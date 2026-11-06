import { startServer, launch, openEditor, makeReporter } from './harness.mjs';
const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const withPage = async fn => {
  const { page, context } = await openEditor(browser, base);
  try { await fn(page); } finally { await context.close(); }
};
const clipboard = page => page.evaluate(async () => {
  const [item] = await navigator.clipboard.read();
  return { plain: item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : '', html: item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '' };
});
const target = page => page.evaluate(() => {
  T.set('<p>[]</p>'); T.ed().focus();
  const range = document.createRange(); range.setStart(T.ed().firstChild.firstChild, 1); range.collapse(true);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
});
const paste = async (page, plain = false) => { await page.keyboard.press(plain ? 'Control+Shift+v' : 'Control+v'); await page.waitForTimeout(120); };
try {
  for (const source of ['<p>앞 단어 뒤</p>', '<p>앞 <b>단어</b> 뒤</p>', '<p>앞  단어   뒤</p>']) {
    const selected = source.includes('  단어') ? '  단어   ' : ' 단어 ';
    for (const plain of [false, true]) {
      await withPage(async page => {
        await page.evaluate(({ source, selected }) => { T.set(source); T.select(selected); }, { source, selected });
        await page.keyboard.press('Control+c');
        const copied = await clipboard(page);
        r.check('복사 평문 앞뒤 공백 유지', copied.plain, selected);
        r.check('복사 HTML 앞뒤 공백 유지', await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.textContent.replace(/\u00a0/g,' '), copied.html), selected);
        await target(page); await paste(page, plain);
        r.check(`${plain ? 'Ctrl+Shift+V' : 'Ctrl+V'} 앞뒤 공백 유지`, await page.evaluate(() => T.ed().textContent), `[${selected}]`);
      });
    }
  }
  await withPage(async page => {
    await page.evaluate(() => { T.set('<p>앞 단어 뒤</p>'); T.select(' 단어 '); });
    await page.keyboard.press('Control+x');
    r.check('잘라내기 클립보드 앞뒤 공백 유지', (await clipboard(page)).plain, ' 단어 ');
    r.check('잘라내기는 선택 공백도 제거', await page.evaluate(() => T.ed().textContent), '앞뒤');
    await target(page); await paste(page);
    r.check('잘라내기 후 붙여넣기 공백 유지', await page.evaluate(() => T.ed().textContent), '[ 단어 ]');
  });
  await withPage(async page => {
    await page.evaluate(() => { T.set('<p>앞  뒤</p>'); T.select('  '); });
    await page.keyboard.press('Control+c');
    r.check('공백만 선택해도 복사됨', (await clipboard(page)).plain, '  ');
    await target(page); await paste(page);
    r.check('공백만 복사해도 붙여넣기 유지', await page.evaluate(() => T.ed().textContent), '[  ]');
  });
  await withPage(async page => {
    await page.evaluate(() => { T.set('<p> 첫 줄 </p><p> 둘째 줄 </p>'); T.ed().focus(); });
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    r.check('여러 문단 각 줄의 앞뒤 공백 유지', (await clipboard(page)).plain, ' 첫 줄 \n 둘째 줄 ');
  });
  await withPage(async page => {
    await target(page);
    await page.evaluate(() => T.writeClipboard('<b> 단어 </b>', ' 단어 '));
    await paste(page);
    r.check('외부 서식 글자 앞뒤 공백 유지', await page.evaluate(() => T.ed().textContent), '[ 단어 ]');
    r.check('외부 굵게 서식 유지', await page.evaluate(() => T.ed().querySelector('b')?.textContent), '단어');
  });
  await withPage(async page => {
    await target(page);
    await page.evaluate(() => T.writeClipboard('<p>첫 줄</p><p>둘째 줄</p>', ' 첫 줄 \n   \n 둘째 줄 '));
    await paste(page);
    r.check('외부 평문의 공백만 있는 줄도 유지', await page.evaluate(() => [...T.ed().children].map(p => p.textContent).join('\n')), '[ 첫 줄 \n   \n 둘째 줄 ]');
  });
  await withPage(async page => {
    await target(page);
    await page.evaluate(() => T.writeClipboard('', ' **단어** '));
    await paste(page);
    r.check('마크다운 서식 변환 시 앞뒤 공백 유지', await page.evaluate(() => T.ed().textContent), '[ 단어 ]');
    r.check('마크다운 굵게 변환 유지', await page.evaluate(() => T.ed().querySelector('b')?.textContent), '단어');
  });
  await withPage(async page => {
    await target(page);
    await page.evaluate(() => T.writeClipboard('', '  **단어**   '));
    await paste(page);
    r.check('마크다운 끝의 여러 공백도 줄바꿈 대신 유지', await page.evaluate(() => T.ed().textContent), '[  단어   ]');
  });
  await withPage(async page => {
    await target(page);
    await page.evaluate(() => T.writeClipboard('', ' https://example.com '));
    await paste(page);
    r.check('URL 붙여넣기도 앞뒤 공백 유지', await page.evaluate(() => T.ed().textContent), '[ https://example.com ]');
    r.check('URL 자동 링크 유지', await page.evaluate(() => T.ed().querySelector('a')?.getAttribute('href')), 'https://example.com');
  });
  // 뮤테이션 테스트에서 드러난 구멍
  await withPage(async page => {
    // 서식 없이 붙여넣으면 글자가 놓인 자리의 서식을 따릅니다(굵은 글 안이면 굵게).
    await page.evaluate(() => {
      T.set('<p><b>굵은글</b></p>'); T.ed().focus();
      const range = document.createRange(); range.setStart(T.ed().querySelector('b').firstChild, 2); range.collapse(true);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.evaluate(() => T.writeClipboard('<i>기울임</i>', '넣음'));
    await paste(page, true);
    r.check('Ctrl+Shift+V는 놓인 자리의 서식을 따름', await page.evaluate(() => T.html()), '<p><b>굵은넣음글</b></p>');
  });
  await withPage(async page => {
    // 찾기 칸 같은 입력칸에서의 복사·붙여넣기는 편집기가 가로채지 않습니다.
    await page.evaluate(() => T.set('<p>본문</p>'));
    await page.keyboard.press('Control+f');
    await page.fill('#findText', '찾을 말');
    await page.locator('#findText').selectText();
    await page.keyboard.press('Control+c');
    r.check('찾기 칸에서 고른 글자를 복사', (await clipboard(page)).plain, '찾을 말');
    await page.locator('#findText').press('End');
    await page.keyboard.press('Control+v');
    r.check('찾기 칸에 붙여넣기', await page.inputValue('#findText'), '찾을 말찾을 말');
    r.check('본문은 그대로', await page.evaluate(() => T.html()), '<p>본문</p>');
  });
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
