import type { BuildRequest, EngineRequest, EngineResponse, OptimizeStats, RestoredPage } from './protocol';

export type OutputHandler = (index: number, name: string, bytes: Uint8Array, stats?: OptimizeStats) => void | Promise<void>;

let worker: Worker | undefined;
let nextJob = 1;
const jobs = new Map<
  number,
  {
    onOutput: OutputHandler;
    onProgress?: (text: string) => void;
    onRestored?: (pages: RestoredPage[], bytes?: Uint8Array) => void;
    onThumb?: (bitmap?: ImageBitmap) => void;
    pending: Promise<void>[];
    resolve: () => void;
    reject: (e: Error) => void;
  }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<EngineResponse>) => {
    const msg = e.data;
    const job = jobs.get(msg.jobId);
    if (!job) return;
    if (msg.type === 'output') {
      job.pending.push(Promise.resolve(job.onOutput(msg.index, msg.name, msg.bytes, msg.stats)));
    } else if (msg.type === 'progress') {
      job.onProgress?.(msg.text);
    } else if (msg.type === 'thumb') {
      jobs.delete(msg.jobId);
      job.onThumb?.(msg.bitmap);
      job.resolve();
    } else if (msg.type === 'restored') {
      jobs.delete(msg.jobId);
      job.onRestored?.(msg.pages, msg.bytes);
      job.resolve();
    } else {
      jobs.delete(msg.jobId);
      if (msg.type === 'error') job.reject(new Error(msg.message));
      else Promise.all(job.pending).then(() => job.resolve(), job.reject);
    }
  };
  // Worker 자체가 죽으면(로드 실패·메모리 부족 등) 대기 중인 작업을 모두 실패 처리하고 다음 호출에서 새로 만든다.
  worker.onerror = (e) => {
    const err = new Error(`저장 엔진 오류: ${e.message || '워커를 시작할 수 없습니다.'}`);
    for (const job of jobs.values()) job.reject(err);
    jobs.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

/** 출력 계획대로 PDF 를 만들고, 완성되는 파일마다 onOutput 을 호출한다. */
export function buildOutputs(
  plan: Omit<BuildRequest, 'type' | 'jobId'>,
  onOutput: OutputHandler,
  onProgress?: (text: string) => void,
): Promise<void> {
  const jobId = nextJob++;
  return new Promise<void>((resolve, reject) => {
    jobs.set(jobId, { onOutput, onProgress, pending: [], resolve, reject });
    const req: EngineRequest = { type: 'build', jobId, ...plan };
    getWorker().postMessage(req);
  });
}

/** 삽입 항목 기록이 있는 파일에서 그려 넣은 부분을 걷어 낸 PDF(bytes)와 쪽별 기록을 받는다. 되살릴 것이 없으면 bytes 가 없다. */
export function restoreSource(source: BuildRequest['sources'][number]): Promise<{ pages: RestoredPage[]; bytes?: Uint8Array }> {
  const jobId = nextJob++;
  return new Promise((resolve, reject) => {
    let result: { pages: RestoredPage[]; bytes?: Uint8Array } = { pages: [] };
    jobs.set(jobId, {
      onOutput: () => {},
      onRestored: (pages, bytes) => (result = { pages, bytes }),
      pending: [],
      resolve: () => resolve(result),
      reject,
    });
    getWorker().postMessage({ type: 'restore', jobId, source } satisfies EngineRequest);
  });
}

/**
 * 썸네일 빠른 경로(engine/pageImage.ts). 쪽 전체를 덮는 이미지가 있으면 워커가 축소 디코딩까지 마친 비트맵을 돌려준다.
 * 맞지 않는 쪽이거나 읽지 못하면 undefined — 호출 쪽은 지금까지대로 PDF.js 로 그린다.
 */
export function fastThumb(
  source: BuildRequest['sources'][number],
  index: number,
  maxW: number,
  maxH: number,
  rotate: number,
): Promise<ImageBitmap | undefined> {
  const jobId = nextJob++;
  return new Promise((resolve) => {
    let bitmap: ImageBitmap | undefined;
    jobs.set(jobId, {
      onOutput: () => {},
      onThumb: (b) => (bitmap = b),
      pending: [],
      resolve: () => resolve(bitmap),
      reject: () => resolve(undefined), // 실패해도 썸네일 그리기를 멈추지 않는다
    });
    getWorker().postMessage({ type: 'thumb', jobId, source, index, maxW, maxH, rotate } satisfies EngineRequest);
  });
}

export function forgetSources(srcIds?: string[]): void {
  worker?.postMessage({ type: 'forget', srcIds } satisfies EngineRequest);
}
