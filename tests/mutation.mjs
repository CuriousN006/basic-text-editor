// 테스트를 테스트한다: index.html에 일부러 작은 버그(돌연변이)를 하나씩 심고
// 테스트가 그 버그를 잡는지(죽이는지) 본다. 살아남은 돌연변이가 테스트의 구멍이다.
//   node coverage.mjs             먼저 실행해 실행된 줄을 기록(.coverage/summary.json)
//   node mutation.mjs [--count 60] [--seed 1] [--only 1234,5678]
// 실행된 줄에만 심고, 문법이 깨지는 돌연변이는 버린다. 결과는 .coverage/mutation.json.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { testJobs } from './test-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const OUT = path.join(HERE, '.coverage');
const argument = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const COUNT = Number(argument('count', 60));
const SEED = Number(argument('seed', 1));
const ONLY = argument('only', '') ? new Set(argument('only').split(',').map(Number)) : null;
const MUTANT_TIMEOUT = 5 * 60 * 1000;

// 연산자를 하나만 바꾸는 돌연변이 규칙. 앞뒤 글자로 다른 연산자 일부가 아닌지 확인한다.
const OPERATORS = [
  { from: '===', to: '!==' }, { from: '!==', to: '===' },
  { from: '&&', to: '||' }, { from: '||', to: '&&' },
  { from: '>=', to: '>' }, { from: '<=', to: '<' },
  { from: ' > ', to: ' >= ' }, { from: ' < ', to: ' <= ' },
  { from: ' + 1', to: ' - 1' }, { from: ' - 1', to: ' + 1' },
  { from: 'true', to: 'false', word: true }, { from: 'false', to: 'true', word: true },
  { from: 'if (!', to: 'if (' },
  { from: '.trim()', to: '' },
  { from: 'break;', to: ';' }, { from: 'continue;', to: ';' }
];

const random = (() => {
  let state = SEED >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
})();

const original = (await fs.readFile(path.join(REPO, 'index.html'), 'utf8')).replace(/\r\n/g, '\n');
const lines = original.split('\n');
const scriptStart = lines.findIndex((line) => line.trim() === '<script>') + 1;
const scriptEnd = lines.findLastIndex((line) => line.trim() === '</script>');
const covered = new Set(JSON.parse(await fs.readFile(path.join(OUT, 'summary.json'), 'utf8')).coveredLines);

const compiles = (source) => {
  const script = source.split('\n').slice(scriptStart, scriptEnd).join('\n');
  try {
    new vm.Script(script);
    return true;
  } catch {
    return false;
  }
};

// 후보 모으기: 실행된 줄, 주석이 아닌 곳, 정규식·문자열 한가운데를 피해 대략 고른다.
const candidates = [];
for (let index = scriptStart; index < scriptEnd; index += 1) {
  const lineNumber = index + 1;
  if (!covered.has(lineNumber)) continue;
  const text = lines[index];
  const code = text.replace(/\/\/.*$/, '');
  if (!code.trim() || /^\s*\*/.test(code)) continue;
  for (const operator of OPERATORS) {
    let at = code.indexOf(operator.from);
    while (at >= 0) {
      const before = code[at - 1] || ' ';
      const after = code[at + operator.from.length] || ' ';
      const wordOk = !operator.word || (!/[\w$]/.test(before) && !/[\w$]/.test(after));
      const symbolOk = operator.word || !/[=!<>&|]/.test(after) || operator.from.startsWith(' ');
      const quotes = (code.slice(0, at).match(/['"`]/g) || []).length;
      if (wordOk && symbolOk && quotes % 2 === 0) {
        candidates.push({ line: lineNumber, at, from: operator.from, to: operator.to });
      }
      at = code.indexOf(operator.from, at + 1);
    }
  }
}

// --replay 를 주면 지난 결과(.coverage/mutation.json)에서 살아남은 돌연변이만 같은 자리에 다시 심는다.
// 테스트를 보강한 뒤 그 구멍이 메워졌는지 확인할 때 쓴다.
const REPLAY = process.argv.includes('--replay');
if (REPLAY) {
  const previous = JSON.parse(await fs.readFile(path.join(OUT, 'mutation.json'), 'utf8'));
  const survivors = previous.filter((result) => result.status === 'survived');
  // 그사이 코드가 바뀌어 줄 번호가 밀려도 같은 줄 내용(바꾸기 전과 후)으로 다시 찾습니다.
  // 똑같은 줄이 여러 곳에 있으면(return true; 등) 그 모두에 심어 봅니다.
  candidates.splice(0, candidates.length, ...candidates.filter((candidate) => {
    const text = lines[candidate.line - 1];
    const after = (text.slice(0, candidate.at) + candidate.to + text.slice(candidate.at + candidate.from.length)).trim();
    return survivors.some((survivor) => survivor.before === text.trim() && survivor.after === after);
  }));
}

// 같은 줄에 몰리지 않게 줄 단위로 섞은 뒤 고른다.
const shuffled = candidates
  .map((candidate) => ({ candidate, key: random() }))
  .sort((left, right) => left.key - right.key)
  .map(({ candidate }) => candidate);
const chosen = [];
const usedLines = new Set();
for (const candidate of shuffled) {
  if (chosen.length >= COUNT) break;
  if (ONLY ? !ONLY.has(candidate.line) : usedLines.has(candidate.line)) continue;
  const mutated = [...lines];
  const text = mutated[candidate.line - 1];
  mutated[candidate.line - 1] = text.slice(0, candidate.at) + candidate.to + text.slice(candidate.at + candidate.from.length);
  const source = mutated.join('\n');
  if (!compiles(source)) continue;
  usedLines.add(candidate.line);
  chosen.push({ ...candidate, before: text.trim(), after: mutated[candidate.line - 1].trim(), source });
}

const jobs = testJobs();
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'bte-mutant-'));

// 도는 동안 테스트 파일을 고쳐도 결과가 섞이지 않도록 시작할 때의 테스트를 복사해 씁니다.
const TESTS = path.join(work, 'tests');
await fs.mkdir(TESTS);
for (const name of await fs.readdir(HERE)) {
  if (name.endsWith('.mjs') || name === 'package.json' || name === 'README.md') {
    await fs.copyFile(path.join(HERE, name), path.join(TESTS, name));
  }
}
await fs.symlink(path.join(HERE, 'node_modules'), path.join(TESTS, 'node_modules'), 'junction');

// 돌연변이 하나에 테스트 파일 전부를 동시에 돌리고, 처음 FAIL이 나오면 모두 멈춘다.
const runMutant = (mutant, dir) => new Promise((resolve) => {
  const children = [];
  let settled = false;
  let finished = 0;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    children.forEach((child) => child.kill());
    resolve(result);
  };
  const timer = setTimeout(() => finish({ status: 'killed', by: '시간 초과' }), MUTANT_TIMEOUT);
  for (const { file, name, env } of jobs) {
    const child = spawn(process.execPath, [file], { cwd: TESTS, env: { ...process.env, ...env, EDITOR_DIR: dir } });
    children.push(child);
    let buffer = '';
    const watch = (chunk) => {
      buffer += chunk;
      const failure = buffer.match(/^FAIL {2}(.+)$/m);
      if (failure) finish({ status: 'killed', by: `${name}: ${failure[1].trim()}` });
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', (chunk) => { buffer += chunk; });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) finish({ status: 'killed', by: `${name}: 종료 코드 ${code}` });
      finished += 1;
      if (finished === jobs.length) finish({ status: 'survived' });
    });
  }
});

// 돌연변이 없이 먼저 돌려 봅니다. 여기서 실패하면 모든 돌연변이가 "잡힌" 것처럼 보입니다.
const control = path.join(work, 'control');
await fs.mkdir(control);
await fs.writeFile(path.join(control, 'index.html'), original);
const baseline = await runMutant(null, control);
if (baseline.status !== 'survived') {
  console.log(`원본 코드에서 테스트가 실패해 중단합니다: ${baseline.by}`);
  process.exit(1);
}

console.log(`후보 ${candidates.length}개 중 ${chosen.length}개를 심습니다 (seed ${SEED}).`);
const results = [];
for (const [index, mutant] of chosen.entries()) {
  const dir = path.join(work, String(index));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), mutant.source);
  const started = Date.now();
  const result = await runMutant(mutant, dir);
  const seconds = Math.round((Date.now() - started) / 1000);
  const { source, ...record } = mutant;
  results.push({ ...record, ...result, seconds });
  console.log(`${result.status === 'survived' ? '생존' : '사망'} ${String(index + 1).padStart(3)}/${chosen.length}  index.html:${mutant.line}  ${mutant.from} → ${mutant.to || '(삭제)'}  ${seconds}s  ${result.by || ''}`);
  await fs.writeFile(path.join(OUT, 'mutation.json'), JSON.stringify(results, null, 2));
}
const survived = results.filter((result) => result.status === 'survived');
console.log(`\n=== 돌연변이 ${results.length}개 중 ${results.length - survived.length}개 잡음 (점수 ${((1 - survived.length / results.length) * 100).toFixed(1)}%) ===`);
survived.forEach((result) => console.log(`  생존 index.html:${result.line}\n    전: ${result.before}\n    후: ${result.after}`));
// 윈도는 방금 끝낸 브라우저가 파일을 잠시 붙잡고 있으므로 몇 번 다시 시도하고, 그래도 안 되면 남겨 둡니다.
await fs.rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {});
