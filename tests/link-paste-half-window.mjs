import { startServer, launch, openEditor, makeReporter } from './harness.mjs';
import { chromium } from 'playwright';
const { server, base } = await startServer();
const browser = process.env.BROWSER_CHANNEL ? await chromium.launch({ channel: process.env.BROWSER_CHANNEL }) : await launch();
const r = makeReporter();
const sample = Array.from({ length: 180 }, (_, i) => `<p>${i} 문단 앞 <b>targetword${i}</b> 문단 뒤 ${'본문 설명입니다. '.repeat(8)}</p>`).join('');
const position = page => page.evaluate(() => {
  const word = T.ed().children[80].querySelector('b').getBoundingClientRect();
  const w = document.querySelector('.workspace');
  return { wordTop: word.top, workspaceTop: w.getBoundingClientRect().top, scroll: w.scrollTop, windowY: scrollY, selection: getSelection().toString() };
});
try {
  for (const width of [960, 680]) for (const mode of ['normal', 'before-paste', 'late-scroll', 'manual-wheel']) {
    const { page, context } = await openEditor(browser, base);
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(sample => {
        T.set(sample); const w = document.querySelector('.workspace');
        w.scrollTop += T.ed().children[80].getBoundingClientRect().top-w.getBoundingClientRect().top-80;
      }, sample);
      await page.locator('#editor b').nth(80).dblclick();
      await page.waitForTimeout(80);
      await page.evaluate(() => T.writeClipboard('', 'https://example.com/'));
      if (mode === 'before-paste') await page.evaluate(() => {
        document.addEventListener('paste', () => {
          const w = document.querySelector('.workspace');
          w.scrollTop += T.ed().children[80].querySelector('b').getBoundingClientRect().top-w.getBoundingClientRect().top;
        }, { capture: true });
      });
      if (mode === 'late-scroll') await page.evaluate(() => {
        const command = document.execCommand.bind(document);
        document.execCommand = (name, ui, value) => {
          const result = command(name, ui, value);
          if (name === 'createLink') requestAnimationFrame(() => requestAnimationFrame(() => {
            const w = document.querySelector('.workspace');
            w.scrollTop += T.ed().children[80].querySelector('b').getBoundingClientRect().top-w.getBoundingClientRect().top;
          }));
          return result;
        };
      });
      const before = await position(page);
      await page.keyboard.press('Control+v');
      if (mode === 'manual-wheel') {
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(200);
        const after = await position(page);
        r.check(`${width}px 사용자의 휠 스크롤은 방해하지 않음`, after.scroll-before.scroll > 100, true);
        r.check(`${width}px 휠 조작 후에도 링크 적용 유지`, await page.evaluate(() => T.ed().children[80].querySelector('a')?.getAttribute('href')), 'https://example.com/');
        continue;
      }
      await page.waitForTimeout(350);
      const after = await position(page);
      r.info(`${width}px ${mode}`, { before, after });
      r.check(`${width}px ${mode} 단어 화면 위치 유지`, Math.abs(before.wordTop-after.wordTop) < 1, true);
      r.check(`${width}px ${mode} 선택 글자 유지`, after.selection, before.selection);
      r.check(`${width}px ${mode} 링크 적용`, await page.evaluate(() => T.ed().children[80].querySelector('a')?.getAttribute('href')), 'https://example.com/');
    } finally { await context.close(); }
  }
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
