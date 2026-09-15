/* "도매처 찾기" — 데이터 레이어 전용 파일.

   이 단계에서는 아직 index.html에 이 기능의 화면(DOM)이 없으므로, DOM
   조작/모달/토스트/라우팅은 전혀 만들지 않는다. stores.js/ops-overview.js와
   같은 "독립 IIFE + Supabase 직접 호출" 스타일은 따르되, 이 파일이 노출하는
   건 오직 데이터 함수뿐이다 — 나중에 화면이 생기면 그 화면 쪽 코드가 이
   함수들을 불러 쓰면 된다.

   window.launchdeskWholesalers 라는 이름으로만 노출한다 — 기존 전역
   (launchdeskSupabase/launchdeskStore 등)과 겹치지 않게 하기 위함.

   보안: published 목록 조회는 로그인 여부와 무관하게(anon도) 동작해야
   하고, 문의 등록은 로그인 사용자만 가능해야 한다 — 실제 강제는 DB의 RLS
   (supabase/migrations/20260915094200_wholesalers.sql)가 담당하고, 이
   파일은 그 앞단에서 사용자에게 더 친절한 실패 사유(NOT_AUTHENTICATED 등)를
   먼저 돌려주는 역할만 한다. user_id는 이 파일이 임의로 만들어 보내지
   않고, 매번 sb.auth.getSession()으로 얻은 서버 세션의 user.id만 쓴다
   (+ 어차피 DB의 insert 정책이 user_id = auth.uid()가 아니면 거부한다). */
(function(){
  function client(){ return window.launchdeskSupabase || null; }

  // ------------------------------------------------------------------ 카테고리
  // DB(wholesalers.category / wholesaler_inquiries.category)의 CHECK
  // 제약과 정확히 같은 값 목록. "전체"는 DB 값이 아니라 UI 필터 전용이라
  // 여기 넣지 않는다 — 화면 쪽에서 "전체" 탭은 category 파라미터를 아예
  // 넘기지 않는 방식(= 필터 없음)으로 구현하면 된다.
  var CATEGORIES = [
    { value: 'clothing',             label: '의류' },
    { value: 'fashion_accessories',  label: '패션잡화' },
    { value: 'living',               label: '생활용품' },
    { value: 'beauty',               label: '뷰티' },
    { value: 'food',                 label: '식품' },
    { value: 'pet',                  label: '반려동물' },
    { value: 'furniture_interior',   label: '가구/인테리어' },
    { value: 'packaging',            label: '포장/부자재' }
  ];
  var CATEGORY_LABEL_BY_VALUE = {};
  CATEGORIES.forEach(function(c){ CATEGORY_LABEL_BY_VALUE[c.value] = c.label; });

  function isValidCategory(value){
    return CATEGORY_LABEL_BY_VALUE.hasOwnProperty(value);
  }

  function categoryLabel(value){
    return CATEGORY_LABEL_BY_VALUE[value] || value;
  }

  // ------------------------------------------------------------------ 유틸
  function trimOrEmpty(v){
    return (typeof v === 'string') ? v.trim() : '';
  }

  // 형식만 가볍게 검증한다(실제 접속 가능 여부까지는 확인하지 않음) —
  // http(s):// 로 시작하고 그 뒤에 뭔가 있으면 통과.
  function isValidUrl(v){
    return /^https?:\/\/.+/i.test(v);
  }

  function isValidEmail(v){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  // ------------------------------------------------------------------ 목록 조회
  // 로그인 여부와 무관하게 호출 가능(RLS가 published만 돌려주므로 anon
  // 세션이어도 안전). category를 생략하면 전체(published 전부)를 반환한다.
  //
  // 반환: Promise<{ ok: true, data: [...] } | { ok: false, error: string }>
  function fetchPublishedWholesalers(category){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    if(category != null && !isValidCategory(category)){
      return Promise.resolve({ ok: false, error: 'INVALID_CATEGORY' });
    }

    var query = sb.from('wholesalers')
      .select('id, slug, name, url, category, summary, main_products, min_order_condition, requires_business_membership, allows_small_quantity, allows_dropshipping, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    if(category != null) query = query.eq('category', category);

    return query.then(function(res){
      if(res.error) return { ok: false, error: res.error.message };
      return { ok: true, data: res.data || [] };
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  // ------------------------------------------------------------------ 문의 등록
  // payload는 화면(나중에 만들 폼)에서 그대로 받은 사용자 입력이라고
  // 가정한다 — 여기서 trim/필수값/형식을 검증하고, 로그인 세션에서 얻은
  // user_id만 사용해 insert한다(payload.user_id가 있어도 절대 쓰지
  // 않는다 — 클라이언트가 남의 user_id를 끼워 넣을 수 없게 하기 위함).
  //
  // 반환: Promise<
  //   { ok: true, data: 생성된 행 } |
  //   { ok: false, error: 'NOT_AUTHENTICATED' } |
  //   { ok: false, error: 'VALIDATION_ERROR', fields: string[] } |
  //   { ok: false, error: string }
  // >
  function submitWholesalerInquiry(payload){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });
    payload = payload || {};

    return sb.auth.getSession().then(function(sessionRes){
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      var user = session && session.user;
      if(!user) return { ok: false, error: 'NOT_AUTHENTICATED' };

      var record = {
        contact_email: trimOrEmpty(payload.contact_email),
        name: trimOrEmpty(payload.name),
        url: trimOrEmpty(payload.url),
        category: trimOrEmpty(payload.category),
        summary: trimOrEmpty(payload.summary),
        main_products: trimOrEmpty(payload.main_products) || null,
        min_order_condition: trimOrEmpty(payload.min_order_condition) || null,
        requires_business_membership: !!payload.requires_business_membership,
        allows_small_quantity: !!payload.allows_small_quantity,
        allows_dropshipping: !!payload.allows_dropshipping,
        memo: trimOrEmpty(payload.memo) || null
      };

      var missing = [];
      if(!record.contact_email || !isValidEmail(record.contact_email)) missing.push('contact_email');
      if(!record.name) missing.push('name');
      if(!record.url || !isValidUrl(record.url)) missing.push('url');
      if(!record.category || !isValidCategory(record.category)) missing.push('category');
      if(!record.summary) missing.push('summary');
      if(missing.length) return { ok: false, error: 'VALIDATION_ERROR', fields: missing };

      // user_id는 오직 서버 세션에서만 가져온다 — payload에 무엇이 들어
      // 있었든 여기서 덮어써서, 다른 사람 id로 문의를 남기는 걸 막는다.
      // (DB의 wholesaler_inquiries_insert_own 정책도 동일 조건을 한 번 더
      // 강제하므로, 설령 이 줄이 실수로 지워져도 다른 사용자 명의로는
      // insert 자체가 거부된다.)
      record.user_id = user.id;

      return sb.from('wholesaler_inquiries')
        .insert(record)
        .select()
        .single()
        .then(function(res){
          if(res.error) return { ok: false, error: res.error.message };
          return { ok: true, data: res.data };
        });
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  // ------------------------------------------------------------------ 내 문의 조회
  // 로그인 사용자가 본인이 남긴 문의 목록/상태를 확인할 때 쓴다(RLS가
  // user_id = auth.uid() 행만 돌려주므로, 여기서도 추가 필터링은 하지
  // 않는다 — 기존 stores.js의 connected_accounts 조회와 같은 방식).
  function fetchMyInquiries(){
    var sb = client();
    if(!sb) return Promise.resolve({ ok: false, error: 'SUPABASE_UNAVAILABLE' });

    return sb.auth.getSession().then(function(sessionRes){
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if(!session || !session.user) return { ok: false, error: 'NOT_AUTHENTICATED' };

      return sb.from('wholesaler_inquiries')
        .select('id, name, url, category, status, admin_note, resolved_wholesaler_id, created_at')
        .order('created_at', { ascending: false })
        .then(function(res){
          if(res.error) return { ok: false, error: res.error.message };
          return { ok: true, data: res.data || [] };
        });
    }).catch(function(err){
      return { ok: false, error: (err && err.message) || 'UNKNOWN_ERROR' };
    });
  }

  window.launchdeskWholesalers = {
    CATEGORIES: CATEGORIES,
    categoryLabel: categoryLabel,
    isValidCategory: isValidCategory,
    fetchPublishedWholesalers: fetchPublishedWholesalers,
    submitWholesalerInquiry: submitWholesalerInquiry,
    fetchMyInquiries: fetchMyInquiries
  };
})();
