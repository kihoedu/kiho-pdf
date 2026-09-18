import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { devTune } from '../devTune';
import { EDITS_INFO_KEY } from '../model/editsCodec';
import type { Box, Rot } from '../model/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// 상대 경로 배포(base: './')에서도 Worker 쪽 요청이 어긋나지 않도록 절대 URL 로 만든다.
const ASSET_BASE = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
/**
 * 이 크기까지는 파일을 통째로 읽어 넘긴다. PDF.js 는 문서를 열 때 마지막 쪽을 검증하는데,
 * 페이지 트리가 평평한 PDF(스캐너 출력물에 흔함)에서는 그 과정이 모든 페이지 사전을 훑어
 * 결국 파일 전체를 청크 단위로 수백 번 왕복하며 읽게 된다. 로컬 디스크에서는 한 번에 읽는 쪽이 훨씬 빠르다.
 * 그보다 큰 파일만 구간 읽기(Range)로 연다.
 */
const WHOLE_FILE_LIMIT = 1024 * 1024 * 1024;
const RANGE_CHUNK = 8 * 1024 * 1024;

/** 로컬 File 을 필요한 구간만 잘라 읽어 PDF.js 에 공급한다(전체를 메모리에 올리지 않는다). */
class FileRangeTransport extends pdfjs.PDFDataRangeTransport {
  #file: File;
  #aborted = false;
  constructor(file: File) {
    super(file.size, null);
    this.#file = file;
  }
  override requestDataRange(begin: number, end: number): void {
    this.#file
      .slice(begin, end)
      .arrayBuffer()
      .then((buf) => {
        if (!this.#aborted) this.onDataRange(begin, new Uint8Array(buf));
      })
      .catch((e) => console.error('range read failed', e));
  }
  override abort(): void {
    this.#aborted = true;
  }
}

export interface LoadedPdf {
  pdf: PDFDocumentProxy;
  getPage(index: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
}

export async function openPdf(file: File, password?: string): Promise<LoadedPdf> {
  const common = {
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    password,
  };
  const tune = devTune();
  const task =
    file.size <= (tune.wholeFileLimit ?? WHOLE_FILE_LIMIT)
      ? pdfjs.getDocument({ ...common, data: await file.arrayBuffer() })
      : pdfjs.getDocument({
          ...common,
          range: new FileRangeTransport(file),
          rangeChunkSize: tune.rangeChunk ?? RANGE_CHUNK,
          disableStream: true,
          disableAutoFetch: true,
        });
  const pdf = await task.promise;
  const pages = new Map<number, Promise<PDFPageProxy>>();
  return {
    pdf,
    getPage(index) {
      let p = pages.get(index);
      if (!p) {
        p = pdf.getPage(index + 1);
        pages.set(index, p);
      }
      return p;
    },
    destroy: () => task.destroy(),
  };
}

export interface DocFlags {
  /** AcroForm 의 SigFlags 에 "서명 있음" 이 켜져 있다. 수정·저장하면 서명이 무효가 된다. */
  signed: boolean;
  /** 이 앱이 삽입 항목 기록과 함께 저장한 파일이다(engine/pieceInfo.ts). */
  kihoEdits: boolean;
}

/** 문서 정보(Info)만 읽는 가벼운 확인. 실패해도 여는 데는 지장이 없게 한다. */
export async function readDocFlags(pdf: PDFDocumentProxy): Promise<DocFlags> {
  try {
    const info = (await pdf.getMetadata()).info as { IsSignaturesPresent?: boolean; Custom?: Map<string, unknown> | Record<string, unknown> };
    const custom = info.Custom;
    const flag = custom instanceof Map ? custom.get(EDITS_INFO_KEY) : custom?.[EDITS_INFO_KEY];
    return { signed: !!info.IsSignaturesPresent, kihoEdits: flag !== undefined };
  } catch {
    return { signed: false, kihoEdits: false };
  }
}

export const pageBox = (page: PDFPageProxy): Box => page.view as Box;
export const pageRot = (page: PDFPageProxy): Rot => ((((page.rotate % 360) + 360) % 360) as Rot);

export function isPasswordError(e: unknown): boolean {
  return e instanceof Error && e.name === 'PasswordException';
}
