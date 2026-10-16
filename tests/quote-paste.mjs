import { startServer, launch, openEditor, makeReporter } from './harness.mjs';
const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const withPage = async fn => {
  const { page, context } = await openEditor(browser, base);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { await fn(page); r.check('인용구 붙여넣기 런타임 오류 없음', errors, []); }
  finally { await context.close(); }
};
const paste = async (page, html, text, { plain = false, start = '<p><br></p>' } = {}) => {
  await page.evaluate(({ html, text, start }) => { T.set(start); T.caretIn(0, true); return T.writeClipboard(html, text); }, { html, text, start });
  await page.keyboard.press(plain ? 'Control+Shift+v' : 'Control+v');
  await page.waitForTimeout(180);
};
const html = page => page.evaluate(() => T.html());
// Gemini 응답 화면에서 드래그해 복사한 형태: HTML에는 blockquote, 평문에는 > 표시가 없습니다.
const gemini = '<meta charset="utf-8"><div class="markdown"><p>앞 문단</p>\n'
  + '<blockquote>\n<p>인용 <b>첫째</b> 줄</p>\n<p>인용 둘째 줄</p>\n</blockquote>\n<p>뒤 문단</p></div>';
const geminiText = '앞 문단\n\n인용 첫째 줄\n\n인용 둘째 줄\n\n뒤 문단';
try {
  await withPage(async page => {
    await paste(page, gemini, geminiText);
    r.check('Gemini 인용구 유지', await html(page),
      '<p>앞 문단</p><p><br></p><blockquote><p>인용 <b>첫째</b> 줄</p><p>인용 둘째 줄</p></blockquote><p><br></p><p>뒤 문단</p>');
    await page.keyboard.press('Control+z');
    r.check('인용구 붙여넣기 한 번에 취소', await html(page), '<p><br></p>');
  });
  await withPage(async page => {
    await paste(page, '<blockquote><p>한 줄 인용</p></blockquote>', '한 줄 인용');
    r.check('한 문단 인용구', await html(page), '<blockquote>한 줄 인용</blockquote>');
  });
  await withPage(async page => {
    await paste(page, '<blockquote><p>하나</p></blockquote><p>사이</p><blockquote><p>둘</p></blockquote>', '하나\n사이\n둘');
    r.check('떨어진 인용구는 따로 유지', await html(page), '<blockquote>하나</blockquote><p>사이</p><blockquote>둘</blockquote>');
  });
  await withPage(async page => {
    // Gemini 복사 버튼은 평문에 마크다운 > 표시를 함께 넣습니다.
    await paste(page, '<p>앞</p><blockquote><p>인용</p></blockquote>', '앞\n\n> 인용');
    r.check('마크다운 평문이 함께 와도 인용구 유지', await html(page), '<p>앞</p><blockquote>인용</blockquote>');
  });
  await withPage(async page => {
    await paste(page, '<blockquote><p>인용</p></blockquote><p>뒤</p>', '인용\n뒤', { start: '<p>기존</p>' });
    r.check('기존 문단 뒤에 인용구 삽입', await html(page), '<p>기존</p><blockquote>인용</blockquote><p>뒤</p>');
    await page.keyboard.type('끝');
    r.check('붙여넣은 뒤 커서는 마지막 글자 뒤', await html(page), '<p>기존</p><blockquote>인용</blockquote><p>뒤끝</p>');
  });
  await withPage(async page => {
    await page.evaluate(() => { T.set('<p>앞</p><blockquote><p>하나</p><p>둘</p></blockquote>'); T.ed().focus(); });
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await page.keyboard.press('Control+v'); await page.waitForTimeout(180);
    r.check('편집기에서 복사한 인용구 다시 붙여넣기',
      await page.evaluate(() => [...T.ed().children].map(node => node.tagName + ':' + node.textContent)),
      ['P:앞', 'BLOCKQUOTE:하나둘']);
  });
  await withPage(async page => {
    await paste(page, '<table><tr><td>칸</td></tr></table><blockquote><p>표 뒤 인용</p></blockquote>', '칸\n표 뒤 인용');
    r.check('표와 함께 붙여넣어도 인용구 유지', await page.locator('#editor table + blockquote').count(), 1);
  });
  await withPage(async page => {
    await paste(page, '<blockquote><p>칸 안</p></blockquote>', '칸 안', { start: '<table><tbody><tr><td><br></td></tr></tbody></table>' });
    r.check('표 칸 안에서는 글자만', await page.locator('#editor td blockquote').count(), 0);
  });
  await withPage(async page => {
    await paste(page, gemini, geminiText, { plain: true });
    r.check('서식 없이 붙여넣기는 인용구 없음', await page.locator('#editor blockquote').count(), 0);
  });
  await withPage(async page => {
    await paste(page, '<blockquote><p>안쪽</p></blockquote>', '안쪽', { start: '<blockquote><br></blockquote>' });
    r.check('인용구 안에서는 인용구를 겹치지 않음', await html(page), '<blockquote>안쪽</blockquote>');
  });
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
