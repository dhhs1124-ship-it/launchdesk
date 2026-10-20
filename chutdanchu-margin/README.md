# 첫단추 마진 계산기

인스타그램 '마진' 댓글 DM으로 공유하는 독립 정적 페이지. 로그인 · DB · API 없음. 입력한 금액은 서버에 전송하거나 저장하지 않는다(CSP `connect-src none`으로 전송 시도 차단, localStorage · 쿠키 미사용). 페이지 자체를 불러오는 요청(HTML · CSS · JS · 로고)은 당연히 있다.

- `margin-calc.js`: `launchroas/margin-calc.js`의 변경 없는 복사본. 원본이 바뀌면 `core.test.js` 첫 테스트가 실패하므로 함께 복사한다.
- `chutdanchu-core.js`: 단순 입력 → 계산 모듈 입력 변환, 할인 전후 비교.
  - 수수료: 할인 후 판매금액 × 요율(입력값 그대로).
  - 배송비: 고객에게 받은 배송비를 뺀 판매자 순부담액 1칸(고객 배송비 0으로 넘겨 중복 차감 없음).
  - 마진율 분모: 할인 후 판매금액. 0원이면 '계산 불가'.
  - '고객에게 배송비를 받았어요'를 펼치면(유료배송 상세 입력): 받은 배송비 · 실제 택배비 두 칸으로 바뀌고 간단 입력 칸은 계산에서 빠진다. LaunchROAS의 '배송비 수수료: 상품과 동일'과 같이 수수료 기준과 마진율 분모 모두 할인 후 판매금액 + 받은 배송비. 처음 펼칠 때 실제 택배비에 간단 입력값을 옮겨 결과가 그대로다.
- `app.js`, `index.html`, `styles.css`: 화면. `logo.png`: 첫단추 2×2 단추 심볼(원본에서 잘라 192px). `screenshots/`: 예시 화면 캡처(가정한 값, 배포 제외).

LaunchDesk(`index.html` 참조 파일만 dist로 복사)와 LaunchROAS(Root Directory `launchroas`) 배포에는 포함되지 않는다.

## 미리보기

```powershell
node --test chutdanchu-margin/core.test.js
npx --yes serve chutdanchu-margin -l 4310
```

## 공개 링크 만들기 (대환 승인 후)

1. 이 브랜치를 GitHub에 push.
2. Vercel → Add New Project → `launchdesk` 저장소 → Root Directory `chutdanchu-margin`, Framework `Other`, Build Command 비움.
3. 배포 후 `https://<프로젝트명>.vercel.app` 이 공개 링크. 프로젝트명을 `chutdanchu-margin`으로 하면 주소가 짧다.
4. Settings → Git → Ignored Build Step에 `git diff --quiet HEAD^ HEAD -- .` 를 넣으면 이 폴더가 바뀔 때만 다시 배포된다.
