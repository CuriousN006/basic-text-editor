import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// EDITOR_DIR을 주면 다른 사본(예: 수정 전 index.html)으로 같은 테스트를 돌릴 수 있습니다.
const REPO = process.env.EDITOR_DIR || path.join(HERE, '..');

export async function startServer() {
  const server = http.createServer(async (req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(REPO, name === '/' ? 'index.html' : name);
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export async function launch() {
  return chromium.launch({ args: ['--no-sandbox'] });
}

let coverageSerial = 0;
let pageErrorCount = 0;
// 페이지를 닫기 전에 V8 코드 실행 범위를 파일로 남긴다. 테스트마다 context.close()를
// 직접 부르므로 그 함수를 감싼다. 새로 고침에도 이어서 모으도록 resetOnNavigation을 끈다.
async function recordCoverage(context, page) {
  const options = { resetOnNavigation: false, reportAnonymousScripts: false };
  await page.coverage.startJSCoverage(options);
  // 새로 고치면 이전 문서의 스크립트 기록이 함께 사라지므로 새로 고치기 직전에 받아 둡니다.
  const earlier = [];
  for (const method of ['reload', 'goto']) {
    const original = page[method].bind(page);
    page[method] = async (...args) => {
      try {
        earlier.push(...await page.coverage.stopJSCoverage());
        await page.coverage.startJSCoverage(options);
      } catch {
        // 처음 열 때(goto)는 아직 기록이 없습니다.
      }
      return original(...args);
    };
  }
  const close = context.close.bind(context);
  context.close = async (...args) => {
    try {
      const entries = [...earlier, ...await page.coverage.stopJSCoverage()].filter((entry) => /\/index\.html$/.test(entry.url));
      await fs.mkdir(process.env.COVERAGE_DIR, { recursive: true });
      const name = `${path.basename(process.argv[1] || 'test', '.mjs')}-${process.pid}-${coverageSerial += 1}.json`;
      await fs.writeFile(path.join(process.env.COVERAGE_DIR, name), JSON.stringify(entries));
    } catch {
      // 페이지가 이미 닫혔으면 그 페이지의 기록은 버립니다.
    }
    return close(...args);
  };
}

// 페이지를 열고 편집기 조작용 헬퍼를 주입한다.
export async function openEditor(browser, base, opts = {}) {
  const context = await browser.newContext({ acceptDownloads: true, hasTouch: Boolean(opts.hasTouch) });
  // 실제 클립보드를 통한 붙여넣기 검증에 필요합니다.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();

  // 브라우저가 다운로드를 조용히 차단한 상황을 흉내내는 스텁.
  if (opts.blockDownloads) {
    await page.addInitScript(() => {
      const real = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download')) return; // 차단: 예외 없이 아무 일도 안 일어남
        return real.apply(this, arguments);
      };
    });
  }
  // File System Access API가 없는 브라우저(파이어폭스 등) 경로를 강제.
  if (opts.noFilePicker) {
    await page.addInitScript(() => {
      delete window.showSaveFilePicker;
      delete window.showOpenFilePicker;
    });
  }
  if (opts.noHighlightApi) {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'Highlight', {
        configurable: true,
        value: undefined
      });
    });
  }
  if (opts.seedDraft !== undefined) {
    await page.addInitScript((html) => {
      localStorage.setItem('basic-text-editor-draft', html);
    }, opts.seedDraft);
  }

  page.on('dialog', (d) => d.accept(opts.promptAnswer ?? ''));
  // 편집기 페이지에서 처리되지 않은 오류가 나면 그 테스트 파일을 실패로 칩니다.
  // 파일마다 따로 확인하지 않아도 모든 테스트에 적용됩니다.
  page.on('pageerror', (error) => {
    pageErrorCount += 1;
    console.log(`FAIL  페이지 오류: ${error.message}`);
  });
  // COVERAGE_DIR를 주면 페이지마다 실행된 코드 범위를 기록합니다(coverage.mjs가 합산).
  if (process.env.COVERAGE_DIR) await recordCoverage(context, page);
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('#editor');
  // 초안 복구는 탭 잠금을 확보한 뒤 비동기로 끝납니다. 끝나면 탭 ID가 기록됩니다.
  // (탭별 초안 이전 버전으로 돌릴 때는 기록되지 않으므로 잠깐만 기다립니다.)
  await page.waitForFunction(() => sessionStorage.getItem('basic-text-editor-tab'), null, { timeout: 2000 }).catch(() => {});

  await page.addScriptTag({
    content: `
    window.T = {
      ed: () => document.getElementById('editor'),
      set(html) {
        const ed = T.ed();
        ed.innerHTML = html;
        ed.focus();
      },
      text() { return T.ed().innerText.replace(/\\u00a0/g, ' '); },
      html() { return T.ed().innerHTML; },
      comments() {
        const w = document.createTreeWalker(T.ed(), NodeFilter.SHOW_COMMENT);
        const out = [];
        while (w.nextNode()) out.push(w.currentNode.nodeValue);
        return out;
      },
      // 편집기 안에서 needle에 해당하는 구간을 선택한다.
      select(needle) {
        const w = document.createTreeWalker(T.ed(), NodeFilter.SHOW_TEXT);
        let full = '', nodes = [];
        while (w.nextNode()) { nodes.push([w.currentNode, full.length]); full += w.currentNode.nodeValue; }
        const at = full.indexOf(needle);
        if (at < 0) throw new Error('not found: ' + needle);
        const end = at + needle.length;
        const find = (pos) => {
          for (let i = nodes.length - 1; i >= 0; i -= 1) {
            if (nodes[i][1] <= pos) return { node: nodes[i][0], offset: pos - nodes[i][1] };
          }
          throw new Error('offset fail');
        };
        const a = find(at), b = find(end);
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        T.ed().focus();
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return full;
      },
      selection() { return String(getSelection()); },
      draft() {
        const id = sessionStorage.getItem('basic-text-editor-tab');
        const raw = id && localStorage.getItem('basic-text-editor-draft:' + id);
        return raw ? JSON.parse(raw).html : localStorage.getItem('basic-text-editor-draft');
      },
      toast() { return document.getElementById('toast').textContent; },
      boldTags() { return T.ed().querySelectorAll('b,strong').length; },
      formatTags() { return T.ed().querySelectorAll('b,strong,i,em,u,s,strike,del,a').length; },
      // 블록 구성 요약. ':빈'은 글자가 없는 블록.
      blocks() {
        return [...T.ed().children].map((el) => el.tagName + (el.textContent.trim() ? '' : ':빈')).join(' ');
      },
      // 실제 커서처럼 문단 안쪽에 캐럿을 둔다.
      caretIn(index, atEnd) {
        const block = T.ed().children[index] || T.ed();
        const range = document.createRange();
        range.selectNodeContents(block);
        range.collapse(!atEnd);
        T.ed().focus();
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(range);
      },
      // 커서가 문서 앞에서 몇 글자 뒤에 있는지. 맨 앞으로 튀는지 확인용.
      caretOffset() {
        const s = getSelection();
        if (!s || !s.rangeCount) return null;
        const probe = document.createRange();
        probe.selectNodeContents(T.ed());
        try { probe.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset); } catch (e) { return null; }
        return probe.toString().length;
      },
      textLength() { return T.ed().textContent.length; },
      selectRange(needle) { return T.select(needle); },
      async writeClipboard(html, text) {
        const data = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
        if (html) data['text/html'] = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem(data)]);
      },
    };
    `,
  });
  return { context, page };
}

// 찾기/바꾸기 창을 열고 값을 채운다. formats: { bold: 'remove' } 등
export async function openReplace(page, {
  find = '',
  replace = '',
  formats = {},
  particles = true,
  scope = 'all'
} = {}) {
  await page.click('[data-action="replace"]');
  if (find !== null) await page.fill('#findText', find);
  await page.fill('#replaceText', replace);
  if (!particles) await page.uncheck('#adjustParticles');
  if (scope !== 'all') await page.selectOption('#replaceScope', scope);
  const order = ['none', 'apply', 'remove'];
  for (const [name, want] of Object.entries(formats)) {
    const sel = `[data-replace-format="${name}"]`;
    const clicks = order.indexOf(want);
    for (let i = 0; i < clicks; i += 1) await page.click(sel);
  }
}

export function makeReporter() {
  const rows = [];
  return {
    check(name, actual, expected, note = '') {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      rows.push({ name, ok, actual, expected, note });
      const mark = ok ? 'PASS' : 'FAIL';
      console.log(`${mark}  ${name}`);
      if (!ok) {
        console.log(`      기대: ${JSON.stringify(expected)}`);
        console.log(`      실제: ${JSON.stringify(actual)}`);
      }
      if (note) console.log(`      ${note}`);
      return ok;
    },
    info(...a) { console.log('      ·', ...a); },
    summary() {
      const bad = rows.filter((r) => !r.ok);
      console.log(`\n=== ${rows.length - bad.length}/${rows.length} PASS ===`);
      if (pageErrorCount) console.log(`=== 페이지 오류 ${pageErrorCount}건 ===`);
      return bad.length + pageErrorCount;
    },
  };
}
