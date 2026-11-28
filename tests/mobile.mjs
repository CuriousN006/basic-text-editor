import { readFile } from 'node:fs/promises';
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

  await page.evaluate(() => {
    window.pickerCalls = 0;
    window.showSaveFilePicker = async () => {
      window.pickerCalls++;
      throw new DOMException('로컬 문서 접근 제한', 'SecurityError');
    };
  });
  for (const extension of ['html', 'md', 'docx']) {
    await tap('#mobileFilesButton');
    const [download] = await Promise.all([page.waitForEvent('download'), tap(`[data-action="save-${extension}"]`)]);
    const body = await readFile(await download.path());
    const content = extension === 'docx' ? body.subarray(0, 2).toString() : body.toString();
    r.check(`M7 모바일에서 파일 선택기를 거치지 않고 ${extension} 다운로드`, [
      download.suggestedFilename().endsWith('.' + extension),
      extension === 'docx' ? content === 'PK' : content.includes('교체'),
      await page.evaluate(() => window.pickerCalls)
    ], [true, true, 0]);
  }

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
  await page.evaluate(() => T.set('<p>첫 <strong id="touchWord">평가기록</strong> <span id="touchEnd">검토</span> 중입니다.</p><p id="touchBlank"><br></p><p id="touchNextLine">다음 줄</p>'));
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
  ], ['평가기록', ['복사', '잘라내기', '붙여넣기', '전체 선택', '링크'], false]);
  await tap('[data-touch-edit="copy"]');
  r.check('M11 메뉴에서 실제 클립보드로 선택한 글자를 복사',
    await page.evaluate(() => navigator.clipboard.readText()), '평가기록');

  const visibleHandles = () => page.locator('.mobile-selection-handle:visible').count();
  const dragSelectionHandle = async (edge, selector, offset) => {
    const handle = '[data-selection-edge="' + edge + '"]';
    const start = await touchAt(handle);
    const end = await page.locator(selector).evaluate((node, { edge, offset, start }) => {
      const selection = getSelection().getRangeAt(0).cloneRange();
      selection.collapse(edge === 'start');
      const from = selection.getBoundingClientRect();
      const caret = new Range();
      caret.setStart(node.firstChild, offset);
      caret.collapse(true);
      const to = caret.getBoundingClientRect();
      return { x: Math.round(start.x + to.left - from.left),
        y: Math.round(start.y + (to.top + to.bottom - from.top - from.bottom) / 2) };
    }, { edge, offset, start });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await release();
  };

  await hold('#touchWord');
  r.check('M13 손을 뗀 뒤에도 선택 시작·끝 손잡이가 표시됨', await visibleHandles(), 2);
  await dragSelectionHandle('end', '#touchEnd', 2);
  r.check('M13 끝 손잡이로 선택을 다음 낱말까지 넓힘', await page.evaluate(() => T.selection()), '평가기록 검토');
  await dragSelectionHandle('end', '#touchNextLine', 2);
  r.check('M13 끝 손잡이로 다음 문단까지 선택', await page.evaluate(() => T.selection().trim().endsWith('다음')), true);
  await dragSelectionHandle('end', '#touchEnd', 2);
  await dragSelectionHandle('start', '#editor p:first-child', 0);
  r.check('M13 시작 손잡이로 반대쪽 범위를 넓힘', await page.evaluate(() => T.selection()), '첫 평가기록 검토');
  await dragSelectionHandle('start', '#touchWord', 1);
  r.check('M13 시작 손잡이로 범위를 한 글자 단위로 좁힘', await page.evaluate(() => T.selection()), '가기록 검토');
  await tap('[data-touch-edit="copy"]');
  await page.locator('#mobileEditMenu').waitFor({ state: 'hidden' });
  r.check('M13 조절한 범위만 복사하고 손잡이를 닫음', [
    await page.evaluate(() => navigator.clipboard.readText()), await visibleHandles()
  ], ['가기록 검토', 0]);

  await hold('#touchWord');
  await dragSelectionHandle('start', '#touchEnd', 2);
  r.check('M18 손잡이가 반대쪽 끝을 지나면 선택 방향을 바꿈', await page.evaluate(() => T.selection()), ' 검토');
  await dragSelectionHandle('end', '#touchWord', 1);
  r.check('M18 방향을 바꾼 뒤 같은 손잡이를 다시 되돌릴 수 있음', await page.evaluate(() => T.selection()), '가기록');
  await tap('.brand');

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
  r.check('M11 빈 문단에서는 잘라내기와 복사를 숨기고 전체 선택은 표시',
    await page.locator('#mobileEditMenu button:visible').allTextContents(), ['붙여넣기', '전체 선택', '링크']);
  r.check('M13 글자를 선택하지 않으면 손잡이가 표시되지 않음', await visibleHandles(), 0);
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

  await page.evaluate(() => {
    const paragraph = '<p>스크롤할 보고서 내용</p>';
    T.set(paragraph.repeat(8) + '<p><strong id="scrollWord">선택한단어</strong> <span id="scrollEnd">다음</span></p>'
      + paragraph.repeat(35));
    document.querySelector('.workspace').scrollTop = 0;
  });
  await hold('#scrollWord');
  const startHandle = page.locator('[data-selection-edge="start"]');
  const oldTop = (await startHandle.boundingBox()).y;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 560 }] });
  for (const y of [530, 500, 470]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y }] });
  }
  await release();
  await page.waitForFunction(() => document.querySelector('.workspace').scrollTop > 20);
  r.check('M14 본문을 밀어 스크롤하면 선택 범위와 손잡이가 함께 이동', [
    await visibleHandles(), (await startHandle.boundingBox())?.y < oldTop, await page.evaluate(() => T.selection())
  ], [2, true, '선택한단어']);
  await page.evaluate(() => { document.querySelector('.workspace').scrollTop = 900; });
  await startHandle.waitFor({ state: 'hidden' });
  r.check('M14 선택이 화면 밖이면 손잡이와 메뉴를 숨김', [
    await visibleHandles(), await page.locator('#mobileEditMenu').isVisible()
  ], [0, false]);
  await page.evaluate(() => { document.querySelector('.workspace').scrollTop = 0; });
  await startHandle.waitFor();
  await dragSelectionHandle('end', '#scrollEnd', 2);
  r.check('M14 돌아온 손잡이로 이전 선택을 계속 조절', await page.evaluate(() => T.selection()), '선택한단어 다음');
  await tap('#scrollWord');
  await startHandle.waitFor({ state: 'hidden' });
  r.check('M14 본문을 짧게 누르면 손잡이 닫힘', await visibleHandles(), 0);

  for (const scenario of [
    { edge: 'end', at: 'bottom', direction: 1, finish: 'touchEnd', keyboard: true },
    { edge: 'start', at: 'top', direction: -1, finish: 'touchCancel', keyboard: false }
  ]) {
    await tap('.brand');
    await page.evaluate(keyboard => {
      // 키보드가 화면 일부를 가려도 보이는 본문의 아래쪽부터 스크롤해야 합니다.
      if (keyboard) Object.defineProperty(visualViewport, 'height', { configurable: true, value: 510 });
      else delete visualViewport.height;
      visualViewport.dispatchEvent(new Event('resize'));
      T.set(Array.from({ length: 90 }, (_, index) =>
        `<p data-line="${index}"><span>선택범위${index}</span> 화면 이동을 시험하는 문단</p>`).join(''));
      document.querySelector('[data-line="32"]').scrollIntoView({ block: 'center' });
    }, scenario.keyboard);
    await hold('[data-line="32"] span');
    const start = await touchAt(`[data-selection-edge="${scenario.edge}"]`);
    const before = await page.evaluate(at => {
      const workspace = document.querySelector('.workspace');
      const rect = workspace.getBoundingClientRect();
      return { scroll: workspace.scrollTop, y: Math.round(at === 'top' ? rect.top + 4 : rect.bottom - 4) };
    }, scenario.at);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: before.y }] });
    const edgeLine = () => page.evaluate(edge => {
      const range = getSelection().getRangeAt(0);
      const node = edge === 'start' ? range.startContainer : range.endContainer;
      return Number((node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest('[data-line]').dataset.line);
    }, scenario.edge);
    await page.waitForFunction(({ scroll, direction }) =>
      (document.querySelector('.workspace').scrollTop - scroll) * direction >= 80,
    { scroll: before.scroll, direction: scenario.direction });
    const firstLine = await edgeLine();
    await page.waitForFunction(({ scroll, direction }) =>
      (document.querySelector('.workspace').scrollTop - scroll) * direction >= 200,
    { scroll: before.scroll, direction: scenario.direction });
    r.check(`M17 손잡이를 ${scenario.at === 'top' ? '위' : '키보드 위의 아래쪽'}에 고정하면 스크롤과 함께 선택이 계속 확장됨`,
      ((await edgeLine()) - firstLine) * scenario.direction > 0, true);
    await touch.send('Input.dispatchTouchEvent', { type: scenario.finish, touchPoints: [] });
    const scrollStopped = await page.evaluate(async () => {
      const workspace = document.querySelector('.workspace');
      const scroll = workspace.scrollTop;
      for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame);
      return workspace.scrollTop === scroll;
    });
    r.check(`M17 ${scenario.finish === 'touchEnd' ? '손을 떼면' : '터치가 취소되면'} 자동 스크롤이 멈춤`, scrollStopped, true);
  }
  await tap('.brand');
  await page.evaluate(() => {
    document.querySelector('[data-line="32"]').scrollIntoView({ block: 'center' });
  });
  await press('[data-line="32"] span');
  const initialDrag = await page.evaluate(() => {
    const area = document.querySelector('.workspace');
    return { scroll: area.scrollTop, y: Math.round(area.getBoundingClientRect().bottom - 4) };
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: initialDrag.y }] });
  await page.waitForFunction(scroll => document.querySelector('.workspace').scrollTop - scroll > 220, initialDrag.scroll);
  await release();
  r.check('M18 처음 길게 누른 손을 떼기 전에도 스크롤하면서 선택이 이어짐', await page.evaluate(() => {
    const range = getSelection().getRangeAt(0);
    return range.toString().includes('선택범위32') && range.toString().includes('선택범위42');
  }), true);

  await page.evaluate(() => {
    T.set('<p><strong id="cutWord">잘라낼글자</strong></p><p>다음 문단</p>');
    document.querySelector('.workspace').scrollTop = 0;
  });
  await hold('#cutWord');
  await tap('[data-touch-edit="cut"]');
  r.check('M18 모바일 잘라내기는 클립보드에 복사한 뒤 본문에서 삭제', [
    await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#cutWord').count()
  ], ['잘라낼글자', 0]);
  await tap('[data-command="undo"]');
  r.check('M18 모바일 잘라내기를 한 번에 되돌림', await page.locator('#cutWord').textContent(), '잘라낼글자');
  await hold('#cutWord');
  await tap('[data-touch-edit="select-all"]');
  r.check('M18 모바일 전체 선택은 다음 문단도 선택', await page.evaluate(() => T.selection().includes('다음 문단')), true);
  await tap('.brand');
  await page.evaluate(() => T.set('<p>선택한단어 다음</p>'));

  const copyAll = page.locator('[data-action="copy-all"]');
  r.check('M15 휴대폰에서 파일 메뉴를 열기 전 전체 서식 복사는 숨김', await copyAll.isVisible(), false);
  await tap('#mobileFilesButton');
  await copyAll.tap();
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('선택한단어 다음'));
  r.check('M15 파일 메뉴에서 문서 전체를 복사', await page.evaluate(async () =>
    (await navigator.clipboard.readText()).includes('선택한단어 다음')), true);
  await page.setViewportSize({ width: 1280, height: 900 });
  r.check('M15 데스크톱 상단에서 전체 서식 복사를 바로 사용 가능', await copyAll.isVisible(), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => T.set('<p><b>첫 줄</b><br><a href="https://example.com/">주소</a></p><p><br></p><p>마지막 줄</p>'));
  const checkRichClipboard = async (label, denyWrite = false) => {
    await page.evaluate(() => T.writeClipboard('', '이전 클립보드'));
    if (denyWrite) {
      await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, 'write', {
          configurable: true, value: async () => { throw new DOMException('로컬 문서 제한', 'NotAllowedError'); }
        });
      });
    }
    await tap('#mobileFilesButton');
    await copyAll.tap();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()) !== '이전 클립보드');
    const types = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return [...item.types].sort();
    });
    r.check(label + '에 HTML과 일반 텍스트 모두 기록', types, ['text/html', 'text/plain']);
    const result = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const html = await (await item.getType('text/html')).text();
      const plain = (await (await item.getType('text/plain')).text()).replace(/^[ \t\u00a0]+$/gm, '');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return [doc.querySelector('b,strong')?.textContent, doc.querySelector('a')?.href, plain];
    });
    r.check(label + '에 굵게·링크·줄바꿈 보존', result, ['첫 줄', 'https://example.com/', '첫 줄\n주소\n\n마지막 줄']);
  };
  await checkRichClipboard('M16 전체 서식 복사');
  await checkRichClipboard('M16 Clipboard API 거절 후 대체 복사', true);

  await tap('#mobileFilesButton');
  await tap('[data-action="check-paste"]');
  await page.keyboard.press('Control+V');
  r.check('M19 실제 붙여넣기에서 HTML·굵게·링크·줄 구조를 감지',
    await page.locator('#pasteCheckResult').textContent(), '서식 HTML이 들어왔습니다. 감지된 항목은 굵게 · 링크 · 줄 구조입니다.');
  await page.evaluate(async () => {
    delete navigator.clipboard.write;
    await T.writeClipboard('', '일반 텍스트만');
  });
  await page.keyboard.press('Control+V');
  r.check('M19 일반 텍스트만 받은 경우와 HTML을 구분',
    await page.locator('#pasteCheckResult').textContent(), '일반 텍스트만 들어왔습니다. 이번 붙여넣기에는 서식 정보가 없습니다.');
  r.check('M19 확인 동작이 원고를 변경하지 않음', await page.locator('#editor b').textContent(), '첫 줄');
  await tap('#pasteCheckDialog button');
  await tap('#mobileFilesButton');
  await tap('[data-action="copy-all-text"]');
  const readablePlainText = '첫 줄\n주소 (https://example.com/)\n\n마지막 줄';
  await page.waitForFunction(async expected => await navigator.clipboard.readText() === expected, readablePlainText);
  r.check('M19 일반 텍스트만 받아도 링크 주소와 빈 줄을 전달하는 별도 복사',
    await page.evaluate(() => navigator.clipboard.readText()), readablePlainText);
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

process.exitCode = r.summary() ? 1 : 0;
