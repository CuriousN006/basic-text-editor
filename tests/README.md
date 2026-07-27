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
