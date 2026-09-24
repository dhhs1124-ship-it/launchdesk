/* 운영 대시보드 리뉴얼(#view-home, home-dashboard.js) — LaunchDesk 메인
   사용자 대시보드를 "현황 → 해석 → 해야 할 일" 구조로 재구성한 화면.

   이 파일은 새 데이터 조회/집계 로직을 만들지 않는다. 전부 이미 존재하는
   안전한 소스를 그대로 재사용한다:
   - Cafe24 주문 요약 · Meta 광고 성과 · 연결 상태 → ops-overview.js가 이미
     계산해 window.launchdeskOpsSnapshot으로 구독 가능하게 내보낸 값(이
     파일이 두 번째로 같은 조회/계산을 하지 않는다 — subscribe()만 한다).
   - 도매처 목록 → wholesalers.js의 fetchPublishedWholesalers()(RLS가
     published만 돌려주므로 로그인 여부와 무관하게 안전).
   - 세팅 대행 문의 → 사용자 본인 조회용 안전한 RPC/뷰가 아직 없다
     (20260915200000_setup_inquiries.sql 주석에 명시된 대로, admin_note
     노출 위험 때문에 authenticated 본인-행 SELECT 정책을 의도적으로 만들지
     않았다). 그래서 이 화면은 "문의하기" CTA + "내 문의 확인 준비중" 안내만
     보여주고, admin SELECT 권한은 절대 열지 않는다.
   - 로드맵 진행 배너/체크리스트(resume-banner 등)는 이 파일이 전혀
     건드리지 않는다 — app.js의 renderHomeDashboard()가 계속 그대로
     담당한다.

   index.html에서 store.js/app.js/ops-overview.js/wholesalers.js보다 뒤에
   로드해야 한다(이 파일이 그 전역들을 구독/호출하기 때문). */
(function(){
  var root = document.getElementById('opsdashRoot');
  if(!root) return;

  var gateEl = document.getElementById('opsdashGuestGate');
  var gateSignupBtn = document.getElementById('opsdashGateSignup');
  var gateLoginBtn = document.getElementById('opsdashGateLogin');

  var subtitleEl = document.getElementById('opsdashSubtitle');
  var refreshBtn = document.getElementById('opsdashRefreshBtn');
  var kpiOrdersEl = document.getElementById('opsdashKpiOrders');
  var kpiPaymentEl = document.getElementById('opsdashKpiPayment');
  var kpiSpendEl = document.getElementById('opsdashKpiSpend');
  var kpiRoasEl = document.getElementById('opsdashKpiRoas');
  var kpiRoasNoteEl = document.getElementById('opsdashKpiRoasNote');
  var kpiOrdersLabelEl = document.getElementById('opsdashKpiOrdersLabel');
  var kpiPaymentLabelEl = document.getElementById('opsdashKpiPaymentLabel');
  var kpiSpendLabelEl = document.getElementById('opsdashKpiSpendLabel');
  var kpiRoasLabelEl = document.getElementById('opsdashKpiRoasLabel');
  var kpiOrdersNoteEl = document.getElementById('opsdashKpiOrdersNote');
  var kpiPaymentNoteEl = document.getElementById('opsdashKpiPaymentNote');
  var kpiSpendNoteEl = document.getElementById('opsdashKpiSpendNote');
  var periodDateEl = document.getElementById('opsdashPeriodDate');
  var periodBtns = root.querySelectorAll ? root.querySelectorAll('[data-ops-period]') : [];
  var PC = window.launchdeskOpsPeriodCore;
  var AdsCore = window.launchdeskMetaAdsetsCore; // 날짜 입력 하한(Meta 37개월) 계산 재사용
  var briefListEl = document.getElementById('opsdashBriefList');
  var adStateEl = document.getElementById('opsdashAdState');
  var monthSummaryEl = document.getElementById('opsdashMonthSummary');
  var wholesalersEl = document.getElementById('opsdashWholesalers');
  var setupInquiryEl = document.getElementById('opsdashSetupInquiry');
  var connectionEl = document.getElementById('opsdashConnectionStatus');

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------- 포맷
  function formatWon(n){ return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원'; }
  function formatCount(n){ return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '건'; }
  function formatMetaMoney(amount, currency){
    var n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(n);
    } catch(e){
      return (currency ? currency + ' ' : '') + n.toLocaleString('en-US');
    }
  }
  // ops-overview.js의 ROAS 표시 규칙과 동일하게 유지한다(같은 원본 ratio를
  // 같은 공식으로 표시만 다시 하는 것 — 데이터/계산 로직 중복이 아니라
  // 각 화면이 자기 표시 형식을 갖는 이 프로젝트의 기존 관례를 그대로
  // 따른 것이다, admin.js의 독립 formatBetaPercent()와 같은 이유).
  function formatRoasPercent(x){ return (x === null || x === undefined) ? '—' : (Math.round(Number(x) * 100).toLocaleString('ko-KR') + '%'); }
  function formatRoasNote(x, currency){
    if(x === null || x === undefined) return '';
    var perUnit = (function(){
      try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(1); }
      catch(e){ return (currency || 'USD') + ' 1'; }
    })();
    return '광고비 ' + perUnit + '당 약 ' + formatMetaMoney(x, currency) + '의 Meta 광고매출';
  }

  // 한국시간 "MM.DD HH:MM" — 동기화 · 조회 시각 표시용.
  function formatKstTime(iso){
    var ms = iso ? Date.parse(iso) : NaN;
    if(isNaN(ms)) return '';
    var s = new Date(ms + 9 * 60 * 60 * 1000).toISOString();
    return s.slice(5, 7) + '.' + s.slice(8, 10) + ' ' + s.slice(11, 16);
  }

  // ---------------------------------------------------------------- 헤더
  function periodLabelOf(snapshot){ return (snapshot.period && snapshot.period.label) || '오늘'; }
  function renderHeader(snapshot){
    if(!subtitleEl) return;
    var storeName = snapshot.cafe24.storeName;
    var text = periodLabelOf(snapshot) + ' 기준 쇼핑몰과 광고 상태를 확인하세요.';
    subtitleEl.textContent = storeName ? (storeName + ' · ' + text) : text;
  }

  // ------------------------------------------------------- 상단 기간 선택
  function renderPeriodControls(snapshot){
    var p = snapshot.period || { period: 'today' };
    Array.prototype.forEach.call(periodBtns, function(btn){
      btn.setAttribute('aria-pressed', btn.getAttribute('data-ops-period') === p.period ? 'true' : 'false');
    });
    if(periodDateEl){
      var picked = p.period === 'date' ? (p.date || '') : '';
      if(periodDateEl.value !== picked) periodDateEl.value = picked;
      periodDateEl.classList.toggle('is-active', p.period === 'date');
    }
    if(refreshBtn){
      var syncing = !!snapshot.cafe24.syncing;
      refreshBtn.disabled = syncing;
      refreshBtn.setAttribute('aria-busy', syncing ? 'true' : 'false');
    }
  }
  function syncDateBounds(){
    if(!periodDateEl) return;
    periodDateEl.max = PC ? PC.kstDate(Date.now()) : '';
    if(AdsCore) periodDateEl.min = AdsCore.earliestDateString(Date.now());
  }

  // ------------------------------------------------------------ KPI 4개
  // Cafe24 카드: 선택 기간이 동기화된 범위인지(coverage)에 따라 숫자 대신
  // "확인 전"을 보여준다 — 동기화되지 않은 날짜를 0건으로 보이지 않게 한다.
  function cafe24CoverageNote(cafe24){
    if(cafe24.syncing) return '주문 동기화 중…';
    if(cafe24.syncError) return cafe24.syncError;
    var sel = cafe24.selected;
    var at = formatKstTime(cafe24.lastSyncedAt);
    if(cafe24.outsideSync) return '최근 3개월보다 오래된 날짜는 주문을 동기화하지 않아요.';
    if(!sel) return cafe24.selectedError ? '이 기간 주문을 불러오지 못했어요.' : '불러오는 중…';
    if(sel.coverage === 'none') return at ? ('이 기간 주문은 아직 동기화 전이에요(마지막 동기화 ' + at + '). 새로고침하면 동기화해요.') : '아직 주문을 동기화한 적이 없어요. 새로고침하면 동기화해요.';
    if(sel.coverage === 'unknown') return '이 기간 일부가 동기화됐는지 확인되지 않았어요. 새로고침하면 이 기간까지 동기화해요.';
    if(sel.coverage === 'partial') return '마지막 동기화 ' + at + '까지 · 취소·환불·미입금 포함';
    return '취소·환불·미입금 포함 · 동기화 ' + at;
  }
  function cafe24Value(cafe24, fmt){
    if(cafe24.state !== 'data') return '-';
    var sel = cafe24.selected;
    if(!sel || cafe24.outsideSync) return '-';
    if(sel.coverage === 'none' || sel.coverage === 'unknown') return '확인 전';
    return fmt(sel);
  }
  function renderKpis(snapshot){
    var cafe24 = snapshot.cafe24;
    var meta = snapshot.meta;
    var label = periodLabelOf(snapshot);

    if(kpiOrdersLabelEl) kpiOrdersLabelEl.textContent = 'Cafe24 주문 · ' + label;
    if(kpiPaymentLabelEl) kpiPaymentLabelEl.textContent = 'Cafe24 주문금액 · ' + label;
    if(kpiSpendLabelEl) kpiSpendLabelEl.textContent = 'Meta 광고비 · ' + label;
    if(kpiRoasLabelEl) kpiRoasLabelEl.textContent = 'Meta ROAS · ' + label;

    if(kpiOrdersEl) kpiOrdersEl.textContent = cafe24Value(cafe24, function(s){ return formatCount(s.count); });
    if(kpiPaymentEl) kpiPaymentEl.textContent = cafe24Value(cafe24, function(s){ return formatWon(s.payment); });
    if(kpiOrdersNoteEl) kpiOrdersNoteEl.textContent = cafe24.state === 'data' ? cafe24CoverageNote(cafe24) : '취소·환불·미입금 주문 포함';
    if(kpiPaymentNoteEl) kpiPaymentNoteEl.textContent = '주문별 결제금액 합계 · 취소·환불 미차감';

    // Meta KPI는 Cafe24 상태와 무관하다 — Cafe24만 연결 해제된 store도
    // Meta 연동은 그대로 남아있을 수 있다(요구사항). Meta 광고매출은 Meta
    // 자체 귀속 기준이라 Cafe24 주문금액과 합산하지 않는다.
    var sel = meta.state === 'data' ? meta.selected : null;
    if(kpiSpendEl) kpiSpendEl.textContent = sel ? formatMetaMoney(sel.spend, meta.currency) : (meta.selectedLoading ? '…' : '-');
    if(kpiRoasEl) kpiRoasEl.textContent = sel ? formatRoasPercent(sel.roas) : (meta.selectedLoading ? '…' : '-');
    if(kpiRoasNoteEl) kpiRoasNoteEl.textContent = sel ? formatRoasNote(sel.roas, meta.currency) : '';
    if(kpiSpendNoteEl){
      kpiSpendNoteEl.textContent = meta.state !== 'data' ? ''
        : (sel ? ('Meta 귀속 기준 · 조회 ' + formatKstTime(meta.fetchedAt))
          : (meta.selectedLoading ? '불러오는 중…' : '이 기간 Meta 요약을 불러오지 못했어요.'));
    }
  }

  // -------------------------------------------------------- 오늘의 운영 브리핑
  // 전부 실제 데이터로 판단 가능한 문장만 — "성과가 좋습니다" 같은 근거
  // 없는 평가는 만들지 않는다(요구사항 7). Cafe24 줄과 Meta 줄은 서로의
  // 상태를 기다리지 않고 각자 독립적으로 채워진다 — Cafe24만 연결 해제된
  // store도 Meta 연동은 그대로 남아 있을 수 있다(요구사항).
  function buildBriefLines(snapshot){
    var cafe24 = snapshot.cafe24;
    var meta = snapshot.meta;
    var lines = [];
    var hasRealData = false;

    if(cafe24.state === 'not-connected'){
      lines.push('Cafe24를 연결하면 실제 주문과 결제금액을 확인할 수 있어요.');
    } else if(cafe24.state === 'error'){
      lines.push(cafe24ErrorLine());
    } else if(cafe24.state === 'data' && cafe24.today){
      hasRealData = true;
      // 집계는 취소·환불·미입금 주문을 구분하지 않는다(ops-overview.js loadOrdersFor) —
      // "발생한 매출"처럼 말하지 않고 마지막 동기화까지 들어온 주문으로만 설명한다.
      // 오늘이 아직 동기화 전이면 0건이라고 말하지 않는다.
      var tc = cafe24.today.coverage;
      if(tc === 'none' || tc === 'unknown'){
        lines.push('Cafe24 오늘 주문은 아직 동기화 전이에요. 새로고침하면 동기화해요.');
      } else {
        lines.push(cafe24.today.count > 0
          ? ('Cafe24에 오늘 들어온 주문은 ' + cafe24.today.count + '건, 주문금액 합계는 ' + formatWon(cafe24.today.payment) + '이에요(취소·환불·미입금 포함, 마지막 동기화 기준).')
          : 'Cafe24에 오늘 들어온 주문이 없어요(마지막 동기화 기준).');
      }
    }

    if(meta.state === 'data' && meta.today){
      hasRealData = true;
      var t = meta.today, m = meta.month;
      if(t.spend > 0 || t.purchase_value > 0){
        lines.push('광고비 ' + formatMetaMoney(t.spend, meta.currency) + '로 Meta 광고매출 ' + formatMetaMoney(t.purchase_value, meta.currency) + '이 집계되었습니다.');
      }
      if(t.roas !== null && m && m.roas !== null && t.roas !== m.roas){
        lines.push(t.roas > m.roas
          ? '오늘 Meta 광고 효율이 이번 달 평균보다 높습니다.'
          : '오늘 Meta 광고 효율이 이번 달 평균보다 낮습니다.');
      }
    }

    // "함께 확인해보세요" 트레일러는 실제 데이터 줄이 최소 하나 있을 때만
    // 붙인다 — not-connected/error 안내 한 줄 뒤에 붙으면 어색하다.
    if(hasRealData) lines.push('주문과 광고 데이터를 함께 확인해보세요.');

    return lines.slice(0, 4);
  }

  // Cafe24 조회 오류 — 정확한 문구는 고정하되("연결이 끊겼다"고 단정하지
  // 않음, 연결 버튼 없음), 기존 새로고침 버튼(#opsdashRefreshBtn)으로 다시
  // 시도할 수 있다는 최소 동선만 같은 줄에 안내한다. 자동 재시도는 하지
  // 않는다.
  function cafe24ErrorLine(){
    return 'Cafe24 주문 데이터를 불러오지 못했어요. 새로고침을 눌러 다시 시도해주세요.';
  }

  function renderBrief(snapshot){
    if(!briefListEl) return;
    var lines = buildBriefLines(snapshot);
    if(!lines.length){
      // 데이터 없음/미연결을 큰 중앙정렬 빈 박스가 아니라 작은 muted
      // 안내 한 줄로 — 카드 높이가 empty state 때문에 커지지 않게 한다
      // (요구사항 18).
      briefListEl.innerHTML = '<p class="opsdash-empty-note">쇼핑몰을 연결하면 오늘의 운영 브리핑을 확인할 수 있습니다.</p>';
      return;
    }
    briefListEl.innerHTML = lines.map(function(line){
      return '<div class="opsdash-brief-item">' + escapeHtml(line) + '</div>';
    }).join('');
  }

  // -------------------------------------------------------------- 광고 상태
  var META_STATE_EMPTY_MESSAGES = {
    'not-connected': 'Meta 광고 계정을 연결해주세요.',
    'not-selected': '분석할 광고계정을 선택해주세요.',
    // stores.js(#/account)가 쓰는 것과 같은 문구 — 광고계정을 한 번 선택한
    // 적이 있는 연결의 인증이 끊긴 경우(요구사항: 인증 만료는 블러 없이
    // 기존 "다시 연결해주세요" 상태·동선을 그대로 보여준다).
    'reconnect-required': 'Meta 연결이 만료되었어요. 다시 연결해주세요.',
    'loading': '광고 데이터를 불러오는 중...',
    'error': null // errorMessage를 그대로 사용
  };

  // 광고 상태는 Meta 상태만 본다 — Cafe24 연결 여부와 무관하게 독립적으로
  // 표시한다(요구사항: Meta 영역이 Cafe24 미연결이라는 이유로 차단되면
  // 안 됨).
  function renderAdState(snapshot){
    if(!adStateEl) return;
    var meta = snapshot.meta;

    if(meta.state !== 'data'){
      var msg = meta.state === 'error' ? (meta.errorMessage || '광고 데이터를 불러오지 못했습니다.') : (META_STATE_EMPTY_MESSAGES[meta.state] || '광고 데이터가 없습니다.');
      adStateEl.innerHTML = '<p class="opsdash-empty-note">' + escapeHtml(msg) + ' <a href="#/account" style="color:var(--op-accent-ink); font-weight:600;">내 쇼핑몰 관리로 이동</a></p>';
      return;
    }

    var t = meta.today, m = meta.month;
    // note와 상태 배지(tone)를 함께 판단한다 — good/warn만 근거가 명확한
    // 경우에만 쓰고(요구사항 17), 그 외는 neutral(색 없음).
    var note, tone;
    if(t.spend === 0){
      note = '오늘 광고비가 아직 사용되지 않았습니다.';
      tone = 'neutral';
    } else if(t.purchase_count === 0){
      note = '광고비가 사용되고 있지만 오늘 구매가 없습니다.';
      tone = 'warn';
    } else if(t.roas !== null && m.roas !== null){
      if(t.roas > m.roas){ note = '오늘 광고 효율이 이번 달 평균보다 높습니다.'; tone = 'good'; }
      else if(t.roas < m.roas){ note = '오늘 광고 효율이 이번 달 평균보다 낮습니다.'; tone = 'neutral'; }
      else { note = '오늘 광고 효율이 이번 달 평균과 비슷합니다.'; tone = 'neutral'; }
    } else {
      note = null;
      tone = null;
    }
    var pillText = tone === 'good' ? '양호' : tone === 'warn' ? '주의' : tone === 'neutral' ? '참고' : null;

    adStateEl.innerHTML =
      '<div class="opsdash-adstate-row"><span class="opsdash-adstate-label">오늘 ROAS</span><span class="opsdash-adstate-value">' + formatRoasPercent(t.roas) + '</span></div>' +
      '<div class="opsdash-adstate-row"><span class="opsdash-adstate-label">이번 달 ROAS</span><span class="opsdash-adstate-value">' + formatRoasPercent(m.roas) + '</span></div>' +
      (note ? ('<div class="opsdash-adstate-note">' + (pillText ? '<span class="opsdash-pill ' + tone + '">' + pillText + '</span>' : '') + '<span>' + escapeHtml(note) + '</span></div>') : '');
  }

  // --------------------------------------------------------- 이번 달 운영 현황
  // 세로로 두 그룹을 쌓지 않고, 한 줄(flex) 안에 "쇼핑몰"과 "광고"를 구분선
  // 하나로 나눠 가로로 배치한다 — Cafe24/Meta 구분은 그룹 라벨 + 구분선으로
  // 시각적으로 유지하되(요구사항 10), 세로 높이는 크게 줄인다.
  function stat(label, value){
    return '<div class="opsdash-stat"><span class="opsdash-stat-label">' + escapeHtml(label) + '</span><span class="opsdash-stat-value">' + value + '</span></div>';
  }

  function renderMonthSummary(snapshot){
    if(!monthSummaryEl) return;
    var cafe24 = snapshot.cafe24;
    var meta = snapshot.meta;
    var html = '';

    html += '<div class="opsdash-summary-group"><div class="opsdash-summary-group-label">쇼핑몰</div>';
    var monthUnsynced = cafe24.state === 'data' && cafe24.month && (cafe24.month.coverage === 'none' || cafe24.month.coverage === 'unknown');
    if(monthUnsynced){
      html += '<p class="opsdash-empty-note" style="padding:0;">이번 달 일부 날짜가 동기화됐는지 확인되지 않았어요. 새로고침하면 이번 달 주문을 동기화해요.</p>';
    } else if(cafe24.state === 'data' && cafe24.month){
      html += '<div class="opsdash-summary-stats">' +
        stat('주문', formatCount(cafe24.month.count)) +
        stat('주문금액', formatWon(cafe24.month.payment)) +
        '</div>' +
        '<p style="margin:.35rem 0 0; font-size:.75rem; color:var(--ink-faint);">취소·환불·미입금 주문 포함 · 주문일 기준</p>';
    } else if(cafe24.state === 'error'){
      html += '<p class="opsdash-empty-note" style="padding:0;">Cafe24 주문 데이터를 불러오지 못했어요.</p>';
    } else {
      html += '<p class="opsdash-empty-note" style="padding:0;">Cafe24 연결 시 확인 가능</p>';
    }
    html += '</div>';

    html += '<div class="opsdash-summary-divider"></div>';

    // 광고(Meta) 그룹은 Cafe24 상태와 무관하다(요구사항).
    html += '<div class="opsdash-summary-group"><div class="opsdash-summary-group-label">광고(Meta)</div>';
    if(meta.state === 'data' && meta.month){
      var m = meta.month;
      html += '<div class="opsdash-summary-stats">' +
        stat('광고비', formatMetaMoney(m.spend, meta.currency)) +
        stat('광고매출', formatMetaMoney(m.purchase_value, meta.currency)) +
        stat('구매', formatCount(m.purchase_count)) +
        stat('ROAS', formatRoasPercent(m.roas)) +
        '</div>';
    } else {
      html += '<p class="opsdash-empty-note" style="padding:0;">Meta 연결 시 확인 가능</p>';
    }
    html += '</div>';

    // Cafe24 결제금액과 Meta 광고매출을 같은 "매출"로 오해하지 않도록 —
    // 광고 그룹에 실제 데이터가 있을 때만 한 줄로 안내(flex-wrap으로 다음
    // 줄 전체 폭을 차지). Cafe24 상태와는 무관하다.
    if(meta.state === 'data' && meta.month){
      html += '<p style="flex-basis:100%; margin:.4rem 0 0; font-size:.75rem; color:var(--ink-faint);">Meta 광고매출·구매는 Meta 자체 귀속 기준이라 Cafe24 주문과 같은 주문이 아니며, 서로 합산하지 않습니다.</p>';
    }

    monthSummaryEl.innerHTML = html;
  }

  // -------------------------------------------------------------- 연결 상태
  // 이모지 대신 이 파일 안에서 그린 24x24 line icon만 쓴다(요구사항 7) —
  // 새 아이콘 라이브러리를 설치하지 않고 기존 sidebar 아이콘과 같은
  // stroke 스타일로 통일했다.
  var ICON_STORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4"/><path d="M12 11v10"/></svg>';
  var ICON_MEGAPHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l6 4V6l-6 4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>';
  var ICON_SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11A8 8 0 1 0 19 15"/><polyline points="20 4 20 11 13 11"/></svg>';
  var ICON_TAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3h6a2 2 0 0 1 2 2v6L11 20l-8-8z"/><circle cx="15" cy="8" r="1.3" fill="currentColor" stroke="none"/></svg>';

  function connectionRow(icon, label, value, connected){
    return '<div class="opsdash-connection-row">' +
      '<span class="opsdash-connection-label">' + icon + '<span>' + label + '</span></span>' +
      '<span class="store-status' + (connected ? ' connected' : '') + '">' + escapeHtml(value) + '</span></div>';
  }

  function renderConnectionStatus(snapshot){
    if(!connectionEl) return;
    var cafe24 = snapshot.cafe24;
    var meta = snapshot.meta;

    var cafe24Connected = cafe24.state === 'data';
    var cafe24Label = cafe24Connected ? '연결됨' : (cafe24.state === 'error' ? '조회 오류' : '연결 안 됨');
    var cafe24Row = connectionRow(ICON_STORE, 'Cafe24', cafe24Label, cafe24Connected);

    // Meta 연결 여부는 Cafe24 연결 여부와 무관하다(요구사항).
    var metaConnected = meta.state === 'data';
    var metaLabel = metaConnected ? '연결됨'
      : (meta.state === 'not-selected' ? '광고계정 미선택'
      : (meta.state === 'reconnect-required' ? '연결 만료' : '연결 안 됨'));
    var metaRow = connectionRow(ICON_MEGAPHONE, 'Meta', metaLabel, metaConnected);

    var metaAccountRow = (metaConnected && meta.accountName)
      ? '<div class="opsdash-connection-row"><span class="opsdash-connection-label">' + ICON_TAG + '<span>광고계정</span></span><span>' + escapeHtml(meta.accountName) + '</span></div>'
      : '';

    var syncOk = cafe24Connected && cafe24.lastSyncedAt;
    var syncText = cafe24.syncing ? '동기화 중…'
      : (cafe24.syncError ? '동기화 실패' : (syncOk ? formatKstTime(cafe24.lastSyncedAt) : '아직 없음'));
    var syncRow = connectionRow(ICON_SYNC, '주문 동기화', syncText, !!syncOk && !cafe24.syncError);

    connectionEl.innerHTML = cafe24Row + metaRow + metaAccountRow + syncRow;
  }

  // ---------------------------------------------------------------- 도매처
  // fetchPublishedWholesalers()는 RLS가 published 행만 돌려주므로 로그인
  // 여부와 무관하게 호출 가능하다(wholesalers.js 기존 구현 그대로 재사용).
  var wholesalersLoaded = false;
  function loadWholesalers(){
    if(!wholesalersEl) return;
    // index.html의 script 순서상 wholesalers.js가 이 파일보다 먼저 로드돼
    // 항상 존재해야 하지만(정상 배포 시 도달하지 않는 분기), 순서가 어떤
    // 이유로든 깨지는 극단적 경우까지 대비해 함수 존재를 다시 한번
    // 확인한다 — 가짜 데이터로 채우지 않고 명확한 오류 상태만 보여준다.
    if(!window.launchdeskWholesalers){
      wholesalersEl.innerHTML = '<p class="opsdash-empty-note">도매처를 불러오지 못했습니다.</p>';
      return;
    }
    wholesalersEl.innerHTML = '<p class="opsdash-empty-note">불러오는 중…</p>';
    window.launchdeskWholesalers.fetchPublishedWholesalers().then(function(res){
      wholesalersLoaded = true;
      if(!res.ok || !res.data || !res.data.length){
        wholesalersEl.innerHTML = '<p class="opsdash-empty-note">아직 등록된 도매처가 없습니다. <a href="#/wholesale" style="color:var(--op-accent-ink); font-weight:600;">도매처 둘러보기</a></p>';
        return;
      }
      var top = res.data.slice(0, 3);
      var categoryLabel = window.launchdeskWholesalers.categoryLabel || function(c){ return c; };
      var rowsHtml = top.map(function(w){
        return '<div class="opsdash-wholesaler-row">' +
          '<div><div class="opsdash-wholesaler-name">' + escapeHtml(w.name) + '</div>' +
          '<div class="opsdash-wholesaler-meta">' + escapeHtml(categoryLabel(w.category) || w.category || '') + '</div></div>' +
          '</div>';
      }).join('');
      wholesalersEl.innerHTML = rowsHtml + '<a class="opsdash-see-all" href="#/wholesale">도매처 전체보기 →</a>';
    }).catch(function(err){
      wholesalersLoaded = true;
      console.warn('[launchdesk] 홈 대시보드: 도매처 조회 중 오류:', err && err.message);
      wholesalersEl.innerHTML = '<p class="opsdash-empty-note">도매처를 불러오지 못했습니다.</p>';
    });
  }

  // ------------------------------------------------------------ 세팅 대행 문의
  // 사용자 본인 문의 조회용 안전한 RPC/뷰가 아직 없어(admin_note 노출
  // 위험 — 20260915200000_setup_inquiries.sql 주석 참고), 데이터 조회 없이
  // 정적으로만 구성한다. admin SELECT 권한은 열지 않는다.
  function renderSetupInquiry(){
    if(!setupInquiryEl) return;
    setupInquiryEl.innerHTML =
      '<p>쇼핑몰 세팅이 필요하신가요?</p>' +
      '<a href="#/services/setup" style="font-size:.83rem; font-weight:700; color:var(--op-accent-ink);">문의하기 →</a>' +
      '<span class="opsdash-inquiry-note">내 문의 확인 준비중</span>';
  }

  // ------------------------------------------------------------ 비회원 게이트
  // 로그인 여부는 cafe24.state(예: 'guest')를 추론해 쓰지 않고,
  // window.launchdeskStore.isAuthed() 하나만 직접 본다 — 앱 전체가 이미
  // 로그인/로그아웃 판정에 쓰는 바로 그 값이다(새 인증 로직 아님). Cafe24가
  // loading/error/not-connected여도, store를 아직 등록하지 않았어도 이
  // 값은 true로 남아 있으므로 로그인 사용자를 비회원으로 오인하지 않는다.
  //
  // launchdeskStore.onChange에도 직접 등록해(아래) ops-overview.js의 비동기
  // 세션 재확인·스냅샷 발행을 기다리지 않고 로그인/로그아웃 "그 순간" 게이트가
  // 갱신되게 한다 — ops 스냅샷 구독(renderAll)에서도 매번 다시 부르므로 두
  // 경로 중 하나가 이벤트를 놓쳐도 다른 쪽이 따라잡는다.
  //
  // 회원으로 처음 확정될 때만 도매처 · 세팅 대행을 그때 불러온다 — 그전
  // (비회원)에는 이 화면이 Cafe24 · Meta · plans · ad_margin_links · 도매처
  // 등 어떤 사용자별 데이터 요청도 보내지 않는다(요구사항).
  var unlockedOnce = false;
  function applyAuthGate(){
    var authed = !!(window.launchdeskStore && window.launchdeskStore.isAuthed());
    if(gateEl) gateEl.hidden = authed;
    if(!authed){
      root.setAttribute('inert', '');
      root.setAttribute('aria-hidden', 'true');
      unlockedOnce = false; // 로그아웃하면 다음 로그인 때 다시 한 번 불러오게 리셋
      return authed;
    }
    root.removeAttribute('inert');
    root.removeAttribute('aria-hidden');
    if(!unlockedOnce){
      unlockedOnce = true;
      renderSetupInquiry();
      loadWholesalers();
    }
    return authed;
  }
  if(window.launchdeskStore){
    window.launchdeskStore.onChange(applyAuthGate);
  }
  applyAuthGate(); // 초기 렌더 — 로그인 여부가 아직 확정되기 전의 안전한 기본값(비회원)

  // 무료 회원가입 · 로그인 버튼 — 둘 다 기존 로그인 모달만 연다(새 인증
  // 로직 없음). 그 모달은 항상 로그인 모드로 열리므로, 회원가입 버튼은
  // 연 직후 모달 안의 기존 전환 링크(#loginToSignup)를 그대로 한 번
  // 눌러 회원가입 모드로 바꾼다 — 사용자가 직접 누르는 것과 동일한 경로다.
  if(gateLoginBtn){
    gateLoginBtn.addEventListener('click', function(){
      if(typeof window.launchdeskOpenLoginModal === 'function'){
        window.launchdeskOpenLoginModal({ hint: '로그인하면 운영 현황에서 Cafe24 주문과 Meta 광고 성과를 확인할 수 있어요.' });
      }
    });
  }
  if(gateSignupBtn){
    gateSignupBtn.addEventListener('click', function(){
      if(typeof window.launchdeskOpenLoginModal !== 'function') return;
      window.launchdeskOpenLoginModal({ hint: '가입하면 운영 현황에서 Cafe24 주문과 Meta 광고 성과를 확인할 수 있어요.' });
      var toggle = document.getElementById('loginToSignup');
      if(toggle) toggle.click();
    });
  }

  // -------------------------------------------------------------- 렌더 총괄
  function renderAll(snapshot){
    if(!snapshot) return;
    applyAuthGate();
    renderHeader(snapshot);
    renderPeriodControls(snapshot);
    renderKpis(snapshot);
    renderBrief(snapshot);
    renderAdState(snapshot);
    renderMonthSummary(snapshot);
    renderConnectionStatus(snapshot);
  }

  if(window.launchdeskOpsSnapshot){
    window.launchdeskOpsSnapshot.subscribe(renderAll);
  }

  // 새로고침 — 선택된 쇼핑몰의 Cafe24 주문을 실제로 동기화한 뒤 주문 · Meta를
  // 다시 조회한다(ops-overview.js refreshWithSync). 기간 버튼은 동기화하지 않는다.
  if(refreshBtn){
    refreshBtn.addEventListener('click', function(){
      if(window.launchdeskOpsSnapshot) window.launchdeskOpsSnapshot.refreshWithSync();
      loadWholesalers();
    });
  }

  Array.prototype.forEach.call(periodBtns, function(btn){
    btn.addEventListener('click', function(){
      if(window.launchdeskOpsSnapshot) window.launchdeskOpsSnapshot.setPeriod(btn.getAttribute('data-ops-period'));
    });
  });
  if(periodDateEl){
    syncDateBounds();
    periodDateEl.addEventListener('focus', syncDateBounds); // 자정을 넘겨 열어 둔 화면 대비
    periodDateEl.addEventListener('change', function(){
      var v = periodDateEl.value;
      if(!v) return;
      var tooNew = v > periodDateEl.max;
      var tooOld = !!periodDateEl.min && v < periodDateEl.min;
      if(tooNew || tooOld){
        // 직접 입력으로 범위를 벗어난 경우 — 조회하지 않고 브라우저 기본 안내로 이유를 알린다.
        periodDateEl.setCustomValidity(tooNew ? '오늘 이후 날짜는 조회할 수 없어요.' : 'Meta는 최근 37개월 안의 날짜만 조회할 수 있어요.');
        periodDateEl.reportValidity();
        periodDateEl.setCustomValidity('');
        var latest = window.launchdeskOpsSnapshot && window.launchdeskOpsSnapshot.getLatest();
        if(latest) renderPeriodControls(latest);
        return;
      }
      if(window.launchdeskOpsSnapshot) window.launchdeskOpsSnapshot.setPeriod('date', v);
    });
  }
})();
