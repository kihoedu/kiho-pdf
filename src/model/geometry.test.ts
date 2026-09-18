import { describe, expect, it } from 'vitest';
import { addRot, pdfToView, remapRect, viewSize, viewToPdf } from './geometry';
import type { Box, Rot } from './types';

const ROTS: Rot[] = [0, 90, 180, 270];
const A4: Box = [0, 0, 595, 842];
const CROPPED: Box = [30, 40, 530, 740];

describe('geometry', () => {
  it('뷰↔PDF 변환은 서로 역함수다', () => {
    for (const box of [A4, CROPPED])
      for (const rot of ROTS) {
        const p = { x: 123.5, y: 77.25 };
        const back = pdfToView(viewToPdf(p, box, rot), box, rot);
        expect(back.x).toBeCloseTo(p.x);
        expect(back.y).toBeCloseTo(p.y);
      }
  });

  it('뷰 원점은 회전별로 올바른 PDF 모서리에 대응한다', () => {
    expect(viewToPdf({ x: 0, y: 0 }, CROPPED, 0)).toEqual({ x: 30, y: 740 }); // 좌상단
    expect(viewToPdf({ x: 0, y: 0 }, CROPPED, 90)).toEqual({ x: 30, y: 40 }); // 좌하단
    expect(viewToPdf({ x: 0, y: 0 }, CROPPED, 180)).toEqual({ x: 530, y: 40 }); // 우하단
    expect(viewToPdf({ x: 0, y: 0 }, CROPPED, 270)).toEqual({ x: 530, y: 740 }); // 우상단
  });

  it('90°/270° 에서는 뷰의 가로·세로가 바뀐다', () => {
    expect(viewSize(A4, 0)).toEqual({ w: 595, h: 842 });
    expect(viewSize(A4, 90)).toEqual({ w: 842, h: 595 });
  });

  it('remapRect 는 크기를 보존하고 왕복하면 원래대로 돌아온다', () => {
    const r = { x: 100, y: 200, w: 300, h: 50 };
    for (const to of ROTS) {
      const m = remapRect(r, A4, 0, to);
      expect(m.w * m.h).toBeCloseTo(r.w * r.h);
      const back = remapRect(m, A4, to, 0);
      expect(back).toEqual(r);
    }
    // 시계 방향 90° 회전: 좌상단 근처 상자는 우상단 근처로 간다
    expect(remapRect(r, A4, 0, 90)).toEqual({ x: 842 - 250, y: 100, w: 50, h: 300 });
  });

  it('addRot 는 음수와 360 초과를 정규화한다', () => {
    expect(addRot(0, -90)).toBe(270);
    expect(addRot(270, 180)).toBe(90);
  });
});
