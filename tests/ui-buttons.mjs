// 커버리지에서 한 번도 실행되지 않던 화면 동작: 서식 제거·실행 취소/다시 실행 버튼,
// 링크 미리보기의 주소 복사, 파일 선택 창으로 열기와 같은 파일 다시 저장, DOCX 구분선.
import { startServer, launch, openEditor, openReplace, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();

async function withPage(options, fn) {
  const { context, page } = await openEditor(browser, base, options);
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

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

console.log('\n--- 서식 제거 ---');

await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<h2><b>굵은</b> <i>기울임</i> <a href="https://a.com/">링크</a> 제목</h2><p>다음 문단</p>'));
  await page.evaluate(() => T.select('굵은 기울임 링크 제목'));
  await page.click('[data-action="clear-format"]');
  r.check('U1 글자 서식·링크·제목을 모두 지움', await page.evaluate(() => T.html()), '<p>굵은 기울임 링크 제목</p><p>다음 문단</p>');
  r.check('U1 문단 종류 표시가 본문으로', await page.inputValue('#blockFormat'), 'P');
  r.check('U1 알림', await page.evaluate(() => T.toast()), '글자와 문단 서식을 제거했습니다.');
  r.check('U2 고르지 않은 문단은 그대로', await page.evaluate(() => T.ed().lastElementChild.outerHTML), '<p>다음 문단</p>');
});

console.log('\n--- 실행 취소·다시 실행 버튼 ---');

await withPage({}, async (page) => {
  await page.evaluate(() => { T.set('<p>사과</p>'); T.caretIn(0, true); });
  await page.keyboard.type(' 배');
  await page.click('[data-command="undo"]');
  r.check('U3 ↶ 버튼으로 입력 취소', await page.evaluate(() => T.text()), '사과');
  await page.click('[data-command="redo"]');
  r.check('U4 ↷ 버튼으로 다시 실행', await page.evaluate(() => T.text()), '사과 배');

  await openReplace(page, { find: '사과', replace: '귤' });
  await page.click('[data-find="replace-all"]');
  await page.click('[data-command="undo"]');
  r.check('U5 ↶ 버튼으로 모두 바꾸기 취소', await page.evaluate(() => T.text()), '사과 배');
  await page.click('[data-command="redo"]');
  r.check('U6 ↷ 버튼으로 모두 바꾸기 다시 실행', await page.evaluate(() => T.text()), '귤 배');
});

console.log('\n--- 링크 미리보기 주소 복사 ---');

await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞 <a href="https://example.com/a?b=1">링크</a> 뒤</p>'));
  await page.hover('#editor a');
  await page.waitForSelector('#linkPreview.visible');
  r.check('U7 미리보기에 주소 표시', await page.textContent('#linkPreviewUrl'), 'https://example.com/a?b=1');
  await page.hover('#linkPreview');
  await page.click('#linkPreviewCopy');
  await page.waitForFunction(() => document.getElementById('linkPreviewCopy').textContent !== '주소 복사');
  r.check('U8 주소 복사 결과 표시', await page.textContent('#linkPreviewCopy'), '복사됨');
  r.check('U8 클립보드에 주소', await page.evaluate(() => navigator.clipboard.readText()), 'https://example.com/a?b=1');
  r.check('U8 본문은 그대로', await page.evaluate(() => T.html()), '<p>앞 <a href="https://example.com/a?b=1">링크</a> 뒤</p>');

  // 링크에서 본문 글자로 마우스를 옮기면 미리보기가 닫힙니다(페이지 오류도 없어야 함).
  await page.hover('#editor a');
  await page.waitForSelector('#linkPreview.visible');
  const plain = await page.evaluate(() => {
    const text = T.ed().querySelector('p').lastChild;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 2);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.move(plain.x, plain.y, { steps: 4 });
  await page.waitForTimeout(150);
  r.check('U13 링크 밖 본문으로 옮기면 미리보기 닫힘', await page.locator('#linkPreview').evaluate((node) => node.classList.contains('visible')), false);
});

await withPage({}, async (page) => {
  // 화면 아래쪽 링크는 미리보기를 링크 위에 띄워 화면 밖으로 나가지 않게 합니다.
  await page.evaluate(() => T.set(`${'<p>줄</p>'.repeat(60)}<p>끝 <a href="https://example.com/">아래 링크</a></p>`));
  await page.evaluate(() => T.ed().querySelector('a').scrollIntoView({ block: 'end' }));
  await page.hover('#editor a');
  await page.waitForSelector('#linkPreview.visible');
  const [link, preview, height] = await page.evaluate(() => [
    document.querySelector('#editor a').getBoundingClientRect().toJSON(),
    document.getElementById('linkPreview').getBoundingClientRect().toJSON(),
    window.innerHeight
  ]);
  r.check('U14 화면 아래 링크의 미리보기는 링크 위에', [preview.bottom <= link.top + 1, preview.bottom <= height], [true, true]);
});

console.log('\n--- 인용 버튼 ---');

await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞 문단</p><p>인용할 문장입니다</p><p>뒤 문단</p>'));
  await page.evaluate(() => T.select('인용할 문장'));
  await page.click('#quoteButton');
  r.check('U15 고른 문단을 인용구로', await page.evaluate(() => T.html()), '<p>앞 문단</p><blockquote>인용할 문장입니다</blockquote><p>뒤 문단</p>');
  r.check('U15 인용구로 바꾼 뒤에도 고른 글자 그대로', await page.evaluate(() => T.selection()), '인용할 문장');
});

await withPage({}, async (page) => {
  await page.evaluate(() => T.set('<p>앞 문단</p><blockquote><p>인용 첫 줄</p><p>인용 둘째 줄</p></blockquote><p>뒤 문단</p>'));
  // T.select는 문단 끝까지 고르면 다음 문단까지 넘어가므로 문단 가운데를 고릅니다.
  await page.evaluate(() => T.select('인용 첫'));
  await page.click('#quoteButton');
  r.check('U19 인용구 안에서 누르면 일반 문단으로', await page.evaluate(() => T.html()), '<p>앞 문단</p><p>인용 첫 줄</p><p>인용 둘째 줄</p><p>뒤 문단</p>');
  r.check('U19 해제한 뒤에도 고른 글자 그대로', await page.evaluate(() => T.selection()), '인용 첫');
  await page.keyboard.press('Control+z');
  r.check('U19 Ctrl+Z로 인용구 복원', await page.evaluate(() => T.ed().querySelectorAll('blockquote p').length), 2);
});

console.log('\n--- DOCX 서식 ---');

const docxXml = async (page, html) => {
  await page.evaluate((value) => T.set(value), html);
  const wait = page.waitForEvent('download');
  await page.click('[data-action="save-docx"]');
  const chunks = [];
  for await (const chunk of await (await wait).createReadStream()) chunks.push(chunk);
  return String(readStoredZipEntry(Buffer.concat(chunks), 'word/document.xml'));
};
// 글자가 든 w:r(런)의 속성만 뽑습니다.
const runOf = (xml, text) => xml.match(new RegExp(`<w:r>(?:(?!</w:r>).)*<w:t[^>]*>${text}</w:t></w:r>`))?.[0] || '';

await withPage({ noFilePicker: true }, async (page) => {
  const xml = await docxXml(page, '<p><span style="font-weight:700">굵게</span> <span style="text-decoration:underline">밑줄</span> 보통</p>');
  r.check('U16 style로 준 굵게·밑줄도 DOCX 서식으로', [/<w:b\/>/.test(runOf(xml, '굵게')), /<w:u /.test(runOf(xml, '밑줄')), /<w:[bu][ /]/.test(runOf(xml, ' 보통'))], [true, true, false]);
});
// 리눅스 Chromium은 한 페이지의 연속 다운로드를 막으므로 DOCX 경우마다 새 페이지를 씁니다.
await withPage({ noFilePicker: true }, async (page) => {
  const xml = await docxXml(page, '<p>첫 줄\n둘째 줄</p>');
  r.check('U17 문단 안 줄바꿈은 DOCX 줄바꿈', /첫 줄<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r>(?:<w:rPr>.*?<\/w:rPr>)?<w:t[^>]*>둘째 줄/.test(xml), true);
});
await withPage({ noFilePicker: true }, async (page) => {
  const xml = await docxXml(page, '<ul><li><b>굵은</b> 바깥<ul><li>안쪽</li></ul></li><li>다음</li></ul>');
  const paragraphs = [...xml.matchAll(/<w:p>(.*?)<\/w:p>/g)].map((match) => [...match[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''));
  r.check('U18 중첩 목록은 항목마다 따로(서식 있는 글자 포함)', paragraphs.filter(Boolean), ['굵은 바깥', '안쪽', '다음']);
});

console.log('\n--- 파일 선택 창으로 열고 같은 파일에 저장 ---');

await withPage({}, async (page) => {
  await page.evaluate(() => {
    window.__written = [];
    const handle = {
      name: '메모.md',
      getFile: async () => new File(['# 회의\n\n**중요**한 내용'], '메모.md', { type: 'text/markdown' }),
      createWritable: async () => ({
        write: async (content) => window.__written.push(typeof content === 'string' ? content : await content.text()),
        close: async () => {}
      })
    };
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => { throw new Error('저장 창이 열리면 안 됨'); };
  });
  await page.click('[data-action="open"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('메모.md'));
  r.check('U9 선택 창으로 연 마크다운', await page.evaluate(() => T.html()), '<h1>회의</h1><p><strong>중요</strong>한 내용</p>');
  await page.evaluate(() => { T.ed().lastElementChild.append(' 추가'); T.ed().dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await page.click('[data-action="save-md"]');
  await page.waitForFunction(() => window.__written.length === 1);
  r.check('U10 저장 창 없이 연 파일에 덮어씀', await page.evaluate(() => window.__written[0]), '# 회의\n\n**중요**한 내용 추가\n');
  r.check('U10 알림', await page.evaluate(() => T.toast()), '메모.md 파일을 업데이트했습니다.');
});

await withPage({}, async (page) => {
  await page.evaluate(() => {
    window.showOpenFilePicker = async () => { throw new DOMException('취소', 'AbortError'); };
  });
  await page.evaluate(() => T.set('<p>그대로</p>'));
  await page.click('[data-action="open"]');
  await page.waitForTimeout(100);
  r.check('U11 선택 창을 취소하면 문서 그대로, 알림 없음', [await page.evaluate(() => T.html()), await page.evaluate(() => T.toast())], ['<p>그대로</p>', '']);
});

console.log('\n--- DOCX 구분선 ---');

await withPage({ noFilePicker: true }, async (page) => {
  await page.evaluate(() => T.set('<p>위</p><hr><p>아래</p>'));
  const wait = page.waitForEvent('download');
  await page.click('[data-action="save-docx"]');
  const chunks = [];
  for await (const chunk of await (await wait).createReadStream()) chunks.push(chunk);
  const documentXml = String(readStoredZipEntry(Buffer.concat(chunks), 'word/document.xml'));
  const order = ['위', 'w:pBdr', '아래'].map((needle) => documentXml.indexOf(needle));
  r.check('U12 구분선이 두 문단 사이 테두리 문단으로', order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), true);
});

await browser.close();
server.close();
process.exit(r.summary() ? 1 : 0);
