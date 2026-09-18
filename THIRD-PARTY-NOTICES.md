# 제3자 소프트웨어·폰트 고지

Kiho PDF 의 배포본(`dist/`)에는 아래 구성 요소가 함께 들어간다. 각 구성 요소는 자신의 라이선스를 따른다.
버전은 `package-lock.json` 이 기준이다.

| 구성 요소 | 용도 | 라이선스 | 배포본 안의 위치 |
|---|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | PDF 렌더·본문 텍스트 | Apache-2.0 | `assets/` (번들), `pdfjs/` |
| └ CMap 파일 | CJK 글자 매핑 | BSD-3-Clause (Adobe) | `pdfjs/cmaps/` (`LICENSE` 포함) |
| └ 표준 폰트 대체본 | 임베드되지 않은 표준 14 폰트 표시 | Foxit(BSD-3-Clause, PDFium) · Liberation(OFL-1.1) | `pdfjs/standard_fonts/` (`LICENSE_FOXIT`, `LICENSE_LIBERATION` 포함) |
| └ WASM 디코더 (OpenJPEG · JBIG2(PDFium) · qcms) | JPX/JBIG2 이미지, 색 변환 | BSD-2-Clause · BSD-3-Clause · MIT | `pdfjs/wasm/` (`LICENSE_*` 포함) |
| └ ICC 프로파일 | 색 변환 | CC0-1.0 | `pdfjs/iccs/` (`LICENSE` 포함) |
| [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (`@cantoo/pdf-lib`) | 저장 엔진 | MIT | `assets/` (번들) |
| [fontkit](https://github.com/cantoo-scribe/fontkit) (`@cantoo/fontkit`) | 폰트 서브셋 | MIT | `assets/` (번들) |
| [fflate](https://github.com/101arrowz/fflate) | ZIP 묶기 | MIT | `assets/` (번들) |
| [React](https://react.dev) · react-dom | 화면 | MIT | `assets/` (번들) |
| [zustand](https://github.com/pmndrs/zustand) | 상태 | MIT | `assets/` (번들) |
| [Pretendard](https://github.com/orioncactus/pretendard) | 삽입 텍스트용 한글 폰트. 저장하는 PDF 에 사용한 글자만 서브셋으로 포함된다 | SIL OFL-1.1 | `fonts/Pretendard-Regular.ttf` (`fonts/Pretendard-LICENSE.txt` 포함) |

- PDF.js 자산과 Pretendard 의 라이선스 파일은 `scripts/copy-assets.mjs` 가 폰트·자산과 함께 `public/` 으로 복사하므로 배포본에 그대로 실린다.
- SIL OFL 은 폰트를 문서에 임베드하는 것을 허용하며, 임베드된 문서에는 OFL 조건이 적용되지 않는다.
- 의존성을 추가·교체하면 이 표를 함께 고친다.
