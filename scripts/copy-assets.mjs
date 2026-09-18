// PDF.js 런타임 자산(CMap·표준 폰트·WASM 디코더·ICC)과 한글 폰트를 public/ 으로 복사한다.
import { cpSync, mkdirSync } from 'node:fs';

const pdfjs = 'node_modules/pdfjs-dist';
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(`${pdfjs}/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
mkdirSync('public/fonts', { recursive: true });
cpSync(
  'node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf',
  'public/fonts/Pretendard-Regular.ttf',
);
// OFL 은 폰트와 함께 라이선스 전문을 배포하도록 요구한다.
cpSync('node_modules/pretendard/dist/LICENSE.txt', 'public/fonts/Pretendard-LICENSE.txt');
console.log('assets copied → public/pdfjs, public/fonts');
