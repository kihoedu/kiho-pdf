import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';

export interface PageText {
  content: TextContent;
}

const cache = new Map<string, Promise<PageText>>();

/** 본문은 원본 쪽 기준으로 캐시한다(순서 변경·회전과 무관). */
export const pageTextKey = (p: { srcId: string; srcIndex: number }): string => `${p.srcId}:${p.srcIndex}`;

export function getPageText(key: string, page: PDFPageProxy): Promise<PageText> {
  let p = cache.get(key);
  if (!p) {
    p = page.getTextContent().then((content) => ({ content }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function clearPageTexts(): void {
  cache.clear();
}
