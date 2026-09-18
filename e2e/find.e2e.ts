import { expect, test, type Page } from '@playwright/test';
import { openSample } from './helpers';

const activeText = (page: Page) =>
  page.evaluate(() => {
    const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('kiho-find-active');
    return h ? [...h].map((r) => r.toString()).join('|') : null;
  });

test('본문 찾기: Ctrl+F → 문서 전체에서 찾아 일치한 곳을 오가고, 글자 층에 강조한다', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('Control+f');
  const input = page.locator('.find-input');
  await expect(input).toBeFocused(); // 보기 탭이 열리고 찾기 칸으로 간다

  // 대소문자·띄어쓰기를 가리지 않는다. 'A4 /Rotate 90' 은 2쪽과 8쪽에 있다.
  await page.keyboard.type('ROTATE90');
  await page.keyboard.press('Enter');
  await expect(page.locator('.find-status')).toHaveText('1 / 2곳');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/2/);
  await expect.poll(() => activeText(page)).toBe('Rotate 90');

  await page.keyboard.press('Enter');
  await expect(page.locator('.find-status')).toHaveText('2 / 2곳');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/8/);
  await expect.poll(() => activeText(page)).toBe('Rotate 90');

  await page.keyboard.press('Enter'); // 끝에서 처음으로
  await expect(page.locator('.find-status')).toHaveText('1 / 2곳');
  await page.keyboard.press('Shift+Enter'); // 거꾸로
  await expect(page.locator('.find-status')).toHaveText('2 / 2곳');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/8/);

  // 한 쪽에 여러 곳: 모든 쪽에 "target box" 가 한 번씩 → 12곳, 보고 있던 8쪽부터
  await input.fill('target box');
  await page.keyboard.press('Enter');
  await expect(page.locator('.find-status')).toHaveText('8 / 12곳');
  await page.getByRole('button', { name: '▶' }).first().click();
  await expect(page.locator('.find-status')).toHaveText('9 / 12곳');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/9/);

  // 없는 말, 그리고 지우면 강조도 사라진다
  await input.fill('어디에도없는말');
  await page.keyboard.press('Enter');
  await expect(page.locator('.find-status')).toContainText('찾는 말이 없습니다');
  await input.fill('');
  await expect.poll(() => activeText(page)).toBeNull();

  // 쪽을 지워도 남은 쪽의 결과는 그대로 맞는다
  await input.fill('rotate 90');
  await page.keyboard.press('Enter');
  await expect(page.locator('.find-status')).toHaveText(/\/ 2곳/);
  await page.getByRole('button', { name: '페이지', exact: true }).click();
  await page.locator('.thumb').nth(1).click();
  await page.getByRole('button', { name: '삭제' }).click();
  await page.getByRole('button', { name: '보기', exact: true }).click();
  await expect(page.locator('.find-status')).toHaveText(/\/ 1곳/);
});
