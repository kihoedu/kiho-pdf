import { expect, test } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';
import { mockPickers, readPdf } from './helpers';

/** 쪽별 이미지 XObject 의 크기·비트 수·바이트를 뽑는다(폼 XObject 안에 든 이미지는 폼을 따라 들어간다). */
function imagesOf(doc: PDFDocument) {
  return doc.getPages().map((page) => {
    const xo = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const [, ref] = xo.entries()[0];
    let s = doc.context.lookup(ref as PDFRef) as PDFRawStream;
    if (s.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) {
      const inner = s.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
      s = doc.context.lookup(inner.entries()[0][1] as PDFRef) as PDFRawStream;
    }
    const n = (k: string) => (s.dict.lookup(PDFName.of(k)) as PDFNumber).asNumber();
    return { w: n('Width'), h: n('Height'), bpc: n('BitsPerComponent'), bytes: s.contents };
  });
}

test('용량 최적화: 기준 해상도를 넘는 이미지만 줄이고 나머지는 바이트 그대로 둔다', async ({ page }) => {
  await mockPickers(page);
  await page.goto('/');

  // 문서처럼 보이는 JPEG 을 브라우저에서 만든다(Node 에는 인코더가 없다)
  const jpeg = (w: number, h: number) =>
    page.evaluate(
      async ([cw, ch]) => {
        const c = new OffscreenCanvas(cw, ch);
        const g = c.getContext('2d')!;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, cw, ch);
        g.fillStyle = '#111';
        g.font = `${Math.round(cw / 40)}px serif`;
        for (let y = cw / 20; y < ch; y += cw / 28) g.fillText('The quick brown fox 다람쥐 헌 쳇바퀴에 타고파 0123456789 '.repeat(3), cw / 25, y);
        const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      [w, h] as const,
    );
  const hi = Buffer.from(await jpeg(2480, 3508), 'base64'); // A6 크기 쪽에 놓으면 600dpi
  const lo = Buffer.from(await jpeg(1000, 1414), 'base64'); // 같은 쪽에서 약 242dpi
  const inForm = Buffer.from(await jpeg(1860, 2631), 'base64'); // 폼 XObject 안에 넣을 450dpi 이미지

  const doc = await PDFDocument.create();
  const size: [number, number] = [297.64, 420.94]; // A6
  for (const bytes of [hi, lo]) {
    const img = await doc.embedJpg(bytes);
    doc.addPage(size).drawImage(img, { x: 0, y: 0, width: size[0], height: size[1] });
  }
  // 1비트 흑백 스캔을 흉내 낸 이미지(600dpi). 절대 건드리면 안 된다.
  const bw = new Uint8Array(Math.ceil(2480 / 8) * 3508).fill(0xff);
  for (let i = 0; i < bw.length; i += 97) bw[i] = 0x00;
  const bwRef = doc.context.register(
    doc.context.stream(bw, { Type: 'XObject', Subtype: 'Image', Width: 2480, Height: 3508, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }),
  );
  const p3 = doc.addPage(size);
  p3.node.setXObject(PDFName.of('Bw'), bwRef);
  p3.node.addContentStream(doc.context.register(doc.context.stream(`q ${size[0]} 0 0 ${size[1]} 0 0 cm /Bw Do Q`)));
  // 4쪽: 이미지를 폼 XObject 로 한 겹 감싼 쪽(조판 프로그램·복합기 출력물에 흔하다). 폼 안까지 따라 들어가야 한다.
  const formImg = await doc.embedJpg(inForm);
  const formRef = doc.context.register(
    doc.context.stream(`q ${size[0]} 0 0 ${size[1]} 0 0 cm /Im Do Q`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, size[0], size[1]],
      Resources: { XObject: { Im: formImg.ref } },
    }),
  );
  const p4 = doc.addPage(size);
  p4.node.setXObject(PDFName.of('Fm'), formRef);
  p4.node.addContentStream(doc.context.register(doc.context.stream('/Fm Do')));
  const original = await doc.save();
  const before = imagesOf(await PDFDocument.load(original));

  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle('hires.pdf', { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
    (window as unknown as { __pickName: string }).__pickName = 'hires.pdf';
  }, Buffer.from(original).toString('base64'));

  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('.thumb')).toHaveCount(4);
  await page.getByRole('button', { name: /최적화하여/ }).click();
  await expect(page.locator('.toast')).toContainText('이미지 4개 중 2개를 300dpi 로 조정', { timeout: 30_000 });

  const saved = await readPdf(page, 'hires_최적화.pdf');
  const after = imagesOf(saved);
  // 1쪽: 600dpi → 300dpi
  expect(after[0].w).toBe(1240);
  expect(after[0].h).toBe(1754);
  expect(after[0].bytes.length).toBeLessThan(before[0].bytes.length * 0.6);
  // 2쪽: 기준 이하 → 바이트까지 동일
  expect(after[1].w).toBe(1000);
  expect(Buffer.from(after[1].bytes).equals(Buffer.from(before[1].bytes))).toBe(true);
  // 3쪽: 1비트 흑백 → 그대로
  expect(after[2]).toMatchObject({ w: 2480, h: 3508, bpc: 1 });
  expect(Buffer.from(after[2].bytes).equals(Buffer.from(before[2].bytes))).toBe(true);

  // 4쪽: 폼 XObject 안의 450dpi → 300dpi
  expect(after[3].w).toBe(1240);
  expect(after[3].h).toBe(1754);
  expect(after[3].bytes.length).toBeLessThan(before[3].bytes.length * 0.8);

  // 기본 저장은 여전히 무손실이어야 한다: 같은 문서를 그냥 저장하면 모든 이미지가 그대로다
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('hires_편집.pdf');
  const plain = imagesOf(await readPdf(page, 'hires_편집.pdf'));
  plain.forEach((im, i) => expect(Buffer.from(im.bytes).equals(Buffer.from(before[i].bytes))).toBe(true));
});
