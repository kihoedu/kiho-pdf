import { describe, expect, it } from 'vitest';
import { pdfToView } from './geometry';
import { hexToRgb01, planShape } from './plan';
import type { Box, Rot, Shape } from './types';

describe('hexToRgb01', () => {
  it('#rrggbb → 0..1', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
    const [r, g, b] = hexToRgb01('#d63031');
    expect(r).toBeCloseTo(0xd6 / 255);
    expect(g).toBeCloseTo(0x30 / 255);
    expect(b).toBeCloseTo(0x31 / 255);
  });
});

describe('planShape', () => {
  const box: Box = [50, 100, 450, 700]; // CropBox 오프셋이 있는 쪽
  const shape = (rot: Rot): Shape => ({ id: 's', kind: 'ink', rot, pts: [10, 20, 30, 45, 60, 5], color: '#ff0000', width: 2.5 });

  it('색·굵기를 그대로 옮기고 점 개수를 보존한다', () => {
    const d = planShape(shape(0), box);
    expect(d).toMatchObject({ kind: 'path', color: [1, 0, 0], width: 2.5 });
    expect(d.pts).toHaveLength(6);
  });

  it('회전 0: x 는 CropBox 왼쪽에서, y 는 위에서 아래로 뒤집힌다', () => {
    expect(planShape(shape(0), box).pts).toEqual([60, 680, 80, 655, 110, 695]);
  });

  it('모든 회전에서 PDF 좌표를 다시 뷰로 옮기면 원래 점이 된다', () => {
    for (const rot of [0, 90, 180, 270] as Rot[]) {
      const s = shape(rot);
      const d = planShape(s, box);
      const back: number[] = [];
      for (let i = 0; i < d.pts.length; i += 2) {
        const p = pdfToView({ x: d.pts[i], y: d.pts[i + 1] }, box, rot);
        back.push(p.x, p.y);
      }
      expect(back).toEqual(s.pts);
    }
  });

  it('홀수 개 좌표가 들어와도 짝이 맞는 점만 쓴다', () => {
    expect(planShape({ ...shape(0), pts: [1, 2, 3] }, box).pts).toHaveLength(2);
  });
});
