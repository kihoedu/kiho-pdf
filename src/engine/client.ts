import type { BuildRequest, EngineRequest, EngineResponse, OptimizeStats } from './protocol';

export type OutputHandler = (index: number, name: string, bytes: Uint8Array, stats?: OptimizeStats) => void | Promise<void>;

let worker: Worker | undefined;
let nextJob = 1;
const jobs = new Map<
  number,
  {
    onOutput: OutputHandler;
    onProgress?: (text: string) => void;
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

export function forgetSources(srcIds?: string[]): void {
  worker?.postMessage({ type: 'forget', srcIds } satisfies EngineRequest);
}
