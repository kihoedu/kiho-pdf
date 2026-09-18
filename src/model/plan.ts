import type { ShapeDraw } from '../engine/protocol';
import { viewToPdf } from './geometry';
import type { Box, Shape } from './types';

export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 뷰 좌표의 펜 선을 PDF 사용자 공간의 그리기 명령으로 바꾼다. */
export function planShape(s: Shape, box: Box): ShapeDraw {
  const pts: number[] = [];
  for (let i = 0; i + 1 < s.pts.length; i += 2) {
    const p = viewToPdf({ x: s.pts[i], y: s.pts[i + 1] }, box, s.rot);
    pts.push(p.x, p.y);
  }
  return { kind: 'path', pts, color: hexToRgb01(s.color), width: s.width };
}
