# 개발용 검증 테스트

`index.html`을 실제 Chromium에서 열고 조작해 동작을 확인합니다.
**편집기를 쓰는 데는 필요하지 않습니다.** 편집기는 여전히 `index.html` 하나만으로 실행됩니다.

`contenteditable`과 `document.execCommand`는 실행 취소 기록처럼 코드만 읽어서는 확인할 수 없는 상태를 갖습니다.
그래서 이 테스트는 DOM 결과뿐 아니라 `Ctrl+Z` 이후의 문서 상태까지 함께 검사합니다.

## 실행

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

`npm test`는 테스트 파일들을 CPU 코어 수만큼 동시에 돌립니다. 오래 걸리는 파일(`tests.mjs` 등)은
`test-files.mjs`에 적은 조각 수만큼 나눠 동시에 돌립니다. 작업이 끝날 때마다 그 출력을 한꺼번에 찍고,
마지막에 전체 통과 개수와 실패한 검증을 모아 보여 줍니다.

```bash
node run.mjs tests.mjs table-format.mjs   # 고른 파일만
node run.mjs -j 4                         # 동시에 돌릴 개수 지정(느린 PC나 CI)
```

새 테스트 파일은 `test-files.mjs`에 추가합니다. 조각으로 나누는 파일은 `withPage` 블록 첫머리에서
`inShard()`로 자기 몫인지 확인하므로, 블록끼리 상태를 주고받지 않아야 합니다.

## 붙여넣기 검증 원칙

붙여넣기는 **반드시 실제 클립보드에 쓰고 실제 `Ctrl+V` 키를 눌러** 확인합니다.
`ClipboardEvent`를 손으로 만들어 넘기면 브라우저가 실제로 주는 클립보드 내용을
재현하지 못합니다. 태그 사이의 개행과 들여쓰기, 인라인 스타일 덩어리,
`<b style="font-weight:normal">` 같은 래퍼가 전부 빠지기 때문에 실제로 깨지는
경우를 하나도 잡지 못합니다.

커서도 실제와 같게 문단 안쪽에 둡니다. 편집기 최상위에 캐럿을 두면 현실에서
일어나지 않는 상태를 시험하게 됩니다.

## 성능 측정

```bash
npm run perf
```

## 수정 전 코드와 비교

`EDITOR_DIR`로 다른 사본을 가리키면 같은 테스트를 그 사본에 실행합니다.

```bash
mkdir -p /tmp/baseline
git show <커밋>:index.html > /tmp/baseline/index.html
EDITOR_DIR=/tmp/baseline npm test
```

## 구성

- `run.mjs` — 모든 테스트를 동시에 실행(`npm test`)
- `test-files.mjs` — 테스트 파일 목록과 나눠 돌릴 조각 수(`run.mjs`·`coverage.mjs`·`mutation.mjs`가 함께 씀)
- `harness.mjs` — 로컬 정적 서버, 브라우저 실행, 편집기 조작 헬퍼(`T.*`)
- `tests.mjs` — 기능·회귀·실행 취소 검증
- `table-paste.mjs` — HTML 표·마크다운 표의 실제 클립보드 붙여넣기 검증
- `table-controls.mjs` — 행·열 추가, 실제 핸들 드래그 선택·삭제, 병합 셀, 실행 취소와 터치 조작 검증
- `clipboard-spaces.mjs` — 실제 복사·잘라내기·붙여넣기에서 앞뒤 공백과 서식을 보존하는지 검증
- `findbar-scroll.mjs` — 치환 후 찾기·바꾸기 창을 닫을 때의 화면 위치와 포커스 복귀 검증
- `numbered-paste.mjs` — HTML·마크다운 번호 목록을 숫자가 포함된 일반 문단으로 붙여넣는지 검증
- `link-paste-scroll.mjs` — 실제 URL 붙여넣기, 연속 링크 변경, 스크롤 유지와 붙여넣기 뒤 커서 위치 검증
- `link-paste-half-window.mjs` — 반쪽 창 크기, 실제 마우스 선택, 붙여넣기 전·후 지연 스크롤 보정 검증
- `quote-paste.mjs` — 제미나이 등에서 복사한 HTML 인용구를 실제 `Ctrl+V`로 붙여넣을 때 인용문을 유지하는지 검증
- `replace-enter-format.mjs` — 바꿀 내용 칸에서 `Enter`로 이어 바꾸기, 서식 경계에 걸친 일치와 교정한 조사의 서식 검증
- `similar-shape.mjs` — 비슷한 모양 찾아 바꾸기: 숫자 자리·0 채우기·두 자리 연도, 첨자·LaTeX 기호, 이름·경로·이모티콘 제외, 조사 교정 검증
- `save-file-name.mjs` — 이름 없는 문서를 저장할 때 첫 줄로 고르는 파일 이름(다운로드·저장 창·복구한 초안)과 HTML·DOCX 제목 검증
- `table-format.mjs` — 손잡이·`Shift+Alt` 단축키로 고른 행·열에 서식 버튼과 `Ctrl+B`·`I`·`U`를 한 번에 적용, 병합 칸·제목 칸·빈 칸, 메뉴 위치
- `ui-buttons.mjs` — 서식 제거·실행 취소 버튼, 링크 미리보기(주소 복사·닫힘·위치), 인용 버튼, 파일 선택 창 열기·저장, DOCX 서식
- `coverage.mjs` — 테스트가 실행하는 코드 범위 측정(`node coverage.mjs`)
- `mutation.mjs` — 코드에 작은 버그를 심어 테스트가 잡는지 확인(`node mutation.mjs`)
- `perf.mjs` — 일괄 치환 소요 시간 측정
