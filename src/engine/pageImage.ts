import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream, type PDFPage } from '@cantoo/pdf-lib';

/**
 * 썸네일 빠른 경로: "쪽 전체를 이미지 한 장으로 덮은 쪽"(스캔본이 거의 그렇다)을 찾아 그 이미지의 원본 바이트를 돌려준다.
 *
 * 왜: PDF.js 는 300dpi 이미지를 원래 크기(2480×3508)로 펼친 뒤 썸네일 크기로 줄인다. 브라우저 디코더에 목표 크기를 알려 주면
 * 디코딩하면서 바로 줄이므로 훨씬 빠르다(측정은 README 벤치마크 절). 대신 "그 이미지만 그리면 쪽 전체가 된다"가
 * 반드시 참이어야 한다 — 조금이라도 어긋나면 undefined 를 돌려주고 호출 쪽이 지금까지의 PDF.js 경로로 그린다.
 */
export interface FullPageImage {
  /** 원본 스트림 바이트 그대로(DCTDecode 는 곧 JPEG 파일이다). 다시 인코딩하지 않는다. */
  bytes: Uint8Array;
  mime: 'image/jpeg';
  width: number;
  height: number;
}

/** 이미지가 쪽을 "덮는다"고 볼 오차(쪽 크기 대비). 만드는 프로그램이 반올림으로 흘리는 정도만 봐준다. */
const COVER_TOL = 0.004;
/** 콘텐츠 스트림이 이보다 크면 단순한 쪽이 아니다. 압축을 풀기 전에 먼저 걸러 큰 스트림을 헛되이 펼치지 않는다. */
const MAX_CONTENT_BYTES = 64 * 1024;
/** PDF 숫자(지수 표기는 쓰지 않는다). */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** [a, b, c, d, e, f] */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** PDF 의 cm 은 새 행렬을 현재 행렬 "앞"에 곱한다. */
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

interface Placement {
  name: string;
  /** 이미지(단위 정사각형)가 놓인 자리 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 콘텐츠를 훑어 "이미지 하나를 그리는 것이 전부인가"를 본다. q·Q·cm·Do 만 허용하고 그 밖의 연산자가 하나라도
 * 나오면 포기한다(글자·선·인라인 이미지·투명도 등). cm 은 제대로 합성한다 — 만드는 프로그램마다 항등 행렬을
 * 덧붙이거나 이동과 확대를 나눠 쓰기 때문에 한 줄로 단정할 수 없다.
 */
function soleImagePlacement(text: string): Placement | undefined {
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const operands: string[] = [];
  let found: Placement | undefined;

  for (const token of text.split(' ')) {
    if (!token) continue;
    if (NUMBER.test(token) || token.startsWith('/')) {
      if (operands.length > 8) return; // 연산자 없이 피연산자만 쌓이면 우리가 모르는 문법이다
      operands.push(token);
      continue;
    }
    switch (token) {
      case 'q':
        if (operands.length) return;
        stack.push(ctm);
        break;
      case 'Q': {
        if (operands.length) return;
        const prev = stack.pop();
        if (!prev) return;
        ctm = prev;
        break;
      }
      case 'cm': {
        if (operands.length !== 6 || !operands.every((o) => NUMBER.test(o))) return;
        ctm = mul(operands.map(Number) as Matrix, ctm);
        operands.length = 0;
        break;
      }
      case 'Do': {
        if (found || operands.length !== 1 || !operands[0].startsWith('/')) return; // 두 번 그리면 포기
        const [a, b, c, d, e, fy] = ctm;
        if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return; // 기울이거나 돌려 놓았다
        if (!(a > 0) || !(d > 0)) return; // 뒤집어 놓았다
        found = { name: operands[0].slice(1), x: e, y: fy, w: a, h: d };
        operands.length = 0;
        break;
      }
      default:
        return; // 그 밖의 연산자가 있으면 이미지 한 장으로 설명되지 않는다
    }
  }
  return found;
}

const num = (dict: PDFDict, key: string): number => {
  const v = dict.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : 0;
};

const names = (obj: unknown): string[] =>
  obj instanceof PDFName ? [obj.decodeText()] : obj instanceof PDFArray ? obj.asArray().flatMap(names) : [];

/** 쪽의 콘텐츠 스트림을 모아 공백을 정규화한 문자열로. 너무 길거나 스트림이 아니면 undefined. */
function contentText(page: PDFPage): string | undefined {
  const contents = page.node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map((_, i) => contents.lookup(i)) : [contents];
  let total = 0;
  const parts: string[] = [];
  for (const s of streams) {
    if (!(s instanceof PDFRawStream)) return;
    total += s.contents.length;
    if (total > MAX_CONTENT_BYTES) return;
    parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()));
  }
  const text = parts.join('\n').replace(/\s+/g, ' ').trim();
  return text.length > MAX_CONTENT_BYTES ? undefined : text;
}

/** 주석이 하나라도 있으면 빠른 경로를 쓰지 않는다(PDF.js 는 썸네일에도 주석을 그린다). */
function hasAnnots(page: PDFPage): boolean {
  const a = page.node.lookup(PDFName.of('Annots'));
  return a instanceof PDFArray && a.size() > 0;
}

export function fullPageImage(page: PDFPage): FullPageImage | undefined {
  if (hasAnnots(page)) return;
  const text = contentText(page);
  const placed = text === undefined ? undefined : soleImagePlacement(text);
  if (!placed) return;

  // 화면에 보이는 것은 CropBox 다. 이미지가 그 영역과 어긋나면(작거나 커서 잘라야 하면) 받지 않는다.
  const box = page.getCropBox();
  const okX = Math.abs(placed.x - box.x) <= COVER_TOL * box.width;
  const okY = Math.abs(placed.y - box.y) <= COVER_TOL * box.height;
  const okW = Math.abs(placed.w - box.width) <= COVER_TOL * box.width;
  const okH = Math.abs(placed.h - box.height) <= COVER_TOL * box.height;
  if (!okX || !okY || !okW || !okH) return;

  const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const stream = xobjects?.lookup(PDFName.of(placed.name));
  if (!(stream instanceof PDFRawStream)) return;
  const d = stream.dict;
  if (d.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) return;
  for (const k of ['SMask', 'Mask', 'Decode', 'ImageMask', 'DecodeParms', 'ColorKeyMask']) {
    if (d.has(PDFName.of(k))) return; // 투명도·반전·색 제외가 걸린 이미지는 그대로 그릴 수 없다
  }
  if (num(d, 'BitsPerComponent') !== 8) return; // 1비트 흑백(CCITT/JBIG2)은 애초에 JPEG 이 아니다
  const filters = names(d.lookup(PDFName.of('Filter')));
  if (filters.length !== 1 || filters[0] !== 'DCTDecode') return;

  // 색공간: 브라우저가 그대로 읽을 수 있는 회색조·RGB 만. CMYK(N=4)는 브라우저마다 결과가 달라 받지 않는다.
  const cs = d.lookup(PDFName.of('ColorSpace'));
  let channels = 0;
  if (cs === PDFName.of('DeviceGray')) channels = 1;
  else if (cs === PDFName.of('DeviceRGB')) channels = 3;
  else if (cs instanceof PDFArray && cs.lookup(0) === PDFName.of('ICCBased')) {
    const profile = cs.lookup(1);
    channels = profile instanceof PDFRawStream ? num(profile.dict, 'N') : 0;
  }
  if (channels !== 1 && channels !== 3) return;

  const width = num(d, 'Width');
  const height = num(d, 'Height');
  if (!(width > 0) || !(height > 0)) return;
  return { bytes: stream.contents, mime: 'image/jpeg', width, height };
}
