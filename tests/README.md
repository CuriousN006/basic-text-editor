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

- `harness.mjs` — 로컬 정적 서버, 브라우저 실행, 편집기 조작 헬퍼(`T.*`)
- `tests.mjs` — 기능·회귀·실행 취소 검증
- `perf.mjs` — 일괄 치환 소요 시간 측정
