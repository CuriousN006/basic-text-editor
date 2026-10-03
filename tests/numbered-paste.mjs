import { startServer, launch, openEditor, makeReporter } from './harness.mjs';
const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const withPage = async fn => {
  const { page, context } = await openEditor(browser, base);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { await fn(page); r.check('번호 텍스트 붙여넣기 런타임 오류 없음', errors, []); }
  finally { await context.close(); }
};
const paste = async (page, html, text, plain = false) => {
  await page.evaluate(({ html, text }) => { T.set('<p><br></p>'); T.caretIn(0, true); return T.writeClipboard(html, text); }, { html, text });
  await page.keyboard.press(plain ? 'Control+Shift+v' : 'Control+v');
  await page.waitForTimeout(180);
};
const paragraphs = page => page.evaluate(() => [...T.ed().children].map(node => node.textContent));
try {
  for (const plain of [false, true]) {
    for (const text of ['1. 이런 텍스트\n2. 다음 텍스트', '이런 텍스트\n다음 텍스트']) {
      await withPage(async page => {
        await paste(page, '<ol><li><p>이런 텍스트</p></li><li><p>다음 텍스트</p></li></ol>', text, plain);
        const expected = plain && !text.startsWith('1.') ? ['이런 텍스트','다음 텍스트'] : ['1. 이런 텍스트','2. 다음 텍스트'];
        r.check('복사된 번호를 글자로 유지', await paragraphs(page), expected);
        r.check('HTML 번호 목록을 별도 목록 서식으로 넣지 않음', await page.locator('#editor ol,#editor li').count(), 0);
      });
    }
  }
  for (const text of ['1. 이런 텍스트\n\n3. 다음 텍스트', '01) 이런 텍스트\n03) 다음 텍스트']) {
    await withPage(async page => {
      await paste(page, '', text);
      r.check('평문 번호를 바꾸거나 없애지 않음', await paragraphs(page), text.split('\n'));
      r.check('평문 번호를 자동 목록으로 만들지 않음', await page.locator('#editor ol,#editor li').count(), 0);
    });
  }
  await withPage(async page => {
    await paste(page, '', '## 제목\n\n1. **굵은 설명**\n\n5. 다음 설명');
    r.check('마크다운 제목과 숫자 텍스트 함께 유지', await paragraphs(page), ['제목', '', '1. 굵은 설명', '', '5. 다음 설명']);
    r.check('마크다운 번호는 목록 서식 없음', await page.locator('#editor ol,#editor li').count(), 0);
    r.check('번호 뒤 굵게 서식 유지', await page.evaluate(() => T.ed().querySelector('strong,b')?.textContent), '굵은 설명');
    await page.keyboard.press('Control+z');
    r.check('번호 텍스트 붙여넣기 한 번에 취소', await page.evaluate(() => T.html()), '<p><br></p>');
  });
  await withPage(async page => {
    await paste(page, '<ol start="4"><li><b>굵은 설명</b></li><li value="8">다음 설명</li><li>마지막 설명</li></ol>', '4. 굵은 설명\n8. 다음 설명\n9. 마지막 설명');
    r.check('시작 번호와 항목별 번호 유지', await paragraphs(page), ['4. 굵은 설명','8. 다음 설명','9. 마지막 설명']);
    r.check('번호 목록 안의 굵게 서식 유지', await page.evaluate(() => T.ed().querySelector('b')?.textContent), '굵은 설명');
  });
  await withPage(async page => {
    await paste(page, '<ol reversed><li>셋</li><li>둘</li><li>하나</li></ol>', '셋\n둘\n하나');
    r.check('역순 목록 번호를 글자로 유지', await paragraphs(page), ['3. 셋','2. 둘','1. 하나']);
  });
  await withPage(async page => {
    await paste(page, '<ol><li>첫 설명<ol start="3"><li>하위 설명</li></ol></li><li>다음 설명</li></ol>', '첫 설명\n하위 설명\n다음 설명');
    r.check('중첩 번호 목록도 숫자를 잃지 않음', await paragraphs(page), ['1. 첫 설명','3. 하위 설명','2. 다음 설명']);
  });
  await withPage(async page => {
    await paste(page, '<ol><li>첫 설명</li><li>다음 설명</li></ol>', '7. 첫 설명\n11. 다음 설명');
    r.check('복사 평문과 HTML 번호가 다르면 평문 숫자 우선', await paragraphs(page), ['7. 첫 설명','11. 다음 설명']);
  });
  await withPage(async page => {
    await paste(page, '<table><tr><td><ol><li>가</li><li>나</li></ol></td><td>값</td></tr></table>', '가\n나\t값');
    r.check('표 안의 번호도 숫자 텍스트로 유지', await page.evaluate(() => T.ed().querySelector('td').textContent), '1. 가2. 나');
    r.check('표 구조 유지', await page.locator('#editor table').count(), 1);
  });
  await withPage(async page => {
    await page.evaluate(() => { T.set('<ol start="5"><li>첫 설명</li><li>다음 설명</li></ol>'); T.ed().focus(); });
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    r.check('기존 편집기 번호 목록 복사 시 평문에도 숫자 포함', await page.evaluate(async () => navigator.clipboard.readText()), '5. 첫 설명\n6. 다음 설명');
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await page.keyboard.press('Control+v'); await page.waitForTimeout(150);
    r.check('기존 번호 목록 다시 붙여넣기도 글자 번호', await paragraphs(page), ['5. 첫 설명','6. 다음 설명']);
  });
  await withPage(async page => {
    await page.evaluate(() => {
      T.set('<ol start="5"><li>첫 설명</li><li>둘째 설명</li><li>셋째 설명</li></ol>'); T.ed().focus();
      const items = T.ed().querySelectorAll('li'), range = document.createRange();
      range.setStart(items[1], 0); range.setEnd(items[2], items[2].childNodes.length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.press('Control+c');
    r.check('목록 중간부터 복사해도 원래 시작 번호 유지', await page.evaluate(() => navigator.clipboard.readText()), '6. 둘째 설명\n7. 셋째 설명');
  });
  await withPage(async page => {
    await paste(page, '', '  1. **설명**   ');
    r.check('번호 텍스트의 앞뒤 공백 유지', await paragraphs(page), ['  1. 설명   ']);
    r.check('공백 있는 번호도 자동 목록 없음', await page.locator('#editor ol,#editor li').count(), 0);
  });
  await withPage(async page => {
    await paste(page, '', '1. 첫 설명\n\n| 항목 | 값 |\n| --- | --- |\n| 사과 | 1 |\n\n3. 다음 설명');
    r.check('마크다운 표 앞뒤 번호 유지', await paragraphs(page), ['1. 첫 설명','','항목값사과1','','3. 다음 설명']);
    r.check('번호 문단과 함께 마크다운 표 변환 유지', await page.locator('#editor table').count(), 1);
  });
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
