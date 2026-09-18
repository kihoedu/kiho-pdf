import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  DEFAULT_TEMPLATE,
  endGroupAt,
  everyN,
  finalFileNames,
  fromBookmarks,
  normalize,
  parseRangeList,
  sanitizeFileName,
  toggleCut,
  unassignedPages,
  validate,
} from './groups';
import type { SplitGroup } from './types';

const ranges = (gs: SplitGroup[]) => [...gs].sort((a, b) => a.start - b.start).map((g) => `${g.start}-${g.end}`);
const named = (start: number, end: number, name: string): SplitGroup => ({ id: `${start}`, start, end, name, auto: false });

describe('이름 템플릿', () => {
  it('자리표시자를 채운다', () => {
    expect(applyTemplate(DEFAULT_TEMPLATE, '문서', 3, 10, 24)).toBe('문서_03_10-24');
    expect(applyTemplate('{번호}-{쪽수}쪽', 'x', 7, 1, 5)).toBe('7-5쪽');
  });
  it('normalize 는 자동 이름만 다시 매긴다', () => {
    const gs = normalize([named(5, 8, '직접입력'), { ...named(1, 4, ''), auto: true }], DEFAULT_TEMPLATE, 'a');
    expect(gs.map((g) => g.name)).toEqual(['a_01_1-4', '직접입력']);
  });
  it('파일명 금지 문자를 바꾼다', () => {
    expect(sanitizeFileName('부속서:1/가?. ')).toBe('부속서_1_가_');
  });
});

describe('분할 지점 토글', () => {
  it('그룹이 없으면 둘로 나눈다', () => {
    expect(ranges(toggleCut([], 4, 12))).toEqual(['1-4', '5-12']);
  });
  it('그룹 안쪽이면 쪼개고, 경계면 합친다', () => {
    const two = toggleCut([], 4, 12);
    const three = toggleCut(two, 8, 12);
    expect(ranges(three)).toEqual(['1-4', '5-8', '9-12']);
    expect(ranges(toggleCut(three, 4, 12))).toEqual(['1-8', '9-12']);
  });
  it('미할당 구간 옆에서는 빈 곳을 채우는 그룹을 만든다', () => {
    expect(ranges(toggleCut([named(1, 3, 'a')], 3, 12))).toEqual(['1-3', '4-12']);
    expect(ranges(toggleCut([named(6, 9, 'b')], 5, 12))).toEqual(['1-5', '6-9']);
  });
  it('범위를 벗어난 위치는 무시한다', () => {
    expect(toggleCut([], 12, 12)).toEqual([]);
  });
});

describe('현재 쪽에서 그룹 종료', () => {
  it('직전 그룹 다음 쪽부터 묶는다', () => {
    const a = endGroupAt([], 3);
    expect(ranges(a.groups)).toEqual(['1-3']);
    const b = endGroupAt(a.groups, 7);
    expect(ranges(b.groups)).toEqual(['1-3', '4-7']);
    expect(b.groups.find((g) => g.id === b.focusId)?.start).toBe(4);
  });
  it('기존 그룹 안이면 그 자리에서 쪼갠다', () => {
    const r = endGroupAt([named(1, 10, 'a')], 4);
    expect(ranges(r.groups)).toEqual(['1-4', '5-10']);
    expect(r.groups.find((g) => g.id === r.focusId)?.name).toBe('a');
  });
});

describe('자동 생성', () => {
  it('N쪽마다', () => {
    expect(ranges(everyN(10, 4))).toEqual(['1-4', '5-8', '9-10']);
  });
  it('북마크 기준: 제목이 파일명이 되고 다음 북마크 직전까지 묶는다', () => {
    const gs = fromBookmarks([{ title: '2장', page: 5 }, { title: '1장', page: 1 }, { title: '중복', page: 5 }], 9);
    expect(gs.map((g) => `${g.start}-${g.end}:${g.name}`)).toEqual(['1-4:1장', '5-9:중복']);
  });
  it('범위 목록 붙여넣기', () => {
    const { groups, errors } = parseRangeList('1-5 계약서\n6~12\t부속서\n13\n\nxyz');
    expect(groups.map((g) => [g.start, g.end, g.name, g.auto])).toEqual([
      [1, 5, '계약서', false],
      [6, 12, '부속서', false],
      [13, 13, '', true],
    ]);
    expect(errors).toHaveLength(1);
  });
});

describe('검증', () => {
  it('겹침·범위 초과·빈 이름·금지 문자를 잡는다', () => {
    const msgs = validate([named(1, 5, 'a'), named(5, 8, 'b'), named(9, 99, ''), named(10, 11, 'x:y')], 12).map((i) => i.message);
    expect(msgs.some((m) => m.includes('겹칩니다'))).toBe(true);
    expect(msgs.some((m) => m.includes('범위'))).toBe(true);
    expect(msgs.some((m) => m.includes('비어'))).toBe(true);
    expect(msgs.some((m) => m.includes('문자'))).toBe(true);
    expect(validate([named(1, 5, 'a'), named(6, 12, 'b')], 12)).toEqual([]);
  });
  it('중복 파일명에는 번호를 붙인다(대소문자 무시)', () => {
    expect(finalFileNames([named(1, 1, 'a'), named(2, 2, 'A'), named(3, 3, 'a_2'), named(4, 4, 'b.pdf')])).toEqual([
      'a.pdf',
      'A_2.pdf',
      'a_2_2.pdf',
      'b.pdf',
    ]);
  });
  it('미할당 쪽수를 센다', () => {
    expect(unassignedPages([named(1, 3, 'a'), named(7, 8, 'b')], 10)).toBe(5);
  });
});
