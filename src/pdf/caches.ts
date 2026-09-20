import { Lru, ThumbQueue } from './render';

const release = (c: HTMLCanvasElement) => {
  c.width = c.height = 0; // GPU/메모리 즉시 반환
};

/** 현재 배율로 그린 페이지(현재 쪽 + 앞뒤 선렌더). */
export const pageCache = new Lru<HTMLCanvasElement>(8, release);
/** 썸네일. 키는 `${uid}|${userRot}`(원본 /Rotate 는 uid 마다 고정이라 키에 넣지 않는다 — pdf/thumbs.ts 의 thumbKey). */
export const thumbCache = new Lru<HTMLCanvasElement>(600, release);
/**
 * 썸네일을 한 번에 몇 장씩 그릴지. PDF.js 로 그릴 때는 캔버스 작업이 메인 스레드를 쓰므로 2 를 넘기면 화면이 끊긴다(측정).
 * 빠른 경로는 디코딩이 워커에서 끝나 메인 스레드를 쓰지 않으므로 더 돌릴수록 빨라진다.
 */
export const THUMB_CONCURRENCY = { pdfjs: 2, fast: 4 };
export const thumbQueue = new ThumbQueue(THUMB_CONCURRENCY.pdfjs);
/** 원본별 썸네일 빠른 경로 성적(pdf/thumbs.ts). 맞은 적 없이 계속 빗나가면 그 문서에서는 그만 묻는다. */
export const fastThumbState = new Map<string, { hits: number; misses: number }>();

/** 문서를 닫을 때 호출한다. */
export function clearRenderCaches(): void {
  thumbQueue.clear();
  thumbQueue.setConcurrency(THUMB_CONCURRENCY.pdfjs);
  fastThumbState.clear();
  pageCache.clear();
  thumbCache.clear();
}
