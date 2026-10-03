import { startServer, launch, openEditor, makeReporter } from './harness.mjs';
import { chromium } from 'playwright';
const { server, base } = await startServer();
const browser = process.env.BROWSER_CHANNEL ? await chromium.launch({ channel: process.env.BROWSER_CHANNEL }) : await launch();
const r = makeReporter();
const view = page => page.evaluate(() => {
  const workspace = document.querySelector('.workspace');
  const bounds = workspace.getBoundingClientRect();
  const blocks = [...T.ed().children];
  const block = blocks.find(p => p.getBoundingClientRect().bottom > bounds.top);
  return { label: block.textContent.split(' ')[0], top: block.getBoundingClientRect().top - bounds.top, scroll: workspace.scrollTop };
});
try {
  for (const scenario of [
    { width: 1000, height: 760, close: 'button', replace: 'all', quick: true },
    { width: 1000, height: 760, close: 'Escape', replace: 'all', noAnchor: true },
    { width: 1000, height: 760, close: 'button', replace: 'all', noAnchor: true },
    { width: 1000, height: 760, close: 'Escape', replace: 'all' },
    { width: 1000, height: 760, close: 'button', replace: 'all' },
    { width: 1280, height: 760, close: 'Escape', replace: 'all' },
    { width: 390, height: 844, close: 'Escape', replace: 'all' },
    { width: 1000, height: 760, close: 'Escape', replace: 'single' },
    { width: 1000, height: 760, close: 'Escape', replace: 'none' },
  ]) {
    const { context, page } = await openEditor(browser, base);
    try {
      await page.setViewportSize({ width: scenario.width, height: scenario.height });
      if (scenario.noAnchor) await page.addStyleTag({ content: '.workspace { overflow-anchor: none; }' });
      await page.evaluate(() => {
        T.set(Array.from({ length: 160 }, (_, i) => `<p>${i} 키워드 ${'문장을 길게 작성하여 줄바꿈을 재현합니다. '.repeat(5)}</p>`).join(''));
        T.caretIn(110, true);
      });
      await page.keyboard.press('Control+h');
      await page.fill('#findText', '키워드');
      await page.fill('#replaceText', '대체어');
      let before, immediate;
      if (scenario.quick) {
        await page.evaluate(() => { document.querySelector('.workspace').scrollTop = 4200; });
        await page.waitForTimeout(80);
        ({ before, immediate } = await page.evaluate(() => {
          const capture = () => {
            const workspace = document.querySelector('.workspace');
            const bounds = workspace.getBoundingClientRect();
            const block = [...T.ed().children].find(p => p.getBoundingClientRect().bottom > bounds.top);
            return { label: block.textContent.split(' ')[0], top: block.getBoundingClientRect().top-bounds.top, scroll: workspace.scrollTop };
          };
          document.querySelector('[data-find="replace-all"]').click();
          const before = capture();
          // 브라우저의 다음 프레임을 기다리지 않고 닫는 빠른 연속 동작입니다.
          document.querySelector('[data-find="close"]').click();
          return { before, immediate: capture() };
        }));
      } else {
        if (scenario.replace === 'single') {
          await page.focus('#findText'); await page.keyboard.press('Enter');
          await page.click('[data-find="replace"]');
        } else if (scenario.replace === 'all') await page.click('[data-find="replace-all"]');
        await page.evaluate(() => { document.querySelector('.workspace').scrollTop = 4200; });
        await page.waitForTimeout(260);
        before = await view(page);
        if (scenario.close === 'Escape') {
          await page.focus('#replaceText'); await page.keyboard.press('Escape');
        } else await page.click('[data-find="close"]');
        immediate = await view(page);
      }
      await page.waitForTimeout(350);
      const after = await view(page);
      const label = `${scenario.width}px ${scenario.replace} ${scenario.close}${scenario.noAnchor ? ' 자동 스크롤 보정 없음' : ''}${scenario.quick ? ' 치환 직후 닫기' : ''}`;
      r.info(label, { before, immediate, after });
      r.check(`${label} 닫은 직후 같은 문단`, immediate.label, before.label);
      r.check(`${label} 닫은 뒤에도 같은 문단`, after.label, before.label);
      r.check(`${label} 문단의 화면 위치 유지`, Math.abs(after.top-before.top) < 1, true);
      r.check(`${label} 본문 포커스 복귀`, await page.evaluate(() => document.activeElement === T.ed()), true);
      r.check(`${label} 찾기 창과 결과 패널 닫힘`, await page.evaluate(() => !document.getElementById('findbar').classList.contains('open') && document.getElementById('findResultsPanel').getAttribute('aria-hidden') === 'true'), true);
    } finally { await context.close(); }
  }
  {
    const { context, page } = await openEditor(browser, base);
    try {
      await page.setViewportSize({ width: 1000, height: 760 });
      await page.addStyleTag({ content: '.workspace { overflow-anchor: none; }' });
      await page.evaluate(() => {
        T.set('<p>키워드 ' + Array.from({ length: 1600 }, (_, i) => `<span data-word="${i}">단어${i} </span>`).join('') + '</p>');
      });
      await page.keyboard.press('Control+h');
      await page.fill('#findText', '키워드'); await page.fill('#replaceText', '대체어');
      await page.click('[data-find="replace-all"]');
      await page.evaluate(() => { document.querySelector('.workspace').scrollTop = 4200; });
      await page.waitForTimeout(150);
      const before = await page.evaluate(() => {
        const view = document.querySelector('.workspace').getBoundingClientRect();
        const word = [...T.ed().querySelectorAll('[data-word]')].find(span => span.getBoundingClientRect().bottom > view.top);
        return { word: word.dataset.word, top: word.getBoundingClientRect().top-view.top };
      });
      await page.click('[data-find="close"]');
      await page.waitForTimeout(350);
      const after = await page.evaluate(word => {
        const view = document.querySelector('.workspace').getBoundingClientRect();
        const rect = T.ed().querySelector(`[data-word="${word}"]`).getBoundingClientRect();
        return { top: rect.top-view.top, visible: rect.bottom > view.top && rect.top < view.bottom };
      }, before.word);
      r.check('긴 한 문단에서도 보던 단어의 화면 위치 유지', Math.abs(before.top-after.top) < 1, true);
      r.check('긴 한 문단에서도 보던 단어가 화면에 남음', after.visible, true);
    } finally { await context.close(); }
  }
  process.exitCode = r.summary() ? 1 : 0;
} finally { await browser.close(); server.close(); }
