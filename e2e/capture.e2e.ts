import { expect, test, type Page } from '@playwright/test';
import { listDir, openSample } from './helpers';

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const s = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.move(s.x + from[0], s.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(s.x + to[0], s.y + to[1], { steps: 6 });
  await page.mouse.up();
}

/** OPFS 의 out/ 폴더에 저장된 이미지를 디코딩해 크기, 지정한 점의 색, 지정한 영역의 어두운 픽셀 수를 돌려준다. */
async function inspect(page: Page, name: string, probes: [number, number][], darkIn?: [number, number, number, number]) {
  return page.evaluate(
    async ([n, pts, region]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('out');
      const bmp = await createImageBitmap(await (await dir.getFileHandle(n as string)).getFile());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const colors = (pts as [number, number][]).map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)));
      let dark = 0;
      if (region) {
        const [x, y, w, h] = region as number[];
        const d = g.getImageData(x, y, w, h).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
      }
      return { w: bmp.width, h: bmp.height, colors, dark };
    },
    [name, probes, darkIn ?? null] as const,
  );
}
const isRed = (c: number[]) => c[0] > 170 && c[1] < 150 && c[2] < 150;

test('캡처: 영역을 목록에 모아 한꺼번에 이미지로 저장한다', async ({ page }) => {
  await openSample(page);

  // 캡처에 포함돼야 할 텍스트를 먼저 넣는다(빨간 상자 안)
  await page.keyboard.press('t');
  const s = (await page.locator('.page-sheet').boundingBox())!;
  await page.mouse.click(s.x + 120, s.y + 262);
  await expect(page.locator('.text-box textarea')).toBeFocused(); // 폰트를 받은 뒤에야 상자가 생긴다
  await page.keyboard.type('캡처포함');
  await page.keyboard.press('Escape');

  // C → 캡처 탭이 열리고 도구가 켜진다
  await page.keyboard.press('c');
  await expect(page.getByRole('button', { name: /영역 캡처.*켜짐/ })).toBeVisible();

  // 1쪽: 빨간 상자(x 100–400, y 200–300pt)를 정확히 따라 끈다 — 75% 에서 1pt = 1px
  await drag(page, [100, 200], [400, 300]);
  await expect(page.locator('.captures li')).toHaveCount(1);
  await expect(page.locator('.captures li input')).toHaveValue('test_12p_1쪽_01');
  await expect(page.locator('.captures li')).toContainText('1250×417px'); // 300pt × 100pt @300dpi
  await expect(page.locator('.capture-box .capture-tag')).toContainText('#1');
  await expect(page.locator('.capture-thumb img')).toHaveCount(1); // 미리보기

  // 도구는 켜진 채: 2쪽(/Rotate 90, 가로로 보임)으로 가서 그 쪽의 빨간 상자를 끈다
  await page.locator('.thumb').nth(1).click();
  await expect(page.locator('.capture-box')).toHaveCount(0); // 다른 쪽의 상자는 보이지 않는다
  await drag(page, [542, 100], [642, 400]);
  await expect(page.locator('.captures li')).toHaveCount(2);

  // 3쪽(가로 A4) 전체
  await page.locator('.thumb').nth(2).click();
  await page.getByRole('button', { name: '현재 쪽 전체 담기' }).click();
  await expect(page.locator('.captures li')).toHaveCount(3);
  await expect(page.locator('.captures li').nth(2)).toContainText('3508×2479px');

  // 이름 바꾸기 · 실행 취소
  await page.locator('.captures li').nth(1).locator('input').fill('도장');
  await page.keyboard.press('Enter');
  await page.locator('.captures li').nth(2).getByTitle('삭제').click();
  await expect(page.locator('.captures li')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.captures li')).toHaveCount(3);

  await page.getByRole('button', { name: /모두 저장/ }).click();
  await expect(page.locator('.toast')).toContainText('이미지 3개 저장 완료');
  expect(await listDir(page, 'out')).toEqual(['test_12p_1쪽_01.png', 'test_12p_3쪽_03.png', '도장.png']);

  // 1쪽 캡처: 크기, 가장자리가 빨간 테두리 위, 삽입 텍스트 포함
  const a = await inspect(page, 'test_12p_1쪽_01.png', [[1, 200], [600, 1], [600, 415]], [85, 215, 260, 90]);
  expect([a.w, a.h]).toEqual([1250, 417]);
  a.colors.forEach((c) => expect(isRed(c), `테두리 색 ${c}`).toBe(true));
  expect(a.dark).toBeGreaterThan(80); // "캡처포함" 글자

  // 회전된 쪽의 캡처도 정확히 그 영역이다
  const b = await inspect(page, '도장.png', [[1, 600], [200, 1], [415, 600]]);
  expect([b.w, b.h]).toEqual([417, 1250]);
  b.colors.forEach((c) => expect(isRed(c), `테두리 색 ${c}`).toBe(true));

  // 캡처한 뒤에 쪽을 돌려도 같은 내용을 가리킨다(방향만 바뀐다) + JPEG 로 내보내기
  await page.locator('.thumb').nth(1).click();
  await page.getByRole('button', { name: '페이지', exact: true }).click();
  await page.getByRole('button', { name: '⟳ 오른쪽 회전' }).click();
  await page.getByRole('button', { name: '캡처', exact: true }).click();
  await expect(page.locator('.captures li').nth(1)).toContainText('1250×417px'); // 목록의 크기도 새 방향을 따른다
  await page.locator('.toast').click(); // 앞선 저장의 알림을 닫아 새 알림과 헷갈리지 않게 한다
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.getByRole('button', { name: /모두 저장/ }).click(); // 같은 이름 → 덮어쓰기 확인(대역이 승인)
  await expect(page.locator('.toast')).toContainText('PNG');
  const r = await inspect(page, '도장.png', [[600, 1], [1, 200], [600, 415]]);
  expect([r.w, r.h]).toEqual([1250, 417]);
  r.colors.forEach((c) => expect(isRed(c), `테두리 색 ${c}`).toBe(true));

  // JPEG 로 내보내기(손실 압축이라 색은 보지 않고 형식·크기만 확인)
  await page.locator('.toast').click();
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.locator('select').nth(1).selectOption('jpeg');
  await page.getByRole('button', { name: /모두 저장/ }).click();
  await expect(page.locator('.toast')).toContainText('JPG');
  const j = await inspect(page, '도장.jpg', []);
  expect([j.w, j.h]).toEqual([1250, 417]);
});

test('캡처 영역 이동·크기 조절·Delete, 다른 탭에서는 도구가 꺼진다', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('c');
  await drag(page, [100, 200], [300, 300]);
  await expect(page.locator('.captures li')).toContainText('833×417px');

  // 도구가 켜져 있는 동안에는 기존 상자 위에서 끌어도 새 캡처가 된다(겹쳐 담기)
  await drag(page, [150, 220], [250, 280]);
  await expect(page.locator('.captures li')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.captures li')).toHaveCount(1);

  // 상자를 고치려면 도구를 끄고(Esc) 상자를 눌러 선택한다 → 손잡이가 나타난다
  await page.keyboard.press('Escape');
  await expect(page.locator('.capture-box .text-resize')).toHaveCount(0);
  await page.locator('.capture-box').click();
  await expect(page.locator('.capture-box .text-resize')).toHaveCount(1);

  // 크기 조절 손잡이(오른쪽 아래)를 100pt 오른쪽으로
  const box = (await page.locator('.capture-box').boundingBox())!;
  const sheet = (await page.locator('.page-sheet').boundingBox())!;
  await drag(page, [box.x + box.width - sheet.x, box.y + box.height - sheet.y], [box.x + box.width - sheet.x + 100, box.y + box.height - sheet.y]);
  await expect(page.locator('.captures li')).toContainText('1250×417px');

  // 상자를 끌어 옮겨도 크기는 그대로
  await drag(page, [200, 250], [260, 320]);
  await expect(page.locator('.captures li')).toContainText('1250×417px');
  const moved = (await page.locator('.capture-box').boundingBox())!;
  expect(Math.round(moved.x - sheet.x)).toBe(160);

  await page.keyboard.press('Delete');
  await expect(page.locator('.captures li')).toHaveCount(0);

  // 다른 탭으로 가면 캡처 도구가 꺼져서, 끌어도 캡처가 생기지 않는다
  await page.getByRole('button', { name: '보기', exact: true }).click();
  await drag(page, [100, 200], [300, 300]);
  await page.getByRole('button', { name: '캡처', exact: true }).click();
  await expect(page.locator('.captures li')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /영역 캡처.*시작/ })).toBeVisible();
});
