import type { PDFPageProxy } from 'pdfjs-dist';
import type { Rot } from '../model/types';

const MAX_CANVAS_PIXELS = 24_000_000;

export interface RenderHandle {
  promise: Promise<HTMLCanvasElement>;
  cancel(): void;
}

/** 페이지를 새 캔버스에 그린다. scale 은 CSS px/pt, 실제 픽셀은 dpr 을 곱한다. */
export function renderToCanvas(page: PDFPageProxy, scale: number, rotation: Rot, dpr: number): RenderHandle {
  let vp = page.getViewport({ scale: scale * dpr, rotation });
  const px = vp.width * vp.height;
  if (px > MAX_CANVAS_PIXELS) {
    vp = page.getViewport({ scale: scale * dpr * Math.sqrt(MAX_CANVAS_PIXELS / px), rotation });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const task = page.render({ canvas, viewport: vp });
  return {
    promise: task.promise.then(() => canvas),
    cancel: () => task.cancel(),
  };
}

export function isCancel(e: unknown): boolean {
  return e instanceof Error && e.name === 'RenderingCancelledException';
}

/** 단순 LRU. 캔버스/비트맵처럼 큰 객체를 개수 제한으로 보관한다. */
export class Lru<V> {
  #map = new Map<string, V>();
  constructor(
    private limit: number,
    private dispose?: (v: V) => void,
  ) {}
  get(key: string): V | undefined {
    const v = this.#map.get(key);
    if (v !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): void {
    this.#map.delete(key);
    this.#map.set(key, v);
    while (this.#map.size > this.limit) {
      const [k, old] = this.#map.entries().next().value as [string, V];
      this.#map.delete(k);
      this.dispose?.(old);
    }
  }
  clear(): void {
    for (const v of this.#map.values()) this.dispose?.(v);
    this.#map.clear();
  }
}

/**
 * 썸네일용 작업 큐. 가장 최근에 요청된(=지금 보이는) 것부터 처리하고,
 * 차례가 왔을 때 더 이상 필요 없으면 건너뛴다.
 */
export class ThumbQueue {
  #stack: { wanted: () => boolean; run: () => Promise<void> }[] = [];
  #running = 0;
  constructor(private concurrency = 2) {}
  /** 일이 메인 스레드를 쓰지 않는 동안에는 더 많이 돌려도 된다(pdf/thumbs.ts 의 빠른 경로). */
  setConcurrency(n: number): void {
    if (n === this.concurrency) return;
    this.concurrency = n;
    this.#pump();
  }
  push(wanted: () => boolean, run: () => Promise<void>): void {
    this.#stack.push({ wanted, run });
    this.#pump();
  }
  clear(): void {
    this.#stack.length = 0;
  }
  #pump(): void {
    while (this.#running < this.concurrency && this.#stack.length) {
      const job = this.#stack.pop()!;
      if (!job.wanted()) continue;
      this.#running++;
      job
        .run()
        .catch((e) => {
          if (!isCancel(e)) console.error(e);
        })
        .finally(() => {
          this.#running--;
          this.#pump();
        });
    }
  }
}
