import { useEffect, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { addRot, viewSize } from '../model/geometry';
import { CSS_UNITS, type Box, type PageItem, type Rot } from '../model/types';
import { pageBox, pageRot } from '../pdf/loader';
import { pageCache, thumbCache } from '../pdf/caches';
import { thumbKey } from '../pdf/thumbs';
import { isCancel, renderToCanvas, type RenderHandle } from '../pdf/render';
import { getPdfPage, useStore } from '../store';
import { Overlay } from './Overlay';
import { TextLayerView } from './TextLayerView';

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const cacheKey = (p: PageItem, rot: Rot, scale: number) => `${p.uid}|${rot}|${scale.toFixed(4)}|${dpr()}`;

export interface PageGeom {
  /** 이 값이 계산된 페이지. 쪽이 바뀐 직후 이전 쪽의 값으로 층을 그리지 않기 위해 확인한다. */
  uid: string;
  box: Box;
  rot: Rot; // 원본 /Rotate + 사용자 회전
  scale: number; // CSS px / pt
}

export function PageView() {
  const item = useStore((s) => s.pages[s.current]);
  const zoom = useStore((s) => s.zoom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<PageGeom>();
  const scale = zoom * CSS_UNITS;

  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => useStore.getState().setPaneSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 페이지가 바뀌면 맨 위로
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [item?.uid]);

  useEffect(() => {
    if (!item) {
      setGeom(undefined);
      canvasHost.current?.replaceChildren();
      return;
    }
    let alive = true;
    let handle: RenderHandle | undefined;
    const show = (c: HTMLCanvasElement | undefined) => {
      if (c) canvasHost.current?.replaceChildren(c);
    };

    (async () => {
      const page = await getPdfPage(item);
      if (!alive) return;
      const rot = addRot(pageRot(page), item.userRot);
      setGeom({ uid: item.uid, box: pageBox(page), rot, scale });

      const key = cacheKey(item, rot, scale);
      const hit = pageCache.get(key);
      if (hit) {
        show(hit);
      } else {
        // 본 렌더가 끝날 때까지 썸네일을 늘려서 먼저 보여 준다.
        const thumb = thumbCache.get(thumbKey(item));
        if (thumb) show(cloneCanvas(thumb));
        handle = renderToCanvas(page, scale, rot, dpr());
        const canvas = await handle.promise;
        pageCache.set(key, canvas);
        if (!alive) return;
        show(canvas);
      }
      prerenderNeighbors(item, scale, () => alive);
    })().catch((e) => {
      if (!isCancel(e)) console.error(e);
    });

    return () => {
      alive = false;
      handle?.cancel();
    };
    // 텍스트 편집으로 item 객체만 바뀐 경우에는 다시 그리지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.uid, item?.userRot, scale]);

  // Ctrl+휠 = 확대/축소, 끝에서 더 굴리면 앞/뒤 페이지
  useEffect(() => {
    const el = scrollRef.current!;
    let over = 0;
    const onWheel = (e: WheelEvent) => {
      const st = useStore.getState();
      if (e.ctrlKey) {
        e.preventDefault();
        st.setZoom(st.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        return;
      }
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop)) {
        over += e.deltaY;
        if (Math.abs(over) > 250) {
          const dir = Math.sign(over);
          over = 0;
          const target = st.current + dir;
          if (target >= 0 && target < st.pages.length) {
            st.setCurrent(target);
            if (dir < 0) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
          }
        }
      } else {
        over = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const size = geom && viewSize(geom.box, geom.rot);
  return (
    <div className="page-scroll" ref={scrollRef}>
      {item ? (
        <div
          className="page-sheet"
          style={{
            ...(size ? { width: size.w * scale, height: size.h * scale } : { width: 595 * scale, height: 842 * scale }),
            // PDF.js 텍스트 레이어가 크기 계산에 쓰는 변수
            ['--total-scale-factor' as string]: scale,
            ['--scale-round-x' as string]: '1px',
            ['--scale-round-y' as string]: '1px',
          }}
          onPointerDown={(e) => {
            // 객체 밖을 누르면 선택 해제
            if (!(e.target as Element).closest('.mark')) useStore.getState().setActiveText(undefined);
          }}
        >
          <div className="page-canvas" ref={canvasHost} />
          {geom && geom.uid === item.uid && (
            <>
              <TextLayerView item={item} geom={{ ...geom, scale }} />
              <Overlay item={item} geom={{ ...geom, scale }} />
            </>
          )}
        </div>
      ) : (
        <div className="empty-hint">
          PDF 파일을 이 창에 끌어다 놓거나, 오른쪽 <b>파일 › 열기</b>를 누르세요.
        </div>
      )}
    </div>
  );
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** 앞뒤 1쪽을 미리 그려 두어 페이지 전환을 즉시 처리한다. */
function prerenderNeighbors(item: PageItem, scale: number, alive: () => boolean): void {
  const { pages } = useStore.getState();
  const idx = pages.findIndex((p) => p.uid === item.uid);
  for (const n of [pages[idx + 1], pages[idx - 1]]) {
    if (!n) continue;
    getPdfPage(n)
      .then(async (page: PDFPageProxy) => {
        const rot = addRot(pageRot(page), n.userRot);
        const key = cacheKey(n, rot, scale);
        if (!alive() || pageCache.get(key)) return;
        pageCache.set(key, await renderToCanvas(page, scale, rot, dpr()).promise);
      })
      .catch((e) => {
        if (!isCancel(e)) console.error(e);
      });
  }
}
