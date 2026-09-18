import { expect, test } from '@playwright/test';
import { listDir, openSample, pageTexts, readPdf } from './helpers';

test('레이아웃: 위쪽 높이 = 750px × 배율, 분할선 드래그/더블클릭', async ({ page }) => {
  await openSample(page);
  const top = page.locator('.pane-top');
  const height = async () => Math.round((await top.boundingBox())!.height);
  expect(await height()).toBe(563); // 750 × 0.75

  // A4 는 75% 에서 595×842 CSS px (1pt = 1px)
  const sheet = (await page.locator('.page-sheet').boundingBox())!;
  expect(Math.round(sheet.width)).toBe(595);
  expect(Math.round(sheet.height)).toBe(842);

  await page.getByRole('button', { name: '보기' }).click();
  await page.getByRole('button', { name: '50%', exact: true }).click();
  expect(await height()).toBe(375);

  const split = (await page.locator('.splitter').boundingBox())!;
  await page.mouse.move(split.x + 200, split.y + 3);
  await page.mouse.down();
  await page.mouse.move(split.x + 200, split.y + 3 + 120, { steps: 4 });
  await page.mouse.up();
  expect(await height()).toBe(495);

  // 수동 높이는 배율이 바뀌어도 유지되고, 더블클릭하면 자동으로 돌아간다
  await page.getByRole('button', { name: '75%', exact: true }).click();
  expect(await height()).toBe(495);
  await page.locator('.splitter').dblclick();
  expect(await height()).toBe(563);
});

test('썸네일 클릭과 키보드로 페이지 이동', async ({ page }) => {
  await openSample(page);
  await page.locator('.thumb').nth(4).click();
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/5/);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('PageDown');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/7/);
  await page.keyboard.press('Home');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/1/);
  // 모든 썸네일이 실제로 그려진다
  await expect(page.locator('.thumb-img canvas')).toHaveCount(12);
});

test('일괄 분할: Enter → 이름 → Enter 흐름과 폴더 저장', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: '분할' }).click();

  await page.locator('.thumb').nth(2).click(); // 3쪽
  await page.keyboard.press('Enter');
  await expect(page.locator('input.name')).toBeFocused();
  await page.keyboard.type('계약서');
  await page.keyboard.press('Enter');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/4/);

  await page.locator('.thumb').nth(6).click(); // 7쪽
  await page.keyboard.press('Enter');
  await page.keyboard.type('부속서');
  await page.keyboard.press('Enter');

  // ✂ 로 나머지(8–12)를 8–10 / 11–12 로 나눈다
  await page.locator('.thumb').nth(6).locator('.cut').click(); // 7|8 경계: 미할당 8–12 가 그룹이 된다
  await page.locator('.thumb').nth(9).locator('.cut').click(); // 10|11
  await expect(page.locator('table.groups tbody tr')).toHaveCount(4);

  await page.getByRole('button', { name: /모두 저장/ }).click();
  await expect(page.locator('.toast')).toContainText('4개 파일 저장 완료');

  expect(await listDir(page, 'out')).toEqual(['test_12p_03_8-10.pdf', 'test_12p_04_11-12.pdf', '계약서.pdf', '부속서.pdf']);
  expect((await readPdf(page, '계약서.pdf', 'out')).getPageCount()).toBe(3);
  expect((await readPdf(page, '부속서.pdf', 'out')).getPageCount()).toBe(4);
  expect((await readPdf(page, 'test_12p_04_11-12.pdf', 'out')).getPageCount()).toBe(2);
});

test('텍스트 삽입: 회전된 쪽에 드래그로 입력 → 저장 → 저장본에서 위치·방향 확인', async ({ page }) => {
  await openSample(page);
  await page.locator('.thumb').nth(1).click(); // 2쪽: /Rotate 90 (가로로 보인다)
  await page.keyboard.press('t');

  const sheet = (await page.locator('.page-sheet').boundingBox())!;
  const x0 = sheet.x + 100;
  const y0 = sheet.y + 120;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 220, y0 + 60, { steps: 5 });
  await page.mouse.up();

  const area = page.locator('.text-box textarea');
  await expect(area).toBeFocused();
  await page.keyboard.type('삽입 테스트 ABC');
  await page.mouse.click(sheet.x + 500, sheet.y + 400); // 상자 밖을 눌러 확정(같은 도구라 새 상자가 생긴다)
  await page.keyboard.press('Escape');
  await expect(page.locator('.text-box')).toHaveCount(1);
  await expect(page.locator('.text-line').first()).toHaveText('삽입 테스트 ABC');

  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('저장 완료');

  // 저장본을 다시 연다
  await page.evaluate(() => ((window as unknown as { __pickName: string }).__pickName = 'test_12p_편집.pdf'));
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('table.info')).toContainText('test_12p_편집.pdf');
  await expect(page.locator('.text-box')).toHaveCount(0); // 이제 오버레이가 아니라 본문이다
  const items = (await pageTexts(page, 1)).filter((t) => t.str.includes('삽입'));
  expect(items).toHaveLength(1);
  expect(items[0].angle).toBe(0); // 화면 기준으로 똑바로
  // 75% 에서 1pt = 1px 이므로 드래그한 좌표가 곧 뷰 좌표다
  expect(items[0].x).toBeGreaterThan(100);
  expect(items[0].x).toBeLessThan(110);
  expect(items[0].y).toBeGreaterThan(120);
  expect(items[0].y).toBeLessThan(145);
});

test('텍스트 삽입: 폰트를 받는 중에 드래그해도 입력이 버려지지 않는다', async ({ page }) => {
  // 폰트(2.7MB) 응답을 늦춰 느린 디스크/네트워크를 흉내 낸다
  await page.route('**/fonts/*.ttf', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await openSample(page);
  await page.keyboard.press('t');
  const sheet = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.move(sheet.x + 100, sheet.y + 320);
  await page.mouse.down();
  await page.mouse.move(sheet.x + 300, sheet.y + 360, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.text-box textarea')).toBeFocused();
  await page.keyboard.type('늦게 온 폰트');
  await page.keyboard.press('Escape');
  await expect(page.locator('.text-line').first()).toHaveText('늦게 온 폰트');
});

test('페이지 조작과 실행 취소, 원본 덮어쓰기 후 자동 재열기', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: '페이지', exact: true }).click();
  await page.locator('.thumb').nth(0).click();
  await page.locator('.thumb').nth(2).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '삭제' }).click();
  await expect(page.locator('.thumb')).toHaveCount(9);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.thumb')).toHaveCount(12);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.thumb')).toHaveCount(9);
  await page.getByRole('button', { name: '⟳ 오른쪽 회전' }).click();

  // 열려 있는 원본과 같은 이름으로 저장 → 저장본으로 다시 열려야 한다
  await page.evaluate(() => ((window as unknown as { __saveAs: string }).__saveAs = 'test_12p.pdf'));
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('저장 완료');
  await expect(page.locator('.thumb')).toHaveCount(9);
  await expect(page.locator('.page-canvas canvas')).toBeVisible();
  const saved = await readPdf(page, 'test_12p.pdf');
  expect(saved.getPageCount()).toBe(9);
  expect(saved.getPage(0).getRotation().angle).toBe(270); // 원래 4쪽(/Rotate 180) + 90
});
