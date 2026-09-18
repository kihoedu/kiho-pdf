import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, TABS, TOOL_KEYS, TOOLS } from '../model/ui';
import { EXTRA, OVERVIEW, TAB_GUIDE } from './guide';

/**
 * 도움말이 실제 기능과 어긋나지 않게 지키는 테스트.
 * 여기서 실패하면 기능을 고치면서 도움말(src/model/ui.ts, src/help/guide.ts)을 함께 고치지 않은 것이다.
 */
describe('도움말은 실제 기능과 일치한다', () => {
  it('모든 탭에 내용이 있는 설명이 있다', () => {
    for (const t of TABS) {
      const g = TAB_GUIDE[t.id];
      expect(g, `탭 "${t.label}" 의 도움말`).toBeDefined();
      expect(g.items.length).toBeGreaterThan(0);
    }
    expect(Object.keys(TAB_GUIDE).sort()).toEqual(TABS.map((t) => t.id).sort());
    for (const s of [OVERVIEW, ...EXTRA]) expect(s.items.length).toBeGreaterThan(0);
  });

  it('모든 도구에 사용법이 있고 단축키가 겹치지 않는다', () => {
    for (const t of TOOLS) expect(t.hint.length, `도구 "${t.label}" 의 사용법`).toBeGreaterThan(10);
    const keys = TOOLS.flatMap((t) => (t.key ? [t.key] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(TOOL_KEYS).sort()).toEqual([...keys].sort());
  });

  it('App.tsx 가 처리하는 모든 키가 도움말 단축키 표에 있다', () => {
    const src = readFileSync('src/App.tsx', 'utf8');
    const handled = new Set<string>();
    // `mod && key === 'o'` 또는 `key === 'home'` 꼴의 비교를 모두 모은다.
    for (const m of src.matchAll(/(mod && )?key === '([a-z0-9]+)'/g)) handled.add(`${m[1] ? 'mod+' : ''}${m[2]}`);
    expect(handled.size).toBeGreaterThan(10); // 정규식이 코드 모양과 어긋나 아무것도 못 잡는 경우 방지

    const documented = new Set(SHORTCUTS.flatMap((s) => s.codes ?? []));
    const missing = [...handled].filter((k) => !documented.has(k));
    expect(missing, '도움말에 없는 단축키 — src/model/ui.ts 의 SHORTCUTS 에 추가하세요').toEqual([]);

    // 반대로, 도움말에만 있고 실제로는 처리하지 않는 키도 없어야 한다.
    const stale = [...documented].filter((k) => !handled.has(k));
    expect(stale, '더 이상 처리하지 않는 단축키가 도움말에 남아 있습니다').toEqual([]);

    // 도구 단축키는 다른 한 글자 단축키와 충돌하지 않아야 한다.
    for (const k of Object.keys(TOOL_KEYS)) expect(handled.has(k), `도구 키 "${k}" 가 다른 단축키와 겹칩니다`).toBe(false);
  });
});
