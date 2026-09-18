import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, rgb } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { listDir, mockPickers, readPdf, seedBytes } from './helpers';

/**
 * 기본 저장은 무손실(CLAUDE.md 규칙 2): 이미지·폰트 스트림은 재압축 없이 바이트 그대로 복사돼야 한다.
 * 문서 안의 이미지 XObject 와 폰트 파일(FontFile/FontFile2/FontFile3) 스트림의 해시를 모아 원본과 비교한다.
 */
function payloadHashes(doc: PDFDocument): { images: string[]; fonts: string[] } {
  const sha = (s: PDFRawStream) => createHash('sha1').update(s.contents).digest('hex');
  const images: string[] = [];
  const fonts: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) images.push(sha(obj));
    const dict = obj instanceof PDFDict ? obj : undefined;
    for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
      const file = dict?.lookup(PDFName.of(key));
      if (file instanceof PDFRawStream) fonts.push(sha(file));
    }
  }
  return { images: images.sort(), fonts: fonts.sort() };
}

/** 임베드 폰트(서브셋)와 쪽마다 다른 Flate 이미지가 든 6쪽 문서. */
async function makeDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync('public/fonts/Pretendard-Regular.ttf'), { subset: true });
  for (let i = 0; i < 6; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`무손실 검증 ${i + 1}쪽 ABC`, { x: 60, y: 760, size: 18, font, color: rgb(0, 0, 0) });
    const w = 64;
    const h = 48;
    const pixels = new Uint8Array(w * h * 3);
    for (let p = 0; p < pixels.length; p++) pixels[p] = (p * (i + 3) + ((p >> 5) * 17)) & 255;
    const ref = doc.context.register(
      doc.context.stream(deflateSync(pixels), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: w,
        Height: h,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'FlateDecode',
      }),
    );
    page.node.setXObject(PDFName.of(`Im${i}`), ref);
    page.node.addContentStream(doc.context.register(doc.context.stream(`q 320 0 0 240 60 400 cm /Im${i} Do Q`)));
  }
  return doc.save();
}

test('무손실: 분할 저장과 편집 저장 모두 이미지·폰트 스트림을 바이트 그대로 둔다', async ({ page }) => {
  const original = await makeDoc();
  const before = payloadHashes(await PDFDocument.load(original));
  expect(before.images).toHaveLength(6);
  expect(before.fonts).toHaveLength(1);

  await mockPickers(page);
  await page.goto('/');
  await seedBytes(page, 'lossless.pdf', original);
  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('.thumb')).toHaveCount(6);

  // 1) 2쪽씩 분할 저장: 세 파일의 이미지를 모으면 원본과 같고, 폰트는 파일마다 원본 그대로다
  await page.getByRole('button', { name: '분할', exact: true }).click();
  await page.locator('input[type=number]').fill('2');
  await page.getByRole('button', { name: '분할', exact: true }).last().click();
  await page.getByRole('button', { name: /모두 저장/ }).click();
  await expect(page.locator('.toast')).toContainText('3개 파일 저장 완료');
  const parts = await listDir(page, 'out');
  expect(parts).toHaveLength(3);
  const splitImages: string[] = [];
  for (const name of parts) {
    const h = payloadHashes(await readPdf(page, name, 'out'));
    expect(h.images).toHaveLength(2);
    expect(h.fonts).toEqual(before.fonts);
    splitImages.push(...h.images);
  }
  expect(splitImages.sort()).toEqual(before.images);

  // 2) 회전 + 펜 선을 넣어 저장: 기존 스트림은 그대로이고 새로 생긴 이미지·폰트가 없다
  await page.getByRole('button', { name: '페이지', exact: true }).click();
  await page.getByRole('button', { name: '⟳ 오른쪽 회전' }).click();
  await page.keyboard.press('p');
  const sheet = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.move(sheet.x + 80, sheet.y + 80);
  await page.mouse.down();
  await page.mouse.move(sheet.x + 220, sheet.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('lossless_편집.pdf');
  const edited = await readPdf(page, 'lossless_편집.pdf');
  expect(edited.getPageCount()).toBe(6);
  expect(payloadHashes(edited)).toEqual(before);
});
