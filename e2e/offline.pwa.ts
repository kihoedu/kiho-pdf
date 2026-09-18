import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { mockPickers, readPdf } from './helpers';

test('오프라인: 한 번 방문한 뒤에는 네트워크 없이 열기·편집·저장이 된다', async ({ page, context }) => {
  await mockPickers(page);
  await page.goto('/');
  // 서비스 워커가 사전 캐시를 끝내고 이 페이지를 제어할 때까지 기다린다
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '열기…' })).toBeVisible();

  // 파일을 끌어다 놓아 연다(빌드본에는 개발용 훅이 없으므로 실제 드롭 경로를 쓴다)
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) doc.addPage([595, 842]).drawText(`Offline page ${i}`, { x: 60, y: 760, size: 20, font });
  const bytes = Array.from(await doc.save());
  await page.evaluate((b) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(b)], 'offline.pdf', { type: 'application/pdf' }));
    document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  await expect(page.locator('.thumb')).toHaveCount(3);
  await expect(page.locator('.thumb-img canvas')).toHaveCount(3); // PDF.js 워커·렌더가 캐시에서 동작

  // 한글 텍스트 삽입 → 저장(폰트·저장 워커도 캐시에서 와야 한다)
  await page.keyboard.press('t');
  const s = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.click(s.x + 100, s.y + 300);
  await page.keyboard.type('오프라인 저장');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast')).toContainText('저장 완료');
  const saved = await readPdf(page, 'offline_편집.pdf');
  expect(saved.getPageCount()).toBe(3);
});
