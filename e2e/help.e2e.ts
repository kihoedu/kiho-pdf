import { expect, test } from '@playwright/test';
import { openSample } from './helpers';

test('도움말: 메뉴 버튼과 F1 로 열리고, 단축키 표를 포함하며, 열려 있는 동안 문서가 움직이지 않는다', async ({ page }) => {
  await page.goto('/');
  // 문서를 열기 전에도 쓸 수 있어야 한다
  await page.getByRole('button', { name: '? 도움말' }).click();
  const dialog = page.getByRole('dialog', { name: '도움말' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('화면 구성');
  await expect(dialog).toContainText('단축키');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await openSample(page);
  await page.getByRole('button', { name: '분할' }).click();
  await page.keyboard.press('F1');
  await expect(dialog).toBeVisible();
  // 보고 있던 탭(분할)의 설명으로 바로 이동한다
  await expect(dialog.locator('#help-split')).toBeInViewport();

  // 모든 탭·모든 도구·주요 단축키가 들어 있다
  for (const label of ['파일', '보기', '분할', '캡처', '페이지', '편집']) await expect(dialog.locator('nav')).toContainText(label);
  for (const key of ['V', 'T', 'P']) await expect(dialog.locator('#help-edit kbd', { hasText: new RegExp(`^${key}$`) })).toHaveCount(1);
  await expect(dialog.locator('#help-capture kbd', { hasText: /^C$/ })).toHaveCount(1);
  await expect(dialog.locator('#help-capture')).toContainText('모두 저장');
  // 없어진 기능은 도움말에도 없어야 한다
  for (const gone of ['형광펜', '사각형', '검색 탭', '본문 찾기', 'Ctrl+F']) await expect(dialog).not.toContainText(gone);
  for (const keys of ['Ctrl+O', 'Ctrl+S', 'Ctrl+P', 'Ctrl+Z', 'F1', 'PgDn', 'Delete']) {
    await expect(dialog.locator('#help-shortcuts')).toContainText(keys);
  }

  // 열려 있는 동안에는 뒤의 문서가 단축키에 반응하지 않는다
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('t');
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/1/);
  await expect(page.locator('table.groups')).toHaveCount(0);

  // 목차로 이동, 바깥을 눌러 닫기
  await dialog.locator('nav a', { hasText: '단축키' }).click();
  await expect(dialog.locator('#help-shortcuts h3')).toBeInViewport();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await page.keyboard.press('ArrowRight'); // 닫은 뒤에는 다시 동작
  await expect(page.locator('.thumb.current .thumb-label')).toHaveText(/2/);
});
