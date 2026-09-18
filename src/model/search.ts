/**
 * 본문 찾기의 순수 로직. PDF 의 글자는 조각(item) 단위로 흩어져 있고 조각 사이의 띄어쓰기도 제각각이라
 * (특히 한글은 글자마다 조각이 나뉘거나 임의의 공백이 끼기도 한다) 공백을 모두 뺀 "압축 문자열"에서 찾는다.
 * 대소문자도 구분하지 않는다. 압축 문자열의 각 글자가 어느 조각의 몇 번째 글자였는지 기억해 두면
 * 찾은 위치를 화면의 글자 층(조각마다 span 하나)으로 되돌릴 수 있다.
 */
export interface CompactIndex {
  text: string;
  /** text 의 k 번째 글자가 속한 조각 번호 */
  itemOf: number[];
  /** 그 조각 안에서의 위치(UTF-16 단위) */
  offsetOf: number[];
}

const isSpace = (ch: string): boolean => /\s/.test(ch);

/** 길이가 바뀌지 않는 범위에서만 소문자로 바꾼다(위치 대응이 어긋나지 않게). */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  return lower.length === 1 ? lower : ch;
}

export function compactText(s: string): string {
  let out = '';
  for (let k = 0; k < s.length; k++) if (!isSpace(s[k])) out += foldChar(s[k]);
  return out;
}

export function buildIndex(items: string[]): CompactIndex {
  let text = '';
  const itemOf: number[] = [];
  const offsetOf: number[] = [];
  items.forEach((str, i) => {
    for (let k = 0; k < str.length; k++) {
      if (isSpace(str[k])) continue;
      text += foldChar(str[k]);
      itemOf.push(i);
      offsetOf.push(k);
    }
  });
  return { text, itemOf, offsetOf };
}

/** 겹치지 않는 모든 일치의 시작 위치(압축 문자열 기준). query 는 compactText 를 거친 값이어야 한다. */
export function findAll(text: string, query: string): number[] {
  const out: number[] = [];
  if (!query) return out;
  for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + query.length)) out.push(at);
  return out;
}

export interface ItemRange {
  startItem: number;
  startOffset: number;
  endItem: number;
  /** 끝 위치(그 글자 다음) */
  endOffset: number;
}

export function toItemRange(index: CompactIndex, start: number, length: number): ItemRange {
  const last = start + length - 1;
  return {
    startItem: index.itemOf[start],
    startOffset: index.offsetOf[start],
    endItem: index.itemOf[last],
    endOffset: index.offsetOf[last] + 1,
  };
}

export interface SearchPos {
  /** 쪽의 uid */
  uid: string;
  /** 그 쪽 안에서 몇 번째 일치인지(0부터) */
  i: number;
}

/**
 * 다음/이전 일치로 옮긴다. pages 는 현재 쪽 순서, counts 는 쪽별 일치 수.
 * pos 가 없으면 현재 쪽(current)에서 가장 가까운 일치부터 시작한다. 끝에 닿으면 반대쪽 끝으로 넘어간다.
 */
export function stepPos(
  pages: { uid: string; count: number }[],
  current: number,
  pos: SearchPos | undefined,
  dir: 1 | -1,
): SearchPos | undefined {
  const n = pages.length;
  if (!pages.some((p) => p.count > 0)) return undefined;
  const at = pos ? pages.findIndex((p) => p.uid === pos.uid) : -1;
  if (pos && at >= 0 && pages[at].count > 0) {
    const i = pos.i + dir;
    if (i >= 0 && i < pages[at].count) return { uid: pos.uid, i };
  }
  // 다른 쪽으로: 기준 쪽의 다음(이전)부터 한 바퀴. pos 가 없을 때는 현재 쪽도 포함한다.
  const base = at >= 0 ? at : current;
  for (let k = at >= 0 ? 1 : 0; k <= n; k++) {
    const idx = (((base + dir * k) % n) + n) % n;
    const p = pages[idx];
    if (p.count > 0) return { uid: p.uid, i: dir > 0 ? 0 : p.count - 1 };
  }
  return undefined;
}

/** 전체에서 몇 번째 일치인지(1부터). */
export function ordinalOf(pages: { uid: string; count: number }[], pos: SearchPos | undefined): number {
  if (!pos) return 0;
  let n = 0;
  for (const p of pages) {
    if (p.uid === pos.uid) return n + pos.i + 1;
    n += p.count;
  }
  return 0;
}
