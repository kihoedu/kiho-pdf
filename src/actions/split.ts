import { endGroupAt } from '../model/groups';
import { useStore } from '../store';

/** "현재 쪽에서 그룹 종료" — 새 그룹의 파일명 칸으로 포커스를 보낸다. */
export function endGroupHere(): void {
  const st = useStore.getState();
  if (!st.pages.length) return;
  const { groups, focusId } = endGroupAt(st.groups, st.current + 1);
  st.setGroups(groups, focusId);
}
