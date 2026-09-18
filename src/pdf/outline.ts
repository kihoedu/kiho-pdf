import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OutlineEntry {
  title: string;
  depth: number;
  /** 원본 문서 내 0-based 쪽 번호. 해석 실패 시 -1. */
  srcIndex: number;
}

type RawItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

const cache = new WeakMap<PDFDocumentProxy, Promise<OutlineEntry[]>>();

export function loadOutline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  let p = cache.get(pdf);
  if (!p) {
    p = (async () => {
      const out: OutlineEntry[] = [];
      const walk = async (items: RawItem[] | null, depth: number) => {
        for (const it of items ?? []) {
          let srcIndex = -1;
          try {
            const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
            const ref = dest?.[0];
            if (typeof ref === 'number') srcIndex = ref;
            else if (ref) srcIndex = await pdf.getPageIndex(ref);
          } catch {
            // 잘못된 목적지는 건너뛴다
          }
          out.push({ title: it.title.trim(), depth, srcIndex });
          await walk(it.items, depth + 1);
        }
      };
      await walk(await pdf.getOutline(), 0);
      return out;
    })();
    cache.set(pdf, p);
  }
  return p;
}
