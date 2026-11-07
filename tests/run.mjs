// 모든 테스트를 동시에 돌립니다(npm test). 파일마다 브라우저를 따로 띄우므로 서로의
// 클립보드나 다운로드에 끼어들지 않습니다. 출력은 작업이 끝날 때마다 한꺼번에 찍습니다.
//   node run.mjs                     전체
//   node run.mjs tests.mjs ...       고른 파일만
//   node run.mjs -j 4                동시에 돌릴 개수(기본: CPU 코어 수)
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testJobs } from './test-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const jobsFlag = args.indexOf('-j');
const concurrency = jobsFlag >= 0 ? Math.max(1, Number(args[jobsFlag + 1]) || 1) : os.availableParallelism();
const only = args.filter((arg, index) => arg.endsWith('.mjs') && !(jobsFlag >= 0 && index === jobsFlag + 1));
const jobs = testJobs(only);
if (!jobs.length) {
  console.log(`테스트 파일을 찾지 못했습니다: ${only.join(', ')}`);
  process.exit(1);
}

const started = Date.now();
const results = [];
const queue = [...jobs];
const runJob = (job) => new Promise((resolve) => {
  const jobStarted = Date.now();
  const child = spawn(process.execPath, [job.file], { cwd: HERE, env: { ...process.env, ...job.env } });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('close', (code) => {
    const counts = output.match(/=== (\d+)\/(\d+) PASS ===/);
    const result = {
      ...job,
      code,
      output,
      passed: counts ? Number(counts[1]) : 0,
      total: counts ? Number(counts[2]) : 0,
      seconds: (Date.now() - jobStarted) / 1000
    };
    console.log(`\n##### ${job.name} — ${code === 0 ? '통과' : '실패'} (${result.seconds.toFixed(1)}초)`);
    process.stdout.write(output);
    results.push(result);
    resolve();
  });
});
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (queue.length) await runJob(queue.shift());
}));

const failed = results.filter((result) => result.code !== 0);
const passed = results.reduce((sum, result) => sum + result.passed, 0);
const total = results.reduce((sum, result) => sum + result.total, 0);
// 도중에 멈춘 작업은 통과 개수를 남기지 않으므로 실패한 작업 수를 따로 적습니다.
console.log(`\n=== 전체 ${passed}/${total} PASS · 작업 ${jobs.length}개${failed.length ? ` 중 ${failed.length}개 실패` : ''} · ${((Date.now() - started) / 1000).toFixed(1)}초 ===`);
if (failed.length) {
  console.log('\n실패한 작업:');
  for (const result of failed) {
    console.log(`- ${result.name} (종료 코드 ${result.code})`);
    for (const line of result.output.split(/\r?\n/)) {
      if (/^FAIL {2}|^ {6}(기대|실제):/.test(line)) console.log(`  ${line}`);
    }
  }
}
process.exit(failed.length ? 1 : 0);
