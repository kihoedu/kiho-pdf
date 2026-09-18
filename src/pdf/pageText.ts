import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import { compactText } from '../model/search';

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

/** 글자 층이 span 으로 만드는 조각과 같은 목록(표시용 마커 등 글자가 없는 항목은 뺀다). */
export const itemStrings = (content: TextContent): string[] =>
  content.items.flatMap((it) => ('str' in it ? [it.str] : []));

const compactCache = new Map<string, Promise<string>>();

/**
 * 본문 찾기용 압축 문자열(model/search). 문서 전체를 훑으므로 쪽마다 TextContent 를 통째로 붙들지 않고
 * 문자열만 남긴다(수백 쪽 문서에서도 메모리가 늘지 않게). 이미 화면에 띄우느라 받아 둔 쪽은 그것을 쓴다.
 */
export function getPageCompact(key: string, page: PDFPageProxy): Promise<string> {
  let p = compactCache.get(key);
  if (!p) {
    p = (cache.get(key)?.then((t) => t.content) ?? page.getTextContent()).then((c) => compactText(itemStrings(c).join('')));
    p.catch(() => compactCache.delete(key));
    compactCache.set(key, p);
  }
  return p;
}

export function clearPageTexts(): void {
  cache.clear();
  compactCache.clear();
}
