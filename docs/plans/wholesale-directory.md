# 도매처 찾기 — 기능 기획 문서

> 상태: 설계 단계. DB에는 아직 배포되지 않음(`supabase/migrations/20260915094200_wholesalers.sql`
> 참조). 화면(UI)도 아직 없음 — 이 문서와 데이터 레이어(`wholesalers.js`)까지만 준비된 상태.

## 1. 기능 목적

LaunchDesk 사용자(1인 쇼핑몰 창업자)가 상품을 소싱할 도매처를 직접 검색해서 찾아다니는
대신, LaunchDesk 안에서 카테고리별로 정리된 도매처 목록을 바로 확인할 수 있게 한다.
운영자가 직접 검증한 곳 위주로 큐레이션하고, 사용자가 아는 도매처를 제보(등록 문의)할
수 있게 해서 목록을 점점 키워간다.

## 2. 사용자 흐름

**목록 조회 (비로그인 포함 전체 사용자)**
```
"도매처 찾기" 메뉴 진입
  → 카테고리 필터(전체/의류/패션잡화/생활용품/뷰티/식품/반려동물/가구·인테리어/포장·부자재)
  → 발행(published)된 도매처 카드 목록
  → (향후) 카드 클릭 → 상세페이지(slug 기반)
```

**등록 문의 (로그인 사용자만)**
```
목록 화면의 "도매처 등록 문의" 버튼
  → 비로그인이면 기존 로그인 모달 유도
  → 로그인 상태면 문의 폼(사이트명/URL/카테고리/설명/취급상품/최소주문조건/
    사업자회원 필요 여부/소량주문 가능 여부/위탁배송 가능 여부/메모) 제출
  → wholesaler_inquiries에 status='pending'으로 저장
  → 운영자 검토(Supabase Studio) → 승인 시 wholesalers에 새 행 생성(status='published')
    + wholesaler_inquiries.status='approved' + resolved_wholesaler_id 연결
  → 반려 시 wholesaler_inquiries.status='rejected' (+ admin_note에 사유)
  → (향후) 신청자는 "내 문의" 화면에서 본인 문의 상태를 확인 가능
```

## 3. 카테고리

DB 저장값(영문 slug) ↔ 화면 라벨(한글) 매핑은 `wholesalers.js`의 `CATEGORIES`에 정의:

| 저장값 | 라벨 |
|---|---|
| `clothing` | 의류 |
| `fashion_accessories` | 패션잡화 |
| `living` | 생활용품 |
| `beauty` | 뷰티 |
| `food` | 식품 |
| `pet` | 반려동물 |
| `furniture_interior` | 가구/인테리어 |
| `packaging` | 포장/부자재 |

"전체"는 DB 값이 아니라 UI 필터 전용 상태(= category 파라미터 없이 조회)다.

## 4. `wholesalers` 테이블 구조 (공개 디렉토리)

운영자가 Supabase Studio에서 직접 등록·발행·반려하는 공개 목록. 상세 컬럼은
`supabase/migrations/20260915094200_wholesalers.sql` 참조. 핵심 필드:

- `slug` — SEO용 고유 식별자 (§7 참조)
- `name`, `url`, `category`, `summary`, `main_products`, `min_order_condition`
- `requires_business_membership`, `allows_small_quantity`, `allows_dropshipping` — 각각 boolean
- `status` — `pending` / `published` / `rejected` (기본값 `pending`)
- `source_inquiry_id` — 사용자 문의에서 채택되어 만들어진 경우 그 문의를 가리킴(추적용, nullable)

## 5. `wholesaler_inquiries` 테이블 구조 (등록 문의)

로그인 사용자가 남기는 제보. `wholesalers`와 컬럼 구성은 거의 같지만 별도 테이블로
분리했다 — 공개 여부(RLS)가 정반대이고(하나는 "published만 전체 공개", 하나는 "본인
것만 비공개"), 문의는 승인 전까지 목록에 절대 노출되면 안 되기 때문이다. 추가 필드:

- `user_id` — 문의를 남긴 사용자 (auth.users FK, 계정 삭제 시 cascade)
- `contact_email` — 회신용 연락처(로그인 이메일과 다를 수 있어 별도 입력받음)
- `memo` — 신청자가 남기는 자유 메모
- `status` — `pending` / `approved` / `rejected`
- `admin_note` — 반려 사유 등 운영자 메모 (신청자도 조회 가능, 작성은 운영자만)
- `resolved_wholesaler_id` — 승인되어 생성된 `wholesalers` 행 연결 (nullable)

## 6. RLS 요약

| 테이블 | SELECT | INSERT | UPDATE/DELETE |
|---|---|---|---|
| `wholesalers` | anon+authenticated, `status='published'`만 | 없음(Studio만) | 없음(Studio만) |
| `wholesaler_inquiries` | authenticated, 본인 행만(`user_id = auth.uid()`) | authenticated, `user_id = auth.uid()`로만 | 없음(Studio만) |

두 테이블 모두 클라이언트 키로는 승인/발행/반려를 할 수 없다 — 이 프로젝트에 아직
관리자 role 시스템이 없으므로, 지금 단계에서 새로 만들지 않고 운영자가 Supabase
Studio(service_role)에서 직접 상태를 바꾸는 방식으로 처리한다(§8).

## 7. 등록문의 → 검토 → 발행 흐름 (운영 절차)

1. 사용자가 문의 폼 제출 → `wholesaler_inquiries` 행 생성 (`status='pending'`)
2. 운영자가 Supabase Studio Table Editor에서 `wholesaler_inquiries`를 확인
3. **승인**: `wholesalers`에 새 행을 만들고(`status='published'`, `slug` 직접 지정),
   방금 만든 문의 행에 `status='approved'` + `resolved_wholesaler_id` 설정
4. **반려**: 문의 행에 `status='rejected'` + `admin_note`에 사유 기록
5. (향후) 신청자가 "내 문의" 화면에서 자기 문의의 최종 상태를 확인

## 8. 초기 운영 방식 — Supabase Studio 수동 처리

MVP 단계에서는 별도 관리자 화면이나 Edge Function을 만들지 않는다. 운영자가
Supabase 대시보드의 Table Editor에서 직접:
- `wholesalers` 행 생성/수정/발행(`status` 변경)
- `wholesaler_inquiries` 행 검토 및 승인/반려 처리

를 수행한다. 이 방식의 장점은 이번 기능 때문에 새로운 인증/역할 체계를 만들
필요가 없다는 것이고, 단점은 문의량이 많아지면 운영 부담이 커진다는 것이다 — 그
시점이 오면 §9로 확장한다.

## 9. 추후 관리자 페이지 확장 (미확정, 참고용)

문의량이 늘어나 Studio 수동 처리가 병목이 되면 고려할 방향:
- `profiles.is_admin` boolean 컬럼(또는 별도 `admin_users` 테이블) 추가
- 해당 플래그를 확인하는 RLS 정책(또는 SECURITY DEFINER 함수)으로 승인/발행을
  authenticated 관리자에게 열어주기
- LaunchDesk 안에 `/admin/wholesalers` 같은 전용 화면 추가
- 승인 시 신청자에게 알림 메일을 보내는 Edge Function (그때 `supabase/config.toml`에
  해당 함수 설정 추가 필요)

## 10. SEO — slug 방향

- `wholesalers.slug`는 지금부터 필수·유니크 컬럼으로 만들어둔다(마이그레이션에 포함).
  나중에 기존 행에 slug를 소급 채우는 것보다, 처음부터 있는 게 훨씬 싸다.
- 상세페이지 라우트(`#/wholesale/:slug` 등)와 렌더링은 이번 단계에서 만들지 않는다 —
  `index.html`/`app.js` 라우팅 작업과 함께 나중에 진행(조사 보고서의 "구현 순서" 4~5단계).
- slug 생성 규칙은 운영자가 발행 시 직접 입력(자동 슬러그화 로직은 지금 만들지 않음,
  문의량이 적은 초기 단계엔 수동으로 충분).

## 11. 향후 수익화 (미확정 — 방향 메모)

- 기본 등록: 무료
- 추천 도매처: 목록 상단/카드에 "추천" 배지, 유상 또는 운영자 선정
- 카테고리 상단 노출: 특정 카테고리 내 상단 고정 슬롯 판매
- 스폰서: 배너/특정 슬롯 스폰서십

수익모델 자체는 이 문서 시점에 확정된 바 없다 — 위 항목은 나중에 검토할 방향성
메모일 뿐, 지금 구현 범위에 포함되지 않는다.

## 12. 향후 분석 (미확정 — 방향 메모)

- 도매처 사이트 방문(카드의 외부 링크 클릭) 수 — 카테고리/사이트별
- 등록 문의 수 — 기간별, 승인율
- 카테고리별 조회 수 — 어떤 카테고리 수요가 큰지 파악

측정 방법(GA4 커스텀 이벤트 vs 자체 카운트 테이블)은 미확정. 기존 프로젝트가
GA4(`gtag`)를 라우팅 이벤트에 이미 쓰고 있으므로, 화면이 생기는 단계에서 같은
방식을 우선 검토한다.
