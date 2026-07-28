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
  r.check('R25 일반 입력 실행 취소 동작',
    await page.evaluate(() => T.ed().textContent), '');
});

// Ctrl+H를 열면 찾을 내용에서 Tab 한 번으로 바꿀 내용으로 이동한다.
await withPage({}, async (page) => {
  await page.keyboard.press('Control+h');
  r.check('R25 Ctrl+H 최초 포커스',
    await page.evaluate(() => document.activeElement?.id), 'findText');
  await page.keyboard.press('Tab');
  r.check('R25 찾기 다음 Tab은 바꾸기',
    await page.evaluate(() => document.activeElement?.id), 'replaceText');
  r.check('R25 조사 자동 교정은 바꿀 내용 아래',
    await page.evaluate(() => document.getElementById('replaceRow').nextElementSibling?.id),
    'particleOption');
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
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  r.check('R26 표 삽입 취소', await page.evaluate(() => T.ed().querySelectorAll('table').length), 0);
  await page.keyboard.press('Control+y');
  r.check('R26 표 삽입 다시 실행', await page.evaluate(() => T.ed().querySelectorAll('table').length), 1);
});
await withPage({}, async (page) => {
  await page.evaluate(() => {
    T.set('<table><tbody><tr><td>A</td></tr></tbody></table>');
    const cell = T.ed().querySelector('td');
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    T.ed().focus();
  });
  await page.keyboard.press('Tab');
  r.check('R26 마지막 셀 Tab으로 행 추가',
    await page.evaluate(() => T.ed().querySelector('table').rows.length), 2);
  await page.keyboard.press('Control+z');
  r.check('R26 Tab 행 추가 취소',
    await page.evaluate(() => T.ed().querySelector('table').rows.length), 1);
  await page.keyboard.press('Control+y');
  r.check('R26 Tab 행 추가 다시 실행',
    await page.evaluate(() => T.ed().querySelector('table').rows.length), 2);
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

console.log('\n--- 붙여넣기 (실제 클립보드 + 실제 키 입력) ---');

// 합성 ClipboardEvent는 브라우저가 실제로 넘겨주는 클립보드 내용을 재현하지
// 못한다. 태그 사이 개행, 인라인 스타일 덩어리, 래퍼 요소가 모두 빠지기 때문에
// 실제로 깨지는 경우를 하나도 못 잡는다. 그래서 진짜 클립보드에 쓰고 진짜
// Ctrl+V / Ctrl+Shift+V 를 누른다.
const pasteReal = async (page, { html = '', text = '', plain = false, blockIndex = 0, atEnd = true } = {}) => {
  await page.evaluate(({ h, t }) => T.writeClipboard(h, t), { h: html, t: text });
  await page.evaluate(({ i, e }) => T.caretIn(i, e), { i: blockIndex, e: atEnd });
  if (plain) {
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
  } else {
    await page.keyboard.press('Control+v');
  }
  await page.waitForTimeout(250);
};

// Word가 내놓는 형태에 가깝게 태그 사이에 개행과 들여쓰기가 있다.
const WORD_CLIP = `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><style>p.MsoNormal{margin:0}</style></head>
<body lang="KO">

<p class="MsoNormal">첫 문단에 <b>굵게</b>와 <span style='font-style:italic'>기울임</span>이 있습니다.<o:p></o:p></p>

<p class="MsoNormal">둘째 문단입니다.<o:p></o:p></p>

</body>
</html>`;
const WORD_TEXT = '첫 문단에 굵게와 기울임이 있습니다.\r\n둘째 문단입니다.';

// P1. Ctrl+V: 인라인 서식 유지 + 태그 사이 공백이 빈 줄로 늘어나지 않음
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: WORD_CLIP, text: WORD_TEXT });
  r.check('P1 문단 구성(빈 줄 없음)', await page.evaluate(() => T.blocks()), 'P P');
  r.check('P2 결과 HTML',
    await page.evaluate(() => T.html()),
    '<p>첫 문단에 <b>굵게</b>와 <i>기울임</i>이 있습니다.</p><p>둘째 문단입니다.</p>');
  r.check('P3 인라인 스타일이 아니라 태그로 표현',
    /style=/.test(await page.evaluate(() => T.html())), false);
});

// P4. Ctrl+Shift+V: 서식 없음, 줄 구조는 동일
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: WORD_CLIP, text: WORD_TEXT, plain: true });
  r.check('P4 서식 태그 없음', await page.evaluate(() => T.formatTags()), 0,
    await page.evaluate(() => T.html()));
  r.check('P5 줄 구조 동일', await page.evaluate(() => T.blocks()), 'P P');
});

// P6. Google 문서의 <b style="font-weight:normal"> 래퍼에 속지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, {
    html: '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1">'
      + '<p dir="ltr"><span style="font-weight:400">보통 글자와 </span>'
      + '<span style="font-weight:700">굵은 글자</span></p></b>',
    text: '보통 글자와 굵은 글자',
  });
  r.check('P6 래퍼 때문에 전체가 굵어지지 않는다',
    await page.evaluate(() => T.html()), '<p>보통 글자와 <b>굵은 글자</b></p>');
});

// P7. 이 편집기에서 복사한 내용을 다시 붙여넣기 (빈 줄 포함)
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가 <b>굵게</b></p><p class="blank-line"><br></p><p>나</p>'));
  await page.evaluate(() => {
    const e = T.ed();
    e.focus();
    const range = document.createRange();
    range.selectNodeContents(e);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
  });
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  await page.evaluate(() => T.set('<p><br></p>'));
  await page.evaluate(() => T.caretIn(0, true));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
  r.check('P7 빈 줄이 서식 껍데기 없이 유지된다',
    await page.evaluate(() => T.html()), '<p>가 <b>굵게</b></p><p><br></p><p>나</p>');
  r.check('P8 굵게 하나만', await page.evaluate(() => T.boldTags()), 1);
});

// P9. 글꼴·크기·색은 가져오지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, {
    html: '<p style="font-family:Impact;font-size:32px">'
      + '<span style="color:red;font-size:40px">색과 크기</span> 그리고 <b>굵게</b></p>',
    text: '색과 크기 그리고 굵게',
  });
  const html = await page.evaluate(() => T.html());
  r.check('P9 외부 글꼴·색 미반영', /font-family|font-size|color/.test(html), false, html);
  r.check('P10 굵게는 유지', /<b>/.test(html), true, html);
});

// P11. 중첩 서식이 인라인 스타일로 새지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, {
    html: '<div>가 <b>굵고 <i>기울임</i></b> 나</div>\n<div>둘째</div>',
    text: '가 굵고 기울임 나\n둘째',
  });
  const html = await page.evaluate(() => T.html());
  r.check('P11 중첩 서식이 태그로 표현', /style=/.test(html), false, html);
  r.check('P12 굵게·기울임 모두 유지',
    await page.evaluate(() => [T.ed().querySelectorAll('b').length > 0, T.ed().querySelectorAll('i').length > 0]),
    [true, true], html);
  r.check('P13 빈 줄이 끼지 않는다', await page.evaluate(() => T.blocks()), 'P P', html);
});

// P14. 문단 중간에 붙여넣기
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
  await page.evaluate(() => T.writeClipboard('<p><b>굵은</b>것</p>', '굵은것'));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
  r.check('P14 문단 중간 삽입', await page.evaluate(() => T.html()), '<p>앞<b>굵은</b>것뒤</p>');
});

// P15. 평문만 있는 클립보드는 연속 공백을 보존한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { text: '가  나 다' });
  r.check('P15 평문 연속 공백 보존', await page.evaluate(() => T.html()), '<p>가  나 다</p>');
});

// P16. 위험한 주소는 링크로 만들지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, {
    html: '<p><a href="javascript:alert(1)">위험</a> <a href="https://ok.example/">정상</a></p>',
    text: '위험 정상',
  });
  const html = await page.evaluate(() => T.html());
  r.check('P16 javascript: 링크 제거', /javascript:/i.test(html), false, html);
  r.check('P17 정상 링크 유지', /href="https:\/\/ok\.example\/"/.test(html), true, html);
});

// P18. 붙여넣기는 Ctrl+Z 한 번으로 되돌아간다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>원본</p>'));
  await pasteReal(page, { html: WORD_CLIP, text: WORD_TEXT });
  r.check('P18 붙여넣기 적용', await page.evaluate(() => T.blocks()), 'P P');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  r.check('P19 한 번의 Ctrl+Z로 복원', await page.evaluate(() => T.html()), '<p>원본</p>');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(150);
  r.check('P20 다시 실행', await page.evaluate(() => T.blocks()), 'P P');
});

// P21. 선택 영역을 덮어쓰는 붙여넣기
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞 지울것 뒤</p>'));
  await page.evaluate(() => T.writeClipboard('<p><b>새말</b></p>', '새말'));
  await page.evaluate(() => T.select('지울것'));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
  r.check('P21 선택 영역 대체', await page.evaluate(() => T.html()), '<p>앞 <b>새말</b> 뒤</p>');
});

// P22. URL 붙여넣기 동작은 그대로.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { text: 'https://example.com/x' });
  r.check('P22 URL 단독 붙여넣기는 링크',
    await page.evaluate(() => T.ed().querySelector('a')?.getAttribute('href')),
    'https://example.com/x');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>대상</p>'));
  await page.evaluate(() => T.writeClipboard('', 'https://example.com/y'));
  await page.evaluate(() => T.select('대상'));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(250);
  r.check('P23 선택 위에 URL 붙여넣기는 링크로 감쌈',
    await page.evaluate(() => T.html()),
    '<p><a href="https://example.com/y">대상</a></p>');
});

// P23a. 서식 없이 붙여넣는 URL은 자동 링크를 만들지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { text: 'https://example.com/plain', plain: true });
  r.check('P23a Ctrl+Shift+V URL은 평문',
    await page.evaluate(() => ({ text: T.text(), links: T.ed().querySelectorAll('a').length })),
    { text: 'https://example.com/plain', links: 0 });
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>대상</p>'));
  await page.evaluate(() => T.writeClipboard('', 'https://example.com/plain-selection'));
  await page.evaluate(() => T.select('대상'));
  await page.keyboard.press('Control+Shift+v');
  await page.waitForTimeout(250);
  r.check('P23a 선택 위 Ctrl+Shift+V도 평문',
    await page.evaluate(() => ({ text: T.text(), links: T.ed().querySelectorAll('a').length })),
    { text: 'https://example.com/plain-selection', links: 0 });
});

// P25. 서식 뒤의 공백이 서식에 포함되지 않는다(밑줄·취소선·링크는 공백에도 선이 보인다).
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: '<p><u>밑줄</u> <s>취소선</s></p>', text: '밑줄 취소선' });
  r.check('P25 밑줄·취소선 경계 공백', await page.evaluate(() => T.html()),
    '<p><u>밑줄</u> <s>취소선</s></p>');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: '<p><a href="https://x.example/">링크</a> 다음</p>', text: '링크 다음' });
  r.check('P26 링크 뒤 공백', await page.evaluate(() => T.html()),
    '<p><a href="https://x.example/">링크</a> 다음</p>');
});

// P27. 빈 문단의 자리표시 <br>을 줄바꿈으로 세지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: '<p>가</p><p><br></p><p>나</p>', text: '가\n\n나' });
  r.check('P27 빈 줄이 두 줄로 늘어나지 않는다', await page.evaluate(() => T.html()),
    '<p>가</p><p><br></p><p>나</p>');
});

// P28. <br>도 평문의 줄바꿈과 같게 문단이 된다. 줄 구조는 평문을 따른다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: '<p>첫<br>둘</p>', text: '첫\n둘' });
  r.check('P28 <br>도 문단으로', await page.evaluate(() => T.html()), '<p>첫</p><p>둘</p>');
});

// P32~. 줄 구조는 평문을 따른다.
// 채팅 화면 등은 평문에는 문단 사이 빈 줄이 있지만 HTML에는 <p> 두 개만 있다.
// HTML 블록만 보고 줄을 세면 빈 줄이 사라져 Ctrl+Shift+V 와 결과가 어긋난다.
const CHAT_HTML = '<p>첫 문단에 <b>굵게</b>가 있습니다.</p>\n'
  + '<p>둘째 문단입니다.</p>\n'
  + '<p>셋째 문단에 <a href="https://x.example/">링크</a>.</p>';
const CHAT_PLAIN = '첫 문단에 굵게가 있습니다.\n\n둘째 문단입니다.\n\n셋째 문단에 링크.';

await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: CHAT_HTML, text: CHAT_PLAIN });
  r.check('P32 빈 줄이 유지된다', await page.evaluate(() => T.blocks()), 'P P:빈 P P:빈 P');
  r.check('P33 서식도 함께 유지된다', await page.evaluate(() => T.html()),
    '<p>첫 문단에 <b>굵게</b>가 있습니다.</p><p><br></p><p>둘째 문단입니다.</p><p><br></p>'
    + '<p>셋째 문단에 <a href="https://x.example/">링크</a>.</p>');
});

// P34. Ctrl+V 와 Ctrl+Shift+V 의 줄 구조가 같아야 한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: CHAT_HTML, text: CHAT_PLAIN });
  const withFormat = await page.evaluate(() => T.blocks());
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: CHAT_HTML, text: CHAT_PLAIN, plain: true });
  const plainOnly = await page.evaluate(() => T.blocks());
  r.check('P34 두 붙여넣기의 줄 구조 일치', withFormat, plainOnly);
});

// P35. 평문과 HTML의 글자가 다르면 서식이 밀릴 수 있으므로 HTML 구조를 쓴다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: '<p>가 <b>굵게</b></p>', text: '전혀 다른 글' });
  r.check('P35 불일치 시 HTML 구조로 되돌아감',
    await page.evaluate(() => T.html()), '<p>가 <b>굵게</b></p>');
});

// P29. 목록은 줄 구조를 다시 계산하므로 문단이 된다(서식은 유지).
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: '<ul><li>하나</li><li>둘 <b>굵게</b></li></ul>', text: '하나\n둘 굵게' });
  r.check('P29 목록 → 문단, 서식 유지', await page.evaluate(() => T.html()),
    '<p>하나</p><p>둘 <b>굵게</b></p>');
});

// P24. 마지막 문단에 잉여 <br>이 남지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p><br></p>'));
  await pasteReal(page, { html: '<p>하나</p><p>둘</p><p>셋</p>', text: '하나\n둘\n셋' });
  r.check('P24 잉여 줄바꿈 없음', await page.evaluate(() => T.html()),
    '<p>하나</p><p>둘</p><p>셋</p>');
});

// P30~. 에디터 안에서 복사해 붙여넣을 때 서식이 유지된다.
// Range.cloneContents는 범위를 감싼 조상 태그를 포함하지 않으므로, 서식 요소의
// 일부만 선택해 복사하면 서식이 사라지던 문제가 있었다.
const copyInEditorAndPaste = async (page, html, needle) => {
  await page.evaluate((h) => T.set(h), html);
  await page.evaluate((n) => T.select(n), needle);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  await page.evaluate(() => T.set('<p><br></p>'));
  await page.evaluate(() => T.caretIn(0, true));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(280);
  return page.evaluate(() => T.html());
};

for (const [label, html, needle, expected] of [
  ['굵은 단어 전체', '<p>앞 <b>굵게</b> 뒤</p>', '굵게', '<p><b>굵게</b></p>'],
  ['굵은 단어 일부', '<p>앞 <b>굵은글자</b> 뒤</p>', '은글', '<p><b>은글</b></p>'],
  ['기울임 일부', '<p>앞 <i>기울임글자</i> 뒤</p>', '임글', '<p><i>임글</i></p>'],
  ['링크 일부', '<p>앞 <a href="https://x.example/">링크글자</a> 뒤</p>', '크글',
    '<p><a href="https://x.example/">크글</a></p>'],
  ['굵게+기울임 일부', '<p>앞 <b><i>둘다입니다</i></b> 뒤</p>', '다입', '<p><b><i>다입</i></b></p>'],
  ['서식 경계 걸침', '<p><b>굵게</b>보통<i>기울임</i></p>', '게보통기',
    '<p><b>게</b>보통<i>기</i></p>'],
]) {
  // eslint-disable-next-line no-await-in-loop
  await withPage({}, async (page) => {
    r.check(`P30 에디터 내 복붙 서식 유지 — ${label}`,
      await copyInEditorAndPaste(page, html, needle), expected);
  });
}

// P36. 에디터에서 복사한 연속 공백은 외부 HTML 편집기에서도 접히지 않아야 한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가   나</p>'));
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  const clipboard = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const html = await (await item.getType('text/html')).text();
    const plain = await (await item.getType('text/plain')).text();
    const visible = new DOMParser().parseFromString(html, 'text/html').body.textContent;
    return { plain, codes: [...visible].map((character) => character.charCodeAt(0)) };
  });
  r.check('P36 평문 클립보드는 일반 공백 유지', clipboard.plain, '가   나');
  r.check('P36 HTML 클립보드는 연속 공백을 NBSP로 보존',
    clipboard.codes, [44032, 160, 160, 160, 45208]);

  await page.evaluate(() => {
    T.set('<p><br></p>');
    T.caretIn(0, true);
  });
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(280);
  r.check('P36 에디터 재붙여넣기는 일반 공백으로 복원',
    await page.evaluate(() => [...T.ed().textContent].map((character) => character.charCodeAt(0))),
    [44032, 32, 32, 32, 45208]);
});

// 굵게 같은 인라인 서식 경계에 공백이 나뉘어도 한 연속 공백으로 계산한다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가 <b> </b> 나</p>'));
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  r.check('P37 서식 경계를 넘는 연속 공백도 NBSP',
    await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const html = await (await item.getType('text/html')).text();
      const visible = new DOMParser().parseFromString(html, 'text/html').body.textContent;
      return [...visible].map((character) => character.charCodeAt(0));
    }),
    [44032, 160, 160, 160, 45208]);
});

// P31~. 붙여넣은 뒤 커서가 붙여넣은 내용 끝에 있어야 한다(맨 앞으로 튀지 않음).
for (const [label, html, text] of [
  ['<br> 구분', '<div>가<br><br>나<br><br>다</div>', '가\n\n나\n\n다'],
  ['<p> 구분', '<p>가</p><p>나</p><p>다</p>', '가\n나\n다'],
  ['평문', '', '가\n나\n다'],
  ['서식 섞인 한 줄', '<p>가 <b>굵게</b> 나</p>', '가 굵게 나'],
]) {
  // eslint-disable-next-line no-await-in-loop
  await withPage({}, async (page) => {
    await page.evaluate(() => T.set('<p>기존</p>'));
    await pasteReal(page, { html, text });
    const [offset, total] = await page.evaluate(() => [T.caretOffset(), T.textLength()]);
    r.check(`P31 커서가 끝에 — ${label}`, offset, total,
      await page.evaluate(() => T.html()));
  });
}

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

// U11. 일반 입력 뒤에 일괄 편집을 해도 그 이전 입력까지 순서대로 취소된다.
await withPage({}, async (page) => {
  await page.evaluate(() => {
    T.set('<p><br></p>');
    T.caretIn(0, true);
  });
  await page.keyboard.type('가가');
  await openReplace(page, { find: '가', replace: '나', particles: false });
  await page.click('[data-find="replace-all"]');
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  r.check('U11 일괄 편집을 먼저 취소', await page.evaluate(() => T.text()), '가가');
  await page.keyboard.press('Control+z');
  r.check('U12 일괄 편집 전 입력도 취소', await page.evaluate(() => T.ed().textContent), '');
});

// U13. 새 입력을 취소한 뒤 다시 실행하면 과거 일괄 편집이 아니라 새 입력이 돌아온다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>가</p>'));
  await openReplace(page, { find: '가', replace: '나', particles: false });
  await page.click('[data-find="replace-all"]');
  await page.evaluate(() => T.ed().focus());
  await page.keyboard.press('Control+z');
  await page.keyboard.type('X');
  const typedHtml = await page.evaluate(() => T.html());
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  r.check('U13 최근 입력을 먼저 다시 실행', await page.evaluate(() => T.html()), typedHtml);
});

/* =================== 사용자 영역 문자 보존 =================== */

// 복사·붙여넣기는 서식을 U+E300 부터의 사용자 영역 문자로 표시한다.
// 원고에 그 구간의 문자가 들어 있으면 표식으로 오해해 글자가 사라졌다.
// 글꼴 아이콘이나 일부 이모지 세트가 실제로 쓰는 구간이므로 실제 원고에 나온다.
console.log('\n--- 사용자 영역 문자 보존 ---');

// 실제 클립보드를 거쳐 왕복시킨다. 표식은 클립보드에 쓸 때 붙고 읽을 때
// 떼어지므로, 합성 이벤트로는 이 경로를 재현할 수 없다.
const copyAllAndPaste = async (page) => {
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  await page.evaluate(() => T.set('<p><br></p>'));
  await page.evaluate(() => T.caretIn(0, true));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(280);
};

for (const [label, spec, expected] of [
  ['표식 구간 첫 문자', '<p>앞뒤</p>', '앞뒤'],
  ['표식 구간 끝 문자', '<p>앞뒤</p>', '앞뒤'],
  ['escape 문자 자체', '<p>앞뒤</p>', '앞뒤'],
  ['여러 개 섞임', '<p>가나다</p>', '가나다'],
  ['서식과 함께', '<p>앞<b>굵게</b>뒤</p>', '앞굵게뒤'],
]) {
  // eslint-disable-next-line no-await-in-loop
  await withPage({}, async (page) => {
    await page.evaluate((html) => T.set(html), spec);
    await copyAllAndPaste(page);
    r.check(`V1 왕복 후 글자 보존 — ${label}`,
      await page.evaluate(() => T.text()), expected,
      await page.evaluate(() => T.html()));
  });
}

// 표식이 살아 있어야 서식도 함께 유지된다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞<b>굵게</b>뒤</p>'));
  await copyAllAndPaste(page);
  r.check('V2 사용자 영역 문자가 있어도 굵게 유지',
    await page.evaluate(() => T.boldTags()), 1,
    await page.evaluate(() => T.html()));
});

// V3. 찾기/바꾸기의 ^p·^l 표식도 원고의 사용자 영역 문자와 충돌하지 않는다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞\uE000뒤</p><p>다음</p>'));
  await openReplace(page, { find: '^p', replace: 'X', particles: false });
  await page.click('[data-find="replace-all"]');
  r.check('V3 ^p는 실제 문단 경계만 바꿈',
    await page.evaluate(() => T.html()),
    '<p>앞\uE000뒤X다음</p>');
});
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞\uE000뒤</p><p>다음</p>'));
  await openReplace(page, { find: '\uE000', replace: 'Y', particles: false });
  await page.click('[data-find="replace-all"]');
  r.check('V4 실제 사용자 영역 문자만 찾음',
    await page.evaluate(() => T.html()),
    '<p>앞Y뒤</p><p>다음</p>');
});

/* =================== 표 칸에 붙여넣기 =================== */

// 여러 줄을 붙여넣으면 줄마다 문단을 나눈다. 그 나누기가 칸에도 적용되어
// <td>를 쪼개면 같은 행에 칸이 하나씩 늘고 표 모양이 무너졌다.
// 칸 안에서 Enter를 직접 누를 때는 칸이 늘지 않고 줄만 바뀐다.
console.log('\n--- 표 칸에 붙여넣기 ---');

const TABLE_2X2 = '<table><tbody><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></tbody></table>';

const tableShape = (page) => page.evaluate(() => {
  const table = T.ed().querySelector('table');
  return [...table.rows].map((row) => row.cells.length).join(',');
});

// 첫 칸 끝에 캐럿을 두고 실제 Ctrl+V로 붙여넣는다.
const pasteInFirstCell = async (page, clip) => {
  await page.evaluate((html) => T.set(html), TABLE_2X2);
  await page.evaluate(({ text, html }) => T.writeClipboard(html, text), clip);
  await page.evaluate(() => {
    const cell = T.ed().querySelector('td');
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    T.ed().focus();
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(280);
};

for (const [label, clip] of [
  ['두 줄 평문', { text: '첫\n둘' }],
  ['세 줄 평문', { text: '가\n나\n다' }],
  ['빈 줄 포함', { text: '가\n\n나' }],
  ['서식 있는 두 줄', { text: '첫\n둘', html: '<p><b>첫</b></p><p>둘</p>' }],
]) {
  // eslint-disable-next-line no-await-in-loop
  await withPage({}, async (page) => {
    await pasteInFirstCell(page, clip);
    r.check(`W1 칸 수가 늘지 않는다 — ${label}`, await tableShape(page), '2,2',
      await page.evaluate(() => T.html()));
  });
}

// 붙여넣은 줄은 칸 안의 줄바꿈으로 들어간다.
await withPage({}, async (page) => {
  await pasteInFirstCell(page, { text: '가\n나' });
  r.check('W2 칸 안에서 줄이 바뀐다',
    await page.evaluate(() => T.ed().querySelector('td').textContent), 'A1가\n나',
    await page.evaluate(() => T.html()));
});

// 칸 안에 문단이 있으면 그 문단은 나뉘어야 한다. 나눌 수 없는 것은 칸뿐이다.
await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<table><tbody><tr><td><p>P1</p></td><td>B1</td></tr></tbody></table>'));
  await page.evaluate(() => T.writeClipboard('', '가\n나'));
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(T.ed().querySelector('td p'));
    range.collapse(false);
    T.ed().focus();
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(280);
  r.check('W3 칸 안 문단은 나뉜다',
    await page.evaluate(() => T.ed().querySelectorAll('td p').length), 2,
    await page.evaluate(() => T.html()));
  r.check('W4 그래도 칸 수는 그대로', await tableShape(page), '2',
    await page.evaluate(() => T.html()));
});

const failed = r.summary();
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
