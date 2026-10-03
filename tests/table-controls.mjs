import { startServer, launch, openEditor, makeReporter } from './harness.mjs';
const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const html = '<p>표 앞 설명</p><table><tbody><tr><th>항목</th><th>가격</th><th>수량</th></tr><tr><td>사과</td><td>100</td><td>1</td></tr><tr><td>배</td><td>200</td><td>2</td></tr><tr><td>포도</td><td>300</td><td>3</td></tr></tbody></table><p>표 뒤 설명</p>';
const read = page => page.evaluate(() => [...T.ed().querySelector('table').rows].map(row => [...row.cells].map(cell => cell.textContent)));
const active = async (page, source = html) => {
  await page.evaluate(source => T.set(source), source);
  await page.locator('#editor td').first().click();
  await page.waitForTimeout(80);
};
const act = async (page, name) => { await page.locator(`[data-table-edit="${name}"]`).click(); await page.waitForTimeout(80); };
const handle = (page, axis, i) => page.locator(`[data-table-select="${axis}"][data-index="${i}"]`);
const drag = async (page, axis, from, to) => {
  const a = await handle(page, axis, from).boundingBox(), b = await handle(page, axis, to).boundingBox();
  await page.mouse.move(a.x+a.width/2, a.y+a.height/2);
  await page.mouse.down();
  await page.mouse.move(b.x+b.width/2, b.y+b.height/2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
};
const withPage = async (fn, opts = {}) => {
  const { page, context } = await openEditor(browser, base, opts);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { await fn(page); r.check('표 편집 런타임 오류 없음', errors, []); }
  finally { await context.close(); }
};
try {
  await withPage(async page => {
    await active(page);
    r.check('셀 클릭으로 표 편집 UI 표시', await page.locator('#tableControls').isVisible(), true);
    r.check('행과 열 핸들 표시', await page.locator('.table-axis-handle').count(), 7);
    await act(page, 'row-before');
    r.check('선택한 셀 위에 행 삽입', await read(page), [['항목','가격','수량'],['','',''],['사과','100','1'],['배','200','2'],['포도','300','3']]);
    await page.keyboard.press('Control+z');
    r.check('행 삽입 한 번에 실행 취소', await page.evaluate(() => T.html()), html);
    await page.keyboard.press('Control+y');
    r.check('행 삽입 다시 실행', await page.locator('#editor tr').count(), 5);
  });
  await withPage(async page => {
    await active(page);
    await act(page, 'column-after');
    r.check('선택 셀 오른쪽에 열 삽입', await read(page), [['항목','','가격','수량'],['사과','','100','1'],['배','','200','2'],['포도','','300','3']]);
    r.check('제목 행 새 열도 제목 셀', await page.evaluate(() => T.ed().querySelector('tr').cells[1].tagName), 'TH');
    await page.keyboard.press('Control+z');
    r.check('열 삽입 한 번에 실행 취소', await page.evaluate(() => T.html()), html);
  });
  await withPage(async page => {
    await active(page);
    const rect = await page.locator('#editor tr').nth(1).boundingBox();
    await page.mouse.move(rect.x+rect.width/2, rect.y+rect.height);
    await page.waitForTimeout(80);
    r.check('표 선에 대면 삽입 가이드 표시', await page.locator('#tableInsertGuide').isVisible(), true);
    await page.locator('#tableAddRow').click();
    r.check('선 사이 + 버튼으로 그 위치에 행 삽입', await read(page), [['항목','가격','수량'],['사과','100','1'],['','',''],['배','200','2'],['포도','300','3']]);
  });
  await withPage(async page => {
    await active(page);
    const rect = await page.locator('#editor tr').nth(1).locator('td').first().boundingBox();
    await page.mouse.move(rect.x+rect.width, rect.y+rect.height/2);
    await page.waitForTimeout(80);
    await page.locator('#tableAddColumn').click();
    r.check('세로 선 + 버튼으로 열 삽입', await read(page), [['항목','','가격','수량'],['사과','','100','1'],['배','','200','2'],['포도','','300','3']]);
  });
  await withPage(async page => {
    await active(page);
    await drag(page, 'row', 1, 2);
    r.check('여러 행 드래그 선택 표시', await page.locator('#tableEditLabel').textContent(), '2–3행 선택');
    r.check('선택 행 하이라이트 표시', await page.locator('.table-cell-selection').count(), 6);
    r.check('행 선택 뒤 행 삭제 버튼 표시', await page.locator('[data-table-edit="delete-row"]').isVisible(), true);
    await act(page, 'delete-row');
    r.check('여러 행 한 번에 삭제', await read(page), [['항목','가격','수량'],['포도','300','3']]);
    await page.keyboard.press('Control+z');
    r.check('여러 행 삭제 한 번에 취소', await page.evaluate(() => T.html()), html);
  });
  await withPage(async page => {
    await active(page);
    await drag(page, 'column', 1, 2);
    r.check('여러 열 드래그 선택 표시', await page.locator('#tableEditLabel').textContent(), '2–3열 선택');
    await act(page, 'delete-column');
    r.check('여러 열 한 번에 삭제', await read(page), [['항목'],['사과'],['배'],['포도']]);
    await page.keyboard.press('Control+z');
    r.check('여러 열 삭제 한 번에 취소', await page.evaluate(() => T.html()), html);
  });
  await withPage(async page => {
    await active(page);
    await handle(page, 'row', 1).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Shift+ArrowDown');
    r.check('키보드로 여러 행 선택', await page.locator('#tableEditLabel').textContent(), '2–3행 선택');
    await page.keyboard.press('Delete');
    r.check('선택 행 Delete로 삭제', await page.locator('#editor tr').count(), 2);
  });
  await withPage(async page => {
    await active(page, '<p>앞</p><table><tbody><tr><td>하나</td></tr></tbody></table><p>뒤</p>');
    await act(page, 'delete-column');
    r.check('마지막 열 삭제 시 표 제거', await page.locator('#editor table').count(), 0);
    r.check('표 제거 시 앞뒤 글자 유지', await page.evaluate(() => T.ed().textContent), '앞뒤');
    await page.keyboard.type('표 자리');
    r.check('표 제거 후 그 자리에서 입력', await page.evaluate(() => T.ed().querySelectorAll('p')[1].textContent), '표 자리');
  });
  const merged = '<table><tbody><tr><th colspan="2">병합 제목</th><th>제목</th></tr><tr><td rowspan="2">세로 내용</td><td>가</td><td>나</td></tr><tr><td>다</td><td>라</td></tr></tbody></table><p>뒤</p>';
  await withPage(async page => {
    await active(page, merged);
    await handle(page, 'row', 2).click();
    await act(page, 'row-before');
    r.check('병합 안 행 삽입 시 세로 병합 확장', await page.evaluate(() => T.ed().querySelector('td[rowspan]').rowSpan), 3);
    r.check('병합 셀 내용 보존', await page.evaluate(() => T.ed().querySelector('td[rowspan]').textContent), '세로 내용');
    await page.keyboard.press('Control+z');
    r.check('병합 표 행 추가 취소', await page.evaluate(() => T.html()), merged);
  });
  await withPage(async page => {
    await active(page, merged);
    await handle(page, 'column', 1).click();
    await act(page, 'column-before');
    r.check('병합 안 열 삽입 시 가로 병합 확장', await page.evaluate(() => T.ed().querySelector('th[colspan]').colSpan), 3);
    await page.keyboard.press('Control+z');
    r.check('병합 표 열 추가 취소', await page.evaluate(() => T.html()), merged);
  });
  await withPage(async page => {
    await active(page, merged);
    await handle(page, 'row', 1).click();
    await act(page, 'delete-row');
    r.check('병합 시작 행 삭제 시 내용 다음 행에 보존', await page.evaluate(() => T.ed().querySelectorAll('tr')[1].cells[0].textContent), '세로 내용');
    r.check('삭제 뒤 병합 축소', await page.evaluate(() => T.ed().querySelectorAll('tr')[1].cells[0].rowSpan), 1);
  });
  await withPage(async page => {
    await active(page);
    await handle(page, 'row', 1).click();
    await page.locator('[data-action="copy-all"]').click();
    const copied = await page.evaluate(async () => { const [item] = await navigator.clipboard.read(); return (await item.getType('text/html')).text(); });
    r.check('복사 내용에 편집 UI 없음', /table-controls|table-axis-handle|table-cell-selection|data-table-edit-focus/.test(copied), false);
    r.check('본문 HTML에 편집 UI 없음', await page.evaluate(() => T.ed().querySelectorAll('button,[data-table-edit-focus],.table-cell-selection').length), 0);
  });
  await withPage(async page => {
    await active(page);
    await page.evaluate(() => {
      const cell = T.ed().querySelector('td');
      const range = document.createRange(); range.setStart(cell.firstChild, 0); range.collapse(true);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.press('Delete');
    r.check('셀의 Delete는 글자만 삭제', await page.evaluate(() => T.ed().querySelector('td').textContent), '과');
    r.check('셀 글자 삭제가 행 삭제로 바뀌지 않음', await page.locator('#editor tr').count(), 4);
    await page.evaluate(() => T.caretIn(2, true));
    await page.waitForTimeout(80);
    r.check('표 밖으로 이동하면 편집 UI 닫힘', await page.locator('#tableControls').isVisible(), false);
  });
  await withPage(async page => {
    await active(page);
    await drag(page, 'row', 1, 2);
    await act(page, 'row-after');
    r.check('선택한 행 수만큼 아래에 추가', await read(page), [['항목','가격','수량'],['사과','100','1'],['배','200','2'],['','',''],['','',''],['포도','300','3']]);
  });
  await withPage(async page => {
    await active(page, merged);
    await handle(page, 'column', 1).click();
    await act(page, 'delete-column');
    r.check('병합 일부 열 삭제 시 제목과 다른 내용 유지', await read(page), [['병합 제목','제목'],['세로 내용','나'],['라']]);
    r.check('삭제 후 가로 병합 축소', await page.evaluate(() => T.ed().querySelector('th').colSpan), 1);
    await page.keyboard.press('Control+z');
    r.check('병합 열 삭제 한 번에 취소', await page.evaluate(() => T.html()), merged);
  });
  await withPage(async page => {
    const source = '<table><thead><tr><th>제목</th><th>값</th></tr></thead><tbody><tr><td rowspan="0">전체 병합</td><td>가</td></tr><tr><td>나</td></tr></tbody></table><p>뒤</p>';
    await active(page, source);
    await handle(page, 'row', 2).click();
    await act(page, 'row-before');
    r.check('끝까지 병합된 셀 안에 행 추가', await page.evaluate(() => T.ed().querySelector('td[rowspan]').rowSpan), 3);
    r.check('제목과 본문 행 그룹 유지', await page.evaluate(() => [T.ed().querySelector('thead').rows.length, T.ed().querySelector('tbody').rows.length]), [1,3]);
  });
  await withPage(async page => {
    await active(page, '<table><tbody><tr><td>하나</td></tr></tbody></table>');
    await act(page, 'delete-row');
    r.check('마지막 행 삭제 시 입력 가능한 문단 유지', await page.evaluate(() => T.html()), '<p><br></p>');
    await page.keyboard.press('Control+z');
    r.check('마지막 행 삭제도 되돌리기', await page.locator('#editor table').count(), 1);
  });
  await withPage(async page => {
    await page.setViewportSize({ width: 390, height: 844 });
    await active(page);
    r.check('좁은 화면에서도 행 핸들 표시', await handle(page, 'row', 1).isVisible(), true);
    r.check('좁은 화면에서도 열 추가 버튼 표시', await page.locator('#tableAddColumn').isVisible(), true);
    await handle(page, 'row', 1).tap();
    await page.locator('[data-table-edit="delete-row"]').tap();
    r.check('좁은 화면에서 행 삭제', await page.locator('#editor tr').count(), 3);
  }, { hasTouch: true });
  await withPage(async page => {
    await active(page, '<p>시작</p>'.repeat(100) + html + '<p>끝</p>'.repeat(50));
    const before = await page.locator('#editor table').boundingBox();
    await page.evaluate(() => document.querySelector('.workspace').scrollBy(0, 45));
    await page.waitForTimeout(80);
    const after = await page.locator('#editor table').boundingBox();
    const position = await handle(page, 'row', 1).boundingBox();
    const cell = await page.locator('#editor td').first().boundingBox();
    r.check('스크롤해도 행 핸들이 표를 따라감', Math.abs(position.y + position.height/2 - cell.y - cell.height/2) < 1, true);
    r.check('실제 스크롤 이동 검증', Math.abs(before.y-after.y-45) < 1, true);
  });
  await withPage(async page => {
    await active(page);
    await handle(page, 'row', 1).click();
    const pending = page.waitForEvent('download');
    await page.locator('[data-action="save-html"]').click();
    const download = await pending;
    const stream = await download.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const exported = Buffer.concat(chunks).toString();
    r.check('저장 HTML에 행·열 편집 UI 없음', /table-controls|table-axis-handle|table-cell-selection|data-table-edit-focus/.test(exported), false);
    r.check('저장 HTML에 표 내용 유지', exported.includes('사과') && exported.includes('<table>'), true);
  }, { noFilePicker: true });
  await withPage(async page => {
    await active(page);
    await act(page, 'delete-table');
    r.check('표 전체 삭제 버튼으로 모든 행·열 제거', await page.locator('#editor table').count(), 0);
    r.check('표 앞뒤 문단 보존', await page.evaluate(() => T.ed().textContent), '표 앞 설명표 뒤 설명');
    r.check('표 삭제 뒤 편집 UI 닫힘', await page.locator('#tableControls').isVisible(), false);
    await page.keyboard.type('표가 있던 자리');
    r.check('삭제한 표 자리에서 계속 입력', await page.evaluate(() => T.ed().querySelectorAll('p')[1].textContent), '표가 있던 자리');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    r.check('표 전체 삭제를 한 단계로 복원', await page.evaluate(() => T.html()), html);
    await page.keyboard.press('Control+y');
    r.check('표 전체 삭제 다시 실행', await page.locator('#editor table').count(), 0);
  });
  await withPage(async page => {
    await active(page, merged);
    await handle(page, 'column', 1).click();
    r.check('열 선택 중에도 표 전체 삭제 버튼 표시', await page.locator('[data-table-edit="delete-table"]').isVisible(), true);
    await act(page, 'delete-table');
    r.check('병합 표도 한 번에 삭제', await page.locator('#editor table').count(), 0);
    await page.keyboard.press('Control+z');
    r.check('병합 표 전체를 서식과 함께 복원', await page.evaluate(() => T.html()), merged);
  });
  await withPage(async page => {
    const source = '<table><tbody><tr><td>첫 표</td></tr></tbody></table><p>사이</p><table><tbody><tr><td>둘째 표</td></tr></tbody></table>';
    await page.evaluate(source => T.set(source), source);
    await page.locator('#editor td').last().click();
    await act(page, 'delete-table');
    r.check('여러 표 중 현재 표만 삭제', await page.evaluate(() => [...T.ed().querySelectorAll('table')].map(table => table.textContent)), ['첫 표']);
    await page.keyboard.press('Control+z');
    r.check('현재 표만 삭제한 작업도 복원', await page.evaluate(() => T.html()), source);
  });
  await withPage(async page => {
    await active(page, '<table><tbody><tr><td>표만 있는 문서</td></tr></tbody></table>');
    await act(page, 'delete-table');
    r.check('표만 있는 문서도 삭제 뒤 입력 문단 유지', await page.evaluate(() => T.html()), '<p><br></p>');
  });
  await withPage(async page => {
    await page.setViewportSize({ width: 390, height: 844 });
    await active(page);
    await page.locator('[data-table-edit="delete-table"]').tap();
    r.check('좁은 화면에서도 표 전체 삭제', await page.locator('#editor table').count(), 0);
  }, { hasTouch: true });
  await withPage(async page => {
    await page.evaluate(() => T.set('<table><tbody><tr><td>옆 칸</td><td>앞<table><tbody><tr><td>안쪽</td></tr></tbody></table>뒤</td></tr></tbody></table>'));
    await page.locator('#editor table table td').click();
    await act(page, 'delete-table');
    r.check('중첩 표는 현재 안쪽 표만 삭제', await page.locator('#editor table').count(), 1);
    r.check('안쪽 표 앞뒤의 셀 내용 보존', await page.evaluate(() => T.ed().querySelector('tr').cells[1].textContent), '앞뒤');
    await act(page, 'delete-column');
    r.check('안쪽 표 삭제 뒤에도 현재 셀 기준 편집', await page.evaluate(() => T.ed().querySelector('tr').cells[0].textContent), '옆 칸');
  });
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
