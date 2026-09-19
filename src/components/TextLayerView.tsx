import { useEffect, useRef } from 'react';
import { TextLayer } from 'pdfjs-dist';
import type { PageItem } from '../model/types';
import { getPageText, pageTextKey } from '../pdf/pageText';
import { getPdfPage } from '../store';
import type { PageGeom } from './PageView';

/** 본문 글자를 마우스로 선택·복사할 수 있게 하는 투명 층. */
export function TextLayerView({ item, geom }: { item: PageItem; geom: PageGeom }) {
  const host = useRef<HTMLDivElement>(null);

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
    })().catch((e) => {
      if (alive && (e as Error)?.name !== 'AbortException') console.error(e);
    });
    return () => {
      alive = false;
      tl?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.uid, geom.rot, geom.scale]);

  return <div className="textLayer" ref={host} />;
}
