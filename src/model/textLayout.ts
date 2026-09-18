import type { TextBox } from './types';

export const TEXT_FONT_FAMILY = 'KihoText';
export const TEXT_PAD = 2; // pt
export const LINE_HEIGHT = 1.3;
const FONT_URL = `${import.meta.env.BASE_URL}fonts/Pretendard-Regular.ttf`;

let fontPromise: Promise<ArrayBuffer> | undefined;

/** 텍스트 도구를 처음 쓸 때만 폰트를 받는다. 화면 표시와 PDF 임베딩에 같은 파일을 쓴다. */
export function ensureTextFont(): Promise<ArrayBuffer> {
  fontPromise ??= (async () => {
    const buf = await (await fetch(FONT_URL)).arrayBuffer();
    const face = new FontFace(TEXT_FONT_FAMILY, buf.slice(0));
    await face.load();
    document.fonts.add(face);
    return buf;
  })();
  fontPromise.catch(() => (fontPromise = undefined));
  return fontPromise;
}

let measureCtx: CanvasRenderingContext2D | undefined;
function ctxFor(size: number): CanvasRenderingContext2D {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${size}px ${TEXT_FONT_FAMILY}`;
  return measureCtx;
}

export interface LaidLine {
  text: string;
  /** 상자 좌상단 기준, 줄 상단까지의 거리(pt). */
  top: number;
  /** 상자 좌상단 기준, 기준선까지의 거리(pt). */
  baseline: number;
}

/**
 * 글자 단위 탐욕적 줄바꿈(CSS `line-break: anywhere` 와 같은 규칙).
 * 화면 표시와 PDF 기록이 같은 결과를 쓰므로 저장물이 화면과 일치한다.
 */
export function layoutText(tb: Pick<TextBox, 'text' | 'size' | 'w'>): LaidLine[] {
  const ctx = ctxFor(tb.size);
  const maxW = Math.max(tb.size, tb.w - TEXT_PAD * 2);
  const lines: string[] = [];
  for (const para of tb.text.split('\n')) {
    let cur = '';
    for (const ch of Array.from(para)) {
      if (cur && ctx.measureText(cur + ch).width > maxW) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    lines.push(cur);
  }
  const m = ctx.measureText('가Ag');
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  const lh = tb.size * LINE_HEIGHT;
  const baseOff = (lh - (asc + desc)) / 2 + asc;
  return lines.map((text, i) => ({
    text,
    top: TEXT_PAD + i * lh,
    baseline: TEXT_PAD + i * lh + baseOff,
  }));
}

export function neededHeight(lineCount: number, size: number): number {
  return lineCount * size * LINE_HEIGHT + TEXT_PAD * 2;
}
