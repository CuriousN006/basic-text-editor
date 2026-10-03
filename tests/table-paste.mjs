import { startServer, launch, openEditor, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const tableHtml = '<div class="gemini-response"><p>표 앞 <b>설명</b></p><div class="table-wrapper">'
  + '<table style="color:red;font-size:30px"><thead><tr><th>항목</th><th>내용</th></tr></thead>'
  + '<tbody><tr><td><span style="font-weight:700;color:blue">사과</span></td>'
  + '<td><a href="https://example.com">링크</a><br>둘째 줄</td></tr>'
  + '<tr><td></td><td>배</td></tr></tbody></table></div><p>표 뒤 설명</p></div>';
const tableText = '표 앞 설명\n항목\t내용\n사과\t링크\n둘째 줄\n\t배\n표 뒤 설명';
const markdown = '## 과일\n\n| 항목 | 내용 |\n| :--- | ---: |\n| **사과** | [링크](https://example.com) |\n| 배\\|포도 | |\n\n마지막 **설명**';
const paste = async (page, html, text, plain = false) => {
  await page.evaluate(({ html, text }) => T.writeClipboard(html, text), { html, text });
  await page.keyboard.press(plain ? 'Control+Shift+v' : 'Control+v');
  await page.waitForTimeout(250);
};
const withPage = async (fn) => {
  const { context, page } = await openEditor(browser, base);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { await fn(page); r.check('표 붙여넣기 런타임 오류 없음', errors, []); }
  finally { await context.close(); }
};

try {
  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, tableHtml, tableText);
    r.check('HTML 표 행과 열 유지', await page.evaluate(() => [...T.ed().querySelectorAll('tr')].map(row => [...row.cells].map(cell => cell.textContent))),
      [['항목', '내용'], ['사과', '링크둘째 줄'], ['', '배']]);
    r.check('HTML 표 앞뒤 설명 유지', await page.evaluate(() => [...T.ed().children].map(node => node.tagName)), ['P', 'TABLE', 'P']);
    r.check('표 셀의 굵게와 링크 유지', await page.evaluate(() => Boolean(T.ed().querySelector('td b,td strong')) && Boolean(T.ed().querySelector('td a[href="https://example.com/"]'))), true);
    r.check('표 외부 글꼴과 색 제거', await page.evaluate(() => T.ed().querySelectorAll('[style],[class]').length), 0);
    r.check('표 셀 줄바꿈 유지', await page.evaluate(() => T.ed().querySelector('td:nth-child(2)').querySelectorAll('br').length), 1);
    await page.keyboard.press('Control+z');
    r.check('표와 설명 한 번에 실행 취소', await page.evaluate(() => T.html()), '<p><br></p>');
    await page.keyboard.press('Control+y');
    r.check('표 다시 실행', await page.locator('#editor table').count(), 1);
  });

  await withPage(async page => {
    await page.evaluate(() => {
      T.set('<p>앞대상뒤</p>'); T.select('대상');
    });
    await paste(page, '<table><tr><th>제목</th></tr><tr><td>값</td></tr></table>', '제목\n값');
    r.check('문단 중간의 표 삽입 구조', await page.evaluate(() => [...T.ed().children].map(node => node.tagName)), ['P', 'TABLE', 'P']);
    r.check('표로 바꾼 선택 양쪽 글자 보존', await page.evaluate(() => [...T.ed().querySelectorAll(':scope > p')].map(p => p.textContent)), ['앞', '뒤']);
    r.check('문단 안에 표가 중첩되지 않음', await page.locator('#editor p table').count(), 0);
    await page.keyboard.type('추가');
    r.check('표 뒤 커서 위치 유지', await page.evaluate(() => T.ed().lastElementChild.textContent), '추가뒤');
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, '<table><tr><td colspan="2">병합</td></tr><tr><td rowspan="2">세로</td><td>가</td></tr><tr><td>나</td></tr></table>', '병합\n세로\t가\n나');
    r.check('가로 세로 병합 유지', await page.evaluate(() => [T.ed().querySelector('td[colspan]').colSpan, T.ed().querySelector('td[rowspan]').rowSpan]), [2, 2]);
    r.check('마지막 표 뒤 편집 문단 존재', await page.evaluate(() => T.ed().lastElementChild.tagName), 'P');
    await page.keyboard.type('표 다음');
    r.check('표 뒤에서 계속 입력', await page.evaluate(() => T.ed().lastElementChild.textContent), '표 다음');
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, tableHtml, tableText, true);
    r.check('Ctrl+Shift+V 표는 일반 텍스트', await page.locator('#editor table').count(), 0);
    r.check('Ctrl+Shift+V 표 내용 보존', await page.evaluate(() => T.text().includes('사과') && T.text().includes('배')), true);
  });

  await withPage(async page => {
    await page.evaluate(() => {
      T.set('<table><tbody><tr><td>원래</td><td>옆 칸</td></tr></tbody></table>');
      const range = document.createRange(); range.selectNodeContents(T.ed().querySelector('td')); range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); T.ed().focus();
    });
    await paste(page, '<table><tr><td>가</td><td>나</td></tr></table>', '가\t나');
    r.check('기존 표 셀에 붙여넣을 때 표 중첩 없음', await page.locator('#editor table').count(), 1);
    r.check('기존 표 칸 수 유지', await page.locator('#editor td').count(), 2);
    r.check('기존 표 셀에 내용 삽입', await page.evaluate(() => T.ed().querySelector('td').textContent.includes('가')), true);
  });

  const rawHtml = markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  for (const wrappedHtml of ['', `<div>${rawHtml}</div>`, `<b style="font-weight:normal">${rawHtml}</b>`]) {
    await withPage(async page => {
      await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
      await paste(page, wrappedHtml, markdown);
      r.check('마크다운 표 변환', await page.evaluate(() => [...T.ed().querySelectorAll('tr')].map(row => [...row.cells].map(cell => cell.textContent))),
        [['항목', '내용'], ['사과', '링크'], ['배|포도', '']]);
      r.check('마크다운 제목과 본문 서식 변환', await page.evaluate(() => T.ed().querySelector('h2')?.textContent === '과일' && T.ed().lastElementChild.querySelector('strong,b')?.textContent === '설명'), true);
      r.check('마크다운 셀 서식 변환', await page.evaluate(() => Boolean(T.ed().querySelector('td strong,td b')) && Boolean(T.ed().querySelector('td a'))), true);
      await page.keyboard.press('Control+z');
      r.check('마크다운 전체 한 번에 취소', await page.evaluate(() => T.html()), '<p><br></p>');
    });
  }

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, '', markdown, true);
    r.check('마크다운 Ctrl+Shift+V는 문법 그대로 유지', await page.evaluate(() => [...T.ed().children].map(p => p.textContent).join('\n')), markdown);
    r.check('마크다운 Ctrl+Shift+V 표 변환 없음', await page.locator('#editor table').count(), 0);
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, '', '항목 | 값\n--- | ---\n사과 | 1\n배 | 2');
    r.check('바깥 파이프 없는 표 지원', await page.evaluate(() => T.ed().querySelector('table')?.rows.length), 3);
  });

  await withPage(async page => {
    await page.setInputFiles('#fileInput', { name: 'table.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
    r.check('마크다운 파일 불러오기도 표 지원', await page.locator('#editor table').count(), 1);
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, '', '```\n| 글자 | 값 |\n| --- | --- |\n| 사과 | 1 |\n```');
    r.check('코드 블록 안 표 문법은 글자로 유지', await page.locator('#editor table').count(), 0);
    r.check('코드 블록 보존', await page.evaluate(() => T.ed().querySelector('pre')?.textContent.includes('| --- | --- |')), true);
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    const text = 'A | B\n이것은 | 일반 문장';
    await paste(page, '', text);
    r.check('구분선 없는 일반 파이프 문장은 변환하지 않음', await page.evaluate(() => [...T.ed().children].map(p => p.textContent).join('\n')), text);
  });

  await withPage(async page => {
    await page.evaluate(() => {
      T.set('<p>선택한 문서</p>'); T.ed().focus();
      const range = document.createRange(); range.selectNodeContents(T.ed());
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await paste(page, '<table><tr><td>새 표</td></tr></table>', '새 표');
    r.check('문서 전체를 표로 대체', await page.evaluate(() => T.ed().firstElementChild.tagName), 'TABLE');
    await page.keyboard.type('표 다음 입력');
    r.check('전체 선택 대체 후 표 뒤에 입력', await page.evaluate(() => T.ed().lastElementChild.textContent), '표 다음 입력');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    r.check('전체 선택 표 붙여넣기 실행 취소', await page.evaluate(() => T.html()), '<p>선택한 문서</p>');
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, '<div style="font-weight:700"><table><tr><td>상속 굵게</td><td style="font-weight:400">보통 글자</td></tr></table></div>', '상속 굵게\t보통 글자');
    r.check('표 셀과 조상의 글자 서식 유지', await page.evaluate(() => Boolean(T.ed().querySelector('td:first-child b')) && !T.ed().querySelector('td:nth-child(2) b')), true);
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, '', '앞 **굵게** 뒤');
    r.check('마크다운 글자 서식만 있는 문장 변환', await page.evaluate(() => T.html()), '<p>앞 <b>굵게</b> 뒤</p>');
  });

  await withPage(async page => {
    await page.evaluate(() => { T.set('<p><br></p>'); T.caretIn(0, true); });
    await paste(page, '<table><tr><td><a href="javascript:alert(1)" onclick="alert(2)">안전한 글자</a></td></tr></table>', '안전한 글자');
    r.check('표 붙여넣기 위험한 링크와 이벤트 제거', await page.evaluate(() => T.ed().querySelectorAll('a,[onclick],script').length), 0);
    r.check('위험한 링크의 글자는 보존', await page.evaluate(() => T.ed().querySelector('td').textContent), '안전한 글자');
  });

  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
