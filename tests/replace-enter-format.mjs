// 찾아 바꾸기: 바꿀 내용 칸의 Enter와, 서식 경계에 걸친 일치를 바꿀 때의 서식.
import { startServer, launch, openEditor, openReplace, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();

async function withPage(fn, options = {}) {
  const { context, page } = await openEditor(browser, base, options);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await fn(page);
    r.check('런타임 오류 없음', errors, []);
  } finally {
    await context.close();
  }
}

const replaceAll = async (page) => {
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(80);
};

console.log('\n--- 바꿀 내용 칸의 Enter ---');

for (const noHighlightApi of [false, true]) {
  const label = noHighlightApi ? ' (Highlight API 없음)' : '';
  await withPage(async (page) => {
    await page.evaluate(() => T.set('<p>가 1번 나 1번 다</p>'));
    await openReplace(page, { find: '1번', replace: '#1' });
    await page.focus('#replaceText');
    const steps = [];
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      steps.push(await page.evaluate(() => [T.text(), document.activeElement.id]));
    }
    r.check(`E1 Enter를 이어 눌러 차례로 바꿈${label}`, steps, [
      ['가 1번 나 1번 다', 'replaceText'],
      ['가 #1 나 1번 다', 'replaceText'],
      ['가 #1 나 #1 다', 'replaceText']
    ]);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    r.check(`E2 더 바꿀 것이 없어도 글자를 지우지 않음${label}`, await page.evaluate(() => T.text()), '가 #1 나 #1 다');
    await page.evaluate(() => T.ed().focus());
    await page.keyboard.press('Control+z');
    r.check(`E3 Ctrl+Z는 하나씩 되돌림${label}`, await page.evaluate(() => T.text()), '가 #1 나 1번 다');
  }, { noHighlightApi });
}

console.log('\n--- 바꾼 글자의 서식 ---');

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p>날짜 <b>2024</b>년 3월 15일 끝</p>'));
  await openReplace(page, { find: '2024년 3월 15일', replace: '2024.3.15' });
  await replaceAll(page);
  r.check('F1 첫 글자가 굵으면 바꾼 글자도 굵게', await page.evaluate(() => T.html()), '<p>날짜 <b>2024.3.15</b> 끝</p>');
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  r.check('F1 되돌리면 원래 서식', await page.evaluate(() => T.html()), '<p>날짜 <b>2024</b>년 3월 15일 끝</p>');
});

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p>가<b>나</b><i>다</i> 끝</p>'));
  await openReplace(page, { find: '가나다', replace: '라' });
  await replaceAll(page);
  r.check('F2 첫 글자가 보통이면 보통 글자', await page.evaluate(() => T.html()), '<p>라 끝</p>');
});

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p>앞 <b>굵<i>은</i></b> 뒤</p>'));
  await openReplace(page, { find: '굵은', replace: '새' });
  await replaceAll(page);
  r.check('F3 겹친 서식 안의 일치', await page.evaluate(() => T.html()), '<p>앞 <b>새</b> 뒤</p>');
});

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p><b>2024</b>년 기록</p>'));
  await openReplace(page, { find: '2024년', replace: '올해', formats: { bold: 'remove' } });
  await replaceAll(page);
  r.check('F4 굵게 제거를 지정하면 그 설정이 우선', await page.evaluate(() => T.html()), '<p>올해 기록</p>');
});

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p><u>20</u>24년</p>'));
  await openReplace(page, { find: '2024년', replace: '올해', formats: { italic: 'apply' } });
  await replaceAll(page);
  r.check('F5 지정한 서식과 이어받은 서식을 함께 적용', await page.evaluate(() => (
    [T.text(), Boolean(T.ed().querySelector('u')), Boolean(T.ed().querySelector('i'))]
  )), ['올해', true, true]);
});

for (const mode of ['replace-all', 'replace']) {
  await withPage(async (page) => {
    await page.evaluate(() => T.set('<p><b>사과</b>를 먹고 <b>사과</b>를 샀다</p>'));
    await openReplace(page, { find: '사과', replace: '귤' });
    if (mode === 'replace-all') await replaceAll(page);
    else {
      for (let index = 0; index < 3; index += 1) {
        await page.click('[data-find="replace"]');
        await page.waitForTimeout(80);
      }
    }
    r.check(`F6 고친 조사는 원래 조사의 서식 (${mode})`, await page.evaluate(() => T.html()),
      '<p><b>귤</b>을 먹고 <b>귤</b>을 샀다</p>');
  });
}

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p>사과<b>를</b> 먹다</p>'));
  await openReplace(page, { find: '사과', replace: '귤' });
  await replaceAll(page);
  r.check('F7 굵은 조사는 굵은 채로 교정', await page.evaluate(() => T.html()), '<p>귤<b>을</b> 먹다</p>');
});

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p><a href="https://example.com/">링크</a> 글</p>'));
  await openReplace(page, { find: '링크 글', replace: '새 글' });
  await replaceAll(page);
  r.check('F8 서식 없는 링크 경계는 그대로', await page.evaluate(() => T.ed().querySelectorAll('b,i,u,s').length), 0);
});

await browser.close();
server.close();
process.exit(r.summary() ? 1 : 0);
