// 개발용 스크린샷: node bench/shot.mjs [split|text|capture|pen|find|help|file] → bench/out/shot-*.png (개발 서버가 떠 있어야 한다)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const scenario = process.argv[2] ?? 'split';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/');
await page.evaluate(async () => {
  const blob = await (await fetch('/bench/samples/test_12p.pdf')).blob();
  await window.__kiho.useStore.getState().openFiles([{ file: new File([blob], 'test_12p.pdf') }], 'replace');
});
await page.waitForSelector('.page-canvas canvas');
mkdirSync('bench/out', { recursive: true });

const scenarios = {
  async split() {
    await page.getByRole('button', { name: '분할' }).click();
    await page.locator('.thumb').nth(2).locator('.cut').click();
    await page.locator('.thumb').nth(6).locator('.cut').click();
  },
  async text() {
    await page.keyboard.press('t');
    const s = await page.locator('.page-sheet').boundingBox();
    await page.mouse.move(s.x + 110, s.y + 215);
    await page.mouse.down();
    await page.mouse.move(s.x + 390, s.y + 290, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.type('한글 텍스트 삽입 테스트 ABC 123 — 영역을 넘으면 자동으로 줄이 바뀝니다.');
  },
  async capture() {
    const s = await page.locator('.page-sheet').boundingBox();
    const drag = async (a, b) => {
      await page.mouse.move(s.x + a[0], s.y + a[1]);
      await page.mouse.down();
      await page.mouse.move(s.x + b[0], s.y + b[1], { steps: 6 });
      await page.mouse.up();
    };
    await page.keyboard.press('c');
    await drag([100, 170], [400, 300]);
    await drag([60, 360], [300, 480]);
    await page.getByRole('button', { name: '현재 쪽 전체 담기' }).click();
  },
  async pen() {
    const s = await page.locator('.page-sheet').boundingBox();
    await page.keyboard.press('p');
    await page.mouse.move(s.x + 120, s.y + 380);
    await page.mouse.down();
    for (let i = 0; i <= 40; i++) await page.mouse.move(s.x + 120 + i * 4, s.y + 380 + Math.sin(i / 3) * 18);
    await page.mouse.up();
    await page.keyboard.press('v');
    await page.mouse.click(s.x + 120, s.y + 380); // 선 선택
  },
  async find() {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('target box');
    await page.keyboard.press('Enter');
  },
  async help() {
    await page.getByRole('button', { name: '편집' }).click();
    await page.keyboard.press('F1');
  },
};
await scenarios[scenario]?.();
await page.waitForTimeout(600);
await page.screenshot({ path: `bench/out/shot-${scenario}.png` });
await browser.close();
console.log(`bench/out/shot-${scenario}.png`);
