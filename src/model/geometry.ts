import type { Box, Rot } from './types';

export interface Pt {
  x: number;
  y: number;
}

/** 회전 rot 상태에서 scale=1 뷰의 크기(pt). */
export function viewSize(box: Box, rot: Rot): { w: number; h: number } {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  return rot % 180 === 0 ? { w, h } : { w: h, h: w };
}

/** 뷰 좌표(좌상단 원점, y 아래로) → PDF 사용자 공간. PDF.js PageViewport 와 같은 규약. */
export function viewToPdf(p: Pt, box: Box, rot: Rot): Pt {
  const [x0, y0, x1, y1] = box;
  switch (rot) {
    case 0:
      return { x: x0 + p.x, y: y1 - p.y };
    case 90:
      return { x: x0 + p.y, y: y0 + p.x };
    case 180:
      return { x: x1 - p.x, y: y0 + p.y };
    case 270:
      return { x: x1 - p.y, y: y1 - p.x };
  }
}

export function pdfToView(p: Pt, box: Box, rot: Rot): Pt {
  const [x0, y0, x1, y1] = box;
  switch (rot) {
    case 0:
      return { x: p.x - x0, y: y1 - p.y };
    case 90:
      return { x: p.y - y0, y: p.x - x0 };
    case 180:
      return { x: x1 - p.x, y: p.y - y0 };
    case 270:
      return { x: y1 - p.y, y: x1 - p.x };
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 회전 from 의 뷰 사각형을 회전 to 의 뷰 사각형으로 옮긴다(축 정렬 유지). */
export function remapRect(r: Rect, box: Box, from: Rot, to: Rot): Rect {
  if (from === to) return { ...r };
  const a = pdfToView(viewToPdf({ x: r.x, y: r.y }, box, from), box, to);
  const b = pdfToView(viewToPdf({ x: r.x + r.w, y: r.y + r.h }, box, from), box, to);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** [x0,y0,x1,y1,…] 점열을 회전 from 의 뷰에서 회전 to 의 뷰로 옮긴다. */
export function remapPts(pts: number[], box: Box, from: Rot, to: Rot): number[] {
  if (from === to) return pts.slice();
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const p = pdfToView(viewToPdf({ x: pts[i], y: pts[i + 1] }, box, from), box, to);
    out.push(p.x, p.y);
  }
  return out;
}

export function boundsOf(pts: number[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const addRot =(a: number, b: number): Rot => ((((a + b) % 360) + 360) % 360) as Rot;
