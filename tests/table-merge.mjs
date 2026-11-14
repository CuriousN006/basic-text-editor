// 셀 병합과 병합 해제. 칸은 실제 마우스 드래그와 손잡이로 고릅니다.
import { startServer, launch, openEditor, makeReporter, inShard, mouseClick } from './harness.mjs';
const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const html = '<p>표 앞 설명</p><table><tbody><tr><th>항목</th><th>가격</th><th>수량</th></tr><tr><td>사과</td><td>100</td><td>1</td></tr><tr><td>배</td><td>200</td><td>2</td></tr><tr><td>포도</td><td>300</td><td>3</td></tr></tbody></table><p>표 뒤 설명</p>';
// 칸마다 [글자, 세로 병합, 가로 병합]. 병합하지 않은 칸은 글자만 적습니다.
const read = page => page.evaluate(() => [...T.ed().querySelector('table').rows].map(row => [...row.cells].map(cell => (
  cell.rowSpan > 1 || cell.colSpan > 1 ? [cell.textContent, cell.rowSpan, cell.colSpan] : cell.textContent
))));
const cellAt = (page, row, column) => page.locator('#editor tr').nth(row).locator('th,td').nth(column);
const set = async (page, source = html) => {
  await page.evaluate(source => T.set(source), source);
  await page.waitForTimeout(40);
};
// 한 칸의 가운데에서 다른 칸의 가운데까지 마우스로 끕니다.
const dragCells = async (page, from, to) => {
  const a = await cellAt(page, ...from).boundingBox(), b = await cellAt(page, ...to).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
};
const menuItem = (page, name) => page.locator(`#tableMenu [data-table-edit="${name}"]`);
const openMenu = async (page) => {
  if (!await page.locator('#tableMenu').isVisible()) await page.locator('#tableMenuButton').click();
  await page.waitForTimeout(60);
};
const act = async (page, name) => {
  await openMenu(page);
  await menuItem(page, name).click();
  await page.waitForTimeout(100);
};
const handle = (page, axis, i) => page.locator(`[data-table-select="${axis}"][data-index="${i}"]`);
const withPage = async (fn, opts = {}) => {
  if (!inShard()) return;
  const { page, context } = await openEditor(browser, base, opts);
  try { await fn(page); }
  finally { await context.close(); }
};
try {
  console.log('\n--- 드래그한 칸 병합 ---');
  await withPage(async page => {
    await set(page);
    await dragCells(page, [1, 0], [2, 1]);
    r.check('칸을 드래그하면 선택 도구막대에 병합 버튼', await page.locator('#selectionMergeCells').isVisible(), true);
    await page.locator('#selectionMergeCells').click();
    await page.waitForTimeout(100);
    r.check('드래그한 네 칸을 하나로 병합', await read(page),
      [['항목', '가격', '수량'], [['사과\n100\n배\n200', 2, 2], '1'], ['2'], ['포도', '300', '3']]);
    r.check('병합 알림', await page.evaluate(() => T.toast()), '칸 4개를 하나로 병합했습니다. Ctrl+Z로 되돌릴 수 있습니다.');
    r.check('표 앞뒤 글은 그대로', await page.evaluate(() => [T.ed().firstElementChild.textContent, T.ed().lastElementChild.textContent]),
      ['표 앞 설명', '표 뒤 설명']);
    await page.keyboard.type('!');
    r.check('커서는 병합한 칸에 놓임', await page.evaluate(() => T.ed().querySelector('td[rowspan]').textContent.includes('!')), true);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(80);
    r.check('병합 한 번에 실행 취소', await page.evaluate(() => T.html()), html);
  });
  await withPage(async page => {
    await set(page);
    await dragCells(page, [1, 1], [1, 2]);
    await act(page, 'merge-cells');
    r.check('표 메뉴에서도 드래그한 칸 병합', await read(page),
      [['항목', '가격', '수량'], ['사과', ['100\n1', 1, 2]], ['배', '200', '2'], ['포도', '300', '3']]);
  });
  await withPage(async page => {
    await set(page);
    await mouseClick(page, cellAt(page, 1, 0));
    await page.keyboard.down('Shift');
    await mouseClick(page, cellAt(page, 1, 0));
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);
    r.check('한 칸 안의 글자만 고르면 병합 버튼 없음', await page.locator('#selectionMergeCells').isVisible(), false);
    await openMenu(page);
    r.check('칸 하나에서는 병합 항목 없음', await menuItem(page, 'merge-cells').isVisible(), false);
    r.check('병합 칸이 없으면 해제 항목 없음', await menuItem(page, 'split-cells').isVisible(), false);
  });

  console.log('\n--- 손잡이로 고른 행·열 병합 ---');
  await withPage(async page => {
    await set(page);
    await mouseClick(page, cellAt(page, 1, 0));
    await handle(page, 'row', 0).click();
    await page.waitForTimeout(80);
    r.check('고른 칸 수를 항목에 표시', await menuItem(page, 'merge-cells').textContent(), '셀 3개 병합');
    await menuItem(page, 'merge-cells').click();
    await page.waitForTimeout(100);
    r.check('행 전체를 한 칸으로', await read(page),
      [[['항목\n가격\n수량', 1, 3]], ['사과', '100', '1'], ['배', '200', '2'], ['포도', '300', '3']]);
    r.check('제목 칸은 제목 칸으로 남음', await page.evaluate(() => T.ed().querySelector('tr').cells[0].tagName), 'TH');
  });
  await withPage(async page => {
    await set(page);
    await mouseClick(page, cellAt(page, 1, 0));
    await handle(page, 'column', 2).click();
    await page.waitForTimeout(80);
    await menuItem(page, 'merge-cells').click();
    await page.waitForTimeout(100);
    r.check('열 전체를 한 칸으로', await read(page),
      [['항목', '가격', ['수량\n1\n2\n3', 4, 1]], ['사과', '100'], ['배', '200'], ['포도', '300']]);
  });
  // 여러 행을 통째로 병합하면 칸이 하나도 시작하지 않는 행이 남는다. 높이 0인 행으로
  // 두지 않고 없앤다.
  await withPage(async page => {
    await set(page);
    await mouseClick(page, cellAt(page, 1, 0));
    await handle(page, 'row', 1).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(80);
    await menuItem(page, 'merge-cells').click();
    await page.waitForTimeout(100);
    r.check('통째로 합친 두 행은 한 행이 됨', await read(page),
      [['항목', '가격', '수량'], [['사과\n100\n1\n배\n200\n2', 1, 3]], ['포도', '300', '3']]);
    r.check('쓸모없는 병합 속성 없음', await page.locator('#editor [colspan="1"], #editor [rowspan="1"]').count(), 0);
    r.check('행 손잡이도 남은 행 수만큼', await page.locator('[data-table-select="row"]').count(), 3);
  });

  console.log('\n--- 내용 잇기 ---');
  await withPage(async page => {
    await set(page, '<table><tbody><tr><td>가</td><td><br></td><td>나</td></tr><tr><td><br></td><td><br></td><td>다</td></tr></tbody></table><p>뒤</p>');
    await mouseClick(page, cellAt(page, 0, 0));
    await handle(page, 'row', 0).click();
    await page.waitForTimeout(80);
    await menuItem(page, 'merge-cells').click();
    await page.waitForTimeout(100);
    r.check('빈 칸은 줄을 만들지 않음', await page.evaluate(() => T.ed().querySelector('td').textContent), '가\n나');
    await mouseClick(page, cellAt(page, 1, 0));
    await dragCells(page, [1, 0], [1, 1]);
    await act(page, 'merge-cells');
    r.check('빈 칸끼리 병합하면 빈 칸', await page.evaluate(() => T.ed().querySelectorAll('tr')[1].cells[0].innerHTML), '<br>');
  });
  await withPage(async page => {
    await set(page, '<table><tbody><tr><td><b>굵게</b></td><td style="text-align: center;"><i>기울임</i></td></tr></tbody></table><p>뒤</p>');
    await dragCells(page, [0, 0], [0, 1]);
    await act(page, 'merge-cells');
    r.check('글자 서식은 유지', await page.evaluate(() => T.ed().querySelector('td').innerHTML), '<b>굵게</b>\n<i>기울임</i>');
    r.check('한 칸뿐인 표가 되면 병합 속성도 없음', await page.evaluate(() => T.ed().querySelector('td').attributes.length), 0);
  });

  console.log('\n--- 이미 병합된 칸 ---');
  const merged = '<table><tbody><tr><th colspan="2">병합 제목</th><th>제목</th></tr><tr><td rowspan="2">세로 내용</td><td>가</td><td>나</td></tr><tr><td>다</td><td>라</td></tr></tbody></table><p>뒤</p>';
  await withPage(async page => {
    await set(page, merged);
    // '가'에서 '다'로 끌면 2열만 고른 것이다.
    await dragCells(page, [1, 1], [2, 0]);
    await act(page, 'merge-cells');
    r.check('병합 칸 옆의 칸끼리 병합', await read(page),
      [[['병합 제목', 1, 2], '제목'], [['세로 내용', 2, 1], ['가\n다', 2, 1], '나'], ['라']]);
  });
  await withPage(async page => {
    await set(page, merged);
    // 가로 병합 칸의 절반만 걸치게 고르면 그 칸 전체로 넓힌다.
    await mouseClick(page, cellAt(page, 1, 1));
    await handle(page, 'column', 1).click();
    await page.waitForTimeout(80);
    r.check('걸친 병합 칸까지 넓혀 셈', await menuItem(page, 'merge-cells').textContent(), '셀 4개 병합');
    await menuItem(page, 'merge-cells').click();
    await page.waitForTimeout(100);
    r.check('걸친 병합 칸을 포함해 병합', await read(page),
      [[['병합 제목\n세로 내용\n가\n다', 3, 1], '제목'], ['나'], ['라']]);
  });
  await withPage(async page => {
    await set(page, merged);
    await mouseClick(page, cellAt(page, 1, 0));
    await openMenu(page);
    r.check('병합 칸에 커서를 두면 해제 항목', await menuItem(page, 'split-cells').isVisible(), true);
    r.check('칸 하나라 병합 항목은 없음', await menuItem(page, 'merge-cells').isVisible(), false);
    await menuItem(page, 'split-cells').click();
    await page.waitForTimeout(100);
    r.check('세로 병합 해제', await read(page),
      [[['병합 제목', 1, 2], '제목'], ['세로 내용', '가', '나'], ['', '다', '라']]);
    r.check('해제 알림', await page.evaluate(() => T.toast()), '병합 칸 1개를 해제했습니다. Ctrl+Z로 되돌릴 수 있습니다.');
    r.check('새 칸에 커서를 둘 수 있음', await page.evaluate(() => T.ed().querySelectorAll('tr')[2].cells[0].innerHTML), '<br>');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(80);
    r.check('해제 한 번에 실행 취소', await page.evaluate(() => T.html()), merged);
  });
  await withPage(async page => {
    await set(page, merged);
    // 병합 셀의 중앙에는 내부 열 경계의 열 추가 버튼이 나타날 수 있습니다.
    await cellAt(page, 0, 0).click({ position: { x: 24, y: 18 } });
    await act(page, 'split-cells');
    r.check('가로 병합 해제 시 제목 행의 새 칸은 제목 칸', await page.evaluate(() => (
      [...T.ed().querySelector('tr').cells].map(cell => `${cell.tagName}:${cell.textContent}`)
    )), ['TH:병합 제목', 'TH:', 'TH:제목']);
  });
  await withPage(async page => {
    await set(page, merged);
    await mouseClick(page, cellAt(page, 1, 1));
    await handle(page, 'row', 0).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(80);
    r.check('고른 행에 병합 칸이 있으면 해제 항목', await menuItem(page, 'split-cells').isVisible(), true);
    await menuItem(page, 'split-cells').click();
    await page.waitForTimeout(100);
    r.check('고른 범위의 병합 칸을 모두 해제', await read(page),
      [['병합 제목', '', '제목'], ['세로 내용', '가', '나'], ['', '다', '라']]);
  });

  console.log('\n--- 병합할 수 없는 경우 ---');
  await withPage(async page => {
    const sections = '<table><thead><tr><th>제목</th><th>값</th></tr></thead><tbody><tr><td>가</td><td>나</td></tr></tbody></table><p>뒤</p>';
    await set(page, sections);
    await mouseClick(page, cellAt(page, 1, 0));
    await handle(page, 'column', 0).click();
    await page.waitForTimeout(80);
    await menuItem(page, 'merge-cells').click();
    await page.waitForTimeout(100);
    r.check('제목 행과 본문 행은 병합하지 않음', await page.evaluate(() => T.html()), sections);
    r.check('이유를 알림', await page.evaluate(() => T.toast()), '제목 행과 본문 행에 걸친 칸은 병합할 수 없습니다.');
  });

  console.log('\n--- 병합한 표의 저장 형태 ---');
  await withPage(async page => {
    await set(page);
    await dragCells(page, [1, 0], [2, 0]);
    await act(page, 'merge-cells');
    r.check('문서에는 표준 병합 속성만 남음', await page.evaluate(() => T.ed().querySelector('table').outerHTML),
      '<table><tbody><tr><th>항목</th><th>가격</th><th>수량</th></tr><tr><td rowspan="2">사과\n배</td><td>100</td><td>1</td></tr><tr><td>200</td><td>2</td></tr><tr><td>포도</td><td>300</td><td>3</td></tr></tbody></table>');
    // 병합한 표에서도 찾기는 칸 경계를 넘지 않는다.
    await page.click('[data-action="replace"]');
    await page.fill('#findText', '배100');
    await page.waitForTimeout(250);
    r.check('병합 칸과 옆 칸을 이어 찾지 않음', await page.textContent('#findCount'), '없음');
  });
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
