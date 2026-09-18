import { expect, test, type Page } from '@playwright/test';
import { PDFArray, PDFDict, PDFName, type PDFDocument } from '@cantoo/pdf-lib';
import { openSample, pageTexts, readPdf } from './helpers';

async function drag(page: Page, from: [number, number], to: [number, number], steps = 6): Promise<void> {
  const s = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.move(s.x + from[0], s.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(s.x + to[0], s.y + to[1], { steps });
  await page.mouse.up();
}

/** 현재 쪽 캔버스(= PDF 본문만, 오버레이 제외)에서 (x, y)pt 의 색. 75% 에서 1pt = 1px. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  await page.waitForFunction(() => (document.querySelector<HTMLCanvasElement>('.page-canvas canvas')?.width ?? 0) > 500);
  return page.evaluate(([px, py]) => {
    const c = document.querySelector<HTMLCanvasElement>('.page-canvas canvas')!;
    const k = c.width / c.getBoundingClientRect().width;
    return Array.from(c.getContext('2d')!.getImageData(Math.round(px * k), Math.round(py * k), 1, 1).data.slice(0, 3));
  }, [x, y]);
}

async function reopen(page: Page, name: string, noRestore: boolean): Promise<void> {
  await page.evaluate(
    ([n, raw]) => {
      const w = window as unknown as { __pickName: string; __kihoTune: { noRestore: boolean } };
      w.__pickName = n as string;
      w.__kihoTune = { noRestore: raw as boolean };
    },
    [name, noRestore] as const,
  );
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('table.info')).toContainText(name);
  await expect(page.locator('.page-canvas canvas')).toBeVisible();
}

const contentsCount = (doc: PDFDocument, i: number) => (doc.getPage(i).node.lookup(PDFName.of('Contents')) as PDFArray).size();
const fontCount = (doc: PDFDocument, i: number) =>
  doc.getPage(i).node.Resources()!.lookup(PDFName.of('Font'), PDFDict).keys().length;

test('재편집: 저장한 텍스트·펜 선이 다시 열면 편집 가능한 항목으로 돌아오고, 고쳐 저장해도 겹쳐 쌓이지 않는다', async ({ page }) => {
  await openSample(page);

  // 1쪽에 펜 선, 2쪽(/Rotate 90)에 텍스트
  await page.keyboard.press('p');
  await drag(page, [420, 230], [520, 230]);
  await page.locator('.thumb').nth(1).click();
  await page.keyboard.press('t');
  await drag(page, [100, 120], [320, 180]);
  await expect(page.locator('.text-box textarea')).toBeFocused();
  await page.keyboard.type('다시 고칠 문장');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('test_12p_편집.pdf');

  // 다시 열면: 본문에서는 걷히고(캔버스가 비어 있고 본문 글자에도 없다) 오버레이 항목으로 돌아온다
  await reopen(page, 'test_12p_편집.pdf', false);
  await expect(page.locator('.side-body')).not.toContainText('변경됨');
  await expect(page.locator('.mark.shape-path')).toHaveCount(1);
  const bare = await pixel(page, 470, 230);
  expect(bare[0] + bare[1] + bare[2]).toBeGreaterThan(700);
  await page.locator('.thumb').nth(1).click();
  await expect(page.locator('.text-box')).toHaveCount(1);
  await expect(page.locator('.text-line').first()).toHaveText('다시 고칠 문장');
  expect((await pageTexts(page, 1)).filter((t) => t.str.includes('고칠'))).toHaveLength(0);

  // 펜 선은 지우고 텍스트는 그대로 둔 채 다른 이름으로 저장
  await page.locator('.thumb').nth(0).click();
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await page.locator('.text-list a').first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.mark.shape-path')).toHaveCount(0);
  await page.evaluate(() => ((window as unknown as { __saveAs: string }).__saveAs = 'round2.pdf'));
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('round2.pdf');

  // 두 번째 저장본을 있는 그대로 열면: 지운 선은 없고, 텍스트는 본문에 정확히 한 번만 있다
  await reopen(page, 'round2.pdf', true);
  await expect(page.locator('.mark')).toHaveCount(0);
  const gone = await pixel(page, 470, 230);
  expect(gone[0] + gone[1] + gone[2]).toBeGreaterThan(700);
  const baked = (await pageTexts(page, 1)).filter((t) => t.str.includes('고칠'));
  expect(baked).toHaveLength(1);
  expect(baked[0].angle).toBe(0);

  // 저장을 거듭해도 콘텐츠 스트림·폰트가 쌓이지 않는다
  const first = await readPdf(page, 'test_12p_편집.pdf');
  const second = await readPdf(page, 'round2.pdf');
  expect(contentsCount(second, 1)).toBe(contentsCount(first, 1));
  expect(fontCount(second, 1)).toBe(fontCount(first, 1));
  // 선을 지운 1쪽에는 기록이 남지 않는다
  expect(second.getPage(0).node.get(PDFName.of('PieceInfo'))).toBeUndefined();
  expect(second.getPage(1).node.get(PDFName.of('PieceInfo'))).toBeDefined();
});
