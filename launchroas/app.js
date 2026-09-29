(function(){
  'use strict';
  var PROJECT_URL = 'https://zzhvckikonnalqnyatgn.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_hu9XkhXJKyoWVL7zMQD8_g_iMmDymMK';
  var byId = function(id){ return document.getElementById(id); };
  var core = window.LaunchRoasCore;
  var periods = window.launchdeskOpsPeriodCore;
  var policy = window.launchdeskPolicyConsentCore;
  var sb = window.supabase && window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY);
  var userId = null, stores = [], requestId = 0, signupMode = false, syncing = false;
  var signupPending = false;
  var dashboardReady = false, period = {kind:'today',date:null}, selectedCafe = null, selectedMeta = null;
  var viewState = {cafe:null,meta:null}, listeners = [];
  function context(){ return {client:sb,userId:dashboardReady ? userId : null,storeId:byId('storeSelect').value,stores:stores.slice(),metaAccount:selectedMeta,metaData:viewState.meta,period:{kind:period.kind,date:period.date}}; }
  function publish(){ listeners.forEach(function(fn){try{fn(context());}catch(e){console.warn('[launchroas] 구독자 오류',e);}}); }
  window.LaunchRoasApp = {getContext:context,subscribe:function(fn){listeners.push(fn);fn(context());}};
  function message(id, value){ byId(id).textContent = value || ''; }
  function won(n){ return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원'; }
  function metaMoney(n, currency){
    try{ return new Intl.NumberFormat('en-US', {style:'currency', currency:currency || 'USD', maximumFractionDigits:2}).format(Number(n) || 0); }
    catch(e){ return (currency || 'USD') + ' ' + (Number(n) || 0).toLocaleString('en-US'); }
  }
  function time(iso){
    if(!iso || !Number.isFinite(Date.parse(iso))) return '';
    return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', dateStyle:'short', timeStyle:'short'}).format(new Date(iso));
  }
  function resetCards(){
    ['orderCount','orderAmount','adSpend','adRoas'].forEach(function(id){ message(id, '—'); });
    message('orderNote', '연결 상태 확인 전'); message('adNote', '광고계정 상태 확인 전');
    ['briefList','adState','monthSummary'].forEach(function(id){byId(id).replaceChildren();});
    setConnection('cafeConnection','Cafe24 확인 중','loading');setConnection('metaConnection','Meta 확인 중','loading');
    viewState = {cafe:null,meta:null}; selectedCafe = null; selectedMeta = null;
  }
  function setConnection(id,text,state){var pill=byId(id);pill.textContent=text;pill.dataset.state=state;}
  function signedOut(){
    requestId++; userId = null; stores = []; signupPending = false; dashboardReady = false;
    byId('loginPanel').hidden = false; byId('dashboard').hidden = true; byId('consentGate').hidden = true;
    byId('connectionPills').hidden = true;
    byId('accountEmail').hidden = true; byId('switchAccount').hidden = true; byId('logout').hidden = true;
    byId('password').value = ''; byId('refresh').disabled = false; syncing = false; resetCards(); publish();
  }
  async function hasConsent(id){
    var result = await sb.from('user_policy_consents').select('id').eq('user_id',id)
      .eq('terms_version',policy.TERMS_VERSION).in('privacy_version',policy.ACCEPTED_PRIVACY_VERSIONS).limit(1);
    return {ok: !result.error && !!(result.data || []).length, error: !!result.error};
  }
  async function saveConsent(id, source){
    await sb.from('user_policy_consents').insert({user_id:id,terms_version:policy.TERMS_VERSION,
      privacy_version:policy.PRIVACY_VERSION,source:source});
    return hasConsent(id); // insert 결과만으로는 동의 완료를 판단하지 않는다.
  }
  async function signedIn(user){
    if(!user || user.is_anonymous){ signedOut(); return; }
    if(dashboardReady && userId === user.id) return;
    dashboardReady = false; stores = []; userId = user.id; var id = ++requestId;
    byId('storeSelect').replaceChildren(); byId('storeSelect').value=''; resetCards(); publish();
    byId('loginPanel').hidden = true; byId('dashboard').hidden = true; byId('consentGate').hidden = true;
    byId('connectionPills').hidden = true;
    byId('accountEmail').textContent = user.email || '로그인됨';
    byId('accountEmail').hidden = false; byId('switchAccount').hidden = false; byId('logout').hidden = false;
    if(!policy){ byId('consentGate').hidden = false; message('gateMessage','동의 확인 서비스를 불러오지 못했어요. 새로고침해 주세요.'); return; }
    var consent = await hasConsent(user.id);
    if(id !== requestId) return;
    if(!consent.ok && !consent.error && signupPending){
      signupPending = false;
      consent = await saveConsent(user.id,policy.SOURCES.EMAIL_SIGNUP);
      if(id !== requestId) return;
    }
    if(!consent.ok){
      byId('consentGate').hidden = false;
      message('gateMessage', consent.error ? '동의 이력을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' : '필수 동의 항목을 확인해 주세요.');
      return;
    }
    dashboardReady = true;
    byId('dashboard').hidden = false;
    byId('connectionPills').hidden = false;
    publish();
    await loadStores(id);
  }
  async function loadStores(id){
    message('pageMessage', '쇼핑몰을 불러오는 중이에요.'); resetCards();
    var previousStoreId = byId('storeSelect').value;
    var result = await sb.from('stores').select('id,name,platform').eq('user_id', userId).eq('platform','cafe24');
    if(id !== requestId) return;
    if(result.error){ message('pageMessage', '쇼핑몰 목록을 불러오지 못했어요. 다시 조회해 주세요.'); return; }
    stores = result.data || [];
    var select = byId('storeSelect');
    select.replaceChildren();
    stores.forEach(function(store){
      var option = document.createElement('option');
      option.value = store.id; option.textContent = store.name; select.appendChild(option);
    });
    if(stores.some(function(store){return String(store.id) === previousStoreId;})) select.value = previousStoreId;
    publish();
    if(!stores.length){
      message('pageMessage', '이 계정에 연결된 Cafe24 쇼핑몰이 없어요. 런치데스크에서 위에 표시된 같은 계정으로 로그인한 뒤 등록해 주세요.');
      setConnection('cafeConnection','Cafe24 미연결','off');setConnection('metaConnection','Meta 미연결','off');
      return;
    }
    message('pageMessage', '');
    await loadSelected(select.value, id);
  }
  async function loadSelected(storeId, id){
    var owned = stores.some(function(s){ return String(s.id) === String(storeId); });
    if(!owned || id !== requestId) return;
    resetCards(); publish(); message('pageMessage', '주문과 광고를 조회하고 있어요.');
    var result = await sb.from('connected_accounts')
      .select('id,store_id,provider,status,last_synced_at,orders_synced_from,external_account_id')
      .eq('store_id', storeId).in('provider',['cafe24','meta']);
    if(id !== requestId) return;
    if(result.error){
      message('pageMessage', '연결 상태를 불러오지 못했어요. 다시 조회해 주세요.');
      setConnection('cafeConnection','Cafe24 확인 실패','error');setConnection('metaConnection','Meta 확인 실패','error');
      return;
    }
    message('pageMessage', '');
    var rows = result.data || [];
    var cafe = rows.find(function(r){ return r.provider === 'cafe24'; });
    var meta = rows.find(function(r){ return r.provider === 'meta'; });
    selectedCafe = cafe || null; selectedMeta = meta || null; publish();
    setConnection('cafeConnection',cafe&&cafe.status==='connected'?'Cafe24 연결됨':'Cafe24 미연결',cafe&&cafe.status==='connected'?'on':'off');
    setConnection('metaConnection',meta&&meta.status==='connected'?'Meta 연결됨':'Meta 미연결',meta&&meta.status==='connected'?'on':'off');
    await Promise.all([loadOrders(storeId, cafe, id), loadMeta(meta, id)]);
  }
  function addLine(id, text){var p = document.createElement('p');p.textContent = text;byId(id).appendChild(p);}
  function addSummary(id,label,value,note){var row=document.createElement('div');row.className='summary-row';var title=document.createElement('span');title.textContent=label;var strong=document.createElement('strong');strong.textContent=value;row.append(title,strong);if(note){var small=document.createElement('small');small.textContent=note;row.appendChild(small);}byId(id).appendChild(row);}
  function showOverview(){
    ['briefList','adState','monthSummary'].forEach(function(id){byId(id).replaceChildren();});
    var cafe = viewState.cafe, meta = viewState.meta;
    if(cafe && cafe.connected){
      if(cafe.selected && cafe.coverage !== 'none' && cafe.coverage !== 'unknown'){
        addSummary('briefList',periods.resolve(period.kind,period.date,Date.now()).label+' Cafe24 주문',cafe.selected.count+'건 · '+won(cafe.selected.amount),'취소·환불·미입금 미차감'+(cafe.syncedAt?' · '+time(cafe.syncedAt)+' 동기화':''));
      } else addLine('briefList','선택 기간 주문은 동기화 범위를 확인할 수 없어요. 주문 동기화 · 다시 조회를 눌러 주세요.');
      if(cafe.month && cafe.monthCoverage !== 'none' && cafe.monthCoverage !== 'unknown')
        addSummary('monthSummary','Cafe24 이번 달 주문',cafe.month.count+'건 · '+won(cafe.month.amount));
      else addLine('monthSummary','Cafe24 · 이번 달 주문 동기화 범위를 확인해 주세요.');
    } else {
      addLine('briefList',cafe && cafe.error ? 'Cafe24 주문 조회에 실패했어요.' : 'Cafe24 연결 후 주문을 확인할 수 있어요.');
      addLine('monthSummary','Cafe24 · 연결 후 확인 가능');
    }
    if(meta && (meta.today||meta.selected||meta.month)){
      var t = period.kind==='month'?meta.month:period.kind==='today'?meta.today:meta.selected, m = meta.month || {}, currency = meta.account && meta.account.currency;
      var label=periods.resolve(period.kind,period.date,Date.now()).label;
      t=t||{};
      addSummary('adState',label+' ROAS',t.roas == null ? '—' : Math.round(t.roas*100).toLocaleString('ko-KR')+'%','Meta 귀속 구매금액 ÷ 광고비');
      addSummary('adState','이번 달 ROAS',m.roas == null ? '—' : Math.round(m.roas*100).toLocaleString('ko-KR')+'%');
      if(Number(t.spend)>0 && Number(t.purchase_count)===0) addLine('adState',label+' 광고비가 사용되고 있지만 Meta 귀속 구매는 없습니다.');
      else if(t.roas != null && m.roas != null) addLine('adState',t.roas>m.roas?label+' 광고 효율이 이번 달 평균보다 높습니다.':t.roas<m.roas?label+' 광고 효율이 이번 달 평균보다 낮습니다.':label+' 광고 효율이 이번 달 평균과 비슷합니다.');
      addSummary('briefList',label+' Meta 광고비',metaMoney(t.spend,currency),'귀속 구매금액 '+(t.purchase_value_observed?metaMoney(t.purchase_value,currency):'측정되지 않음'));
      addSummary('monthSummary','Meta 이번 달 광고비',metaMoney(m.spend,currency),'귀속 구매금액 '+(m.purchase_value_observed?metaMoney(m.purchase_value,currency):'측정되지 않음')+' · 구매 '+(Number(m.purchase_count)||0)+'건');
    } else {
      addLine('adState',meta && meta.error ? 'Meta 성과 조회에 실패했어요.' : 'Meta 광고계정 연결 후 확인 가능');
      addLine('monthSummary','Meta · 연결 후 확인 가능');
    }
  }
  async function loadOrders(storeId, account, id){
    if(!account || account.status !== 'connected'){
      message('orderNote', '연결 전');
      viewState.cafe = {connected:false}; showOverview();
      return;
    }
    var now = Date.now();
    var range = periods.resolve(period.kind,period.date,now), month = periods.resolve('month',null,now);
    var bounds = periods.queryBounds(range), monthBounds = periods.queryBounds(month);
    var result = await sb.from('orders').select('ordered_at,payment_amount')
      .eq('store_id',storeId).gte('ordered_at',monthBounds.gte < bounds.gte ? monthBounds.gte : bounds.gte)
      .lt('ordered_at',monthBounds.lt > bounds.lt ? monthBounds.lt : bounds.lt).limit(5001);
    if(id !== requestId) return;
    if(result.error){ message('orderNote','조회 실패'); viewState.cafe={error:true};showOverview();return; }
    if((result.data || []).length > 5000){
      message('orderNote','집계 한도 초과');viewState.cafe={error:true};showOverview();return;
    }
    function total(start,end){return core.summarizeOrders((result.data||[]).filter(function(row){return row.ordered_at >= start && row.ordered_at < end;}));}
    var selected = total(bounds.gte,bounds.lt), monthTotal=total(monthBounds.gte,monthBounds.lt);
    var coverage=periods.coverage(range,account.last_synced_at,account.orders_synced_from);
    var monthCoverage=periods.coverage(month,account.last_synced_at,account.orders_synced_from);
    viewState.cafe={connected:true,selected:selected,month:monthTotal,coverage:coverage,monthCoverage:monthCoverage,syncedAt:account.last_synced_at};
    if(coverage==='none'||coverage==='unknown'){
      message('orderNote','동기화 범위 확인 전');
    } else {
      message('orderCount',selected.count.toLocaleString('ko-KR')+'건');
      message('orderAmount',won(selected.amount));
      message('orderNote',range.label+' · 마지막 동기화 기준');
    }
    showOverview();
  }
  async function loadMeta(account, id){
    if(!account){ message('adNote','연결 전');viewState.meta=null;showOverview();return; }
    if(account.status !== 'connected'){
      message('adNote','연결 확인 필요');viewState.meta=null;showOverview();return;
    }
    var body={connected_account_id:account.id};
    if(period.kind==='yesterday'||period.kind==='date'){body.period=period.kind;if(period.date)body.date=period.date;}
    var result = await sb.functions.invoke('meta-insights',{body:body});
    if(id !== requestId) return;
    var data = result.data;
    if(result.error || !data || data.ok !== true){
      message('adNote','조회 실패');viewState.meta={error:true};showOverview();return;
    }
    viewState.meta=data;
    var today = period.kind==='month' ? data.month || {} : period.kind==='today' ? data.today || {} : data.selected || {};
    var currency = data.account && data.account.currency;
    message('adSpend',metaMoney(today.spend,currency));
    message('adRoas',today.roas == null ? '—' : Math.round(today.roas * 100).toLocaleString('ko-KR')+'%');
    message('adNote','Meta 광고계정 시간대 기준');
    showOverview();publish();
  }
  byId('authMode').addEventListener('click', function(){
    signupMode = !signupMode;
    byId('signupFields').hidden = !signupMode;
    byId('authTitle').textContent = signupMode ? '계정을 만들어 시작하세요.' : '다시 만나서 반가워요.';
    byId('loginSubmit').textContent = signupMode ? '회원가입 →' : '로그인 →';
    byId('authMode').textContent = signupMode ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입';
    byId('password').autocomplete = signupMode ? 'new-password' : 'current-password';
    byId('password').value = ''; byId('passwordConfirm').value = '';
    byId('signupTerms').checked = false; byId('signupPrivacy').checked = false;
    message('loginMessage','');
  });
  byId('loginForm').addEventListener('submit', async function(event){
    event.preventDefault();
    if(!sb){ message('loginMessage','로그인 서비스를 불러오지 못했어요. 새로고침해 주세요.'); return; }
    var password = byId('password').value;
    if(signupMode){
      if(!policy){ message('loginMessage','가입 정보를 불러오지 못했어요. 새로고침해 주세요.'); return; }
      if(password.length < 8){ message('loginMessage','비밀번호는 8자 이상으로 입력해 주세요.'); return; }
      if(password !== byId('passwordConfirm').value){ message('loginMessage','비밀번호가 일치하지 않아요.'); return; }
      if(!byId('signupTerms').checked || !byId('signupPrivacy').checked){
        message('loginMessage','이용약관과 개인정보 수집·이용에 동의해 주세요.');
        (!byId('signupTerms').checked ? byId('signupTerms') : byId('signupPrivacy')).focus(); return;
      }
    }
    var button = byId('loginSubmit'); button.disabled = true;
    message('loginMessage',signupMode ? '가입 중이에요.' : '로그인 중이에요.');
    try{
      signupPending = signupMode;
      var result = signupMode
        ? await sb.auth.signUp({email:byId('email').value.trim(),password:password})
        : await sb.auth.signInWithPassword({email:byId('email').value.trim(),password:password});
      if(result.error){
        signupPending = false;
        message('loginMessage',signupMode ? '가입하지 못했어요. 이메일 또는 비밀번호를 확인해 주세요.' : '로그인하지 못했어요. 이메일·비밀번호와 인증 여부를 확인해 주세요.');
      } else if(signupMode && !result.data.session){
        signupPending = false;
        message('loginMessage','인증 이메일을 확인해 주세요. 인증 링크가 런치데스크로 열리면 인증을 마친 뒤 이곳으로 돌아와 로그인하면 됩니다.');
      } else message('loginMessage','');
    }catch(e){ signupPending = false; message('loginMessage','요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally{ button.disabled = false; byId('password').value = ''; byId('passwordConfirm').value = ''; }
  });
  async function logout(){ await sb.auth.signOut(); signedOut(); }
  byId('logout').addEventListener('click',logout);
  byId('switchAccount').addEventListener('click',logout);
  byId('gateLogout').addEventListener('click',logout);
  byId('gateSubmit').addEventListener('click',async function(){
    if(!userId || !policy) return;
    if(!byId('gateTerms').checked || !byId('gatePrivacy').checked){ message('gateMessage','두 필수 항목에 동의해 주세요.'); return; }
    var id = userId, button = this; button.disabled = true;
    message('gateMessage','동의 이력을 저장하고 있어요.');
    var result = await saveConsent(id,policy.SOURCES.EXISTING_USER_GATE);
    button.disabled = false;
    if(userId !== id) return;
    if(!result.ok){ message('gateMessage','동의 이력을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    var session = await sb.auth.getUser();
    if(userId === id && session.data && session.data.user) signedIn(session.data.user);
  });
  byId('storeSelect').addEventListener('change',function(){
    var id = ++requestId; resetCards();publish();loadSelected(this.value,id);
  });
  function switchView(view){
    var calculator = view === 'calculator';
    byId('overviewView').hidden = calculator; byId('calculatorView').hidden = !calculator;
    document.querySelectorAll('[data-view]').forEach(function(btn){
      var active = btn.getAttribute('data-view') === view;
      btn.setAttribute('aria-current',active?'page':'false');
      if(btn.closest('.sidebar')) btn.className=active?'sidebar-current':'sidebar-link';
    });
  }
  window.LaunchRoasApp.openCalculatorFromAd=function(ad){
    switchView('calculator');
    window.dispatchEvent(new CustomEvent('launchroas:ad-selection',{detail:ad}));
    window.scrollTo(0,0);
  };
  document.querySelectorAll('[data-view]').forEach(function(btn){btn.addEventListener('click',function(){switchView(btn.getAttribute('data-view'));window.scrollTo(0,0);});});
  document.querySelectorAll('[data-period]').forEach(function(btn){btn.addEventListener('click',function(){
    period={kind:btn.getAttribute('data-period'),date:null}; byId('periodDate').value='';
    document.querySelectorAll('[data-period]').forEach(function(b){b.setAttribute('aria-pressed',b===btn?'true':'false');});
    var label=periods.resolve(period.kind,null,Date.now()).label;
    message('ordersLabel','Cafe24 '+label+' 주문');message('amountLabel','Cafe24 '+label+' 주문금액');
    message('spendLabel','Meta '+label+' 광고비');message('roasLabel','Meta '+label+' ROAS');
    if(dashboardReady && byId('storeSelect').value)loadSelected(byId('storeSelect').value,++requestId);
  });});
  byId('periodDate').max=periods.kstDate(Date.now());
  byId('periodDate').addEventListener('change',function(){
    if(!periods.resolve('date',this.value,Date.now())){this.value='';return;}
    period={kind:'date',date:this.value};
    document.querySelectorAll('[data-period]').forEach(function(b){b.setAttribute('aria-pressed','false');});
    ['ordersLabel','amountLabel','spendLabel','roasLabel'].forEach(function(id){var original={ordersLabel:'Cafe24 주문',amountLabel:'Cafe24 주문금액',spendLabel:'Meta 광고비',roasLabel:'Meta ROAS'}[id];message(id,original+' · '+period.date);});
    if(dashboardReady && byId('storeSelect').value)loadSelected(byId('storeSelect').value,++requestId);
  });
  byId('refresh').addEventListener('click',async function(){
    if(!userId || syncing) return;
    var id = ++requestId, owner = userId, storeId = byId('storeSelect').value;
    if(!stores.some(function(store){return String(store.id) === storeId;})) return;
    syncing = true; this.disabled = true;
    message('pageMessage','Cafe24 주문을 동기화하고 있어요. 완료되면 수치를 다시 조회합니다.');
    var syncError = '';
    try{
      var accounts = await sb.from('connected_accounts').select('id,status,last_synced_at').eq('store_id',storeId).eq('provider','cafe24').limit(1);
      if(accounts.error) syncError = 'Cafe24 연결 상태를 확인하지 못했어요.';
      else if(accounts.data && accounts.data[0] && accounts.data[0].status === 'connected'){
        var range=periods.resolve(period.kind,period.date,Date.now());
        var plan=periods.syncPlan(range,Date.now(),accounts.data[0].last_synced_at);
        var result = await sb.functions.invoke('cafe24-orders-sync',{body:{store_id:storeId,start_date:plan.start_date,end_date:plan.end_date}});
        if(result.error || !result.data || result.data.ok !== true){
          var body = result.error && result.error.context && await result.error.context.json().catch(function(){return null;});
          syncError = body && body.code === 'RECONNECT_REQUIRED'
            ? 'Cafe24 인증이 만료됐어요. 런치데스크에서 같은 계정으로 다시 연결해 주세요.'
            : '주문 동기화에 실패했어요. 연결 상태를 확인해 주세요.';
        }
      } else syncError = 'Cafe24가 연결되지 않아 저장된 데이터만 다시 조회했어요.';
    }catch(e){ syncError = '주문 동기화 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.'; }
    finally{
      syncing = false; byId('refresh').disabled = false;
      if(id === requestId && owner === userId && byId('storeSelect').value === storeId){
        await loadStores(id);
        if(window.LaunchRoasAdlog) window.LaunchRoasAdlog.refresh();
        if(syncError) message('pageMessage',syncError);
        else message('pageMessage','주문 동기화와 다시 조회를 완료했어요.');
      }
    }
  });
  if(!sb){ message('loginMessage','로그인 서비스를 불러오지 못했어요. 새로고침해 주세요.'); return; }
  sb.auth.onAuthStateChange(function(_event, session){
    // Auth 콜백 안에서 Supabase 요청을 바로 await하지 않도록 다음 태스크에서 처리.
    setTimeout(function(){ if(session && session.user) signedIn(session.user); else signedOut(); },0);
  });
})();
