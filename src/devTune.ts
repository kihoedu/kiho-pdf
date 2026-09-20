/**
 * 개발·자동화(E2E, bench) 전용 조정값. 개발 서버에서 `window.__kihoTune = { … }` 로 넣는다.
 * 빌드본에서는 항상 빈 객체이므로 사용자 동작에는 영향이 없다.
 */
export interface DevTune {
  /** 삽입 항목을 되살리지 않고 저장본을 있는 그대로 연다(본문에 실제로 그려졌는지 검증할 때). */
  noRestore?: boolean;
  /** 이 크기(바이트)를 넘으면 구간 읽기로 연다. 작은 샘플로 구간 읽기 경로를 재는 데 쓴다. */
  wholeFileLimit?: number;
  /** 구간 읽기 한 번의 크기(바이트). */
  rangeChunk?: number;
  /** 썸네일 빠른 경로를 끄고 항상 PDF.js 로 그린다(두 경로의 결과·속도를 견줄 때). */
  noFastThumb?: boolean;
}

export const devTune = (): DevTune =>
  import.meta.env.DEV ? ((globalThis as unknown as { __kihoTune?: DevTune }).__kihoTune ?? {}) : {};
