import { expect, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';

/**
 * 파일 선택 대화상자는 자동화할 수 없으므로, 브라우저의 OPFS(원본 전용 파일 시스템)를 가리키는
 * 진짜 FileSystemHandle 을 돌려주는 대역으로 바꾼다. 앱의 읽기/쓰기 경로는 실제 그대로 실행된다.
 */
export async function mockPickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const root = () => navigator.storage.getDirectory();
    const w = window as unknown as Record<string, unknown>;
    w.__pickName = 'test_12p.pdf';
    w.showOpenFilePicker = async () => [await (await root()).getFileHandle(w.__pickName as string)];
    w.showSaveFilePicker = async (o: { suggestedName: string }) =>
      (await root()).getFileHandle((w.__saveAs as string) ?? o.suggestedName, { create: true });
    w.showDirectoryPicker = async () => (await root()).getDirectoryHandle('out', { create: true });
    w.confirm = () => true;
  });
}

/** 개발 서버가 내주는 샘플을 OPFS 에 넣어 "디스크의 파일" 역할을 하게 한다. */
export async function seedFile(page: Page, name = 'test_12p.pdf'): Promise<void> {
  await page.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    for await (const key of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      await root.removeEntry(key, { recursive: true });
    }
    const buf = await (await fetch(`/bench/samples/${n}`)).arrayBuffer();
    const w = await (await root.getFileHandle(n, { create: true })).createWritable();
    await w.write(buf);
    await w.close();
  }, name);
}

export async function openSample(page: Page): Promise<void> {
  await mockPickers(page);
  await page.goto('/');
  await seedFile(page);
  await page.getByRole('button', { name: '열기…' }).click();
  await expect(page.locator('.thumb')).toHaveCount(12);
  await expect(page.locator('.page-canvas canvas')).toBeVisible();
}

/** OPFS 의 파일을 읽어 pdf-lib 문서로 돌려준다. dir 생략 시 루트. */
export async function readPdf(page: Page, name: string, dir?: string): Promise<PDFDocument> {
  const bytes = await page.evaluate(
    async ([n, d]) => {
      let h = await navigator.storage.getDirectory();
      if (d) h = await h.getDirectoryHandle(d);
      const f = await (await h.getFileHandle(n)).getFile();
      return Array.from(new Uint8Array(await f.arrayBuffer()));
    },
    [name, dir ?? ''] as const,
  );
  return PDFDocument.load(new Uint8Array(bytes));
}

export async function listDir(page: Page, dir: string): Promise<string[]> {
  return page.evaluate(async (d) => {
    const h = await (await navigator.storage.getDirectory()).getDirectoryHandle(d);
    const out: string[] = [];
    for await (const key of (h as unknown as { keys(): AsyncIterable<string> }).keys()) out.push(key);
    return out.sort();
  }, dir);
}

/** 저장본의 한 쪽에서 텍스트 조각을 뽑는다(PDF.js 사용, 앱이 연 문서 기준). */
export async function pageTexts(page: Page, index: number): Promise<{ str: string; x: number; y: number; angle: number }[]> {
  return page.evaluate(async (i) => {
    type Item = { str: string; transform: number[] };
    const st = (window as unknown as { __kiho: { useStore: { getState(): { pages: { srcId: string; srcIndex: number }[]; sources: Record<string, { loaded: { getPage(n: number): Promise<{ getViewport(o: { scale: number }): { transform: number[] }; getTextContent(): Promise<{ items: Item[] }> }> } }> } } } }).__kiho.useStore.getState();
    const item = st.pages[i];
    const pg = await st.sources[item.srcId].loaded.getPage(item.srcIndex);
    const v = pg.getViewport({ scale: 1 }).transform;
    const tc = await pg.getTextContent();
    return tc.items
      .filter((it) => it.str.trim())
      .map((it) => {
        const m = it.transform;
        const a = v[0] * m[0] + v[2] * m[1];
        const b = v[1] * m[0] + v[3] * m[1];
        return {
          str: it.str,
          x: v[0] * m[4] + v[2] * m[5] + v[4],
          y: v[1] * m[4] + v[3] * m[5] + v[5],
          angle: Math.round((Math.atan2(b, a) * 180) / Math.PI),
        };
      });
  }, index);
}
