// E2E 가 함께 쓰는 브라우저 서버. global-setup 이 별도 프로세스로 띄우고, 끝나면 프로세스 트리째 끝낸다.
// (왜 따로 띄우는지는 global-setup.ts 의 설명 참고)
import { chromium } from '@playwright/test';

const server = await chromium.launchServer({ channel: process.env.PW_CHANNEL ?? 'msedge' });
console.log(`WS ${server.wsEndpoint()}`);
// 부모(테스트 러너)가 사라지면 같이 끝난다.
process.stdin.on('end', () => process.exit(0)).resume();
