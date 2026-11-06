// 비슷한 모양 찾아 바꾸기: 숫자 모양(날짜·전화번호)과 ^ _ \명령어 기호를 예시 하나로 일괄 변경한다.
import { startServer, launch, openEditor, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();

async function withPage(fn) {
  const { context, page } = await openEditor(browser, base);
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

// 예시를 드래그하고 Ctrl+H로 연 뒤 비슷한 모양을 켠다.
async function openShape(page, html, example, { replace = true } = {}) {
  await page.evaluate((value) => T.set(value), html);
  await page.evaluate((value) => T.select(value), example);
  await page.keyboard.press(replace ? 'Control+h' : 'Control+f');
  await page.check('#similarShape');
  await page.waitForTimeout(260);
}

const state = (page) => page.evaluate(() => ({
  replace: document.getElementById('replaceText').value,
  count: document.getElementById('findCount').textContent,
  warning: document.getElementById('shapeWarning').hidden ? null : document.getElementById('shapeWarning').textContent
}));

// 검색 결과 목록의 "찾은 모양 → 바뀔 모양"
const results = (page) => page.evaluate(() => [...document.querySelectorAll('.find-result-sentence')]
  .map((item) => {
    const to = item.querySelector('ins');
    return to ? `${item.querySelector('mark').textContent} → ${to.textContent}` : item.querySelector('mark').textContent;
  }));

async function typeReplacement(page, value) {
  await page.fill('#replaceText', value);
  await page.waitForTimeout(260);
}

async function undo(page) {
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
}

console.log('\n--- 비슷한 모양: 숫자 ---');

await withPage(async (page) => {
  const html = '<p>작성 2024년 3월 15일, 수정 2025년 11월 2일, 기한 2025년 12월 1일.</p>';
  await openShape(page, html, '2024년 3월 15일');
  const opened = await state(page);
  r.check('S1 켜면 바꿀 내용에 예시가 채워짐', opened.replace, '2024년 3월 15일');
  r.check('S2 숫자만 다른 날짜 개수', opened.count, '3개');

  await typeReplacement(page, '2024.3.15');
  r.check('S3 검색 결과에 일치마다 바뀔 모양 표시', await results(page), [
    '2024년 3월 15일 → 2024.3.15',
    '2025년 11월 2일 → 2025.11.2',
    '2025년 12월 1일 → 2025.12.1'
  ]);
  r.check('S3 입력칸 아래 안내 없음', (await state(page)).warning, null);

  await typeReplacement(page, '2024-03-15');
  r.check('S4 0을 채우면 두 자리로 맞춤', await results(page), [
    '2024년 3월 15일 → 2024-03-15',
    '2025년 11월 2일 → 2025-11-02',
    '2025년 12월 1일 → 2025-12-01'
  ]);
  await page.click('[data-find="replace-all"]');
  r.check('S5 모두 바꾸기 결과', await page.evaluate(() => T.text()),
    '작성 2024-03-15, 수정 2025-11-02, 기한 2025-12-01.');
  r.check('S6 알림', await page.evaluate(() => T.toast()), '비슷한 모양 3개를 바꿨습니다.');
  await undo(page);
  r.check('S7 Ctrl+Z 한 번으로 원래대로', await page.evaluate(() => T.html()), html);
});

await withPage(async (page) => {
  await openShape(page, '<p>전화 010-1234-5678, 010-9876-5432</p>', '010-1234-5678');
  await typeReplacement(page, '01012345678');
  await page.click('[data-find="replace-all"]');
  r.check('S8 붙여 써도 각 번호를 유지', await page.evaluate(() => T.text()), '전화 01012345678, 01098765432');
});

await withPage(async (page) => {
  await openShape(page, '<p>2024년 3월 15일 / 2025년 11월 2일</p>', '2024년 3월 15일');
  await typeReplacement(page, '15/3/2024');
  await page.click('[data-find="replace-all"]');
  r.check('S9 순서를 바꿔도 따라감', await page.evaluate(() => T.text()), '15/3/2024 / 2/11/2025');
});

console.log('\n--- 비슷한 모양: 첨자와 LaTeX ---');

await withPage(async (page) => {
  const html = '<p>x^2 + y^2 = r^2, 10^-3, a^(n+1), e^{2x}, ^^ ^_^</p>';
  await openShape(page, html, 'x^2');
  const opened = await state(page);
  r.check('S10 기본값은 유니코드 위첨자', opened.replace, 'x²');
  r.check('S10 찾을 내용의 ^^는 ^로 보여 줌', await page.inputValue('#findText'), 'x^2');
  r.check('S11 ^ 기호 개수(이모티콘 제외)', opened.count, '6개');
  await page.click('[data-find="replace-all"]');
  r.check('S12 위첨자로 바꿈', await page.evaluate(() => T.text()), 'x² + y² = r², 10⁻³, aⁿ⁺¹, e²ˣ, ^^ ^_^');
});

await withPage(async (page) => {
  const html = '<p>H_2SO_4, CO_2, a_n, x_{10}, my_file_v2.txt, data_2024, https://a.com/b_1 ㅠ_ㅠ</p>';
  await openShape(page, html, 'H_2SO_4');
  r.check('S13 기본값은 아래첨자', (await state(page)).replace, 'H₂SO₄');
  r.check('S13 검색 결과는 기호가 붙은 낱말 전체', await results(page),
    ['H_2SO_4 → H₂SO₄', 'CO_2 → CO₂', 'a_n → aₙ', 'x_{10} → x₁₀']);
  await page.click('[data-find="replace-all"]');
  r.check('S14 이름·주소·이모티콘은 그대로', await page.evaluate(() => T.text()),
    'H₂SO₄, CO₂, aₙ, x₁₀, my_file_v2.txt, data_2024, https://a.com/b_1 ㅠ_ㅠ');
});

await withPage(async (page) => {
  await openShape(page, '<p>\\alpha + \\beta \\leq \\infty, x \\in A, \\foo</p>', '\\alpha');
  r.check('S15 LaTeX 기본값', (await state(page)).replace, 'α');
  await page.click('[data-find="replace-all"]');
  r.check('S16 LaTeX 기호로 바꿈(\\infty와 \\in 구분, 모르는 명령어 유지)',
    await page.evaluate(() => T.text()), 'α + β ≤ ∞, x ∈ A, \\foo');
});

await withPage(async (page) => {
  await openShape(page, '<p>물은 H_2O이고 황산은 H_2SO_4를</p>', 'H_2O');
  r.check('S16 한글 조사는 낱말에 넣지 않음', await results(page), ['H_2O → H₂O', 'H_2SO_4 → H₂SO₄']);
  await page.click('[data-find="replace-all"]');
  r.check('S16 낱말 단위로 바꿔도 조사는 그대로', await page.evaluate(() => T.text()), '물은 H₂O이고 황산은 H₂SO₄를');
});

await withPage(async (page) => {
  await openShape(page, '<p>x^2 + 10^-3</p>', 'x^2');
  await typeReplacement(page, 'x**2');
  r.check('S17 바꿀 모양을 글자로 고친 검색 결과', await results(page), ['x^2 → x**2', '10^-3 → 10**-3']);
  await page.click('[data-find="replace-all"]');
  r.check('S18 고친 모양대로 바꿈', await page.evaluate(() => T.text()), 'x**2 + 10**-3');
});

await withPage(async (page) => {
  const html = '<p>x^2 + 10^-3</p>';
  await openShape(page, html, 'x^2');
  await typeReplacement(page, 'y²');
  r.check('S19 예시 앞 글자를 고치면 안내', (await state(page)).warning,
    '예시의 앞뒤 글자는 그대로 두고 바뀌는 부분만 고쳐 주세요.');
  r.check('S19 읽을 수 없으면 검색 결과에 바뀔 모양 없음', await results(page), ['x^2', '10^-3']);
  await page.click('[data-find="replace-all"]');
  r.check('S20 읽을 수 없는 모양은 바꾸지 않음', await page.evaluate(() => T.html()), html);
});

console.log('\n--- 비슷한 모양: 숫자 자리 읽기 ---');

// 예시를 고르고 바꿀 내용을 넣은 뒤 모두 바꾼 결과
async function replaceShape(page, html, example, replacement) {
  await openShape(page, html, example);
  if (replacement !== undefined) await typeReplacement(page, replacement);
  await page.click('[data-find="replace-all"]');
  return page.evaluate(() => T.text());
}

const shapeCases = [
  ['S27 0 채운 예시를 0 빼고 쓰면 모두 0을 뺌', '<p>2024-03-15, 2025-11-02, 2025-12-01 끝</p>', '2024-03-15', '2024.3.15',
    '2024.3.15, 2025.11.2, 2025.12.1 끝'],
  ['S28 연도를 두 자리로 쓰면 일치마다 끝 두 자리', '<p>2024년 3월 15일, 2025년 11월 2일, 1999년 1월 1일 끝</p>', '2024년 3월 15일', '24.3.15',
    '24.3.15, 25.11.2, 99.1.1 끝'],
  ['S29 앞자리가 같은 숫자의 순서 바꾸기', '<p>1번 12번, 3번 45번 끝</p>', '1번 12번', '12번 1번', '12번 1번, 45번 3번 끝'],
  ['S30 같은 숫자 두 개', '<p>1월 1일, 12월 25일 끝</p>', '1월 1일', '1/1', '1/1, 12/25 끝'],
  ['S31 0을 채운 예시를 그대로 두면 0을 채움', '<p>2024-03-15, 2025-1-2 끝</p>', '2024-03-15', '2024/03/15', '2024/03/15, 2025/01/02 끝'],
  ['S32 묶은 지수를 글자 모양으로 바꾸면 괄호 유지', '<p>x^2, a^(n+1), e^{2x}, 10^-3 끝</p>', 'x^2', 'x**2',
    'x**2, a**(n+1), e**(2x), 10**-3 끝'],
  ['S33 묶은 예시를 따라 쓴 괄호는 숫자 하나에 붙이지 않음', '<p>a^(n+1), x^2 끝</p>', 'a^(n+1)', 'a**(n+1)', 'a**(n+1), x**2 끝'],
  ['S34 첨자 문자가 없어도 글자 모양이면 바꿈', '<p>x^2, x^q 끝</p>', 'x^2', 'x**2', 'x**2, x**q 끝'],
  ['S35 첨자 문자가 없는 예시', '<p>x^q, y^2 끝</p>', 'x^q', 'x**q', 'x**q, y**2 끝'],
  ['S36 짧은 변수 이름과 이모티콘은 그대로', '<p>user_id_2, my_1, o_o, x_ab, x_1, a_n을 끝</p>', 'x_1', undefined,
    'user_id_2, my_1, o_o, x_ab, x₁, aₙ을 끝'],
  ['S37 윈도 경로의 \\는 그대로', '<p>\\alpha, C:\\Users\\pi\\Desktop, D:\\data\\in\\file.txt, src\\in\\main, x \\in A, x\\in\\mathbb{R} 끝</p>', '\\alpha', undefined,
    'α, C:\\Users\\pi\\Desktop, D:\\data\\in\\file.txt, src\\in\\main, x ∈ A, x∈\\mathbb{R} 끝'],
  ['S38 인자가 있는 명령어', '<p>\\alpha, \\sqrt{2}, \\sqrt{x+1}, \\frac{1}{2}, \\frac{\\pi}{n+1}, \\text{km} 끝</p>', '\\alpha', undefined,
    'α, √2, √(x+1), 1/2, π/(n+1), km 끝'],
  ['S39 명령어를 글자로', '<p>\\alpha, \\leq, \\sqrt{2} 끝</p>', '\\alpha', 'alpha', 'alpha, leq, sqrt{2} 끝']
];
for (const [name, html, example, replacement, expected] of shapeCases) {
  await withPage(async (page) => {
    r.check(name, await replaceShape(page, html, example, replacement), expected);
  });
}

await withPage(async (page) => {
  // 문단 끝까지 드래그하면 찾을 내용 끝에 ^p가 붙습니다.
  await openShape(page, '<p>물은 H_2O</p><p>숫자 1번</p><p>2번 끝</p>', 'H_2O');
  r.check('S40 문단 끝까지 고른 예시', [await page.inputValue('#findText'), (await state(page)).replace, (await state(page)).warning],
    ['H_2O^p', 'H₂O', null]);
  await page.click('[data-find="replace-all"]');
  r.check('S40 문단 구분은 그대로 두고 바꿈', await page.evaluate(() => T.html()), '<p>물은 H₂O</p><p>숫자 1번</p><p>2번 끝</p>');
});

await withPage(async (page) => {
  await openShape(page, '<p>값 1번</p><p>값 2번</p><p>끝</p>', '1번');
  await typeReplacement(page, '#1');
  await page.click('[data-find="replace-all"]');
  r.check('S41 문단 끝 숫자 모양도 표식 없이 바꿈', await page.evaluate(() => T.html()), '<p>값 #1</p><p>값 #2</p><p>끝</p>');
});

await withPage(async (page) => {
  await openShape(page, '<p>3번을 보고 <b>10번</b>을 본다</p>', '3번');
  await typeReplacement(page, '3호');
  await page.click('[data-find="replace-all"]');
  r.check('S42 조사는 낱말과 따로 교정', await page.evaluate(() => T.html()), '<p>3호를 보고 <b>10호</b>를 본다</p>');
});

await withPage(async (page) => {
  await openShape(page, '<p>x^2, x^q 끝</p>', 'x^2');
  await typeReplacement(page, 'x**2');
  r.check('S43 개수와 검색 결과도 바꿀 대상과 같음', [(await state(page)).count, await results(page)], ['2개', ['x^2 → x**2', 'x^q → x**q']]);
  await page.focus('#findText');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  r.check('S43 Enter 이동도 같은 대상', await page.evaluate(() => document.getElementById('findCount').textContent), '2 / 2');
});

console.log('\n--- 비슷한 모양: 찾기와 기본 상태 ---');

await withPage(async (page) => {
  await openShape(page, '<p>2024년 3월 15일, 2025년 11월 2일</p>', '2024년 3월 15일', { replace: false });
  await page.focus('#findText');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  r.check('S21 Ctrl+F에서도 다음 일치로 이동', (await state(page)).count, '2 / 2');
  r.check('S22 찾기 전용 검색 결과는 찾은 모양만 표시', await results(page), [
    '2024년 3월 15일',
    '2025년 11월 2일'
  ]);

  await page.keyboard.press('Escape');
  await page.evaluate(() => T.caretIn(0));
  await page.keyboard.press('Control+h');
  r.check('S23 다시 열면 비슷한 모양은 꺼짐', await page.isChecked('#similarShape'), false);
});

await withPage(async (page) => {
  await page.evaluate(() => T.set('<p>2024년 3월 15일</p>'));
  await page.evaluate(() => T.select('2024년 3월 15일'));
  await page.keyboard.press('Control+h');
  await page.fill('#replaceText', '직접 쓴 내용');
  await page.check('#similarShape');
  await page.uncheck('#similarShape');
  r.check('S24 끄면 자동으로 채운 내용만 지움',
    await page.inputValue('#replaceText'), '');
  await page.fill('#replaceText', '직접 쓴 내용');
  await page.fill('#findText', '2025년 1월 1일');
  await page.check('#similarShape');
  await page.fill('#replaceText', '내 모양');
  await page.fill('#findText', '2026년 1월 1일');
  r.check('S25 고쳐 쓴 바꿀 내용은 찾을 내용을 바꿔도 유지',
    await page.inputValue('#replaceText'), '내 모양');
  await page.fill('#findText', 'H_2O');
  r.check('S26 모양 종류가 바뀌면 새 기본값으로 채움',
    await page.inputValue('#replaceText'), 'H₂O');
});

await browser.close();
server.close();
process.exit(r.summary() ? 1 : 0);
