import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 테스트용 샘플 PDF 는 저장소에 넣지 않고 필요할 때 만든다. */
export default function globalSetup(): void {
  if (!existsSync('bench/samples/test_12p.pdf')) {
    execFileSync(process.execPath, ['bench/make-test.mjs'], { stdio: 'inherit' });
  }
}
