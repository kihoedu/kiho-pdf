import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, type PDFPage } from '@cantoo/pdf-lib';
import { fullPageImage } from './pageImage';

const W = 595.276;
const H = 841.89;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]); // 구조만 보므로 진짜 JPEG 일 필요는 없다

interface Opts {
  dict?: Record<string, unknown>;
  content?: string;
  size?: [number, number];
  cropBox?: [number, number, number, number];
  annots?: boolean;
  contentFilter?: boolean;
}

async function makePage(o: Opts = {}): Promise<PDFPage> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(o.size ?? [W, H]);
  const img = doc.context.stream(JPEG, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: 2480,
    Height: 3508,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
    ...o.dict,
  });
  page.node.setXObject(PDFName.of('Im0'), doc.context.register(img));
  const content = o.content ?? `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  page.node.addContentStream(doc.context.register(doc.context.stream(content)));
  if (o.cropBox) page.setCropBox(...o.cropBox);
  if (o.annots) {
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50] });
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  }
  return page;
}

describe('쪽 전체를 덮는 이미지 판별', () => {
  it('이미지 한 장뿐인 쪽을 알아보고 원본 바이트를 그대로 돌려준다', async () => {
    const info = fullPageImage(await makePage());
    expect(info).toBeDefined();
    expect(Array.from(info!.bytes)).toEqual(Array.from(JPEG));
    expect(info).toMatchObject({ mime: 'image/jpeg', width: 2480, height: 3508 });
  });

  it('q·Q 가 없어도, 줄바꿈이 섞여도 알아본다', async () => {
    expect(await makePage({ content: `${W} 0 0 ${H} 0 0 cm\n/Im0 Do` }).then(fullPageImage)).toBeDefined();
    expect(await makePage({ content: `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n` }).then(fullPageImage)).toBeDefined();
  });

  it('CropBox 만큼 옮겨 놓은 이미지도 알아본다(그 영역이 곧 화면에 보이는 쪽이다)', async () => {
    const page = await makePage({ cropBox: [30, 40, 500, 700], content: 'q 500 0 0 700 30 40 cm /Im0 Do Q' });
    expect(fullPageImage(page)).toBeDefined();
  });

  it('항등 행렬이 섞여 있어도 알아본다(만드는 프로그램이 흔히 덧붙인다)', async () => {
    const content = `q 1 0 0 1 0 0 cm 1 0 0 1 0 0 cm ${W} 0 0 ${H} 0 0 cm 1 0 0 1 0 0 cm /Im0 Do Q`;
    expect(await makePage({ content }).then(fullPageImage)).toBeDefined();
  });

  it('이동과 확대를 나눠 쓴 배치도 합성해서 알아본다', async () => {
    const page = await makePage({
      cropBox: [30, 40, 500, 700],
      content: 'q 1 0 0 1 30 40 cm 500 0 0 700 0 0 cm /Im0 Do Q',
    });
    expect(fullPageImage(page)).toBeDefined();
  });

  it('q·Q 로 되돌린 변환은 셈에 넣지 않는다', async () => {
    const content = `q 9 0 0 9 5 5 cm Q ${W} 0 0 ${H} 0 0 cm /Im0 Do`;
    expect(await makePage({ content }).then(fullPageImage)).toBeDefined();
  });

  it("반올림 오차는 봐준다", async () => {
    expect(await makePage({ content: 'q 595.28 0 0 841.9 0.01 0 cm /Im0 Do Q' }).then(fullPageImage)).toBeDefined();
  });

  describe('조금이라도 어긋나면 받지 않는다', () => {
    const rejects = async (o: Opts) => expect(fullPageImage(await makePage(o))).toBeUndefined();

    it('쪽을 다 덮지 않는 이미지', () => rejects({ content: `q 300 0 0 400 0 0 cm /Im0 Do Q` }));
    it('CropBox 보다 큰 이미지(잘라야 한다)', () =>
      rejects({ cropBox: [100, 100, 400, 600], content: `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q` }));
    it('뒤집어 놓은 이미지', () => rejects({ content: `q ${W} 0 0 -${H} 0 ${H} cm /Im0 Do Q` }));
    it('기울이거나 돌려 놓은 이미지', () => rejects({ content: `q ${W} 10 10 ${H} 0 0 cm /Im0 Do Q` }));
    it('합성하면 쪽을 벗어나는 배치', () =>
      rejects({ content: `q 2 0 0 2 0 0 cm ${W} 0 0 ${H} 0 0 cm /Im0 Do Q` }));
    it('짝이 맞지 않는 Q', () => rejects({ content: `${W} 0 0 ${H} 0 0 cm /Im0 Do Q Q` }));
    it('이미지 말고 다른 것도 그리는 쪽', () =>
      rejects({ content: `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q BT /F1 12 Tf (hi) Tj ET` }));
    it('이미지를 두 번 그리는 쪽', () =>
      rejects({ content: `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q` }));
    it('그리기 전에 상태를 바꾸는 쪽(투명도 등)', () =>
      rejects({ content: `q /GS0 gs ${W} 0 0 ${H} 0 0 cm /Im0 Do Q` }));
    it('주석이 있는 쪽', () => rejects({ annots: true }));
    it('이름이 다른 XObject 를 그리는 쪽', () => rejects({ content: `q ${W} 0 0 ${H} 0 0 cm /Im9 Do Q` }));

    it('따로 그린 투명도 마스크(SMask)가 있는 이미지', () => rejects({ dict: { SMask: [0, 0, 0] } }));
    it('색 제외 마스크(Mask)가 있는 이미지', () => rejects({ dict: { Mask: [0, 0] } }));
    it('색을 뒤집는 Decode 가 있는 이미지', () => rejects({ dict: { Decode: [1, 0, 1, 0, 1, 0] } }));
    it('JPEG 이 아닌 이미지', () => rejects({ dict: { Filter: 'FlateDecode' } }));
    it('JPEG 위에 다른 압축이 겹친 이미지', () => rejects({ dict: { Filter: ['FlateDecode', 'DCTDecode'] } }));
    it('1비트 흑백 스캔', () => rejects({ dict: { BitsPerComponent: 1, Filter: 'CCITTFaxDecode' } }));
    it('CMYK 이미지(브라우저마다 결과가 다르다)', () => rejects({ dict: { ColorSpace: 'DeviceCMYK' } }));
    it('찾을 수 없는 색공간', () => rejects({ dict: { ColorSpace: 'Indexed' } }));
    it('크기가 없는 이미지', () => rejects({ dict: { Width: 0 } }));
  });
});
