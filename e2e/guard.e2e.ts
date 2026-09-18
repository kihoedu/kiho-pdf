import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { listDir, mockPickers, openSample, seedBytes } from './helpers';

/** 확인 창의 문구를 기록하고, 테스트가 정한 답을 돌려주는 대역(기본은 승인). */
async function recordConfirms(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __confirms: string[]; __answer?: boolean; confirm(m: string): boolean };
    w.__confirms = [];
    const record = (m: string) => {
      w.__confirms.push(m);
      return w.__answer ?? true;
    };
    // mockPickers 가 나중에 confirm 을 다시 덮어써도 이 대역이 남도록 대입을 무시한다.
    Object.defineProperty(window, 'confirm', { get: () => record, set: () => {}, configurable: true });
  });
}
const confirms = (page: Page) => page.evaluate(() => (window as unknown as { __confirms: string[] }).__confirms);
const answer = (page: Page, yes: boolean) => page.evaluate((v) => void ((window as unknown as { __answer: boolean }).__answer = v), yes);

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const s = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.move(s.x + from[0], s.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(s.x + to[0], s.y + to[1], { steps: 6 });
  await page.mouse.up();
}

test('전자서명이 있는 문서는 저장 전에 한 번 확인한다', async ({ page }) => {
  const doc = await PDFDocument.create();
  const first = doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  const ctx = doc.context;
  const sig = ctx.register(
    ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', Contents: PDFHexString.of('00'), ByteRange: [0, 0, 0, 0] }),
  );
  const field = ctx.register(
    ctx.obj({ FT: 'Sig', T: PDFString.of('Signature1'), V: sig, Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 0, 0], F: 132, P: first.ref }),
  );
  first.node.set(PDFName.of('Annots'), ctx.obj([field]));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field], SigFlags: 3 }));

  await mockPickers(page);
  await recordConfirms(page);
  await page.goto('/');
  await seedBytes(page, 'signed.pdf', await doc.save());
  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('.thumb')).toHaveCount(2);
  await expect(page.locator('.side-body')).toContainText('전자서명이 있는 문서입니다');

  // 거절하면 저장하지 않는다
  await answer(page, false);
  await page.keyboard.press('Control+s');
  expect(await confirms(page)).toHaveLength(1);
  expect((await confirms(page))[0]).toContain('전자서명이 무효');
  await expect(page.locator('.toast')).toHaveCount(0);

  // 승인하면 저장하고, 같은 문서에서는 다시 묻지 않는다
  await answer(page, true);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('저장 완료');
  await page.getByRole('button', { name: '페이지', exact: true }).click();
  await page.getByRole('button', { name: '추출하여 저장…' }).click();
  await expect(page.locator('.toast')).toContainText('추출');
  expect(await confirms(page)).toHaveLength(2);
});

test('서명이 없는 문서는 저장할 때 묻지 않는다', async ({ page }) => {
  await recordConfirms(page);
  await openSample(page);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('저장 완료');
  expect(await confirms(page)).toEqual([]);
});

test('저장하지 않은 캡처가 있으면 닫기 전에 알려 주고, 이미지로 저장한 뒤에는 묻지 않는다', async ({ page }) => {
  await recordConfirms(page);
  await openSample(page);
  await page.keyboard.press('c');
  await drag(page, [100, 170], [400, 300]);
  await expect(page.locator('ul.captures li')).toHaveCount(1);

  // 캡처만으로는 PDF 가 "변경됨" 이 되지 않는다
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await expect(page.locator('.side-body')).not.toContainText('변경됨');

  await answer(page, false);
  await page.getByRole('button', { name: '닫기' }).click();
  expect((await confirms(page)).at(-1)).toContain('캡처 1장');
  await expect(page.locator('.thumb')).toHaveCount(12); // 거절했으므로 그대로

  await answer(page, true);
  await page.getByRole('button', { name: '캡처', exact: true }).click();
  await page.getByRole('button', { name: /모두 저장/ }).click();
  await expect(page.locator('.toast')).toContainText('이미지 1개 저장 완료');
  const asked = (await confirms(page)).length;
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('.thumb')).toHaveCount(0);
  expect((await confirms(page)).length).toBe(asked);
});

test('원본에 덮어써서 다시 열려도 분할 그룹·캡처 목록·보던 쪽이 유지된다', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: '분할', exact: true }).click();
  await page.locator('input[type=number]').fill('5');
  await page.getByRole('button', { name: '분할', exact: true }).last().click();
  await expect(page.locator('table.groups tbody tr')).toHaveCount(3);

  await page.locator('.thumb').nth(2).click(); // 3쪽
  await page.keyboard.press('c');
  await drag(page, [100, 170], [400, 300]);
  await page.getByRole('button', { name: '페이지', exact: true }).click();
  await page.getByRole('button', { name: '⟳ 오른쪽 회전' }).click();

  await page.evaluate(() => ((window as unknown as { __saveAs: string }).__saveAs = 'test_12p.pdf'));
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('저장 완료');
  await expect(page.locator('.thumb')).toHaveCount(12);
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/3/);

  await page.getByRole('button', { name: '분할', exact: true }).click();
  await expect(page.locator('table.groups tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: '캡처', exact: true }).click();
  await expect(page.locator('ul.captures li')).toHaveCount(1);
  await expect(page.locator('ul.captures li img')).toBeVisible(); // 미리보기도 새 문서에서 다시 만들어진다
  await expect(page.locator('.capture-box')).toHaveCount(1);

  // 이어받은 캡처가 실제로 저장된다
  await page.getByRole('button', { name: /모두 저장/ }).click();
  await expect(page.locator('.toast')).toContainText('이미지 1개 저장 완료');
  expect(await listDir(page, 'out')).toEqual(['test_12p_3쪽_01.png']);
});
