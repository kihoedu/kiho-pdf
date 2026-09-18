/// <reference lib="webworker" />
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString, type PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import { EDITS_INFO_KEY, EDITS_VERSION, decodeEdits } from '../model/editsCodec';
import type { RestoredPage } from './protocol';

/**
 * 재편집을 위한 기록. 삽입 항목을 본문에 그릴 때, 같은 내용을 쪽의 /PieceInfo(응용 프로그램 전용 자료를 두는
 * PDF 표준 자리) 아래에 함께 적는다.
 *
 *   /PieceInfo << /KihoPDF << /LastModified (D:…) /Private <<
 *       /V 1  /Edits <삽입 항목 JSON>  /Streams [이번 저장이 덧붙인 콘텐츠 스트림]  /Fonts [이번 저장이 추가한 폰트 이름]
 *   >> >> >>
 *
 * 다시 열 때는 /Streams 의 스트림을 /Contents 에서 빼면 원본 쪽이 그대로 돌아오므로, /Edits 를 편집 가능한
 * 항목으로 되살릴 수 있다. 다른 프로그램이 콘텐츠 스트림을 합치는 등 구조를 바꿔 놓았으면(= /Streams 가
 * /Contents 에 없으면) 그 쪽은 건드리지 않는다 — 그린 내용이 사라지는 일은 없어야 한다.
 * 문서 정보(Info)의 KihoEdits 는 "이 파일에 기록이 있다"는 표시로, 열 때 이것만 보고 되살릴지 정한다
 * (표시가 없는 파일은 여는 속도에 영향이 없다).
 */
const APP = PDFName.of('KihoPDF');
const PIECE_INFO = PDFName.of('PieceInfo');
const PRIVATE = PDFName.of('Private');
const CONTENTS = PDFName.of('Contents');
const FONT = PDFName.of('Font');

function contentsArray(page: PDFPage): PDFArray | undefined {
  const c = page.node.lookup(CONTENTS);
  return c instanceof PDFArray ? c : undefined;
}

function contentRefs(page: PDFPage): PDFRef[] {
  const raw = page.node.get(CONTENTS);
  const arr = contentsArray(page);
  if (arr) return arr.asArray().filter((x): x is PDFRef => x instanceof PDFRef);
  return raw instanceof PDFRef ? [raw] : [];
}

const fontDict = (page: PDFPage): PDFDict | undefined => page.node.Resources()?.lookupMaybe(FONT, PDFDict);
const fontNames = (page: PDFPage): string[] => (fontDict(page)?.keys() ?? []).map((k) => k.decodeText());

export interface PageSnapshot {
  contents: PDFRef[];
  fonts: string[];
}

/** 그리기 전에 찍어 둔다. 그린 뒤와 비교해 "이번 저장이 덧붙인 것"을 알아낸다. */
export const snapshotPage = (page: PDFPage): PageSnapshot => ({ contents: contentRefs(page), fonts: fontNames(page) });

export function recordEdits(doc: PDFDocument, page: PDFPage, edits: string, before: PageSnapshot): void {
  const ctx = doc.context;
  const streams = contentRefs(page).filter((r) => !before.contents.includes(r));
  const fonts = fontNames(page).filter((n) => !before.fonts.includes(n));
  let piece = page.node.lookupMaybe(PIECE_INFO, PDFDict);
  if (!piece) {
    piece = ctx.obj({});
    page.node.set(PIECE_INFO, piece);
  }
  piece.set(
    APP,
    ctx.obj({
      LastModified: PDFString.fromDate(new Date()),
      Private: { V: EDITS_VERSION, Edits: PDFHexString.fromText(edits), Streams: streams, Fonts: fonts.map((n) => PDFName.of(n)) },
    }),
  );
}

function infoDict(doc: PDFDocument): PDFDict | undefined {
  return doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict);
}

export function markDocument(doc: PDFDocument): void {
  infoDict(doc)?.set(PDFName.of(EDITS_INFO_KEY), PDFString.of(String(EDITS_VERSION)));
}

/**
 * 기록이 있는 쪽에서 그려 넣은 스트림을 걷어 내고 기록을 돌려준다(doc 를 직접 고친다).
 * 기록은 성공 여부와 무관하게 지운다: 이후 저장에서 현재 상태로 새로 적기 때문이다.
 */
export function restoreEdits(doc: PDFDocument): RestoredPage[] {
  const out: RestoredPage[] = [];
  const fontRemovals: { dict: PDFDict; name: PDFName }[] = [];
  let failed = false;

  doc.getPages().forEach((page, index) => {
    const piece = page.node.lookupMaybe(PIECE_INFO, PDFDict);
    const priv = piece?.lookupMaybe(APP, PDFDict)?.lookupMaybe(PRIVATE, PDFDict);
    if (!piece || !priv) return;
    piece.delete(APP);
    if (!piece.keys().length) page.node.delete(PIECE_INFO);

    const edits = priv.lookup(PDFName.of('Edits'));
    const streams = priv.lookup(PDFName.of('Streams'));
    const fonts = priv.lookup(PDFName.of('Fonts'));
    const json = edits instanceof PDFHexString || edits instanceof PDFString ? edits.decodeText() : undefined;
    const contents = contentsArray(page);
    const refs = streams instanceof PDFArray ? streams.asArray() : [];
    const usable =
      json !== undefined &&
      decodeEdits(json) !== undefined &&
      contents !== undefined &&
      refs.length > 0 &&
      refs.every((r) => r instanceof PDFRef && contents.indexOf(r) !== undefined);
    if (!usable) {
      failed = true;
      return;
    }
    for (const r of refs) contents.remove(contents.indexOf(r)!);
    const fd = fontDict(page);
    if (fd && fonts instanceof PDFArray) {
      for (const n of fonts.asArray()) if (n instanceof PDFName) fontRemovals.push({ dict: fd, name: n });
    }
    out.push({ index, edits: json });
  });

  // 폰트 사전은 여러 쪽이 함께 쓰기도 한다. 걷어 내지 못한 쪽이 하나라도 있으면 그 쪽의 글자가 이 폰트를 쓰므로 남겨 둔다.
  if (!failed) for (const { dict, name } of fontRemovals) dict.delete(name);
  infoDict(doc)?.delete(PDFName.of(EDITS_INFO_KEY));
  return out;
}
