import { startServer, launch, openEditor, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const { context, page } = await openEditor(browser, base, {
  isMobile: true,
  hasTouch: true,
  viewport: { width: 390, height: 844 },
  noFilePicker: true,
  promptAnswer: 'https://example.com/report'
});
const tap = (selector) => page.locator(selector).tap();

try {
  await page.evaluate(() => T.set('<p>앞 대상 뒤</p><p><a href="https://example.com/">링크</a></p>'));
  r.check('M1 파일 및 추가 도구는 접힌 상태로 시작', [
    await page.locator('[data-action="open"]').isVisible(),
    await page.locator('#tableButton').isVisible()
  ], [false, false]);
  await page.evaluate(() => T.select('대상'));
  await tap('[data-command="bold"]');
  r.check('M2 서식 버튼을 터치하면 선택한 글자가 굵게', await page.locator('#editor b').textContent(), '대상');

  await tap('#mobileToolsButton');
  await tap('#plainPasteButton');
  await page.evaluate(() => T.writeClipboard('<b>교체</b><p>다음</p>', '교체\n다음'));
  await page.keyboard.press('Control+V');
  await tap('#plainPasteDialog [value="insert"]');
  await page.waitForFunction(() => T.ed().textContent.includes('교체'));
  r.check('M3 원래 선택 영역에 줄바꿈을 유지해 텍스트 삽입', await page.evaluate(() =>
    [...T.ed().querySelectorAll('p')].map(p => p.textContent)), ['앞 교체', '다음 뒤', '링크']);

  await tap('#editor a');
  r.check('M4 링크를 터치하면 열기·복사 미리보기', [
    await page.locator('#linkPreview').isVisible(),
    await page.locator('#linkPreviewUrl').getAttribute('href')
  ], [true, 'https://example.com/']);
  await tap('#linkPreviewCopy');
  r.check('M4 링크 주소 복사', await page.evaluate(() => navigator.clipboard.readText()), 'https://example.com/');
  await tap('#mobileToolsButton');
  r.check('M4 다른 곳을 터치하면 미리보기 닫힘', await page.locator('#linkPreview').isVisible(), false);

  await page.evaluate(() => T.caretIn(2, true));
  await tap('#mobileToolsButton');
  await tap('#tableButton');
  r.check('M5 좁은 화면의 표 삽입은 행·열 입력을 사용', await page.locator('#tableGrid').isVisible(), false);
  await page.locator('#tableRows').fill('3');
  await page.locator('#tableColumns').fill('2');
  await tap('[data-table-action="insert"]');
  r.check('M5 숫자로 지정한 표를 삽입', [await page.locator('#editor tr').count(), await page.locator('#editor td').count()], [3, 6]);

  await tap('[data-action="find"]');
  await page.locator('#findText').fill('다음');
  await page.locator('[data-find-result-index]').first().waitFor();
  // 운영체제의 키보드는 데스크톱 Chromium에 없으므로 시각 뷰포트만 줄어드는 경로를 재현합니다.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 346 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  const layout = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const bar = rect('#findbar'), workspace = rect('.workspace'), results = rect('#findResultsPanel');
    return [rect('body').height, bar.bottom <= workspace.top, workspace.height > 0,
      results.top >= workspace.bottom, results.bottom <= 346];
  });
  r.check('M6 키보드가 차지한 높이를 빼고 검색창·본문·결과를 배치', layout, [346, true, true, true, true]);
  await tap('[data-find="close"]');
  await page.evaluate(() => {
    delete visualViewport.height;
    visualViewport.dispatchEvent(new Event('resize'));
  });

  await tap('#mobileFilesButton');
  const download = await Promise.all([
    page.waitForEvent('download'),
    tap('[data-action="save-html"]')
  ]).then(([item]) => item);
  r.check('M7 파일 메뉴에서 HTML 다운로드', download.suggestedFilename().endsWith('.html'), true);

  await page.setViewportSize({ width: 844, height: 390 });
  r.check('M8 가로로 돌린 터치 화면에 모바일 도구가 유지됨', await page.locator('#mobileToolsButton').isVisible(), true);
  await page.setViewportSize({ width: 320, height: 640 });
  r.check('M9 폭 320px에서 본문과 페이지가 가로로 넘치지 않음', await page.evaluate(() =>
    document.documentElement.scrollWidth === innerWidth), true);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => T.set('<h2>업무 평가 보고서</h2><p>첫 판정은 완료했습니다.</p><p>둘째 판정은 검토 중입니다.</p>'));
  if (await page.locator('#mobileToolsButton').getAttribute('aria-expanded') === 'false') await tap('#mobileToolsButton');
  await tap('[data-action="replace"]');
  await page.locator('#findText').fill('판정');
  await page.locator('[data-find-result-index]').first().waitFor();
  await page.locator('#replaceText').fill('분류');

  // 레이아웃 뷰포트는 그대로 두고 키보드 위에 보이는 부분만 줄이는 브라우저를 재현합니다.
  const setVisibleHeight = (height) => page.evaluate(value => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value });
    visualViewport.dispatchEvent(new Event('resize'));
  }, height);
  const compactLayout = () => page.evaluate(() => {
    const bounds = selector => document.querySelector(selector).getBoundingClientRect();
    const editor = bounds('.workspace'), results = bounds('#findResultsPanel'), bar = bounds('#findbar');
    const inBar = selector => bounds(selector).top >= bar.top && bounds(selector).bottom <= bar.bottom;
    return [editor.height >= 85, editor.right <= bar.left, results.top === editor.bottom,
      inBar('#findText'), inBar('#replaceText'), inBar('[data-find="close"]')];
  });
  await setVisibleHeight(150);
  r.check('M10 가로 화면에 150px만 남아도 본문과 입력칸·닫기가 보임',
    await compactLayout(), [true, true, true, true, true, true]);
  await setVisibleHeight(180);
  r.check('M10 가로 화면에서 모두 바꾸기 버튼 전체가 보임', await page.evaluate(() => {
    const action = document.querySelector('[data-find="replace-all"]').getBoundingClientRect();
    const bar = document.getElementById('findbar').getBoundingClientRect();
    return action.height >= 44 && action.top >= bar.top && action.bottom <= bar.bottom;
  }), true);
  await tap('[data-find="replace-all"]');
  r.check('M10 가로 화면에서 실제로 두 곳을 바꿀 수 있음', await page.evaluate(() =>
    [...T.ed().querySelectorAll('p')].map(p => p.textContent)), ['첫 분류는 완료했습니다.', '둘째 분류는 검토 중입니다.']);
  await tap('[data-find="close"]');
  r.check('M10 검색 종료 후 도구 모음과 편집 포커스를 복원', [
    await page.locator('#mobileToolsButton').isVisible(),
    await page.locator('#findbar').isVisible(),
    await page.locator('#editor').evaluate(el => document.activeElement === el)
  ], [true, false, true]);

  await page.evaluate(() => {
    delete visualViewport.height;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => T.set('<p>첫 <strong id="touchWord">평가기록</strong> <span id="touchEnd">검토</span> 중입니다.</p><p id="touchBlank"><br></p>'));
  const touch = await context.newCDPSession(page);
  const touchAt = async (selector, horizontalFraction = 0.5) => {
    const target = page.locator(selector);
    await target.scrollIntoViewIfNeeded();
    const { x, y, width, height } = await target.boundingBox();
    return { x: Math.round(x + width * horizontalFraction), y: Math.round(y + height / 2) };
  };
  const press = async (selector) => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await touchAt(selector)] });
    await page.locator('#mobileEditMenu').waitFor({ state: 'visible' });
  };
  const release = () => touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const hold = async (selector) => { await press(selector); await release(); };

  const dispatchSelectionEvent = (type) => page.locator('#touchWord').evaluate((node, name) => {
    const event = name === 'contextmenu'
      ? new PointerEvent(name, { bubbles: true, cancelable: true, pointerType: 'mouse' })
      : new Event(name, { bubbles: true, cancelable: true });
    return node.dispatchEvent(event);
  }, type);
  r.check('M11 평소에는 본문의 기본 선택 이벤트를 허용', await dispatchSelectionEvent('selectstart'), true);
  await press('#touchWord');
  r.check('M11 길게 누르면 기본 선택과 마우스로 표시된 컨텍스트 메뉴 이벤트를 취소', [
    await dispatchSelectionEvent('selectstart'),
    await dispatchSelectionEvent('contextmenu')
  ], [false, false]);
  await release();
  r.check('M11 손을 뗀 뒤 늦게 온 기본 메뉴 이벤트도 취소', await dispatchSelectionEvent('contextmenu'), false);
  r.check('M11 글자를 길게 누르면 낱말을 고르고 편집기 메뉴 하나를 표시', [
    await page.evaluate(() => getSelection().toString()),
    await page.locator('#mobileEditMenu button:visible').allTextContents(),
    await page.locator('#selectionToolbar').isVisible()
  ], ['평가기록', ['복사', '붙여넣기', '링크'], false]);
  await tap('[data-touch-edit="copy"]');
  r.check('M11 메뉴에서 실제 클립보드로 선택한 글자를 복사',
    await page.evaluate(() => navigator.clipboard.readText()), '평가기록');

  await press('#touchWord');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [await touchAt('#touchEnd', 0.96)] });
  await release();
  r.check('M11 길게 누른 뒤 끌어서 선택 범위를 확장', await page.evaluate(() => getSelection().toString()), '평가기록 검토');
  await tap('.brand');
  r.check('M11 바깥을 탭하면 편집 메뉴 닫힘', await page.locator('#mobileEditMenu').isVisible(), false);

  await hold('#touchWord');
  await tap('[data-touch-edit="link"]');
  r.check('M11 새 링크 입력창은 비어 있음', await page.inputValue('#linkAddress'), '');
  await page.evaluate(() => T.writeClipboard('', 'https://example.com/report'));
  await page.keyboard.press('Control+V');
  await tap('#linkDialog [type="submit"]');
  r.check('M11 링크를 누르면 기존 표시 글자에 주소 연결',
    await page.locator('#editor a').getAttribute('href'), 'https://example.com/report');
  await hold('#editor a');
  r.check('M11 이미 걸린 링크에는 수정과 해제 표시', [
    await page.locator('[data-touch-edit="link"]').textContent(),
    await page.locator('[data-touch-edit="unlink"]').isVisible()
  ], ['링크 수정', true]);
  await tap('[data-touch-edit="link"]');
  r.check('M11 링크 수정에 실제 기존 주소 표시', await page.inputValue('#linkAddress'), 'https://example.com/report');
  await page.fill('#linkAddress', 'https://example.com/revised');
  await tap('#linkDialog [type="submit"]');
  r.check('M11 링크 수정 후 표시 글자 유지',
    [await page.locator('#editor a').getAttribute('href'), await page.locator('#editor a').textContent()],
    ['https://example.com/revised', '평가기록']);
  await hold('#editor a');
  await tap('[data-touch-edit="unlink"]');
  r.check('M11 링크 해제 후에도 표시 글자 유지', [
    await page.locator('#editor a').count(), await page.locator('#touchWord').textContent()
  ], [0, '평가기록']);

  await page.evaluate(() => T.writeClipboard('<i>새 기록</i>', '새 기록'));
  await hold('#touchWord');
  await tap('[data-touch-edit="paste"]');
  await page.locator('#editor i').waitFor();
  r.check('M11 메뉴에서 붙여넣으면 선택 영역을 실제 서식 있는 클립보드 내용으로 교체',
    await page.locator('#editor i').textContent(), '새 기록');

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'read', { configurable: true, value: async () => { throw new Error('Denied'); } });
  });
  await hold('#touchBlank');
  r.check('M11 빈 문단을 길게 누르면 붙여넣기와 링크만 표시',
    await page.locator('#mobileEditMenu button:visible').allTextContents(), ['붙여넣기', '링크']);
  await tap('[data-touch-edit="paste"]');
  await page.locator('#plainPasteText').fill('직접 붙여넣은 문장');
  await tap('#plainPasteDialog [value="insert"]');
  await page.waitForFunction(() => T.ed().textContent.includes('직접 붙여넣은 문장'));
  r.check('M11 직접 읽기 제한 시 입력창을 통해 원래 빈 문단에 삽입',
    await page.locator('#touchBlank').textContent(), '직접 붙여넣은 문장');
  await page.evaluate(() => { delete navigator.clipboard.read; });

  await page.evaluate(() => {
    T.set('<p><br></p>');
    return T.writeClipboard(
      '<p>판정 보고서</p><pre><code>def review():\n    return total &lt; 1\n\n# 재검토</code></pre>'
      + '<p><br></p><table><tr><th>판정</th><th>건수</th></tr><tr><td>성공</td><td>12</td></tr></table>',
      '판정 보고서\ndef review():\n    return total < 1\n\n# 재검토\n\n판정\t건수\n성공\t12'
    );
  });
  await hold('#editor p');
  await tap('[data-touch-edit="paste"]');
  await page.locator('#editor table').waitFor();
  r.check('M12 모바일 메뉴로 복합 보고서를 붙여넣어 코드·빈 문단·표 보존', await page.evaluate(() => {
    const blocks = [...T.ed().children];
    return [blocks.map(block => block.tagName).slice(0, 4), blocks[1].textContent, blocks[2].textContent,
      [...blocks[3].rows].map(row => [...row.cells].map(cell => cell.textContent))];
  }), [['P', 'PRE', 'P', 'TABLE'], 'def review():\n    return total < 1\n\n# 재검토', '', [['판정', '건수'], ['성공', '12']]]);
  await page.keyboard.press('Control+z');
  r.check('M12 모바일 메뉴로 붙여넣은 보고서를 한 번에 실행 취소', await page.evaluate(() => T.html()), '<p><br></p>');

  await page.evaluate(() => T.writeClipboard('', ['판정 보고서', '', '\\`\\`\\`', '&#x20;   outcome = "성공"', '\\`\\`\\`', '', '평가 완료'].join('\\\n')));
  await hold('#editor p');
  await tap('[data-touch-edit="paste"]');
  await page.locator('#editor pre code').waitFor();
  r.check('M12 모바일 메뉴에서 이스케이프된 Markdown 줄바꿈과 들여쓰기 복원', await page.evaluate(() =>
    [...T.ed().children].map(block => block.textContent)), ['판정 보고서', '', '    outcome = "성공"', '', '평가 완료']);

  await page.evaluate(() => {
    T.set('<p id="tapTarget">입력할 문장</p>' + '<p>스크롤할 보고서 내용</p>'.repeat(40));
    document.querySelector('.workspace').scrollTop = 0;
  });
  await tap('#tapTarget');
  await page.keyboard.insertText('추가');
  r.check('M11 짧게 탭하면 메뉴 없이 원래대로 입력', [
    await page.locator('#tapTarget').textContent(), await page.locator('#mobileEditMenu').isVisible()
  ], ['입력할 문장추가', false]);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 550 }] });
  for (const y of [515, 480, 440, 395]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y }] });
  }
  await release();
  await page.waitForFunction(() => document.querySelector('.workspace').scrollTop > 0);
  r.check('M11 밀어서 스크롤할 때는 메뉴가 열리지 않음', await page.locator('#mobileEditMenu').isVisible(), false);
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

process.exitCode = r.summary() ? 1 : 0;
