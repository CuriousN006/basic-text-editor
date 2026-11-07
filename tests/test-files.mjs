// 테스트 파일 목록입니다. run.mjs(npm test), coverage.mjs, mutation.mjs가 함께 씁니다.
// shards는 오래 걸리는 파일을 몇 조각으로 나눠 동시에 돌릴지입니다. 조각마다 withPage 블록을
// 번갈아 맡으므로(harness.mjs의 inShard) 블록끼리 상태를 주고받지 않는 파일만 나눌 수 있습니다.
export const TEST_FILES = [
  { file: 'tests.mjs', shards: 6 },
  { file: 'similar-shape.mjs', shards: 2 },
  { file: 'table-controls.mjs', shards: 2 },
  { file: 'table-paste.mjs' },
  { file: 'link-paste-scroll.mjs' },
  { file: 'numbered-paste.mjs' },
  { file: 'findbar-scroll.mjs' },
  { file: 'replace-enter-format.mjs' },
  { file: 'drafts.mjs' },
  { file: 'save-file-name.mjs' },
  { file: 'table-format.mjs' },
  { file: 'link-paste-half-window.mjs' },
  { file: 'clipboard-spaces.mjs' },
  { file: 'quote-paste.mjs' },
  { file: 'ui-buttons.mjs' }
];

// 실제로 띄울 작업 목록입니다. 조각은 TEST_SHARD="i/n" 환경 변수로 구분합니다.
export const testJobs = (only = []) => TEST_FILES
  .filter(({ file }) => !only.length || only.includes(file))
  .flatMap(({ file, shards = 1 }) => Array.from({ length: shards }, (_, index) => ({
    file,
    name: shards > 1 ? `${file} [${index + 1}/${shards}]` : file,
    env: shards > 1 ? { TEST_SHARD: `${index}/${shards}` } : {}
  })));
