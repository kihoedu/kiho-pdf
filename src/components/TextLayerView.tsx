import { useEffect, useRef, useState } from 'react';
import { TextLayer } from 'pdfjs-dist';
import { buildIndex, findAll, toItemRange } from '../model/search';
import type { PageItem } from '../model/types';
import { getPageText, pageTextKey } from '../pdf/pageText';
import { getPdfPage, useStore } from '../store';
import type { PageGeom } from './PageView';

const FIND_ALL = 'kiho-find';
const FIND_ACTIVE = 'kiho-find-active';

/** CSS Custom Highlight API: DOM 을 건드리지 않고 범위에 색만 입힌다. 없는 브라우저에서는 강조 없이 쪽 이동만 된다. */
const highlights = (): Map<string, Highlight> | undefined =>
  typeof Highlight === 'undefined' ? undefined : (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights;

/** 본문 글자를 마우스로 선택·복사할 수 있게 하는 투명 층. 본문 찾기의 일치도 여기에 강조한다. */
export function TextLayerView({ item, geom }: { item: PageItem; geom: PageGeom }) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<TextLayer>(undefined);
  const [rendered, setRendered] = useState(0);
  const query = useStore((s) => s.search.query);
  const pos = useStore((s) => s.searchPos);
  const activeIndex = pos?.uid === item.uid ? pos.i : -1;

  useEffect(() => {
    const el = host.current!;
    let alive = true;
    let tl: TextLayer | undefined;
    (async () => {
      const page = await getPdfPage(item);
      const pt = await getPageText(pageTextKey(item), page);
      if (!alive) return;
      el.replaceChildren();
      tl = new TextLayer({
        textContentSource: pt.content,
        container: el,
        viewport: page.getViewport({ scale: geom.scale, rotation: geom.rot }),
      });
      await tl.render();
      if (!alive) return;
      layer.current = tl;
      setRendered((n) => n + 1);
    })().catch((e) => {
      if (alive && (e as Error)?.name !== 'AbortException') console.error(e);
    });
    return () => {
      alive = false;
      layer.current = undefined;
      tl?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.uid, geom.rot, geom.scale]);

  useEffect(() => {
    const registry = highlights();
    const tl = layer.current;
    if (!registry || !tl || !query) return;
    const index = buildIndex(tl.textContentItemsStr);
    const divs = tl.textDivs;
    const ranges = findAll(index.text, query).flatMap((at) => {
      const r = toItemRange(index, at, query.length);
      const from = divs[r.startItem]?.firstChild;
      const to = divs[r.endItem]?.firstChild;
      if (!from || !to) return [];
      try {
        const range = new Range();
        range.setStart(from, r.startOffset);
        range.setEnd(to, r.endOffset);
        return [range];
      } catch {
        return []; // 글자 층의 글자 수가 예상과 다르면 그 일치만 건너뛴다
      }
    });
    const active = ranges[activeIndex];
    registry.set(FIND_ALL, new Highlight(...ranges.filter((r) => r !== active)));
    if (active) {
      registry.set(FIND_ACTIVE, new Highlight(active));
      // 지금 가리키는 일치가 화면 밖이면 보이는 곳으로 굴린다.
      const scroller = host.current?.closest('.page-scroll');
      if (scroller) {
        const a = active.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        if (a.top < s.top + 24 || a.bottom > s.bottom - 24) scroller.scrollTop += a.top - s.top - s.height / 3;
        if (a.left < s.left + 24 || a.right > s.right - 24) scroller.scrollLeft += a.left - s.left - s.width / 3;
      }
    }
    return () => {
      registry.delete(FIND_ALL);
      registry.delete(FIND_ACTIVE);
    };
  }, [query, activeIndex, rendered]);

  return <div className="textLayer" ref={host} />;
}
