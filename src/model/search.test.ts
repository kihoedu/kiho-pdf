import { describe, expect, it } from 'vitest';
import { buildIndex, compactText, findAll, ordinalOf, stepPos, toItemRange } from './search';

describe('compactText / buildIndex', () => {
  it('공백을 빼고 소문자로 맞춘다', () => {
    expect(compactText('  Hello \t World\n')).toBe('helloworld');
    expect(compactText('계 약 서')).toBe('계약서');
  });

  it('소문자로 바꾸면 길이가 달라지는 글자는 그대로 둔다(위치 대응 유지)', () => {
    const s = 'İx'; // 'İ'.toLowerCase() 는 두 글자
    expect(compactText(s)).toHaveLength(2);
  });

  it('조각으로 흩어진 글자에서 찾고, 조각 위치로 되돌린다', () => {
    const items = ['제1조 (계', ' 약', '', '서) 의 Page', ' One'];
    const index = buildIndex(items);
    expect(index.text).toBe('제1조(계약서)의pageone');

    const [hit] = findAll(index.text, compactText('계약서'));
    expect(toItemRange(index, hit, 3)).toEqual({ startItem: 0, startOffset: 5, endItem: 3, endOffset: 1 });

    const q = compactText('page one');
    const [hit2] = findAll(index.text, q);
    expect(toItemRange(index, hit2, q.length)).toEqual({ startItem: 3, startOffset: 5, endItem: 4, endOffset: 4 });
  });
});

describe('findAll', () => {
  it('겹치지 않게 모두 찾는다', () => {
    expect(findAll('aaaa', 'aa')).toEqual([0, 2]);
    expect(findAll('abcabc', 'bc')).toEqual([1, 4]);
    expect(findAll('abc', '')).toEqual([]);
    expect(findAll('abc', 'x')).toEqual([]);
  });
});

describe('stepPos / ordinalOf', () => {
  const pages = [
    { uid: 'a', count: 0 },
    { uid: 'b', count: 2 },
    { uid: 'c', count: 0 },
    { uid: 'd', count: 1 },
  ];

  it('처음에는 현재 쪽에서 가까운 일치로 간다', () => {
    expect(stepPos(pages, 0, undefined, 1)).toEqual({ uid: 'b', i: 0 });
    expect(stepPos(pages, 1, undefined, 1)).toEqual({ uid: 'b', i: 0 });
    expect(stepPos(pages, 2, undefined, 1)).toEqual({ uid: 'd', i: 0 });
    expect(stepPos(pages, 2, undefined, -1)).toEqual({ uid: 'b', i: 1 });
  });

  it('쪽 안에서 옮기고, 쪽을 넘고, 끝에서 돌아온다', () => {
    expect(stepPos(pages, 1, { uid: 'b', i: 0 }, 1)).toEqual({ uid: 'b', i: 1 });
    expect(stepPos(pages, 1, { uid: 'b', i: 1 }, 1)).toEqual({ uid: 'd', i: 0 });
    expect(stepPos(pages, 3, { uid: 'd', i: 0 }, 1)).toEqual({ uid: 'b', i: 0 });
    expect(stepPos(pages, 1, { uid: 'b', i: 0 }, -1)).toEqual({ uid: 'd', i: 0 });
  });

  it('일치가 한 곳뿐이면 제자리', () => {
    const one = [{ uid: 'a', count: 1 }];
    expect(stepPos(one, 0, { uid: 'a', i: 0 }, 1)).toEqual({ uid: 'a', i: 0 });
  });

  it('일치가 없으면 undefined, 지워진 쪽을 가리키던 위치는 현재 쪽 기준으로 다시 잡는다', () => {
    expect(stepPos([{ uid: 'a', count: 0 }], 0, undefined, 1)).toBeUndefined();
    expect(stepPos(pages, 3, { uid: 'gone', i: 5 }, 1)).toEqual({ uid: 'd', i: 0 });
  });

  it('전체에서 몇 번째인지', () => {
    expect(ordinalOf(pages, { uid: 'b', i: 1 })).toBe(2);
    expect(ordinalOf(pages, { uid: 'd', i: 0 })).toBe(3);
    expect(ordinalOf(pages, undefined)).toBe(0);
  });
});
