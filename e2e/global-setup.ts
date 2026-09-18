import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * 1) 테스트용 샘플 PDF 는 저장소에 넣지 않고 필요할 때 만든다.
 * 2) 브라우저는 여기서 서버로 한 번만 띄우고, 워커들은 거기에 접속해서 쓴다(playwright.config.ts 의 connectOptions).
 *
 * 브라우저를 워커가 직접 띄우게 두면, 워커가 끝날 때 Playwright 가 브라우저의 임시 프로필 폴더를 지운다.
 * Windows 에서는 방금 닫힌 프로필의 파일이 다른 프로세스(실시간 검사 등)에 잠시 붙들려 "삭제 대기" 로 남는 일이 있는데,
 * Playwright 는 파일마다 10번씩 다시 시도하므로(150여 개 × 약 5초) 그동안 워커가 끝나지 않는다. 그러면
 * 다음 프로젝트(pwa)의 워커가 시작되지 못하고 러너도 끝나지 않아, 전체 실행이 멈춘 것처럼 보인다.
 * 브라우저를 별도 프로세스에 두고 마지막에 프로세스 트리째 끝내면 러너는 그 정리를 기다릴 일이 없다.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync('bench/samples/test_12p.pdf')) {
    execFileSync(process.execPath, ['bench/make-test.mjs'], { stdio: 'inherit' });
  }

  const child = spawn(process.execPath, ['e2e/browser-server.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const endpoint = await new Promise<string>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => line.startsWith('WS ') && resolve(line.slice(3).trim()));
    child.once('exit', (code) => reject(new Error(`브라우저 서버가 시작하지 못했습니다(exit ${code}). PW_CHANNEL 의 브라우저가 설치돼 있는지 확인하세요.`)));
    child.once('error', reject);
  });
  // 워커 프로세스는 이 뒤에 만들어지므로 환경 변수를 물려받는다.
  process.env.PW_E2E_WS = endpoint;

  return async () => {
    if (process.platform === 'win32' && child.pid) {
      // Windows 의 kill 은 자식(브라우저)을 남긴다. 트리째 끝낸다.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM'); // Playwright 가 신호를 받아 브라우저를 닫고 끝난다
    }
  };
}
