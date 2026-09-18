import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** dist/ 의 모든 파일을 사전 캐시 목록으로 넣은 서비스 워커(dist/sw.js)를 만든다. */
function offlineServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'kiho-offline-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else if (!/\.map$|^sw\.js$/.test(name)) files.push('./' + relative(outDir, p).replace(/\\/g, '/'));
        }
      };
      walk(outDir);
      files.sort();
      const hash = createHash('sha1');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const template = readFileSync('src/sw.template.js', 'utf8');
      const sw = template
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('= __FILES__;', `= ${JSON.stringify(files)};`);
      if (sw.includes('__VERSION__') || sw.includes('__FILES__')) {
        throw new Error('sw.template.js 의 자리표시자를 채우지 못했습니다.');
      }
      writeFileSync(join(outDir, 'sw.js'), sw);
      console.log(`sw.js: ${files.length} files precached`);
    },
  };
}

export default defineConfig({
  base: './', // 어떤 하위 경로에 올려도 동작하도록 상대 경로로 빌드
  plugins: [react(), offlineServiceWorker()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
