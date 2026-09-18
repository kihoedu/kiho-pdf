import { expect, test, type Page } from '@playwright/test';
import { openSample } from './helpers';

async function drag(page: Page, from: [number, number], to: [number, number], steps = 6): Promise<void> {
  const s = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.move(s.x + from[0], s.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(s.x + to[0], s.y + to[1], { steps });
  await page.mouse.up();
}

/** 본 렌더가 끝난 현재 쪽 캔버스에서 (x, y)pt 위치의 색을 읽는다(75% = 1pt 당 1px). */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  await page.waitForFunction(() => (document.querySelector<HTMLCanvasElement>('.page-canvas canvas')?.width ?? 0) > 500);
  return page.evaluate(([px, py]) => {
    const c = document.querySelector<HTMLCanvasElement>('.page-canvas canvas')!;
    const k = c.width / c.getBoundingClientRect().width;
    const d = c.getContext('2d')!.getImageData(Math.round(px * k), Math.round(py * k), 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, [x, y]);
}

test('편집 메뉴에는 선택·텍스트·펜만 있다', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await expect(page.locator('.tool-grid button')).toHaveText(['↖ 선택', 'Ｔ 텍스트', '✎ 펜']);
  await expect(page.locator('.side-body')).not.toContainText('형광펜');
  await expect(page.locator('.side-body')).not.toContainText('이미지');
  // 없어진 도구의 단축키는 아무 일도 하지 않는다
  for (const k of ['h', 'r', 'l']) await page.keyboard.press(k);
  await expect(page.locator('.tool-grid button.on')).toHaveText('↖ 선택');
  // 검색 탭도 없다
  await expect(page.locator('.tabs button')).toHaveText(['파일', '보기', '분할', '캡처', '페이지', '편집']);
});

test('펜: 그린 선이 저장본에 그대로 그려지고, 이동·삭제·실행 취소가 된다', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('p');
  await drag(page, [420, 230], [520, 230]); // 가로선
  await drag(page, [420, 260], [500, 300], 12); // 지울 선
  await expect(page.locator('.text-list li')).toHaveCount(2);

  // 선택 도구로 두 번째 선을 고르고 Delete
  await page.keyboard.press('v');
  await page.locator('.text-list a').nth(1).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.text-list li')).toHaveCount(1);

  // 첫 선을 아래로 40pt 옮겼다가 실행 취소
  await drag(page, [470, 230], [470, 270]);
  await expect(page.locator('.shape-frame')).toHaveCount(1);
  await page.keyboard.press('Control+z');

  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('저장 완료');
  await page.evaluate(() => ((window as unknown as { __pickName: string }).__pickName = 'test_12p_편집.pdf'));
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('table.info')).toContainText('test_12p_편집.pdf');
  await expect(page.locator('.mark')).toHaveCount(0);

  const line = await pixel(page, 470, 230);
  expect(line[0]).toBeGreaterThan(180); // 빨간 선
  expect(line[1]).toBeLessThan(140);
  const movedAway = await pixel(page, 470, 270); // 실행 취소했으므로 여기는 비어 있다
  expect(movedAway[0] + movedAway[1] + movedAway[2]).toBeGreaterThan(700);
  const erased = await pixel(page, 460, 281);
  expect(erased[0] + erased[1] + erased[2]).toBeGreaterThan(700);
});

test('본문 글자를 선택할 수 있다', async ({ page }) => {
  await openSample(page);
  await expect(page.locator('.textLayer span').first()).toBeAttached();
  const s = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.dblclick(s.x + 135, s.y + 183); // "Page"
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('Page');
});
