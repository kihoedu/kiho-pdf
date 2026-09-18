/**
 * 메뉴·도구·단축키 정의의 단일 출처. 우측 메뉴, 키 처리, 도움말이 모두 여기서 읽는다.
 * ⚠ 기능을 추가·변경하면 여기와 src/help/guide.ts 를 함께 고친다(CLAUDE.md 참고).
 */
export type Tab = 'file' | 'view' | 'split' | 'capture' | 'pages' | 'edit';
export type Tool = 'select' | 'text' | 'ink' | 'capture';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'file', label: '파일' },
  { id: 'view', label: '보기' },
  { id: 'split', label: '분할' },
  { id: 'capture', label: '캡처' },
  { id: 'pages', label: '페이지' },
  { id: 'edit', label: '편집' },
];

export interface ToolDef {
  id: Tool;
  label: string;
  /** 단축키(소문자 한 글자). */
  key: string;
  /** 이 도구를 고르면 열리는 탭(도구 단추도 이 탭에 놓인다). */
  tab: Tab;
  hint: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: '↖ 선택', key: 'v', tab: 'edit', hint: '삽입한 항목을 눌러 선택하고, 끌어서 옮기거나 모서리로 크기를 바꿉니다. Delete 로 삭제. 빈 곳에서는 본문 글자를 선택할 수 있습니다.' },
  { id: 'text', label: 'Ｔ 텍스트', key: 't', tab: 'edit', hint: '페이지 위를 드래그해 영역을 정하면 바로 입력합니다(클릭만 해도 됩니다). 상자 밖을 누르면 확정됩니다.' },
  { id: 'ink', label: '✎ 펜', key: 'p', tab: 'edit', hint: '자유롭게 그립니다. 서명·체크 표시에 쓸 수 있습니다.' },
  { id: 'capture', label: '⛶ 영역 캡처', key: 'c', tab: 'capture', hint: '캡처할 영역을 드래그하세요. 놓는 즉시 목록에 담기고, 도구는 켜진 채로 남아 계속 캡처할 수 있습니다.' },
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key, t.id]));
export const toolDef = (id: Tool): ToolDef => TOOLS.find((t) => t.id === id)!;

export interface ShortcutDef {
  /** 화면에 보여 줄 키 표기. */
  keys: string[];
  desc: string;
  group: '파일' | '이동·보기' | '편집' | '분할' | '캡처' | '마우스';
  /**
   * App.tsx 의 키 처리와 대조하기 위한 식별자(소문자 e.key, Ctrl/⌘ 조합은 'mod+' 접두).
   * 도움말 누락을 테스트(src/help/guide.test.ts)가 잡아낸다.
   */
  codes?: string[];
}

export const SHORTCUTS: ShortcutDef[] = [
  { group: '파일', keys: ['Ctrl+O'], desc: 'PDF 열기', codes: ['mod+o'] },
  { group: '파일', keys: ['Ctrl+S'], desc: '다른 이름으로 저장(무손실)', codes: ['mod+s'] },
  { group: '파일', keys: ['Ctrl+P'], desc: '인쇄', codes: ['mod+p'] },
  { group: '파일', keys: ['F1'], desc: '도움말 열기 / 닫기', codes: ['f1'] },

  { group: '이동·보기', keys: ['←', 'PgUp'], desc: '이전 쪽', codes: ['arrowleft', 'pageup'] },
  { group: '이동·보기', keys: ['→', 'PgDn'], desc: '다음 쪽', codes: ['arrowright', 'pagedown'] },
  { group: '이동·보기', keys: ['Home', 'End'], desc: '첫 쪽 / 마지막 쪽', codes: ['home', 'end'] },
  { group: '이동·보기', keys: ['Ctrl+휠'], desc: '확대 / 축소' },
  { group: '이동·보기', keys: ['휠(끝에서 계속)'], desc: '쪽의 맨 위·맨 아래에서 더 굴리면 이전·다음 쪽으로 넘어갑니다' },

  { group: '편집', keys: ['Ctrl+Z'], desc: '실행 취소', codes: ['mod+z'] },
  { group: '편집', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], desc: '다시 실행', codes: ['mod+y'] },
  { group: '편집', keys: ['Esc'], desc: '선택 도구로 돌아가기 · 입력 중인 텍스트 확정 · 도움말 닫기', codes: ['escape'] },
  { group: '편집', keys: ['Delete', 'Backspace'], desc: '선택한 삽입 항목 또는 캡처 영역 삭제', codes: ['delete', 'backspace'] },

  { group: '분할', keys: ['Enter'], desc: '(분할 탭) 현재 쪽에서 그룹 종료 → 파일명 입력란으로 이동', codes: ['enter'] },
  { group: '분할', keys: ['Enter'], desc: '(파일명 입력란) 이름 확정 후 다음 묶음의 첫 쪽으로 이동' },

  { group: '캡처', keys: ['드래그'], desc: '(영역 캡처 도구) 끌어 놓은 영역을 캡처 목록에 담기' },
  { group: '캡처', keys: ['Enter'], desc: '(캡처 이름 입력란) 이름 확정' },

  { group: '마우스', keys: ['썸네일 클릭'], desc: '그 쪽으로 이동' },
  { group: '마우스', keys: ['Ctrl+클릭', 'Shift+클릭'], desc: '썸네일 여러 개 선택 / 범위 선택' },
  { group: '마우스', keys: ['썸네일 끌기'], desc: '쪽 순서 바꾸기(선택한 여러 쪽을 함께)' },
  { group: '마우스', keys: ['썸네일 사이 ✂'], desc: '(분할 탭) 분할 지점 켜기 / 끄기' },
  { group: '마우스', keys: ['분할선 끌기', '더블클릭'], desc: '위·아래 화면 높이 조절 / 자동 높이(750px × 배율)로 복귀' },
  { group: '마우스', keys: ['파일 끌어다 놓기'], desc: 'PDF 열기. Shift 를 누른 채 놓으면 현재 문서에 삽입(병합)' },
];
