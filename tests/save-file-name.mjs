// 저장할 때 제안하는 파일 이름: 이름이 없는 문서는 Word처럼 첫 줄을 제목으로 쓴다.
import { startServer, launch, openEditor, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();

const readStoredZipEntry = (buffer, wantedName) => {
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    if (buffer.subarray(nameStart, nameStart + fileNameLength).toString() === wantedName) {
      return buffer.subarray(dataStart, dataStart + compressedSize);
    }
    offset = dataStart + compressedSize;
  }
  return null;
};

async function withPage(options, fn) {
  const { context, page } = await openEditor(browser, base, options);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await fn(page);
    r.check('런타임 오류 없음', errors, []);
  } finally {
    await context.close();
  }
}

// 파일 선택 창이 없는 브라우저(다운로드 저장)
const download = async (page, action) => {
  const wait = page.waitForEvent('download');
  await page.click(`[data-action="${action}"]`);
  const file = await wait;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return { name: file.suggestedFilename(), body: Buffer.concat(chunks) };
};

console.log('\n--- 첫 줄에서 고른 이름 ---');

const nameCases = [
  ['N1 첫 줄 제목', '<h1>3월 회의록</h1><p>본문</p>', '3월 회의록'],
  ['N2 앞의 빈 줄은 건너뜀', '<p><br></p><p>  </p><p>계획 초안</p><p>내용</p>', '계획 초안'],
  ['N3 파일 이름에 못 쓰는 글자는 공백으로', '<p>보고서: 1/2 &lt;초안&gt; "최종"?</p>', '보고서 1 2 초안 최종'],
  ['N4 첫 문장까지만', '<p>오늘 회의를 정리합니다. 다음 안건은 예산입니다.</p>', '오늘 회의를 정리합니다'],
  ['N5 번호 점은 문장 끝이 아님', '<p>1. 서론과 배경</p>', '1. 서론과 배경'],
  ['N6 긴 줄은 낱말 경계에서 자름',
    '<p>아주 긴 제목이 계속 이어지는 문서의 첫 줄인데 파일 이름으로 쓰기에는 너무 길어서 적당한 곳에서 잘라야 합니다</p>',
    '아주 긴 제목이 계속 이어지는 문서의 첫 줄인데 파일 이름으로 쓰기에는 너무 길어서'],
  ['N7 같은 문단의 둘째 줄은 넣지 않음', '<p>첫 줄\n둘째 줄</p>', '첫 줄'],
  ['N8 표가 먼저면 첫 칸들의 글자', '<table><tbody><tr><td>이름</td><td>점수</td></tr></tbody></table><p>끝</p>', '이름 점수'],
  ['N9 끝의 점과 공백은 뺌', '<p>요약...</p>', '요약'],
  ['N10 윈도 예약 이름은 쓰지 않음', '<p>CON</p>', '새 문서'],
  ['N11 빈 문서', '<p><br></p>', '새 문서'],
  ['N12 서식이 섞여도 글자만', '<p><b>굵은</b> <a href="https://a.com/">링크</a> 제목</p>', '굵은 링크 제목']
];

// 리눅스 Chromium은 한 페이지에서 다운로드가 10번을 넘으면 다음 다운로드를 막으므로
// 경우마다 새 페이지에서 내려받습니다.
for (const [name, html, expected] of nameCases) {
  await withPage({ noFilePicker: true }, async (page) => {
    await page.evaluate((value) => T.set(value), html);
    r.check(`${name} (HTML)`, (await download(page, 'save-html')).name, `${expected}.html`);
  });
}

await withPage({ noFilePicker: true }, async (page) => {
  await page.evaluate(() => T.set('<h1>분기 보고</h1><p>본문</p>'));
  r.check('N13 MD 저장도 같은 이름', (await download(page, 'save-md')).name, '분기 보고.md');
  const docx = await download(page, 'save-docx');
  r.check('N14 DOCX 저장도 같은 이름', docx.name, '분기 보고.docx');
  r.check('N14 DOCX 문서 제목 속성', /<dc:title>분기 보고<\/dc:title>/.test(String(readStoredZipEntry(docx.body, 'docProps/core.xml'))), true);
  const html = await download(page, 'save-html');
  r.check('N15 HTML 문서 제목', /<title>분기 보고<\/title>/.test(String(html.body)), true);

  // 다운로드 저장은 이름이 정해지지 않으므로 첫 줄을 고치면 다음 저장에 따라갑니다.
  await page.evaluate(() => T.set('<h1>분기 보고 수정본</h1>'));
  r.check('N16 첫 줄을 고치면 다음 저장 이름도 바뀜', (await download(page, 'save-html')).name, '분기 보고 수정본.html');
});

console.log('\n--- 이미 이름이 있는 문서 ---');

await withPage({ noFilePicker: true }, async (page) => {
  await page.setInputFiles('#fileInput', { name: '기존 문서.md', mimeType: 'text/markdown', buffer: Buffer.from('# 전혀 다른 제목\n\n본문') });
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('기존 문서.md'));
  r.check('N17 연 파일은 그 파일 이름을 씀', (await download(page, 'save-html')).name, '기존 문서.html');

  await page.click('[data-action="new"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => T.set('<p>새로 쓴 글</p>'));
  r.check('N18 새 문서로 바꾸면 다시 첫 줄', (await download(page, 'save-html')).name, '새로 쓴 글.html');
});

// 파일 선택 창이 있는 브라우저: 제안 이름을 받아 두는 가짜 선택 창
const pickerStub = () => {
  window.__pickerNames = [];
  window.showSaveFilePicker = async (options) => {
    window.__pickerNames.push(options.suggestedName);
    const name = window.__pickerAnswer || options.suggestedName;
    return { name, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  };
};

await withPage({}, async (page) => {
  await page.evaluate(pickerStub);
  await page.evaluate(() => T.set('<h2>여행 계획</h2><p>1일차</p>'));
  await page.click('[data-action="save-html"]');
  await page.waitForTimeout(100);
  r.check('N19 저장 창에 첫 줄 이름을 제안', await page.evaluate(() => window.__pickerNames), ['여행 계획.html']);

  // 사용자가 저장 창에서 이름을 바꾸면 그 이름을 이어 씁니다.
  await page.evaluate(() => { window.__pickerAnswer = '내가 정한 이름.md'; T.set('<h2>여행 계획 2</h2>'); });
  await page.click('[data-action="save-md"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__pickerAnswer = null; });
  await page.click('[data-action="save-docx"]');
  await page.waitForTimeout(100);
  // 한 번 저장하면 첫 줄이 바뀌어도 저장한 파일 이름을 따릅니다(다른 형식도 같은 이름).
  r.check('N20 저장한 뒤에는 저장한 파일 이름을 제안', await page.evaluate(() => window.__pickerNames),
    ['여행 계획.html', '여행 계획.md', '내가 정한 이름.docx']);
});

await withPage({}, async (page) => {
  // 복구한 초안도 아직 이름이 없으므로 첫 줄을 씁니다.
  await page.evaluate(() => {
    const id = sessionStorage.getItem('basic-text-editor-tab');
    localStorage.setItem(`basic-text-editor-draft:${id}`, JSON.stringify({ html: '<p>복구한 글의 제목</p><p>본문</p>', savedAt: Date.now() }));
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('editor').textContent.includes('복구한 글'));
  await page.evaluate(() => {
    window.__pickerNames = [];
    window.showSaveFilePicker = async (options) => {
      window.__pickerNames.push(options.suggestedName);
      return { name: options.suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
  });
  await page.click('[data-action="save-html"]');
  await page.waitForTimeout(100);
  r.check('N21 복구한 초안도 첫 줄 이름', await page.evaluate(() => window.__pickerNames), ['복구한 글의 제목.html']);
});

await browser.close();
server.close();
process.exit(r.summary() ? 1 : 0);
