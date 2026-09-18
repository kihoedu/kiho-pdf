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

export type EngineRequest = BuildRequest | { type: 'forget'; srcIds?: string[] };

export type EngineResponse =
  | { type: 'output'; jobId: number; index: number; name: string; bytes: Uint8Array; stats?: OptimizeStats }
  | { type: 'progress'; jobId: number; text: string }
  | { type: 'done'; jobId: number }
  | { type: 'error'; jobId: number; message: string };
