import { devTune } from '../devTune';
import { fastThumb } from '../engine/client';
import { addRot, viewSize } from '../model/geometry';
import type { PageItem } from '../model/types';
import { getPdfPage, useStore } from '../store';
import { fastThumbState, THUMB_CONCURRENCY, thumbCache, thumbQueue } from './caches';
import { pageBox, pageRot } from './loader';
import { renderToCanvas } from './render';

/**
 * 썸네일 한 장을 그린다. 두 경로가 있다.
 *  - 빠른 경로: 쪽 전체를 덮는 이미지 한 장뿐인 쪽(스캔본)은 저장 워커가 그 이미지를 "디코딩하면서 축소"해 준다.
 *    큰 이미지가 메인 스레드로 오지 않고 디코딩도 워커에서 끝난다.
 *  - 기본 경로: 그 밖의 모든 쪽은 지금까지대로 PDF.js 로 그린다.
 * 어느 쪽이든 결과는 같은 캐시에 같은 열쇠로 들어간다.
 */

/** 쪽당 이만큼은 되어야 빠른 경로를 시도한다. 스캔본은 쪽당 수백 KB, 글자 문서는 훨씬 작다. */
const MIN_BYTES_PER_PAGE = 120_000;
/** 맞은 적 없이 이만큼 빗나가면 이 문서에서는 더 묻지 않는다(쓸데없이 pdf-lib 로 파싱하지 않게). */
const GIVE_UP_AFTER = 4;

export const thumbKey = (item: PageItem): string => `${item.uid}|${item.userRot}`;

function worthAsking(srcId: string): boolean {
  if (devTune().noFastThumb) return false;
  const src = useStore.getState().sources[srcId];
  if (!src) return false;
  if (src.file.size / Math.max(1, src.pageCount) < MIN_BYTES_PER_PAGE) return false;
  const st = fastThumbState.get(srcId);
  return !st || st.hits > 0 || st.misses < GIVE_UP_AFTER;
}

async function tryFast(item: PageItem, maxW: number, maxH: number): Promise<HTMLCanvasElement | undefined> {
  const src = useStore.getState().sources[item.srcId];
  if (!src) return;
  const bmp = await fastThumb(
    { id: src.id, file: src.file, password: src.password },
    item.srcIndex,
    maxW,
    maxH,
    item.userRot,
  );
  const st = fastThumbState.get(item.srcId) ?? { hits: 0, misses: 0 };
  if (bmp) st.hits++;
  else st.misses++;
  fastThumbState.set(item.srcId, st);
  // 이 문서가 빠른 경로를 타면 메인 스레드가 놀게 되므로 더 많이 겹쳐 돌린다.
  if (st.hits > 0) thumbQueue.setConcurrency(THUMB_CONCURRENCY.fast);
  if (!bmp) return;
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas;
}

/** maxW·maxH 는 CSS px. 실제 픽셀은 dpr 을 곱한다. */
export async function renderThumb(item: PageItem, maxW: number, maxH: number, dpr: number): Promise<HTMLCanvasElement> {
  const key = thumbKey(item);
  const hit = thumbCache.get(key);
  if (hit) return hit;

  if (worthAsking(item.srcId)) {
    const fast = await tryFast(item, Math.round(maxW * dpr), Math.round(maxH * dpr));
    if (fast) {
      thumbCache.set(key, fast);
      return fast;
    }
  }

  const page = await getPdfPage(item);
  const rot = addRot(pageRot(page), item.userRot);
  const v = viewSize(pageBox(page), rot);
  const canvas = await renderToCanvas(page, Math.min(maxW / v.w, maxH / v.h), rot, dpr).promise;
  thumbCache.set(key, canvas);
  return canvas;
}
