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

// 페이지를 열고 편집기 조작용 헬퍼를 주입한다.
export async function openEditor(browser, base, opts = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
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
  if (opts.seedDraft !== undefined) {
    await page.addInitScript((html) => {
      localStorage.setItem('basic-text-editor-draft', html);
    }, opts.seedDraft);
  }

  page.on('dialog', (d) => d.accept(opts.promptAnswer ?? ''));
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('#editor');

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
      draft() { return localStorage.getItem('basic-text-editor-draft'); },
      toast() { return document.getElementById('toast').textContent; },
      boldTags() { return T.ed().querySelectorAll('b,strong').length; },
    };
    `,
  });
  return { context, page };
}

// 찾기/바꾸기 창을 열고 값을 채운다. formats: { bold: 'remove' } 등
export async function openReplace(page, { find = '', replace = '', formats = {}, particles = true } = {}) {
  await page.click('[data-action="replace"]');
  if (find !== null) await page.fill('#findText', find);
  await page.fill('#replaceText', replace);
  if (!particles) await page.uncheck('#adjustParticles');
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
      return bad.length;
    },
  };
}
