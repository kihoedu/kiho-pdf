export type Rot = 0 | 90 | 180 | 270;

/** 화면 100% = 96dpi. PDF 1pt = 1/72in 이므로 100%에서 1pt = 96/72 px. */
export const CSS_UNITS = 96 / 72;
export const DEFAULT_ZOOM = 0.75;
/** 위쪽 화면의 기준 높이(배율 100%일 때, px). */
export const TOP_PANE_BASE_HEIGHT = 750;

/** [x0, y0, x1, y1] — PDF 사용자 공간에서의 페이지 표시 영역(CropBox). */
export type Box = [number, number, number, number];

/**
 * 삽입 텍스트. 사각형은 "scale=1, 회전 rot 상태의 뷰 좌표(pt, 좌상단 원점)"로 보관한다.
 * rot 는 텍스트가 똑바로 읽히는 페이지 회전값(삽입 당시의 총 회전)이다.
 */
export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: Rot;
  text: string;
  size: number;
  color: string; // #rrggbb
}

/**
 * 펜으로 그린 선. 좌표 규약은 TextBox 와 같다(그릴 당시 회전 rot 의 뷰 좌표, pt).
 * 저장 시 기존 콘텐츠 뒤에 새 콘텐츠 스트림으로 그려진다(주석 객체가 아니라 본문).
 */
export interface Shape {
  id: string;
  kind: 'ink';
  rot: Rot;
  /** [x0, y0, x1, y1, …] */
  pts: number[];
  color: string;
  width: number;
}

/**
 * 캡처할 영역. 분할 그룹처럼 목록에 모아 두었다가 한꺼번에 이미지 파일로 내보낸다.
 * 영역은 캡처 당시 회전 rot 의 뷰 좌표(pt)로 보관하므로, 이후 쪽을 돌려도 같은 내용을 가리킨다.
 */
export interface Capture {
  id: string;
  pageUid: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: Rot;
  /** 캡처 당시 그 쪽의 사용자 회전. 이후 쪽을 돌렸는지(가로·세로가 바뀌었는지) 알아내는 데 쓴다. */
  userRot: Rot;
  name: string;
  /** true 이면 이름을 템플릿으로 자동 생성한다(사용자가 직접 입력하면 false). */
  auto: boolean;
}

export interface CaptureOptions {
  dpi: number;
  format: 'png' | 'jpeg';
}

export interface PageItem {
  uid: string;
  srcId: string;
  srcIndex: number; // 0-based
  /** 사용자가 추가한 회전(원본 /Rotate 에 더해진다). */
  userRot: Rot;
  texts: TextBox[];
  shapes: Shape[];
}

export const hasEdits = (p: PageItem): boolean => p.texts.length > 0 || p.shapes.length > 0;

export interface SplitGroup {
  id: string;
  start: number; // 1-based, 포함
  end: number; // 1-based, 포함
  name: string;
  /** true 이면 이름을 템플릿으로 자동 생성한다(사용자가 직접 입력하면 false). */
  auto: boolean;
}

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
