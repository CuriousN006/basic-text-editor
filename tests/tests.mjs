// 수정 사항 검증 + 침습적 변경(전체 문서 insertHTML 커밋)에 대한 회귀 검증.
import { startServer, launch, openEditor, openReplace, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();

async function withPage(opts, fn) {
  const { context, page } = await openEditor(browser, base, opts);
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

const readDownload = async (page, action) => {
  const wait = page.waitForEvent('download');
  await action();
  const download = await wait;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};

/* =================== 수정 검증 =================== */

console.log('\n--- 수정 검증 ---');

// A. 모두 바꾸기 후 실행 취소가 원본을 정확히 복원하고 주석이 남지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>one one</p>'));
  await openReplace(page, { find: 'one', replace: 'two' });
  await page.click('[data-find="replace-all"]');
  r.check('A1 모두 바꾸기 결과', await page.evaluate(() => T.text()), 'two two');
  r.check('A2 치환 직후 주석 없음', await page.evaluate(() => T.comments()), []);
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  r.check('A3 Ctrl+Z 1회로 원본 복원', await page.evaluate(() => T.text()), 'one one');
  r.check('A4 실행 취소 후에도 주석 없음', await page.evaluate(() => T.comments()), []);
  r.check('A5 실행 취소 후 HTML', await page.evaluate(() => T.html()), '<p>one one</p>');
});

// A'. 다중 문단 + 다중 일치도 한 단계로 되돌아간다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가 나 가</p><p>가</p>'));
  await openReplace(page, { find: '가', replace: 'X' });
  await page.click('[data-find="replace-all"]');
  r.check('A6 4곳 치환', await page.evaluate(() => T.text()), 'X 나 X\n\nX');
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  r.check('A7 한 번의 Ctrl+Z로 전체 복원', await page.evaluate(() => T.text()), '가 나 가\n\n가');
});

// B. 서식이 섞인 범위의 서식 제거가 실제로 적용된다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>x<b>ab</b>cd y</p>'));
  await openReplace(page, { find: 'abcd', replace: '', formats: { bold: 'remove' } });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(80);
  r.check('B1 굵게 제거됨', await page.evaluate(() => T.boldTags()), 0);
  r.check('B2 글자 보존', await page.evaluate(() => T.text()), 'x abcd y'.replace(' abcd', 'abcd'));
});

// B'. 범위 전체가 굵은 조상 안에 있을 때도 해제된다 (조상 분할).
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><b>앞 대상 뒤</b></p>'));
  await openReplace(page, { find: '대상', replace: '', formats: { bold: 'remove' } });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(80);
  r.check('B3 조상 분할 결과', await page.evaluate(() => T.html()), '<p><b>앞 </b>대상<b> 뒤</b></p>');
});

// B''. 중간 래퍼(<em>)는 보존하고 <b>만 벗긴다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><b>가<em>대상</em>나</b></p>'));
  await openReplace(page, { find: '대상', replace: '', formats: { bold: 'remove' } });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(80);
  r.check('B4 기울임 보존, 굵게만 해제',
    await page.evaluate(() => T.html()),
    '<p><b>가</b><em>대상</em><b>나</b></p>');
});

// B'''. 인라인 스타일로 표현된 굵게도 해제되며 다른 스타일은 유지된다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><span style="font-weight:700;color:rgb(255, 0, 0)">대상</span></p>'));
  await openReplace(page, { find: '대상', replace: '', formats: { bold: 'remove' } });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(80);
  const html = await page.evaluate(() => T.html());
  r.check('B5 font-weight 제거', /font-weight/.test(html), false, html);
  r.check('B6 color 유지', /color/.test(html), true, html);
});

// B''''. 서식 적용도 문단을 넘어 감싸지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>대상</p><p>대상</p>'));
  await openReplace(page, { find: '대상', replace: '', formats: { italic: 'apply' } });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(80);
  r.check('B7 문단별로 서식 적용',
    await page.evaluate(() => T.html()),
    '<p><i>대상</i></p><p><i>대상</i></p>');
});

// C. 드래그 선택 후 바꾸기가 다음 일치로 진행한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>one X one</p>'));
  await openReplace(page, { find: 'one', replace: 'one two' });
  await page.evaluate(() => T.select('one'));
  await page.click('[data-find="replace"]');
  await page.waitForTimeout(100);
  r.check('C1 첫 일치 치환', await page.evaluate(() => T.text()), 'one two X one');
  await page.click('[data-find="replace"]');
  await page.waitForTimeout(100);
  r.check('C2 두 번째 일치로 진행', await page.evaluate(() => T.text()), 'one two X one two');
});

// D. 새 문서가 초안을 지운다.
await withPage({}, async (page) => {
  await page.click('#editor');
  await page.keyboard.type('원고');
  await page.waitForTimeout(900);
  await page.click('[data-action="new"]');
  await page.waitForTimeout(200);
  r.check('D1 새 문서 후 초안 삭제', await page.evaluate(() => T.draft()), null);
});

// E. 다운로드를 확인할 수 없으면 초안을 남긴다.
await withPage({ noFilePicker: true, blockDownloads: true }, async (page) => {
  await page.click('#editor');
  await page.keyboard.type('원고');
  await page.waitForTimeout(900);
  await page.click('[data-action="save-html"]');
  await page.waitForTimeout(200);
  r.check('E1 초안 유지', await page.evaluate(() => T.draft()), '<p>원고</p>');
});
await withPage({ seedDraft: '<p>복구 대상</p>' }, async (page) => {
  r.check('E2 초안 복원', await page.evaluate(() => T.text()), '복구 대상');
  r.check('E3 복원 사실을 알린다', await page.evaluate(() => T.toast()), '저장하지 않은 내용을 복구했습니다.');
});

// F~I
await withPage({}, async (page) => {
  await page.setInputFiles('#fileInput', {
    name: 'a.md', mimeType: 'text/markdown', buffer: Buffer.from('시작 `$&` 끝\n'),
  });
  await page.waitForTimeout(200);
  r.check('F1 코드 스팬의 $& 보존', (await page.evaluate(() => T.text())).trim(), '시작 $& 끝');
});
await withPage({ promptAnswer: 'https://' }, async (page) => {
  await page.evaluate(() => T.set('<p>대상</p>'));
  await page.evaluate(() => T.select('대상'));
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(150);
  r.check('G1 스킴만 있는 주소 거부', await page.evaluate(() => T.html()), '<p>대상</p>');
});
await withPage({ promptAnswer: 'https://example.com/a' }, async (page) => {
  await page.evaluate(() => T.set('<p>대상</p>'));
  await page.evaluate(() => T.select('대상'));
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(150);
  r.check('G2 정상 주소는 링크 생성',
    await page.evaluate(() => T.html()), '<p><a href="https://example.com/a">대상</a></p>');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>한 문단뿐</p>'));
  await page.click('[data-action="find"]');
  await page.fill('#findText', '없음^p또없음');
  await page.click('[data-find="next"]');
  await page.waitForTimeout(150);
  r.check('H1 특수기호 검색 실패 안내', await page.evaluate(() => T.toast()), '찾을 수 없습니다');
});
await withPage({ noFilePicker: true }, async (page) => {
  await page.evaluate(() => T.set('<h4>소제목</h4><ul><li>바깥<ul><li>안쪽</li></ul></li><li>둘째</li></ul>'));
  const md = (await readDownload(page, () => page.click('[data-action="save-md"]'))).toString();
  r.check('I1 h4 + 중첩 목록 마크다운', md, '#### 소제목\n\n- 바깥\n  - 안쪽\n- 둘째\n');
});

// 보안: 제어문자를 끼운 javascript: 와 form 제거
await withPage({}, async (page) => {
  await page.setInputFiles('#fileInput', {
    name: 'x.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<p><a href="java&#9;script:alert(1)">a</a>'
      + '<a href="javascript:alert(2)">b</a>'
      + '<a href="https://ok.example/">c</a>'
      + '<img src="data:image/png;base64,iVBORw0KGgo=">'
      + '<form action="https://x/"><button formaction="javascript:alert(3)">go</button></form></p>'),
  });
  await page.waitForTimeout(200);
  const html = await page.evaluate(() => T.html());
  r.check('S1 제어문자 javascript: 제거', /script:/i.test(html), false, html);
  r.check('S2 form 제거', /<form/i.test(html), false, html);
  r.check('S3 정상 링크 유지', /https:\/\/ok\.example\//.test(html), true, html);
  r.check('S4 인라인 이미지 유지', /data:image\/png/.test(html), true, html);
});

/* =================== 회귀 검증 =================== */

console.log('\n--- 회귀 검증 (전체 문서 커밋이 구조를 보존하는지) ---');

// 표·목록·제목·링크·빈 줄이 섞인 문서에서 한 단어만 바꿔도 구조가 유지되어야 한다.
await withPage({}, async (page) => {
  const source = '<h1>제목 대상</h1>'
    + '<p class="blank-line"><br></p>'
    + '<p>본문 <b>굵게</b> <i>기울임</i> <a href="https://e.example/">링크</a></p>'
    + '<ul><li>항목1</li><li>항목2</li></ul>'
    + '<ol><li>번호1</li></ol>'
    + '<blockquote>인용</blockquote>'
    + '<pre><code>코드 블록</code></pre>'
    + '<table><tbody><tr><th>머리</th><td>셀</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>'
    + '<hr>';
  await page.evaluate((html) => T.set(html), source);
  await openReplace(page, { find: '대상', replace: '치환' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => T.html());
  r.check('R1 치환 적용', /제목 치환/.test(after), true);
  r.check('R2 표 유지', await page.evaluate(() => T.ed().querySelectorAll('table th,table td').length), 4);
  r.check('R3 목록 유지', await page.evaluate(() => T.ed().querySelectorAll('ul>li,ol>li').length), 3);
  r.check('R4 제목/인용/코드 유지',
    await page.evaluate(() => [...T.ed().querySelectorAll('h1,blockquote,pre')].map((e) => e.tagName)),
    ['H1', 'BLOCKQUOTE', 'PRE']);
  r.check('R5 링크 유지', await page.evaluate(() => T.ed().querySelector('a')?.getAttribute('href')), 'https://e.example/');
  r.check('R6 빈 줄 문단 유지', await page.evaluate(() => T.ed().querySelectorAll('p.blank-line').length), 1);
  r.check('R7 구분선 유지', await page.evaluate(() => T.ed().querySelectorAll('hr').length), 1);
  r.check('R8 굵게/기울임 유지',
    await page.evaluate(() => [T.ed().querySelectorAll('b').length, T.ed().querySelectorAll('i').length]),
    [1, 1]);
});

// 치환 문자열이 주변 서식을 물려받아야 한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><b>앞대상뒤</b></p>'));
  await openReplace(page, { find: '대상', replace: '새말' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R9 서식 상속', await page.evaluate(() => T.html()), '<p><b>앞새말뒤</b></p>');
});

// ^p 로 문단 나누기
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가|나</p>'));
  await openReplace(page, { find: '|', replace: '^p' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R10 ^p 문단 분리', await page.evaluate(() => T.html()), '<p>가</p><p>나</p>');
});

// ^l 로 줄바꿈
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가|나</p>'));
  await openReplace(page, { find: '|', replace: '^l' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  // 이 편집기의 Shift+Enter는 pre-wrap 때문에 <br>이 아니라 개행 문자를 만든다.
  r.check('R11 ^l 줄바꿈(Shift+Enter와 같은 형태)',
    await page.evaluate(() => T.html()), '<p>가\n나</p>');
});

// ^p 를 찾아 문단 합치기
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가</p><p>나</p>'));
  await openReplace(page, { find: '^p', replace: '-' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R12 ^p 검색 후 치환', await page.evaluate(() => T.text()), '가-나');
});

// 조사 자동 교정: 모두 바꾸기와 단일 바꾸기가 같은 결과여야 한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>사과를 먹다</p>'));
  await openReplace(page, { find: '사과', replace: '책' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R13 조사 교정(모두)', await page.evaluate(() => T.text()), '책을 먹다');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>사과를 먹다</p>'));
  await openReplace(page, { find: '사과', replace: '책' });
  await page.evaluate(() => T.select('사과'));
  await page.click('[data-find="replace"]');
  await page.waitForTimeout(120);
  r.check('R14 조사 교정(단일)', await page.evaluate(() => T.text()), '책을 먹다');
});
// 조사가 다른 서식 안에 있어도 단일/모두가 일치해야 한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><b>사과</b>를 먹다</p>'));
  await openReplace(page, { find: '사과', replace: '책' });
  await page.evaluate(() => T.select('사과'));
  await page.click('[data-find="replace"]');
  await page.waitForTimeout(120);
  r.check('R15 서식 경계 넘는 조사 교정(단일)', await page.evaluate(() => T.text()), '책을 먹다');
});

// 일치가 없으면 문서를 건드리지 않는다 (불필요한 실행 취소 단계도 만들지 않는다).
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>내용</p>'));
  await openReplace(page, { find: '없는말', replace: 'X' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R16 무일치 시 문서 불변', await page.evaluate(() => T.html()), '<p>내용</p>');
  r.check('R17 무일치 안내', await page.evaluate(() => T.toast()), '0개 항목을 바꿨습니다.');
});

// 붙여넣기 경로가 계속 동작한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await page.evaluate(() => {
    T.ed().focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '첫 줄\n둘째 줄');
    T.ed().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  r.check('R18 여러 줄 붙여넣기(줄마다 문단)', await page.evaluate(() => T.html()), '<p>첫 줄</p><p>둘째 줄</p>');
});

// 마크다운 왕복
await withPage({ noFilePicker: true }, async (page) => {
  const md = '# 제목\n\n본문 **굵게** *기울임*\n\n- 하나\n- 둘\n\n> 인용\n\n```\n코드\n```\n';
  await page.setInputFiles('#fileInput', { name: 'a.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await page.waitForTimeout(200);
  const out = (await readDownload(page, () => page.click('[data-action="save-md"]'))).toString();
  r.check('R19 마크다운 왕복', out.replace(/\n{3,}/g, '\n\n').trim(), md.trim());
});

// DOCX 저장이 유효한 zip 인지 (로컬 파일 헤더 + 필수 파트)
await withPage({ noFilePicker: true }, async (page) => {
  await page.evaluate(() => T.set('<h1>제목</h1><p>본문 <b>굵게</b></p><ul><li>항목</li></ul>'
    + '<table><tbody><tr><th>머리</th><td>셀</td></tr></tbody></table>'));
  const buf = await readDownload(page, () => page.click('[data-action="save-docx"]'));
  r.check('R20 DOCX zip 서명', buf.subarray(0, 4).toString('hex'), '504b0304');
  const text = buf.toString('latin1');
  r.check('R21 DOCX 필수 파트', ['word/document.xml', 'word/styles.xml', 'word/numbering.xml']
    .every((n) => text.includes(n)), true);
});

// HTML 저장 결과가 정상 파싱되고 스크립트가 없어야 한다.
await withPage({ noFilePicker: true }, async (page) => {
  await page.evaluate(() => T.set('<p>본문 <a href="https://e.example/">링크</a></p>'));
  const html = (await readDownload(page, () => page.click('[data-action="save-html"]'))).toString();
  r.check('R22 저장 HTML에 내용 포함', /https:\/\/e\.example\//.test(html), true);
  r.check('R23 저장 HTML에 스크립트 없음', /<script/i.test(html), false);
});

// 편집기 기본 동작: 입력 후 글자 수 갱신, 실행 취소
await withPage({}, async (page) => {
  await page.click('#editor');
  await page.keyboard.type('abc');
  await page.waitForTimeout(150);
  r.check('R24 글자 수 표시', await page.evaluate(() => document.getElementById('count').textContent), '3자 · 1단어');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  r.check('R25 일반 입력 실행 취소 동작', /^(ab|)$/.test(await page.evaluate(() => T.text())), true,
    '브라우저 기본 실행 취소 단위에 따라 ab 또는 빈 문자열');
});

// 표 삽입
await withPage({}, async (page) => {
  await page.click('#editor');
  await page.click('[data-action="table"]');
  await page.fill('#tableRows', '3');
  await page.fill('#tableColumns', '2');
  await page.click('[data-table-action="insert"]');
  await page.waitForTimeout(150);
  r.check('R26 표 삽입', await page.evaluate(() => {
    const t = T.ed().querySelector('table');
    return t ? [t.rows.length, t.rows[0].cells.length] : null;
  }), [3, 2]);
});

// 블록 병합 경계 사례
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<h1>제목</h1><p>본문</p>'));
  await openReplace(page, { find: '^p', replace: ' — ' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R27 제목+문단 병합은 앞 블록을 따른다',
    await page.evaluate(() => T.html()), '<h1>제목 — 본문</h1>');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<ul><li>하나</li><li>둘</li></ul>'));
  await openReplace(page, { find: '^p', replace: '/' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R28 목록 항목 병합', await page.evaluate(() => T.html()), '<ul><li>하나/둘</li></ul>');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가</p><ul><li>항목</li></ul>'));
  await openReplace(page, { find: '^p', replace: '·' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R29 문단+목록 병합 후 빈 목록 껍데기 제거',
    await page.evaluate(() => T.ed().querySelectorAll('ul').length), 0,
    await page.evaluate(() => T.html()));
});
// 빈 문단을 사이에 둔 치환에서 자리표시 br이 남지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가</p><p class="blank-line"><br></p><p>나</p>'));
  await openReplace(page, { find: '가', replace: '다' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R30 빈 줄 보존',
    await page.evaluate(() => T.html()),
    '<p>다</p><p class="blank-line"><br></p><p>나</p>');
});
// 표 안에서의 치환
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<table><tbody><tr><td>대상</td><td>대상</td></tr></tbody></table>'));
  await openReplace(page, { find: '대상', replace: 'X' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(120);
  r.check('R31 표 셀 치환',
    await page.evaluate(() => [...T.ed().querySelectorAll('td')].map((c) => c.textContent)), ['X', 'X']);
});
// 상한 안내
await withPage({}, async (page) => {
  await page.evaluate(() => T.set(`<p>${'가'.repeat(10050)}</p>`));
  await openReplace(page, { find: '가', replace: '나' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(2000);
  const toast = await page.evaluate(() => T.toast());
  r.check('R32 상한 도달을 알린다', /한 번에 10,000개까지만/.test(toast), true, toast);
});

console.log('\n--- 붙여넣기 ---');

// 실제 Ctrl+Shift+V 키 입력은 브라우저 자체 붙여넣기를 먼저 발생시켜
// 요청 표시를 소비하므로, 테스트에서는 keydown만 합성해 분리한다.
const pasteInto = async (page, { html = '', text = '', plain = false } = {}) => {
  await page.evaluate(({ h, t, p }) => {
    if (p) {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        ctrlKey: true, shiftKey: true, key: 'V', bubbles: true,
      }));
    }
    const dt = new DataTransfer();
    if (t) dt.setData('text/plain', t);
    if (h) dt.setData('text/html', h);
    T.ed().focus();
    T.ed().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { h: html, t: text, p: plain });
  await page.waitForTimeout(150);
};

const RICH_SOURCE = '<p>첫 문단에 <b>굵게</b>와 <a href="https://example.com/a">링크</a>가 있습니다.</p>'
  + '<p>둘째 문단은 <em>기울임</em>과 <span style="text-decoration:line-through">취소선</span>.</p>'
  + '<p>셋째 줄<br>같은 문단 안 줄바꿈</p>';

// P1. Ctrl+V는 인라인 서식을 유지하고 줄 구조는 다시 계산한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteInto(page, { html: RICH_SOURCE, text: '무시되는 평문' });
  r.check('P1 문단 수', await page.evaluate(() => T.ed().querySelectorAll('p').length), 3);
  r.check('P2 서식 경계가 새지 않는다',
    await page.evaluate(() => T.ed().querySelector('p').innerHTML),
    '첫 문단에 <b>굵게</b>와 <a href="https://example.com/a">링크</a>가 있습니다.');
  r.check('P3 기울임·취소선 유지',
    await page.evaluate(() => [
      T.ed().querySelectorAll('i,em').length,
      T.ed().querySelectorAll('s,strike,del').length,
    ]), [1, 1]);
  r.check('P4 문단 안 줄바꿈 유지',
    await page.evaluate(() => T.ed().querySelectorAll('p')[2].textContent),
    '셋째 줄\n같은 문단 안 줄바꿈');
  r.check('P5 붙여넣은 뒤 빈 문단이 생기지 않는다',
    await page.evaluate(() => T.ed().querySelectorAll('p').length), 3);
});

// P6. Ctrl+Shift+V는 서식을 버린다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteInto(page, { html: RICH_SOURCE, text: '무시되는 평문', plain: true });
  r.check('P6 서식 태그 없음',
    await page.evaluate(() => T.ed().querySelectorAll('b,strong,i,em,u,s,strike,del,a').length), 0,
    await page.evaluate(() => T.html()));
  r.check('P7 줄 구조는 그대로',
    await page.evaluate(() => T.ed().querySelectorAll('p').length), 3);
});

// P8. 글꼴·글자 크기·색 같은 외부 서식은 가져오지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteInto(page, {
    html: '<p style="font-family:Impact;font-size:32px">'
      + '<span style="color:red;font-size:40px">색과 크기</span> 그리고 <b>굵게</b></p>',
    text: '색과 크기 그리고 굵게',
  });
  const html = await page.evaluate(() => T.html());
  r.check('P8 외부 글꼴·색 미반영', /font-family|font-size|color/.test(html), false, html);
  r.check('P9 굵게는 유지', /<b>/.test(html), true, html);
});

// P10. 문단 중간에 붙여넣으면 그 자리에 들어간다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞뒤</p>'));
  await page.evaluate(() => {
    const node = T.ed().querySelector('p').firstChild;
    const range = document.createRange();
    range.setStart(node, 1);
    range.collapse(true);
    T.ed().focus();
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
  });
  await pasteInto(page, { html: '<p><b>굵은</b>것</p>', text: '굵은것' });
  r.check('P10 문단 중간 삽입', await page.evaluate(() => T.html()), '<p>앞<b>굵은</b>것뒤</p>');
});

// P11. 평문만 있는 클립보드는 공백을 그대로 보존한다(기존 동작).
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteInto(page, { text: '가  나 다' });
  r.check('P11 평문 연속 공백 보존', await page.evaluate(() => T.html()), '<p>가  나 다</p>');
});

// P12. 위험한 주소는 링크로 만들지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteInto(page, {
    html: '<p><a href="javascript:alert(1)">위험</a> <a href="https://ok.example/">정상</a></p>',
    text: '위험 정상',
  });
  const html = await page.evaluate(() => T.html());
  r.check('P12 javascript: 링크 제거', /javascript:/i.test(html), false, html);
  r.check('P13 정상 링크 유지', /https:\/\/ok\.example\//.test(html), true, html);
});

// P14. 서식 유지 붙여넣기도 실행 취소된다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>원본</p>'));
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(T.ed().querySelector('p'));
    range.collapse(false);
    T.ed().focus();
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
  });
  await pasteInto(page, { html: '<p><b>굵게</b></p>', text: '굵게' });
  r.check('P14 붙여넣기 결과', await page.evaluate(() => T.html()), '<p>원본<b>굵게</b></p>');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  r.check('P15 실행 취소', await page.evaluate(() => T.text()), '원본');
});

// P16. URL 단독/선택 영역 붙여넣기 동작은 그대로.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteInto(page, { text: 'https://example.com/x' });
  r.check('P16 URL 단독 붙여넣기는 링크',
    await page.evaluate(() => T.ed().querySelector('a')?.getAttribute('href')),
    'https://example.com/x');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>대상</p>'));
  await page.evaluate(() => T.select('대상'));
  await pasteInto(page, { text: 'https://example.com/y' });
  r.check('P17 선택 위에 URL 붙여넣기는 링크로 감쌈',
    await page.evaluate(() => T.html()),
    '<p><a href="https://example.com/y">대상</a></p>');
});

console.log('\n--- 실행 취소 메커니즘 ---');

// U1. 일괄 편집 되돌리기 후 다시 실행
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<h1>제목</h1><p>가 가</p>'));
  await openReplace(page, { find: '가', replace: '나' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(100);
  r.check('U1 치환 결과', await page.evaluate(() => T.html()), '<h1>제목</h1><p>나 나</p>');
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  r.check('U2 되돌리기로 구조까지 복원', await page.evaluate(() => T.html()), '<h1>제목</h1><p>가 가</p>');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(100);
  r.check('U3 다시 실행', await page.evaluate(() => T.html()), '<h1>제목</h1><p>나 나</p>');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  r.check('U4 Ctrl+Shift+Z 중복 실행은 무해', await page.evaluate(() => T.html()), '<h1>제목</h1><p>나 나</p>');
});

// U5. 일괄 편집 후 사용자가 입력하면, 먼저 사용자 입력이 취소되고 그 다음 일괄 편집이 취소된다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가</p>'));
  await openReplace(page, { find: '가', replace: '나' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const ed = T.ed();
    ed.focus();
    const r2 = document.createRange();
    r2.selectNodeContents(ed.firstElementChild);
    r2.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r2);
  });
  await page.keyboard.type('XYZ');
  await page.waitForTimeout(150);
  r.check('U5 입력 후 상태', await page.evaluate(() => T.text()), '나XYZ');
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(70);
    if (await page.evaluate(() => T.text()) === '나') break;
  }
  r.check('U6 사용자 입력이 먼저 취소됨', await page.evaluate(() => T.text()), '나');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  r.check('U7 이어서 일괄 편집이 취소됨', await page.evaluate(() => T.text()), '가');
});

// U8. 서식만 바꾸는 일괄 편집도 되돌릴 수 있다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>x<b>ab</b>cd y</p>'));
  await openReplace(page, { find: 'abcd', replace: '', formats: { bold: 'remove' } });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(100);
  r.check('U8 서식 제거 적용', await page.evaluate(() => T.boldTags()), 0);
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  r.check('U9 서식 제거 되돌리기', await page.evaluate(() => T.html()), '<p>x<b>ab</b>cd y</p>');
});

// U10. 되돌리기 버튼도 같은 경로를 쓴다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가 가</p>'));
  await openReplace(page, { find: '가', replace: '나' });
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(100);
  await page.click('[data-command="undo"]');
  await page.waitForTimeout(100);
  r.check('U10 툴바 되돌리기 버튼', await page.evaluate(() => T.html()), '<p>가 가</p>');
});

const failed = r.summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
