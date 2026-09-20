import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { mockPickers } from './helpers';

/**
 * 스캔본처럼 "쪽 전체가 이미지 한 장"인 PDF 를 만든다. JPEG 인코더가 없는 Node 대신 브라우저에서 만든다.
 * 쪽마다 눈에 띄게 다른 그림을 넣는다 — 엉뚱한 쪽을 그리는 실수도 잡아내려면 쪽이 서로 달라야 한다.
 */
async function makeScanPdf(page: Page): Promise<Uint8Array> {
  const b64s = await page.evaluate(async () => {
    const spots: [number, number][] = [
      [80, 80], // 1쪽: 왼쪽 위
      [860, 80], // 2쪽: 오른쪽 위
      [80, 1400], // 3쪽: 왼쪽 아래
    ];
    const out: string[] = [];
    for (const [bx, by] of spots) {
      const c = new OffscreenCanvas(1240, 1754); // A4 150dpi
      const g = c.getContext('2d')!;
      g.fillStyle = '#fffdf5';
      g.fillRect(0, 0, 1240, 1754);
      g.fillStyle = '#c01020';
      g.fillRect(bx, by, 300, 250); // 쪽마다 다른 자리에 빨간 상자
      g.fillStyle = '#111';
      g.font = '40px serif';
      for (let y = 400; y < 1300; y += 60) g.fillText('다람쥐 헌 쳇바퀴에 타고파 The quick brown fox 0123', 100, y);
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
      let str = '';
      for (let i = 0; i < buf.length; i += 0x8000) str += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      out.push(btoa(str));
    }
    return out;
  });

  const doc = await PDFDocument.create();
  const size: [number, number] = [595.28, 841.89];
  // 1쪽: 그냥 스캔 쪽 / 2쪽: /Rotate 90 인 스캔 쪽 / 3쪽: 이미지 위에 글자를 얹어 빠른 경로에 맞지 않는 쪽
  for (let i = 0; i < 3; i++) {
    const img = await doc.embedJpg(Buffer.from(b64s[i], 'base64'));
    const p = doc.addPage(size);
    p.drawImage(img, { x: 0, y: 0, width: size[0], height: size[1] });
    if (i === 1) p.setRotation(degrees(90));
    if (i === 2) p.drawText('overlay', { x: 40, y: 400, size: 40 });
  }
  return doc.save({ useObjectStreams: false });
}

/** 개발 훅으로 썸네일 한 장을 그려 픽셀을 돌려준다. */
async function thumbPixels(page: Page, index: number, fast: boolean) {
  return page.evaluate(
    async ([i, useFast]) => {
      const k = (window as unknown as { __kiho: Record<string, never> }).__kiho as unknown as {
        useStore: { getState(): { pages: unknown[] } };
        renderThumb(item: unknown, w: number, h: number, dpr: number): Promise<HTMLCanvasElement>;
        clearRenderCaches(): void;
        fastThumbState: Map<string, { hits: number; misses: number }>;
      };
      (window as unknown as { __kihoTune: unknown }).__kihoTune = { noFastThumb: !useFast };
      k.clearRenderCaches();
      const canvas = await k.renderThumb(k.useStore.getState().pages[i as number], 120, 160, 2);
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const state = [...k.fastThumbState.values()][0] ?? { hits: 0, misses: 0 };
      return { w: canvas.width, h: canvas.height, data: Array.from(d), hits: state.hits, misses: state.misses };
    },
    [index, fast] as const,
  );
}

/** 두 그림의 픽셀당 평균 차이(0~255). 줄이는 방식이 달라 완전히 같지는 않다. */
function meanDiff(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * 8×8 칸의 평균 밝기. 줄이는 방식의 차이에는 둔하고 "무엇이 어디에 있는가"에는 민감하다 —
 * 방향이 틀리거나 잘려 나가면 이 값이 크게 벌어진다.
 */
function grid8(data: number[], w: number, h: number): number[] {
  const out: number[] = [];
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      let sum = 0;
      let count = 0;
      for (let y = Math.floor((gy * h) / 8); y < Math.floor(((gy + 1) * h) / 8); y++) {
        for (let x = Math.floor((gx * w) / 8); x < Math.floor(((gx + 1) * w) / 8); x++) {
          const i = (y * w + x) * 4;
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
          count++;
        }
      }
      out.push(count ? sum / count : 0);
    }
  }
  return out;
}

interface Shot {
  w: number;
  h: number;
  data: number[];
}
/** 같은 그림인가: 칸별 밝기가 거의 같아야 하고(방향·잘림), 픽셀 차이도 눈에 띌 만큼은 아니어야 한다. */
function expectSamePicture(fast: Shot, slow: Shot): void {
  expect([fast.w, fast.h]).toEqual([slow.w, slow.h]);
  expect(meanDiff(grid8(fast.data, fast.w, fast.h), grid8(slow.data, slow.w, slow.h))).toBeLessThan(4);
  expect(meanDiff(fast.data, slow.data)).toBeLessThan(12);
}

test('썸네일 빠른 경로: PDF.js 로 그린 것과 사실상 같은 그림을 훨씬 빨리 낸다', async ({ page }) => {
  await mockPickers(page);
  await page.goto('/');
  const pdf = await makeScanPdf(page);

  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle('scan.pdf', { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
    (window as unknown as { __pickName: string }).__pickName = 'scan.pdf';
  }, Buffer.from(pdf).toString('base64'));

  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('.thumb')).toHaveCount(3);

  // 1쪽: 스캔 쪽 — 빠른 경로를 타고, PDF.js 로 그린 것과 사실상 같다
  const slow = await thumbPixels(page, 0, false);
  const fast = await thumbPixels(page, 0, true);
  expect(fast.hits).toBeGreaterThan(0);
  expectSamePicture(fast, slow);

  // 2쪽: /Rotate 90 인 쪽도 방향까지 같다(가로로 눕고, 빨간 상자가 같은 자리에 온다)
  const slowRot = await thumbPixels(page, 1, false);
  const fastRot = await thumbPixels(page, 1, true);
  expect(fastRot.hits).toBeGreaterThan(0);
  expect(fastRot.w).toBeGreaterThan(fastRot.h); // 눕혀서 그려졌다
  expectSamePicture(fastRot, slowRot);

  // 3쪽: 이미지 위에 글자가 있으면 빠른 경로를 쓰지 않는다(빠뜨리면 글자가 사라진 썸네일이 된다)
  const mixed = await thumbPixels(page, 2, true);
  expect(mixed.misses).toBeGreaterThan(0);
  expect(meanDiff(mixed.data, (await thumbPixels(page, 2, false)).data)).toBe(0);
});

test('썸네일 빠른 경로: 사용자가 쪽을 돌려도 화면과 같은 방향으로 그린다', async ({ page }) => {
  await mockPickers(page);
  await page.goto('/');
  const pdf = await makeScanPdf(page);
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle('scan.pdf', { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
    (window as unknown as { __pickName: string }).__pickName = 'scan.pdf';
  }, Buffer.from(pdf).toString('base64'));
  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('.thumb')).toHaveCount(3);

  // 1쪽을 오른쪽으로 90° 돌린다
  await page.locator('.thumb').nth(0).click();
  await page.getByRole('button', { name: '페이지', exact: true }).click();
  await page.getByRole('button', { name: '⟳ 오른쪽 회전' }).click();

  const slow = await thumbPixels(page, 0, false);
  const fast = await thumbPixels(page, 0, true);
  expect(fast.hits).toBeGreaterThan(0);
  expect(fast.w).toBeGreaterThan(fast.h);
  expectSamePicture(fast, slow);
});
