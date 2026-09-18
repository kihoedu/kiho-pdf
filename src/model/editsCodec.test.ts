import { describe, expect, it } from 'vitest';
import { decodeEdits, encodeEdits } from './editsCodec';
import type { Shape, TextBox } from './types';

const text: TextBox = { id: 'a', x: 10.123, y: 20, w: 200, h: 40, rot: 90, text: '한글 ABC\n둘째 줄 😀', size: 12, color: '#d63031' };
const ink: Shape = { id: 'b', kind: 'ink', rot: 0, pts: [1, 2, 3.456, 4, 5, 6], color: '#000000', width: 1.5 };

describe('editsCodec', () => {
  it('텍스트·펜 선을 되살린다(id 는 새로 매기고 좌표는 0.01pt 로 반올림)', () => {
    const out = decodeEdits(encodeEdits({ texts: [text], shapes: [ink] })!)!;
    expect(out.texts).toHaveLength(1);
    expect(out.texts[0]).toMatchObject({ ...text, id: expect.any(String), x: 10.12 });
    expect(out.texts[0].id).not.toBe('a');
    expect(out.shapes[0]).toMatchObject({ ...ink, id: expect.any(String), pts: [1, 2, 3.46, 4, 5, 6] });
  });

  it('빈 텍스트 상자는 기록하지 않고, 남길 것이 없으면 undefined', () => {
    expect(encodeEdits({ texts: [{ ...text, text: '  \n' }], shapes: [] })).toBeUndefined();
    const out = decodeEdits(encodeEdits({ texts: [{ ...text, text: ' ' }, text], shapes: [] })!)!;
    expect(out.texts).toHaveLength(1);
  });

  it('어긋난 입력은 통째로 거부한다', () => {
    const good = JSON.parse(encodeEdits({ texts: [text], shapes: [ink] })!);
    const bad = (patch: (o: typeof good) => void) => {
      const o = structuredClone(good);
      patch(o);
      return decodeEdits(JSON.stringify(o));
    };
    expect(decodeEdits('not json')).toBeUndefined();
    expect(decodeEdits('null')).toBeUndefined();
    expect(bad((o) => (o.v = 2))).toBeUndefined();
    expect(bad((o) => (o.t[0].r = 45))).toBeUndefined();
    expect(bad((o) => (o.t[0].c = 'red'))).toBeUndefined();
    expect(bad((o) => (o.t[0].x = null))).toBeUndefined();
    expect(bad((o) => (o.t[0].s = 0))).toBeUndefined();
    expect(bad((o) => (o.t[0].t = 5))).toBeUndefined();
    expect(bad((o) => (o.s[0].p = [1, 2, 3]))).toBeUndefined();
    expect(bad((o) => (o.s[0].p = [1, 2, 'x', 4]))).toBeUndefined();
    expect(bad((o) => (o.s[0].w = -1))).toBeUndefined();
    expect(bad((o) => (o.s = 'x'))).toBeUndefined();
  });
});
