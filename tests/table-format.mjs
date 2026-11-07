// 표의 행·열을 손잡이나 Shift+Alt 단축키로 고른 뒤, 도구막대 서식 버튼과
// Ctrl+B·I·U로 고른 칸 전체의 글자 서식과 정렬을 한 번에 바꿉니다.
import { startServer, launch, openEditor, makeReporter, mouseClick } from './harness.mjs';
const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const html = '<table><tbody><tr><th>항목</th><th>가격</th><th>수량</th></tr><tr><td>사과 <b>빨강</b></td><td>100</td><td>1</td></tr><tr><td>배</td><td>200</td><td><br></td></tr></tbody></table><p>뒤</p>';
const cells = page => page.evaluate(() => [...T.ed().querySelectorAll('th,td')].map(cell => cell.innerHTML));
const toast = page => page.locator('#toast').textContent();
const pressed = (page, command) => page.locator(`[data-command="${command}"]`).getAttribute('aria-pressed');
const handle = (page, axis, i) => page.locator(`[data-table-select="${axis}"][data-index="${i}"]`);
const select = async (page, axis, i, source = html) => {
  await page.evaluate(source => T.set(source), source);
  await mouseClick(page, page.locator('#editor td').first());
  await page.waitForTimeout(80);
  await handle(page, axis, i).click();
  await page.waitForTimeout(60);
};
const withPage = async fn => {
  const { page, context } = await openEditor(browser, base);
  try { await fn(page); }
  finally { await context.close(); }
};
try {
  console.log('\n--- 손잡이로 고른 열 ---');
  await withPage(async page => {
    await select(page, 'column', 0);
    r.check('C1 열을 고르면 굵게 버튼은 꺼짐(일부만 굵음)', await pressed(page, 'bold'), 'false');
    await page.locator('[data-command="bold"]').click();
    r.check('C2 B 버튼으로 열 전체 굵게', await cells(page),
      ['항목', '가격', '수량', '<b>사과 </b><b>빨강</b>', '100', '1', '<b>배</b>', '200', '<br>']);
    r.check('C3 알림에 바뀐 칸 수', await toast(page), '칸 2개에 굵게 서식을 적용했습니다. Ctrl+Z로 되돌릴 수 있습니다.');
    r.check('C4 적용 뒤에도 열 선택 유지', await page.locator('#tableEditLabel').textContent(), '1열 선택');
    r.check('C5 굵게 버튼이 켜짐', await pressed(page, 'bold'), 'true');
    r.check('C6 선택 강조 유지', await page.locator('.table-cell-selection').count(), 3);
    await page.keyboard.press('Control+b');
    r.check('C7 모두 굵으면 Ctrl+B로 해제(원래 굵던 글자 포함)', await cells(page),
      ['항목', '가격', '수량', '사과 빨강', '100', '1', '배', '200', '<br>']);
    r.check('C8 해제 알림', await toast(page), '칸 2개에 굵게 서식을 해제했습니다. Ctrl+Z로 되돌릴 수 있습니다.');
    await page.keyboard.press('Control+i');
    r.check('C9 Ctrl+I로 제목 칸까지 기울임', await cells(page),
      ['<i>항목</i>', '가격', '수량', '<i>사과 빨강</i>', '100', '1', '<i>배</i>', '200', '<br>']);
    await page.keyboard.press('Control+z');
    r.check('C10 Ctrl+Z 한 번에 열 전체 되돌림', await cells(page),
      ['항목', '가격', '수량', '사과 빨강', '100', '1', '배', '200', '<br>']);
    // 되돌리면 편집 UI가 닫혀도 초점은 숨은 손잡이에 남습니다. 그때 키를 눌러도 오류가 없어야 합니다.
    // 실제 키 입력으로는 초점이 빠지는 시점과 겹쳐야만 나므로 숨은 손잡이에 직접 보냅니다.
    await page.waitForTimeout(100);
    await page.evaluate(() => document.querySelector('[data-table-select]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', bubbles: true })));
    await page.keyboard.press('Control+y');
    r.check('C11 Ctrl+Y로 다시 실행', (await cells(page))[6], '<i>배</i>');
  });

  console.log('\n--- 여러 행과 다른 서식 ---');
  await withPage(async page => {
    await select(page, 'row', 1);
    await page.keyboard.press('Shift+ArrowDown');
    r.check('R1 Shift+↓로 2–3행 선택', await page.locator('#tableEditLabel').textContent(), '2–3행 선택');
    await page.keyboard.press('Control+u');
    r.check('R2 Ctrl+U로 두 행 밑줄(빈 칸은 그대로)', await cells(page),
      ['항목', '가격', '수량', '<u>사과 </u><b><u>빨강</u></b>', '<u>100</u>', '<u>1</u>', '<u>배</u>', '<u>200</u>', '<br>']);
    r.check('R3 밑줄 버튼 켜짐', await pressed(page, 'underline'), 'true');
    await page.locator('[data-command="strikeThrough"]').click();
    r.check('R4 취소선 버튼도 같은 칸에', (await cells(page))[7], '<u><s>200</s></u>');
    await page.locator('[data-command="justifyRight"]').click();
    r.check('R5 오른쪽 정렬은 칸에 지정', await page.evaluate(() => [...T.ed().querySelectorAll('td')].map(cell => cell.style.textAlign)),
      ['right', 'right', 'right', 'right', 'right', 'right']);
    r.check('R6 오른쪽 정렬 버튼 켜짐', [await pressed(page, 'justifyRight'), await pressed(page, 'justifyLeft')], ['true', 'false']);
    r.check('R7 제목 행은 정렬 안 바뀜', await page.evaluate(() => T.ed().querySelector('th').getAttribute('style')), null);
    await page.locator('[data-command="justifyLeft"]').click();
    r.check('R8 왼쪽 정렬은 지정을 지움', await page.evaluate(() => T.ed().querySelectorAll('[style]').length), 0);
    await page.locator('[data-command="justifyCenter"]').click();
    await page.locator('[data-action="clear-format"]').click();
    r.check('R9 서식 제거 버튼은 고른 칸의 글자 서식과 정렬을 지움', await page.evaluate(() => T.html()),
      '<table><tbody><tr><th>항목</th><th>가격</th><th>수량</th></tr><tr><td>사과 빨강</td><td>100</td><td>1</td></tr><tr><td>배</td><td>200</td><td><br></td></tr></tbody></table><p>뒤</p>');
    r.check('R10 서식 제거 알림', await toast(page), '칸 6개의 글자와 문단 서식을 제거했습니다. Ctrl+Z로 되돌릴 수 있습니다.');
    await page.keyboard.press('Control+z');
    r.check('R11 서식 제거 되돌리면 가운데 정렬로', await page.evaluate(() => T.ed().querySelector('td').style.textAlign), 'center');
  });

  console.log('\n--- 드래그와 단축키로 고르기 ---');
  await withPage(async page => {
    await page.evaluate(source => T.set(source), html);
    await mouseClick(page, page.locator('#editor td').first());
    await page.waitForTimeout(80);
    const a = await handle(page, 'column', 1).boundingBox(), b = await handle(page, 'column', 2).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    await page.locator('[data-command="italic"]').click();
    r.check('D1 드래그로 고른 두 열에 기울임', await cells(page),
      ['항목', '<i>가격</i>', '<i>수량</i>', '사과 <b>빨강</b>', '<i>100</i>', '<i>1</i>', '배', '<i>200</i>', '<br>']);
  });
  await withPage(async page => {
    await page.evaluate(source => T.set(source), html);
    await mouseClick(page, page.locator('#editor td').nth(1));
    await page.keyboard.press('Shift+Alt+End');
    await page.waitForTimeout(60);
    r.check('K1 Shift+Alt+End로 현재 행 선택', await page.locator('#tableEditLabel').textContent(), '2행 선택');
    r.check('K2 손잡이로 초점 이동', await page.evaluate(() => document.activeElement.dataset.tableSelect), 'row');
    await page.keyboard.press('Control+b');
    r.check('K3 행 전체 굵게', await cells(page),
      ['항목', '가격', '수량', '<b>사과 </b><b>빨강</b>', '<b>100</b>', '<b>1</b>', '배', '200', '<br>']);
    await page.keyboard.press('Shift+ArrowDown');
    r.check('K4 서식을 바꾼 뒤에도 Shift+↓로 이어 고름', await page.locator('#tableEditLabel').textContent(), '2–3행 선택');
    await page.keyboard.press('Escape');
    await mouseClick(page, page.locator('#editor td').nth(2));
    await page.keyboard.press('Shift+Alt+PageUp');
    await page.waitForTimeout(60);
    r.check('K5 Shift+Alt+PageUp으로 현재 열 선택', await page.locator('#tableEditLabel').textContent(), '3열 선택');
    await page.keyboard.press('Escape');
    await mouseClick(page, page.locator('#editor td').nth(0));
    await page.keyboard.press('Shift+Alt+PageDown');
    await page.waitForTimeout(60);
    r.check('K6 Shift+Alt+PageDown으로 현재 열 선택', await page.locator('#tableEditLabel').textContent(), '1열 선택');
    await page.keyboard.press('Escape');
    await mouseClick(page, page.locator('#editor td').nth(0));
    await page.keyboard.press('Shift+Alt+Home');
    await page.waitForTimeout(60);
    r.check('K7 Shift+Alt+Home으로 현재 행 선택', await page.locator('#tableEditLabel').textContent(), '2행 선택');
  });

  console.log('\n--- 특별한 경우 ---');
  await withPage(async page => {
    await select(page, 'row', 0);
    r.check('E1 제목 행은 굵게로 표시', await pressed(page, 'bold'), 'true');
    await page.keyboard.press('Control+b');
    r.check('E2 제목 칸 굵게는 풀 수 없다고 알림', await toast(page), '제목 칸은 원래 굵게 표시되므로 굵게를 해제할 수 없습니다.');
    r.check('E3 문서는 그대로', await page.evaluate(() => T.html()), html);
    await page.keyboard.press('Delete');
    r.check('E4 Delete는 여전히 고른 행 삭제', await page.locator('#editor tr').count(), 2);
  });
  await withPage(async page => {
    const merged = '<table><tbody><tr><td colspan="2">합친 칸</td><td>c</td></tr><tr><td>a</td><td>b</td><td>d</td></tr></tbody></table><p>뒤</p>';
    await select(page, 'column', 1, merged);
    await page.keyboard.press('Control+b');
    r.check('E5 병합 칸이 걸친 열도 포함', await cells(page), ['<b>합친 칸</b>', 'c', 'a', '<b>b</b>', 'd']);
  });
  await withPage(async page => {
    const empty = '<table><tbody><tr><td><br></td><td><br></td></tr></tbody></table><p>뒤</p>';
    await select(page, 'row', 0, empty);
    await page.keyboard.press('Control+b');
    r.check('E6 빈 칸뿐이면 바꾸지 않고 알림', await toast(page), '굵게: 고른 칸에 바꿀 글자가 없습니다.');
    r.check('E7 빈 칸 문서는 그대로', await page.evaluate(() => T.html()), empty);
  });
  await withPage(async page => {
    // 행·열을 고르지 않았으면 원래대로 커서가 있는 곳에만 적용됩니다.
    await page.evaluate(source => T.set(source), html);
    await page.evaluate(() => T.select('100'));
    await page.keyboard.press('Control+b');
    r.check('E8 선택 없이 칸 글자만 고르면 그 글자만 굵게', (await cells(page)).slice(4, 6), ['<b>100</b>', '1']);
    await mouseClick(page, page.locator('#editor td').nth(1));
    await page.keyboard.press('Shift+Alt+End');
    await mouseClick(page, page.locator('#editor p'));
    r.check('E9 본문을 누르면 행 선택이 풀림', await page.locator('#tableMenu').isVisible(), false);
    await page.evaluate(() => T.select('뒤'));
    await page.locator('[data-command="italic"]').click();
    r.check('E10 선택이 풀린 뒤 버튼은 본문 글자에 적용', await page.evaluate(() => T.ed().lastElementChild.innerHTML), '<i>뒤</i>');
  });
  await withPage(async page => {
    // 칸 안에서 서식 제거를 눌러도 칸 내용이 <p>로 한 겹 더 싸이지 않습니다.
    await page.evaluate(source => T.set(source), html);
    await page.evaluate(() => T.select('빨강'));
    await page.locator('[data-action="clear-format"]').click();
    r.check('E11 칸 안 서식 제거는 문단으로 감싸지 않음', (await cells(page))[3], '사과 빨강');
  });
  console.log('\n--- 메뉴가 고른 칸을 가리지 않음 ---');
  const overlaps = page => page.evaluate(() => {
    const menu = document.getElementById('tableMenu').getBoundingClientRect();
    return [...document.querySelectorAll('.table-cell-selection')].some(cell => {
      const rect = cell.getBoundingClientRect();
      return rect.left < menu.right && menu.left < rect.right && rect.top < menu.bottom && menu.top < rect.bottom;
    });
  });
  await withPage(async page => {
    for (const [axis, index] of [['column', 0], ['column', 1], ['column', 2], ['row', 0], ['row', 1], ['row', 2]]) {
      await select(page, axis, index);
      r.check(`M ${index + 1}${axis === 'row' ? '행' : '열'}을 고르면 메뉴가 고른 칸을 덮지 않음`, [await page.locator('#tableMenu').isVisible(), await overlaps(page)], [true, false]);
    }
    await select(page, 'row', 1);
    await page.keyboard.press('Shift+ArrowDown');
    r.check('M 2–3행을 고르면 메뉴가 고른 칸을 덮지 않음', await overlaps(page), false);
  });
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
