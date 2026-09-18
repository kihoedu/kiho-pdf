/// <reference lib="webworker" />
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFDocument } from '@cantoo/pdf-lib';
import type { OptimizeOptions, OptimizeStats } from './protocol';

/**
 * 용량 최적화(선택 기능). OCR 품질을 해치지 않는 범위에서만 이미지를 줄인다.
 *
 * 규칙
 *  - 범위: 쪽의 XObject 와, 그 안의 폼 XObject 가 (몇 겹이든) 품고 있는 이미지.
 *  - 대상: 8비트 회색조/RGB 이미지(JPEG 또는 예측기 없는 Flate/무압축). 1비트(흑백 CCITT/JBIG2)·마스크·CMYK·
 *    투명도가 있는 이미지는 건드리지 않는다.
 *  - 해상도 하한: 이미지가 "쪽을 가득 채워 그려졌다"고 가정한 값으로, 쪽보다 작게 그려진 이미지의 실제 해상도는
 *    이보다 높다. 이 하한이 목표 dpi 를 넘는 이미지만 목표 dpi 까지 줄이므로 결과의 유효 해상도는 목표 dpi 이상이다.
 *    (전제: 이미지가 가로·세로 같은 배율로, 쪽 밖으로 넘치지 않게 그려져 있다 — 스캔 문서에서는 항상 성립한다.)
 *  - 다시 인코딩한 결과가 원본보다 충분히(10%) 작지 않으면 원본을 유지한다.
 */
export async function optimizeImages(
  doc: PDFDocument,
  opt: OptimizeOptions,
  onProgress: (done: number, total: number) => void,
): Promise<OptimizeStats> {
  const ctx = doc.context;
  // 이미지별 해상도 하한: 여러 쪽에서 쓰이면 가장 낮은 값(가장 크게 그려질 수 있는 경우)을 따른다.
  const dpiByRef = new Map<PDFRef, number>();
  for (const page of doc.getPages()) {
    const media = page.getMediaBox();
    const pw = media.width / 72;
    const ph = media.height / 72;
    // 폼 XObject 는 서로를 참조할 수 있으므로 쪽마다 방문 기록을 두어 순환을 끊는다.
    const seenForms = new Set<PDFRef>();
    const visit = (resources: PDFDict | undefined) => {
      const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (!xobjects) return;
      for (const [, value] of xobjects.entries()) {
        if (!(value instanceof PDFRef)) continue;
        const stream = ctx.lookup(value);
        if (!(stream instanceof PDFRawStream)) continue;
        const subtype = stream.dict.get(PDFName.of('Subtype'));
        if (subtype === PDFName.of('Form')) {
          if (seenForms.has(value)) continue;
          seenForms.add(value);
          visit(stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict));
          continue;
        }
        if (subtype !== PDFName.of('Image')) continue;
        const w = num(stream.dict, 'Width');
        const h = num(stream.dict, 'Height');
        if (!w || !h) continue;
        // 이미지가 균일 배율로 쪽 안에 들어간다면, 가장 크게 그려질 때의 해상도는
        // 세워 그린 경우 max(w/pw, h/ph), 눕혀 그린 경우 max(h/pw, w/ph) 이다. 어느 쪽인지 모르므로 낮은 쪽을 쓴다.
        // 폼 안의 이미지도 결국 이 쪽 위에 그려지므로 같은 하한이 성립한다.
        const dpi = Math.min(Math.max(w / pw, h / ph), Math.max(h / pw, w / ph));
        dpiByRef.set(value, Math.min(dpiByRef.get(value) ?? Infinity, dpi));
      }
    };
    visit(page.node.Resources());
  }

  const stats: OptimizeStats = { images: dpiByRef.size, resampled: 0, bytesBefore: 0, bytesAfter: 0 };
  let done = 0;
  for (const [ref, dpi] of dpiByRef) {
    const stream = ctx.lookup(ref) as PDFRawStream;
    const before = stream.contents.length;
    stats.bytesBefore += before;
    let after = before;
    if (dpi > opt.dpi * 1.05) {
      try {
        const replaced = await resample(stream, opt.dpi / dpi, opt.quality);
        if (replaced && replaced.bytes.length < before * 0.9) {
          const dict: Record<string, unknown> = {
            Type: 'XObject',
            Subtype: 'Image',
            Width: replaced.width,
            Height: replaced.height,
            BitsPerComponent: 8,
            Filter: 'DCTDecode',
            // 3채널 ICC 프로파일은 그대로 유효하므로 유지한다. 그 밖에는 JPEG 출력에 맞춰 DeviceRGB.
            ColorSpace: replaced.keepColorSpace ? stream.dict.get(PDFName.of('ColorSpace')) : 'DeviceRGB',
          };
          ctx.assign(ref, ctx.stream(replaced.bytes, dict as never));
          after = replaced.bytes.length;
          stats.resampled++;
        }
      } catch (e) {
        console.warn('이미지 최적화를 건너뜁니다', ref.toString(), e); // 원본 유지
      }
    }
    stats.bytesAfter += after;
    onProgress(++done, dpiByRef.size);
  }
  return stats;
}

const num = (dict: PDFDict, key: string): number => {
  const v = dict.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : 0;
};

const names = (obj: unknown): string[] =>
  obj instanceof PDFName ? [obj.decodeText()] : obj instanceof PDFArray ? obj.asArray().flatMap(names) : [];

async function resample(
  stream: PDFRawStream,
  ratio: number,
  quality: number,
): Promise<{ bytes: Uint8Array; width: number; height: number; keepColorSpace: boolean } | undefined> {
  const d = stream.dict;
  const has = (k: string) => d.has(PDFName.of(k));
  if (has('SMask') || has('Mask') || has('Decode') || has('ImageMask') || has('DecodeParms')) return;
  if (num(d, 'BitsPerComponent') !== 8) return;

  // 색공간: DeviceGray/DeviceRGB 또는 ICCBased(N=1,3)
  const cs = d.lookup(PDFName.of('ColorSpace'));
  let channels = 0;
  let keepColorSpace = false;
  if (cs === PDFName.of('DeviceGray')) channels = 1;
  else if (cs === PDFName.of('DeviceRGB')) channels = 3;
  else if (cs instanceof PDFArray && cs.lookup(0) === PDFName.of('ICCBased')) {
    const profile = cs.lookup(1);
    channels = profile instanceof PDFRawStream ? num(profile.dict, 'N') : 0;
    keepColorSpace = channels === 3;
  }
  if (channels !== 1 && channels !== 3) return;

  const w = num(d, 'Width');
  const h = num(d, 'Height');
  const filters = names(d.lookup(PDFName.of('Filter')));
  let source: ImageBitmap;
  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    source = await createImageBitmap(new Blob([stream.contents as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  } else if (filters.every((f) => f === 'FlateDecode')) {
    const raw = decodePDFRawStream(stream).decode();
    if (raw.length < w * h * channels) return;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, o = 0; i < w * h; i++, o += 4) {
      const p = i * channels;
      rgba[o] = raw[p];
      rgba[o + 1] = raw[channels === 3 ? p + 1 : p];
      rgba[o + 2] = raw[channels === 3 ? p + 2 : p];
      rgba[o + 3] = 255;
    }
    source = await createImageBitmap(new ImageData(rgba, w, h));
  } else {
    return; // JPX, CCITT, JBIG2, LZW 등은 그대로 둔다
  }

  const width = Math.max(1, Math.round(w * ratio));
  const height = Math.max(1, Math.round(h * ratio));
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, width, height);
  source.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, keepColorSpace };
}
