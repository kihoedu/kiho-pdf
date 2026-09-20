/** 저장 엔진(Worker)과 주고받는 메시지. 좌표는 모두 PDF 사용자 공간(pt). */

export interface TextDraw {
  lines: { text: string; x: number; y: number }[];
  size: number;
  color: [number, number, number]; // 0..1
  /** 반시계 방향 각도(도). */
  rotate: number;
}

type Rgb = [number, number, number];

export interface ShapeDraw {
  kind: 'path';
  pts: number[];
  color: Rgb;
  width: number;
}

export interface PagePlan {
  srcId: string;
  srcIndex: number;
  /** 원본 /Rotate 에 더할 회전. */
  addRotate: number;
  texts: TextDraw[];
  shapes: ShapeDraw[];
  /** 이 쪽의 삽입 항목 기록(model/editsCodec). 저장본에 함께 적어 두어 다시 열었을 때 재편집할 수 있게 한다. */
  edits?: string;
}

export interface OutputPlan {
  name: string;
  pages: PagePlan[];
}

export interface OptimizeOptions {
  /** 이 해상도를 넘는 이미지만 이 해상도까지 줄인다. */
  dpi: number;
  /** JPEG 품질(0–1). */
  quality: number;
}

export interface OptimizeStats {
  images: number;
  resampled: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface BuildRequest {
  type: 'build';
  jobId: number;
  sources: { id: string; file: File; password?: string }[];
  outputs: OutputPlan[];
  /** 텍스트가 있을 때만 전달하는 TTF. */
  fontBytes?: ArrayBuffer;
  /** 지정하면 용량 최적화를 수행한다. 기본 저장은 항상 무손실이다. */
  optimize?: OptimizeOptions;
}

/** 이 앱이 삽입 항목과 함께 저장한 파일에서, 그려 넣은 부분을 걷어 내고 기록을 돌려 달라는 요청. */
export interface RestoreRequest {
  type: 'restore';
  jobId: number;
  source: BuildRequest['sources'][number];
}

export interface RestoredPage {
  /** 0-based 쪽 번호 */
  index: number;
  edits: string;
}

/**
 * 썸네일 빠른 경로 요청(engine/pageImage.ts). 쪽 전체를 덮는 이미지가 있으면 워커가 "디코딩하면서 축소"까지 마치고
 * 작은 비트맵만 돌려준다. 큰 이미지 바이트가 메인 스레드로 넘어오지 않고, 디코딩도 메인 스레드 밖에서 끝난다.
 */
export interface ThumbRequest {
  type: 'thumb';
  jobId: number;
  source: BuildRequest['sources'][number];
  /** 0-based 쪽 번호 */
  index: number;
  /** 결과 비트맵이 들어갈 최대 크기(px) */
  maxW: number;
  maxH: number;
  /** 사용자가 쪽에 더한 회전. 원본 /Rotate 는 워커가 스스로 더한다. */
  rotate: number;
}

export type EngineRequest = BuildRequest | RestoreRequest | ThumbRequest | { type: 'forget'; srcIds?: string[] };

export type EngineResponse =
  | { type: 'output'; jobId: number; index: number; name: string; bytes: Uint8Array; stats?: OptimizeStats }
  /** pages 가 비어 있으면 되살릴 것이 없다는 뜻이고 bytes 도 없다. bytes 는 그려 넣은 부분을 걷어 낸 PDF. */
  | { type: 'restored'; jobId: number; pages: RestoredPage[]; bytes?: Uint8Array }
  /** bitmap 이 없으면 이 쪽은 빠른 경로에 맞지 않는다는 뜻(호출 쪽이 PDF.js 로 그린다). */
  | { type: 'thumb'; jobId: number; bitmap?: ImageBitmap }
  | { type: 'progress'; jobId: number; text: string }
  | { type: 'done'; jobId: number }
  | { type: 'error'; jobId: number; message: string };
