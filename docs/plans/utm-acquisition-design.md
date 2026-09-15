# UTM 유입(First-Touch Acquisition) 설계안

> 상태: **구현 완료(2026-09-15, 별도 작업).** `supabase/migrations/20260915320000_
> user_acquisition.sql`(테이블 + `record_user_acquisition()` + `admin_beta_
> acquisition_overview()`) · `utm-acquisition.js`(신규) · `app.js`
> `handleSession()` 1줄 추가 · `admin.js` "유입별 전환" 섹션으로 구현됐다.
> 아래 본문은 조사/설계 기록이며, 실제 구현에서 이 설계와 달라진 부분(§3
> RLS 정책 없음으로 조정, §6 관리자 집계를 source+medium 2단으로 단순화 등)은
> 해당 작업 보고서와 마이그레이션 파일 주석에 명시돼 있다. 이 문서 자체는
> 과거 조사 기록으로서 그대로 남겨둔다.
>
> 아래는 원래 "왜 이번에 안 했는지"와 "다음에 구현한다면 어떻게 할지"를
> 남겨두는 목적으로 작성됐던 설계 초안이다(2026-09-15, 이전 작업).

---

## 1. 왜 이번 단계에서 구현하지 않았는가

행동 이벤트(`product_events`)·7일 재방문 지표는 이번 브랜치의 기존
로그인/라우팅 코드를 거의 건드리지 않고 추가할 수 있었다(app.js의 `render()`/
`setChapterDone()`에 계측 코드만 얹었을 뿐, 로그인 상태 판별 로직 자체는
전혀 바꾸지 않았다). 반면 UTM first-touch는 구조적으로 다음 지점을 반드시
건드려야 한다.

- app.js의 `handleSession()` — 로그인 상태 판별·hydrate·게스트 병합을 전부
  담당하는, 이 프로젝트에서 가장 조심스럽게 다뤄진 상태 머신(이미 "탭
  재포커스로 SIGNED_IN이 다시 발생해도 오작동하지 않게" 등 여러 겹의 가드가
  있다 — [app.js](../../app.js) L222-228, L1027-1055 참고).
- 새 localStorage 키 하나(UTM 임시 저장) — 기존 키와 충돌하지는 않지만,
  "언제 읽고, 언제 지우는지"를 이 상태 머신의 타이밍과 정확히 맞춰야 한다.

이 자체가 "복잡하게 충돌한다"는 뜻은 아니다(실제로 아래 3장에서 확인한
결론은 "충돌하지 않는다"이다). 다만 이번 요청은 이미 범위가 넓고(행동
이벤트+재방문+관리자 UI), 여기에 이 상태 머신을 건드리는 변경까지 같은
배포에 얹으면 리뷰/회귀 검증 부담이 함께 커진다. 그래서 이번 단계는 A(행동
이벤트+재방문+UTM 전부)가 아니라 B(행동 이벤트+재방문 먼저, UTM은 설계만)를
선택했다.

## 2. 현재 상태 조사 결과

- `utm_`, `localStorage`, `sessionStorage`로 grep한 결과, 이 저장소 어디에도
  UTM 파라미터를 저장하는 코드가 없다(전부 신규 구현 필요).
- 회원가입은 이메일 컨펌 방식이다([app.js](../../app.js) L311-318) —
  `signUp()` 호출 시점에는 세션이 없고, 사용자가 이메일의 확인 링크를 클릭한
  뒤에야 세션이 생긴다. 즉 "가입 이벤트 자체"와 "최초로 인증된 세션이
  생기는 시점"이 분리되어 있어, UTM을 auth.uid()에 연결하려면 후자(로그인
  상태가 확정되는 시점)에서 처리해야 한다 — 이는 아래 4장 설계와 일치한다.

## 3. DB 설계안

```sql
create table public.user_acquisition (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text,
  medium text,
  campaign text,
  content text,
  term text,
  landing_path text,
  created_at timestamptz not null default now()
);
```

- `source`/`medium`/`campaign`/`content`/`term`은 각각 100자 내외로 길이
  제한(CHECK) — 광고 플랫폼이 실제로 붙이는 값은 짧고, 과도하게 긴 값은
  이상 입력으로 간주해 자르거나 거부한다.
- `landing_path`는 해시 라우트(`/`, `/start` 등)만 저장 — 전체 URL이나
  쿼리스트링 원문은 저장하지 않는다(민감 파라미터 유입 방지, 요구사항 11).
- 이메일/전화번호 등 PII 컬럼 없음.
- `user_id`가 PK이자 FK이므로, 한 사용자당 정확히 0개 또는 1개의 행만
  존재할 수 있다 — "여러 번 갱신되는 최신값"이 아니라 "최초 1회만 기록되는
  first-touch"라는 걸 스키마 수준에서 강제한다.

## 4. RPC 설계안 — `record_user_acquisition`

```sql
create or replace function public.record_user_acquisition(
  p_source text default null,
  p_medium text default null,
  p_campaign text default null,
  p_content text default null,
  p_term text default null,
  p_landing_path text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.user_acquisition (user_id, source, medium, campaign, content, term, landing_path)
  values (
    v_user_id,
    left(p_source, 100), left(p_medium, 100), left(p_campaign, 100),
    left(p_content, 100), left(p_term, 100), left(p_landing_path, 200)
  )
  on conflict (user_id) do nothing; -- first-touch — 이미 기록이 있으면 절대 덮어쓰지 않는다
end;
$$;

revoke all on function public.record_user_acquisition(text, text, text, text, text, text) from public;
grant execute on function public.record_user_acquisition(text, text, text, text, text, text) to authenticated;
```

`product_events`와 동일한 이유로 SECURITY DEFINER + 테이블 자체에는 authenticated
GRANT 없음(RPC만이 유일한 쓰기 경로) 패턴을 그대로 재사용한다.

## 5. 클라이언트 캡처 시점

1. **랜딩 시점(비로그인 포함)**: 페이지 최초 로드 시 1회, `location.search`에서
   `utm_source`가 있으면 5개 필드 + 현재 해시 경로를 하나의 JSON으로
   `localStorage`(예: `ld-pending-acquisition`, 기존 키와 겹치지 않음)에
   저장한다. `utm_source`가 없으면 아무것도 저장하지 않는다 — "값이 없으면
   direct로 명시 저장"이 아니라 "행 자체가 없으면 direct/organic으로 간주"
   방식을 채택한다(더 단순하고, 이후 집계 쪽에서 `not exists`로 처리 가능).
2. **최초 인증 세션 확정 시점**: `app.js`의 `handleSession()`이 이미 "이
   user_id로 hydrate를 실행하는" 그 지점(중복 실행 가드 포함)에서,
   `localStorage`에 대기 중인 UTM이 있으면 `record_user_acquisition` RPC를
   호출하고, 성공/실패와 무관하게 `localStorage`의 대기 값을 지운다(매
   로그인마다 다시 보내지 않기 위함 — 어차피 `ON CONFLICT DO NOTHING`이
   서버 쪽에서도 중복을 막지만, 불필요한 요청 자체를 줄인다).

### 알려진 한계 — 이메일 컨펌이 다른 기기/브라우저에서 열리는 경우

`signUp()` 시점엔 세션이 없으므로, UTM은 "랜딩 시 localStorage에 대기 →
로그인 확정 시 전송" 방식일 수밖에 없다. 만약 사용자가 광고를 클릭해 랜딩한
브라우저와 확인 이메일을 열어 인증을 완료하는 브라우저/기기가 다르면(실제로
흔하다 — PC에서 가입, 모바일 메일 앱에서 인증), localStorage가 기기를
넘어가지 못해 해당 사용자는 first-touch가 기록되지 않고 "direct"로
집계된다. 이는 서버 쿠키 없이 클라이언트 저장소만으로 first-touch를 구현하는
방식의 일반적인 한계이며, 완전히 해결하려면 확인 링크 자체에 UTM을 실어
보내는 등 이메일 발송 로직까지 손대야 한다 — 이번 설계에서는 "완전한 커버리지
보다 단순함"을 택했고, 실제 구현 시에도 이 한계를 관리자 화면에 명시해야
한다(예: "UTM 없음 = 반드시 direct라는 뜻은 아니며, 다른 기기에서 인증한
가입자를 포함할 수 있습니다").

## 6. 관리자 집계 방식(후속 단계)

이번 UI에 바로 반영하지 않는다(요구사항 13 — source별 상세 리포트는 후속
단계). 구현된다면:

- `admin_acquisition_overview()` 같은 새 RPC를 `admin_beta_overview()`와
  분리해서 만든다(기존 캐노니컬 퍼널 RPC를 수정하지 않는다 — 이번 작업에서
  세운 "행동/유입 지표는 기존 캐노니컬 RPC에 억지로 합치지 않는다" 원칙과
  동일).
- `user_acquisition`을 `source`/`medium`/`campaign`으로 그룹핑하고, 각
  그룹의 `user_id` 집합을 `stores`/`connected_accounts`와 조인해 채널별
  가입자/쇼핑몰 등록/Cafe24 연결 수를 반환한다(요구사항 13 예시 그대로).
- `admin_users` 제외 여부는 그 시점에 다시 판단한다(운영자 본인이 광고를
  통해 유입될 일은 거의 없어 실익이 적을 수 있음 — 별도 검토).

## 7. 인덱스(후속 구현 시)

```sql
create index on public.user_acquisition (source, medium, campaign);
```

100~1000 사용자 규모에서는 이 하나로 충분하다(요구사항 16과 동일한 원칙).
