import { startServer, launch, openEditor, makeReporter } from './harness.mjs';
import { chromium } from 'playwright';
const { server, base } = await startServer();
const browser = process.env.BROWSER_CHANNEL ? await chromium.launch({ channel: process.env.BROWSER_CHANNEL }) : await launch();
const r = makeReporter();
const sample = Array.from({ length: 180 }, (_, i) => `<p>${i} 문단 앞 <b>대상${i}</b> 문단 뒤 ${'본문 설명입니다. '.repeat(8)}</p>`).join('');
const metrics = page => page.evaluate(() => {
  const w = document.querySelector('.workspace'), view = w.getBoundingClientRect();
  const first = [...T.ed().children].find(p => p.getBoundingClientRect().bottom > view.top);
  return { scroll: w.scrollTop, label: first.textContent.split(' ')[0], top: first.getBoundingClientRect().top-view.top };
});
try {
  for (const scenario of ['url', 'spaced-url', 'rich', 'selection', 'existing-link', 'multi-selection', 'backward-selection', 'backward-multi', 'bottom-selection', 'native-scroll', 'window-scroll', 'plain-url', 'bare-domain', 'plain-label', 'text-caret']) {
    const { page, context } = await openEditor(browser, base);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 1000, height: 760 });
      await page.evaluate(sample => T.set(sample), sample);
      await page.evaluate(scenario => {
        const p = T.ed().children[80];
        if (scenario === 'existing-link') p.querySelector('b').innerHTML = '<a href="https://old.example/">대상80</a>';
        if (['selection', 'existing-link', 'backward-selection', 'bottom-selection', 'native-scroll', 'window-scroll'].includes(scenario)) {
          T.select('대상80');
          if (scenario === 'backward-selection') {
            const range = getSelection().getRangeAt(0);
            getSelection().setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
          }
        } else if (['multi-selection','backward-multi'].includes(scenario)) {
          const range = document.createRange(); range.setStart(T.ed().children[75].firstChild, 0);
          range.setEnd(T.ed().children[120], T.ed().children[120].childNodes.length);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          if (scenario === 'backward-multi') selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
          T.ed().focus();
        } else if (scenario === 'text-caret') {
          T.select('대상80'); const selection = getSelection(); selection.collapseToEnd();
        } else T.caretIn(80, true);
        const w = document.querySelector('.workspace');
        const view = w.getBoundingClientRect();
        const offset = scenario === 'bottom-selection' ? view.height - 20 : 100;
        w.scrollTop += p.getBoundingClientRect().top - view.top - offset;
      }, scenario);
      if (scenario === 'window-scroll') await page.addStyleTag({ content: 'html::after { content: ""; display:block; height:600px; }' });
      if (['native-scroll','window-scroll'].includes(scenario)) await page.evaluate(scenario => {
        // 브라우저의 링크 명령이 동기·다음 프레임에 선택 위치로 스크롤하는 상황입니다.
        const command = document.execCommand.bind(document);
        document.execCommand = (name, ui, value) => {
          const result = command(name, ui, value);
          if (name === 'createLink') {
            const move = () => {
              if (scenario === 'window-scroll') window.scrollTo(0, 400);
              else { const w = document.querySelector('.workspace'); w.scrollTop = w.scrollHeight; }
            };
            move(); requestAnimationFrame(move);
          }
          return result;
        };
      }, scenario);
      await page.evaluate(scenario => T.writeClipboard(scenario === 'rich' ? '<a href="https://example.com/">링크</a>' : '', scenario === 'rich' ? '링크' : scenario === 'spaced-url' ? ' https://example.com/ ' : scenario === 'bare-domain' ? 'www.example.com' : ['plain-label','text-caret'].includes(scenario) ? '링크 설명' : 'https://example.com/'), scenario);
      await page.waitForTimeout(120);
      const before = await metrics(page);
      await page.keyboard.press(scenario === 'plain-url' ? 'Control+Shift+v' : 'Control+v');
      const immediate = await metrics(page);
      await page.waitForTimeout(350);
      const after = await metrics(page);
      r.info(scenario, { before, immediate, after });
      r.check(`${scenario} 붙여넣기 후 같은 문단 유지`, after.label, before.label);
      r.check(`${scenario} 붙여넣기 후 화면 위치 유지`, Math.abs(after.top-before.top) < 1, true);
      if (!['plain-url','bare-domain','plain-label','text-caret'].includes(scenario)) r.check(`${scenario} 링크 실제 적용`, await page.evaluate(() => Boolean(T.ed().querySelector('a[href="https://example.com/"]'))), true);
      r.check(`${scenario} 런타임 오류 없음`, errors, []);
      r.check(`${scenario} 페이지 바깥쪽 스크롤도 유지`, await page.evaluate(() => window.scrollY), 0);
      if (scenario === 'text-caret') {
        r.check('평문 붙여넣기 후 커서가 삽입한 문단에 남음', await page.evaluate(() => {
          let node = getSelection().focusNode;
          if (node?.nodeType !== Node.ELEMENT_NODE) node = node?.parentElement;
          return node?.closest('p')?.textContent.startsWith('80 ');
        }), true);
        await page.keyboard.type('!'); await page.waitForTimeout(100);
        r.check('평문 붙여넣기 후 입력도 같은 문단에서 계속', await page.evaluate(() => T.ed().children[80].textContent.includes('링크 설명!')), true);
      }
    } finally { await context.close(); }
  }
  {
    const { page, context } = await openEditor(browser, base);
    try {
      await page.evaluate(() => { T.set('<p>앞대상뒤</p><p>마지막 문단</p>'); T.select('대상'); });
      await page.evaluate(() => T.writeClipboard('', 'https://example.com/'));
      await page.keyboard.press('Control+Shift+v');
      await page.keyboard.type('!');
      r.check('문장 중간 평문 URL 붙여넣기 뒤 정확한 위치에 입력', await page.evaluate(() => T.ed().firstElementChild.textContent), '앞https://example.com/!뒤');
      r.check('평문 URL에 하이퍼링크를 강제로 만들지 않음', await page.locator('#editor a').count(), 0);
    } finally { await context.close(); }
  }
  {
    const { page, context } = await openEditor(browser, base);
    try {
      await page.setInputFiles('#fileInput', { name: 'long.html', mimeType: 'text/html', buffer: Buffer.from(sample) });
      await page.locator('#editor b').nth(80).waitFor({ state: 'visible' });
      await page.evaluate(() => {
        T.select('대상80'); const w = document.querySelector('.workspace');
        w.scrollTop += T.ed().children[80].getBoundingClientRect().top-w.getBoundingClientRect().top-100;
      });
      const before = await metrics(page);
      for (let i = 1; i <= 3; i += 1) {
        await page.evaluate(url => T.writeClipboard('', url), `https://example.com/${i}`);
        await page.keyboard.press('Control+v'); await page.waitForTimeout(80);
        const after = await metrics(page);
        r.check(`링크 ${i}회 연속 적용 후 화면 유지`, Math.abs(after.scroll-before.scroll) < 1, true);
        r.check(`링크 ${i}회 연속 적용 후 선택 글자 유지`, await page.evaluate(() => T.selection()), '대상80');
        r.check(`링크 ${i}회 연속 적용 후 주소 반영`, await page.evaluate(() => T.ed().children[80].querySelector('a')?.getAttribute('href')), `https://example.com/${i}`);
      }
      await page.keyboard.press('Control+z');
      r.check('연속 링크 변경은 직전 주소로 실행 취소', await page.evaluate(() => T.ed().children[80].querySelector('a')?.getAttribute('href')), 'https://example.com/2');
    } finally { await context.close(); }
  }
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
