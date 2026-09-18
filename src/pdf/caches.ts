import { Lru, ThumbQueue } from './render';

const release = (c: HTMLCanvasElement) => {
  c.width = c.height = 0; // GPU/메모리 즉시 반환
};

/** 현재 배율로 그린 페이지(현재 쪽 + 앞뒤 선렌더). */
export const pageCache = new Lru<HTMLCanvasElement>(8, release);
/** 썸네일. 키는 `${uid}|${rot}`. */
export const thumbCache = new Lru<HTMLCanvasElement>(600, release);
export const thumbQueue = new ThumbQueue(2);

/** 문서를 닫을 때 호출한다. */
export function clearRenderCaches(): void {
  thumbQueue.clear();
  pageCache.clear();
  thumbCache.clear();
}
