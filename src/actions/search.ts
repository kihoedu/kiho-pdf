import { compactText, findAll, ordinalOf, stepPos } from '../model/search';
import { getPageCompact, pageTextKey } from '../pdf/pageText';
import { NO_SEARCH, getPdfPage, useStore } from '../store';

let runId = 0;

/** 쪽 순서대로 (uid, 일치 수). */
export function searchPages(): { uid: string; count: number }[] {
  const { pages, search } = useStore.getState();
  return pages.map((p) => ({ uid: p.uid, count: search.counts[pageTextKey(p)] ?? 0 }));
}

export function clearSearch(): void {
  runId++;
  useStore.setState({ search: NO_SEARCH, searchPos: undefined });
}

/**
 * 문서 전체에서 찾는다. 보고 있는 쪽부터 뒤로 한 바퀴 돌며 쪽별 일치 수를 세고, 첫 일치가 나오는 즉시 그리로 간다.
 * 쪽의 글자는 찾을 때 처음 읽으므로(열기·쪽 전환 속도에는 영향이 없다) 긴 문서에서는 진행 상황을 보여 준다.
 */
export async function runSearch(raw: string): Promise<void> {
  const query = compactText(raw);
  if (!query) return clearSearch();
  const id = ++runId;
  const { pages, current } = useStore.getState();
  const counts: Record<string, number> = {};
  useStore.setState({ search: { raw, query, counts, done: 0, total: pages.length, running: true }, searchPos: undefined });

  let jumped = false;
  for (let k = 0; k < pages.length; k++) {
    const item = pages[(current + k) % pages.length];
    const key = pageTextKey(item);
    if (!(key in counts)) {
      try {
        counts[key] = findAll(await getPageCompact(key, await getPdfPage(item)), query).length;
      } catch (e) {
        console.warn('본문을 읽지 못한 쪽이 있습니다', key, e);
        counts[key] = 0;
      }
      if (id !== runId) return; // 그 사이에 다른 말을 찾기 시작했다
    }
    // 매 쪽마다 화면을 다시 그리지 않도록 가끔씩만 알린다.
    const last = k === pages.length - 1;
    if (last || k % 16 === 15 || (!jumped && counts[key] > 0)) {
      useStore.setState({ search: { raw, query, counts: { ...counts }, done: k + 1, total: pages.length, running: !last } });
    }
    if (!jumped && counts[key] > 0) {
      jumped = true;
      stepSearch(1);
    }
  }
}

export function stepSearch(dir: 1 | -1): void {
  const st = useStore.getState();
  const list = searchPages();
  const pos = stepPos(list, st.current, st.searchPos, dir);
  if (!pos) return;
  const at = st.pages.findIndex((p) => p.uid === pos.uid);
  if (at !== st.current) st.setCurrent(at);
  useStore.setState({ searchPos: pos });
}

/** "3 / 17" 같은 상태 표시에 쓸 값. */
export function searchSummary(): { ordinal: number; total: number } {
  const list = searchPages();
  return { ordinal: ordinalOf(list, useStore.getState().searchPos), total: list.reduce((n, p) => n + p.count, 0) };
}
