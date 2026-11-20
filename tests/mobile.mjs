import { startServer, launch, openEditor, makeReporter } from './harness.mjs';

const { server, base } = await startServer();
const browser = await launch();
const r = makeReporter();
const { context, page } = await openEditor(browser, base, {
  isMobile: true,
  hasTouch: true,
  viewport: { width: 390, height: 844 },
  noFilePicker: true
});
const tap = (selector) => page.locator(selector).tap();

try {
  await page.evaluate(() => T.set('<p>앞 대상 뒤</p><p><a href="https://example.com/">링크</a></p>'));
  r.check('M1 파일 및 추가 도구는 접힌 상태로 시작', [
    await page.locator('[data-action="open"]').isVisible(),
    await page.locator('#tableButton').isVisible()
  ], [false, false]);
  await page.evaluate(() => T.select('대상'));
  await tap('[data-command="bold"]');
  r.check('M2 서식 버튼을 터치하면 선택한 글자가 굵게', await page.locator('#editor b').textContent(), '대상');

  await tap('#mobileToolsButton');
  await tap('#plainPasteButton');
  await page.evaluate(() => T.writeClipboard('<b>교체</b><p>다음</p>', '교체\n다음'));
  await page.keyboard.press('Control+V');
  await tap('#plainPasteDialog [value="insert"]');
  await page.waitForFunction(() => T.ed().textContent.includes('교체'));
  r.check('M3 원래 선택 영역에 줄바꿈을 유지해 텍스트 삽입', await page.evaluate(() =>
    [...T.ed().querySelectorAll('p')].map(p => p.textContent)), ['앞 교체', '다음 뒤', '링크']);

  await tap('#editor a');
  r.check('M4 링크를 터치하면 열기·복사 미리보기', [
    await page.locator('#linkPreview').isVisible(),
    await page.locator('#linkPreviewUrl').getAttribute('href')
  ], [true, 'https://example.com/']);
  await tap('#linkPreviewCopy');
  r.check('M4 링크 주소 복사', await page.evaluate(() => navigator.clipboard.readText()), 'https://example.com/');
  await tap('#mobileToolsButton');
  r.check('M4 다른 곳을 터치하면 미리보기 닫힘', await page.locator('#linkPreview').isVisible(), false);

  await page.evaluate(() => T.caretIn(2, true));
  await tap('#mobileToolsButton');
  await tap('#tableButton');
  r.check('M5 좁은 화면의 표 삽입은 행·열 입력을 사용', await page.locator('#tableGrid').isVisible(), false);
  await page.locator('#tableRows').fill('3');
  await page.locator('#tableColumns').fill('2');
  await tap('[data-table-action="insert"]');
  r.check('M5 숫자로 지정한 표를 삽입', [await page.locator('#editor tr').count(), await page.locator('#editor td').count()], [3, 6]);

  await tap('[data-action="find"]');
  await page.locator('#findText').fill('다음');
  await page.locator('[data-find-result-index]').first().waitFor();
  // 운영체제의 키보드는 데스크톱 Chromium에 없으므로 시각 뷰포트만 줄어드는 경로를 재현합니다.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 346 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  const layout = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const bar = rect('#findbar'), workspace = rect('.workspace'), results = rect('#findResultsPanel');
    return [rect('body').height, bar.bottom <= workspace.top, workspace.height > 0,
      results.top >= workspace.bottom, results.bottom <= 346];
  });
  r.check('M6 키보드가 차지한 높이를 빼고 검색창·본문·결과를 배치', layout, [346, true, true, true, true]);
  await tap('[data-find="close"]');
  await page.evaluate(() => {
    delete visualViewport.height;
    visualViewport.dispatchEvent(new Event('resize'));
  });

  await tap('#mobileFilesButton');
  const download = await Promise.all([
    page.waitForEvent('download'),
    tap('[data-action="save-html"]')
  ]).then(([item]) => item);
  r.check('M7 파일 메뉴에서 HTML 다운로드', download.suggestedFilename().endsWith('.html'), true);

  await page.setViewportSize({ width: 844, height: 390 });
  r.check('M8 가로로 돌린 터치 화면에 모바일 도구가 유지됨', await page.locator('#mobileToolsButton').isVisible(), true);
  await page.setViewportSize({ width: 320, height: 640 });
  r.check('M9 폭 320px에서 본문과 페이지가 가로로 넘치지 않음', await page.evaluate(() =>
    document.documentElement.scrollWidth === innerWidth), true);
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

process.exitCode = r.summary() ? 1 : 0;
