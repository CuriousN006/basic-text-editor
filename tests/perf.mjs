// 일괄 치환 성능을 원본/수정본에서 동일 조건으로 측정한다.
// 핸들러가 동기 실행이므로 페이지 안에서 직접 시간을 잰다.
import { startServer, launch, openEditor, openReplace } from './harness.mjs';

const label = process.env.EDITOR_DIR ? '원본' : '수정본';
const { server, base } = await startServer();
const browser = await launch();

const cases = [
  { name: '200개 · 서식 경계 ', build: () => '<p>앞<b>키워드</b>뒤 문장을 조금 더 길게.</p>'.repeat(200), find: '키워드', replace: '대체어' },
  { name: '2000개 · 문단 분산', build: () => '<p>키워드 그리고 나머지 문장입니다.</p>'.repeat(2000), find: '키워드', replace: '대체어' },
  { name: '3000개 · 한 문단 집중', build: () => `<p>${'가나'.repeat(3000)}</p>`, find: '가', replace: '다' },
];

for (const c of cases) {
  const { context, page } = await openEditor(browser, base);
  await page.evaluate((html) => T.set(html), c.build());
  await openReplace(page, { find: c.find, replace: c.replace });
  const ms = await page.evaluate(() => {
    const t = performance.now();
    document.querySelector('[data-find="replace-all"]').click();
    return Math.round(performance.now() - t);
  }, { timeout: 600000 });
  const left = await page.evaluate((find) => (T.text().match(new RegExp(find, 'g')) || []).length, c.find);
  const comments = await page.evaluate(() => T.comments().length);
  console.log(`[${label}] ${c.name}: ${String(ms).padStart(6)}ms · 남은 원문 ${left}개 · 잔존 주석 ${comments}개`);
  await context.close();
}

await browser.close();
server.close();
