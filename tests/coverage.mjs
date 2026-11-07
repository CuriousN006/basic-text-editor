// 테스트가 index.html 스크립트의 어디를 실행하는지 잰다. 편집기 실행에는 필요 없다.
//   node coverage.mjs            모든 테스트를 커버리지 기록과 함께 돌린 뒤 보고
//   node coverage.mjs --report   이미 모은 기록(.coverage/)만 다시 보고
// 결과: 실행된 줄의 비율, 한 번도 실행되지 않은 함수, 실행되지 않은 큰 구간.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testJobs } from './test-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.EDITOR_DIR || path.join(HERE, '..');
const OUT = path.join(HERE, '.coverage');
const reportOnly = process.argv.includes('--report');

const runAll = async (files) => {
  // 지난 커버리지 기록만 지웁니다. 같은 폴더의 뮤테이션 결과는 남겨 둡니다.
  await fs.mkdir(OUT, { recursive: true });
  for (const name of await fs.readdir(OUT)) {
    if (name.endsWith('.json') && !name.startsWith('mutation')) await fs.rm(path.join(OUT, name));
  }
  const queue = [...files];
  const failed = [];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, [job.file], {
          cwd: HERE,
          env: { ...process.env, ...job.env, COVERAGE_DIR: OUT },
          stdio: ['ignore', 'ignore', 'inherit']
        });
        child.on('exit', resolve);
      });
      console.log(`${code === 0 ? '완료' : '실패'}  ${job.name}`);
      if (code !== 0) failed.push(job.name);
    }
  };
  await Promise.all(Array.from({ length: Math.min(files.length, Math.max(2, os.cpus().length >> 1)) }, worker));
  return failed;
};

// V8 범위는 바깥 범위 다음에 안쪽 범위가 오므로 순서대로 덮어쓰면 글자마다 실행 횟수가 된다.
const executedCharacters = (entry) => {
  const counts = new Int32Array(entry.source.length).fill(-1);
  for (const fn of entry.functions) {
    for (const range of fn.ranges) counts.fill(range.count, range.startOffset, range.endOffset);
  }
  return counts;
};

const report = async () => {
  // 윈도 체크아웃은 CRLF이지만 V8이 돌려주는 스크립트는 LF입니다.
  const html = (await fs.readFile(path.join(REPO, 'index.html'), 'utf8')).replace(/\r\n/g, '\n');
  const files = (await fs.readdir(OUT)).filter((name) => name.endsWith('.json') && name !== 'summary.json');
  let source = null;
  let covered = null;
  const functionHits = new Map();
  for (const name of files) {
    for (const entry of JSON.parse(await fs.readFile(path.join(OUT, name), 'utf8'))) {
      // 편집기 본체 스크립트만 봅니다(테스트가 주입한 스크립트 제외).
      if (!entry.source || !entry.source.includes("'use strict'")) continue;
      if (source === null) {
        source = entry.source;
        covered = new Uint8Array(source.length);
      }
      if (entry.source !== source) continue;
      const counts = executedCharacters(entry);
      for (let index = 0; index < counts.length; index += 1) if (counts[index] > 0) covered[index] = 1;
      for (const fn of entry.functions) {
        const [whole] = fn.ranges;
        if (!fn.functionName || !whole) continue;
        const key = `${fn.functionName}@${whole.startOffset}`;
        functionHits.set(key, (functionHits.get(key) || 0) + whole.count);
      }
    }
  }
  if (source === null) throw new Error('편집기 스크립트 기록이 없습니다.');

  const base = html.indexOf(source);
  const firstLine = html.slice(0, base).split('\n').length;
  const lines = source.split('\n');
  let offset = 0;
  const lineState = lines.map((text) => {
    const start = offset;
    offset += text.length + 1;
    const code = text.replace(/\/\/.*$/, '').trim();
    if (!code || /^[)\]};,]+$/.test(code)) return null; // 빈 줄·주석·닫는 괄호만 있는 줄은 세지 않음
    for (let index = start; index < start + text.length; index += 1) {
      if (!/\s/.test(source[index]) && covered[index]) return true;
    }
    return false;
  });
  const counted = lineState.filter((state) => state !== null);
  const hit = counted.filter(Boolean).length;

  const functions = [...functionHits.entries()];
  const neverRun = functions.filter(([, count]) => count === 0)
    .map(([key]) => {
      const [name, at] = key.split('@');
      return { name, line: firstLine + source.slice(0, Number(at)).split('\n').length - 1 };
    })
    .sort((left, right) => left.line - right.line);

  // 실행되지 않은 연속 구간(3줄 이상)과 그 구간을 품은 함수 이름
  const gaps = [];
  for (let index = 0; index < lines.length;) {
    if (lineState[index] !== false) {
      index += 1;
      continue;
    }
    let end = index;
    let size = 0;
    while (end < lines.length && lineState[end] !== true) {
      if (lineState[end] === false) size += 1;
      end += 1;
    }
    if (size >= 3) {
      let owner = '';
      for (let back = index; back >= 0 && !owner; back -= 1) {
        const match = lines[back].match(/^\s*(?:const|let|function)\s+([A-Za-z_$][\w$]*)\s*(?:=|\()/);
        if (match && lines[back].search(/\S/) <= 6) owner = match[1];
      }
      gaps.push({ from: firstLine + index, to: firstLine + end - 1, size, owner });
    }
    index = end;
  }
  gaps.sort((left, right) => right.size - left.size);

  const percent = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;
  console.log(`\n=== 커버리지 (index.html 스크립트, 기록 ${files.length}개 페이지) ===`);
  console.log(`줄: ${hit}/${counted.length} (${percent(hit, counted.length)})`);
  console.log(`이름 있는 함수: ${functions.length - neverRun.length}/${functions.length} (${percent(functions.length - neverRun.length, functions.length)})`);
  console.log(`\n한 번도 실행되지 않은 함수 ${neverRun.length}개:`);
  neverRun.forEach((fn) => console.log(`  index.html:${fn.line}  ${fn.name}`));
  console.log('\n실행되지 않은 큰 구간 (상위 40):');
  gaps.slice(0, 40).forEach((gap) => console.log(`  index.html:${gap.from}-${gap.to}  ${gap.size}줄  ${gap.owner}`));
  // mutation.mjs가 실행된 줄에만 버그를 심도록 실행된 index.html 줄 번호도 남깁니다.
  const coveredLines = lineState.flatMap((state, index) => (state ? [firstLine + index] : []));
  await fs.writeFile(path.join(OUT, 'summary.json'), JSON.stringify({ hit, total: counted.length, neverRun, gaps, coveredLines }, null, 2));
};

if (!reportOnly) {
  const failed = await runAll(testJobs());
  if (failed.length) console.log(`\n실패한 테스트 파일: ${failed.join(', ')} (커버리지는 실행된 만큼만 집계)`);
}
await report();
