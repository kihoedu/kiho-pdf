import { uid, type Rot, type Shape, type TextBox } from './types';

/**
 * 삽입 항목(텍스트·펜 선)을 저장본 안에 함께 적어 두는 형식.
 * 저장할 때 본문에 그리는 것과 별도로 이 기록을 쪽에 남겨 두면, 다시 열었을 때 그린 부분을 걷어 내고
 * 같은 항목을 편집 가능한 상태로 되살릴 수 있다. 파일 안의 값은 믿을 수 없는 입력이므로 엄격하게 검증한다.
 */
export const EDITS_VERSION = 1;
/** 문서 정보(Info)에 두는 표시의 키. 열 때 이것만 보고 기록을 되살릴지 정한다. */
export const EDITS_INFO_KEY = 'KihoEdits';
/** 한 쪽의 기록이 이보다 크면(문자 수) 되살리지 않는다. */
const MAX_JSON_CHARS = 8_000_000;
const MAX_TEXT_CHARS = 200_000;

export interface PageEdits {
  texts: TextBox[];
  shapes: Shape[];
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** 내용이 없는 텍스트 상자는 저장본에 그려지지 않으므로 기록에서도 뺀다. 남길 것이 없으면 undefined. */
export function encodeEdits(p: PageEdits): string | undefined {
  const t = p.texts
    .filter((x) => x.text.trim())
    .map((x) => ({ x: r2(x.x), y: r2(x.y), w: r2(x.w), h: r2(x.h), r: x.rot, s: x.size, c: x.color, t: x.text }));
  const s = p.shapes.map((x) => ({ r: x.rot, c: x.color, w: x.width, p: x.pts.map(r2) }));
  if (!t.length && !s.length) return undefined;
  return JSON.stringify({ v: EDITS_VERSION, t, s });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRot = (v: unknown): v is Rot => v === 0 || v === 90 || v === 180 || v === 270;
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** 형식이 조금이라도 어긋나면 undefined(그 쪽은 되살리지 않고 본문에 고정된 채로 둔다). */
export function decodeEdits(json: string): PageEdits | undefined {
  if (json.length > MAX_JSON_CHARS) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const { v, t, s } = raw as { v?: unknown; t?: unknown; s?: unknown };
  if (v !== EDITS_VERSION || !Array.isArray(t) || !Array.isArray(s)) return undefined;

  const texts: TextBox[] = [];
  for (const x of t as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object') return undefined;
    if (![x.x, x.y, x.w, x.h, x.s].every(isNum) || !isRot(x.r) || !isColor(x.c) || typeof x.t !== 'string') return undefined;
    const size = x.s as number;
    if (size <= 0 || size > 1000 || (x.w as number) <= 0 || (x.h as number) <= 0 || x.t.length > MAX_TEXT_CHARS) return undefined;
    texts.push({ id: uid(), x: x.x as number, y: x.y as number, w: x.w as number, h: x.h as number, rot: x.r, size, color: x.c, text: x.t });
  }

  const shapes: Shape[] = [];
  for (const x of s as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object') return undefined;
    const pts = x.p;
    if (!isRot(x.r) || !isColor(x.c) || !isNum(x.w) || x.w <= 0 || x.w > 1000) return undefined;
    if (!Array.isArray(pts) || pts.length < 4 || pts.length % 2 || !pts.every(isNum)) return undefined;
    shapes.push({ id: uid(), kind: 'ink', rot: x.r, color: x.c, width: x.w, pts: pts as number[] });
  }
  return texts.length || shapes.length ? { texts, shapes } : undefined;
}
