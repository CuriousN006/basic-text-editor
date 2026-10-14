// 탭 여러 개에서의 복구 초안 검증.
// 예전에는 모든 탭이 초안 키 하나를 같이 써서, 다른 탭의 입력이 초안을 덮어쓰고
// 한 탭의 저장이 다른 탭의 초안까지 지웠습니다.
import { startServer, launch, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();

const open = async (context, init) => {
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => sessionStorage.getItem('basic-text-editor-tab'));
  return page;
};
const type = async (page, text) => {
  await page.locator('#editor').click();
  await page.keyboard.type(text);
  await page.waitForTimeout(900);
};
const tabId = (page) => page.evaluate(() => sessionStorage.getItem('basic-text-editor-tab'));
const drafts = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
  .filter((key) => key.startsWith('basic-text-editor-draft'))
  .map((key) => [key, (() => { try { return JSON.parse(localStorage.getItem(key)).html; } catch { return localStorage.getItem(key); } })()])));
const text = (page) => page.evaluate(() => document.getElementById('editor').textContent);
const toast = (page) => page.evaluate(() => document.getElementById('toast').textContent);

try {
  {
    const context = await browser.newContext();
    const a = await open(context), b = await open(context);
    r.check('탭마다 다른 ID', (await tabId(a)) !== (await tabId(b)), true);
    await type(a, 'A tab work');
    await type(b, 'B');
    const stored = Object.values(await drafts(a)).sort();
    r.check('두 탭의 초안이 서로 덮어쓰지 않음', stored, ['<p>A tab work</p>', '<p>B</p>']);

    await b.locator('[data-action="new"]').click();
    await b.waitForTimeout(200);
    r.check('한 탭의 새 문서가 다른 탭 초안을 지우지 않음', Object.values(await drafts(a)), ['<p>A tab work</p>']);

    await type(b, 'B again');
    await a.close({ runBeforeUnload: false });
    const c = await open(context);
    r.check('닫힌 탭의 초안을 새 탭이 복구', await text(c), 'A tab work');
    r.check('복구 안내', await toast(c), '저장하지 않은 내용을 복구했습니다.');
    r.check('살아 있는 탭의 초안은 가져가지 않음', await text(b), 'B again');
    const after = await drafts(c);
    r.check('복구한 초안은 새 탭 소유로 옮김', after[`basic-text-editor-draft:${await tabId(c)}`], '<p>A tab work</p>');
    r.check('초안이 중복되지 않음', Object.values(after).sort(), ['<p>A tab work</p>', '<p>B again</p>']);

    const d = await open(context);
    r.check('남은 주인 없는 초안이 없으면 빈 문서', await text(d), '');
    await context.close();
  }

  {
    const context = await browser.newContext();
    const a = await open(context);
    await type(a, '새로 고침 전');
    const before = await tabId(a);
    await a.reload();
    await a.waitForFunction(() => sessionStorage.getItem('basic-text-editor-tab'));
    r.check('새로 고침하면 같은 탭 ID 유지', await tabId(a), before);
    r.check('새로 고침 뒤 자기 초안 복구', await text(a), '새로 고침 전');

    // 탭 복제처럼 sessionStorage가 복사된 경우
    // 미리 넣은 ID 때문에 open()의 대기가 바로 끝나므로, 잠금 대기(0.8초)를 지나 ID가 바뀔 때까지 기다립니다.
    // 첫 로드에서만 넣어야 이후 새로 고침을 흉내 내지 않습니다.
    const duplicate = await open(context, `if (!sessionStorage.getItem('dup-seeded')) { sessionStorage.setItem('dup-seeded', '1'); sessionStorage.setItem('basic-text-editor-tab', ${JSON.stringify(before)}); }`);
    await duplicate.waitForFunction((id) => sessionStorage.getItem('basic-text-editor-tab') !== id, before, { timeout: 3000 }).catch(() => {});
    r.check('복제된 탭은 새 ID를 받음', (await tabId(duplicate)) !== before, true);
    r.check('복제된 탭은 원본 탭 초안을 가져가지 않음', await text(duplicate), '');
    await context.close();
  }

  {
    const context = await browser.newContext();
    const a = await open(context), b = await open(context);
    await type(a, '첫째');
    await type(b, '둘째');
    await a.close({ runBeforeUnload: false });
    await b.close({ runBeforeUnload: false });
    const c = await open(context);
    r.check('주인 없는 초안 중 최근 것부터 복구', await text(c), '둘째');
    r.check('남은 초안 개수 안내', await toast(c), '저장하지 않은 내용을 복구했습니다. 복구할 초안이 1개 더 있습니다. 새 창을 열면 이어서 복구됩니다.');
    const d = await open(context);
    r.check('다음 새 탭이 나머지 초안 복구', await text(d), '첫째');
    await context.close();
  }

  {
    const context = await browser.newContext();
    const seed = await context.newPage();
    await seed.goto(`${base}/index.html`);
    await seed.evaluate(() => localStorage.setItem('basic-text-editor-draft', '<p>예전 초안<img src="x" onerror="window.__xss = 1"></p>'));
    await seed.close();
    const page = await open(context);
    r.check('이전 버전 초안 복구', await text(page), '예전 초안');
    r.check('복구한 초안도 정리해서 넣음', await page.evaluate(() => [window.__xss, document.querySelector('#editor img').hasAttribute('onerror')]), [undefined, false]);
    r.check('이전 버전 키는 정리', await page.evaluate(() => localStorage.getItem('basic-text-editor-draft')), null);
    await context.close();
  }

  process.exitCode = r.summary() ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
