import { sanitizeFileName } from './groups';
import type { Capture, PageItem } from './types';

export const DEFAULT_CAPTURE_TEMPLATE = '{원본}_{쪽}쪽_{번호:02}';
export const CAPTURE_DPIS = [96, 150, 200, 300, 600];
/** 한 장이 이보다 커지면(픽셀 수) 브라우저 캔버스 한계에 걸릴 수 있어 막는다. */
export const MAX_CAPTURE_PIXELS = 120_000_000;

export function applyCaptureTemplate(tpl: string, base: string, pageNo: number, no: number): string {
  return tpl
    .replace(/\{원본\}/g, base)
    .replace(/\{쪽(?::0?(\d+))?\}/g, (_, w) => String(pageNo).padStart(Number(w ?? 1), '0'))
    .replace(/\{번호(?::0?(\d+))?\}/g, (_, w) => String(no).padStart(Number(w ?? 1), '0'));
}

/**
 * 쪽 순서대로(같은 쪽 안에서는 담은 순서대로) 정렬하고 자동 이름을 다시 매긴다.
 * 없어진 쪽의 캡처는 버린다.
 */
export function normalizeCaptures(captures: Capture[], pages: PageItem[], tpl: string, base: string): Capture[] {
  const index = new Map(pages.map((p, i) => [p.uid, i]));
  return captures
    .filter((c) => index.has(c.pageUid))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => index.get(a.c.pageUid)! - index.get(b.c.pageUid)! || a.i - b.i)
    .map(({ c }, i) => (c.auto ? { ...c, name: applyCaptureTemplate(tpl, base, index.get(c.pageUid)! + 1, i + 1) } : c));
}

export interface CaptureIssue {
  id: string;
  message: string;
}

export function validateCaptures(captures: Capture[]): CaptureIssue[] {
  const issues: CaptureIssue[] = [];
  for (const c of captures) {
    if (!c.name.trim()) issues.push({ id: c.id, message: '파일명이 비어 있습니다.' });
    else if (c.name !== sanitizeFileName(c.name)) issues.push({ id: c.id, message: '파일명에 쓸 수 없는 문자가 있습니다.' });
  }
  return issues;
}

/** 확장자를 붙이고, 같은 이름에는 _2, _3… 을 붙인다(대소문자 무시). */
export function uniqueFileNames(names: string[], ext: string): string[] {
  const used = new Set<string>();
  const has = new RegExp(`\\.${ext === 'jpg' ? 'jpe?g' : ext}$`, 'i');
  return names.map((raw) => {
    const base = raw.replace(has, '');
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    return `${name}.${ext}`;
  });
}

/** dpi 로 내보낼 때의 픽셀 크기(w, h 는 내보낼 방향 기준 pt). */
export function capturePixels(c: { w: number; h: number }, dpi: number): { w: number; h: number } {
  return { w: Math.max(1, Math.round((c.w * dpi) / 72)), h: Math.max(1, Math.round((c.h * dpi) / 72)) };
}

/** 캡처한 뒤 쪽을 90°/270° 돌렸다면 내보낼 이미지는 가로·세로가 바뀐다. */
export function orientedSize(c: Capture, pageUserRot: number): { w: number; h: number } {
  return (pageUserRot - c.userRot) % 180 === 0 ? { w: c.w, h: c.h } : { w: c.h, h: c.w };
}
