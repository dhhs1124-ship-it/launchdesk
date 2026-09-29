(function(){
  'use strict';
  var PROJECT_URL = 'https://zzhvckikonnalqnyatgn.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_hu9XkhXJKyoWVL7zMQD8_g_iMmDymMK';
  var byId = function(id){ return document.getElementById(id); };
  var core = window.LaunchRoasCore;
  var policy = window.launchdeskPolicyConsentCore;
  var sb = window.supabase && window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY);
  var userId = null, stores = [], requestId = 0, signupMode = false, syncing = false;
  var signupPending = false;
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
    message('cafeStatus', '연결 상태를 확인하고 있어요.'); message('metaStatus', '연결 상태를 확인하고 있어요.');
    message('lastSync', ''); message('metaPurchase', '');
  }
  function signedOut(){
    requestId++; userId = null; stores = []; signupPending = false;
    byId('loginPanel').hidden = false; byId('dashboard').hidden = true; byId('consentGate').hidden = true;
    byId('accountEmail').hidden = true; byId('logout').hidden = true;
    byId('password').value = ''; byId('refresh').disabled = false; syncing = false; resetCards();
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
    userId = user.id; var id = ++requestId;
    byId('loginPanel').hidden = true; byId('dashboard').hidden = true; byId('consentGate').hidden = true;
    byId('accountEmail').textContent = user.email || '로그인됨';
    byId('workspaceEmail').textContent = user.email || '로그인됨';
    byId('accountEmail').hidden = false; byId('logout').hidden = false;
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
    byId('dashboard').hidden = false;
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
    if(!stores.length){
      message('pageMessage', '이 계정에 연결된 Cafe24 쇼핑몰이 없어요. 런치데스크에서 위에 표시된 같은 계정으로 로그인한 뒤 등록해 주세요.');
      message('cafeStatus', '쇼핑몰 없음'); message('metaStatus', '쇼핑몰을 등록한 뒤 확인할 수 있어요.');
      return;
    }
    message('pageMessage', '');
    await loadSelected(select.value, id);
  }
  async function loadSelected(storeId, id){
    var owned = stores.some(function(s){ return String(s.id) === String(storeId); });
    if(!owned || id !== requestId) return;
    resetCards(); message('pageMessage', '주문과 광고를 조회하고 있어요.');
    var result = await sb.from('connected_accounts')
      .select('id,store_id,provider,status,last_synced_at,orders_synced_from,external_account_id')
      .eq('store_id', storeId).in('provider',['cafe24','meta']);
    if(id !== requestId) return;
    if(result.error){
      message('pageMessage', '연결 상태를 불러오지 못했어요. 다시 조회해 주세요.');
      message('cafeStatus', '연결 상태 조회 실패'); message('metaStatus', '연결 상태 조회 실패');
      return;
    }
    message('pageMessage', '');
    var rows = result.data || [];
    var cafe = rows.find(function(r){ return r.provider === 'cafe24'; });
    var meta = rows.find(function(r){ return r.provider === 'meta'; });
    await Promise.all([loadOrders(storeId, cafe, id), loadMeta(meta, id)]);
  }
  async function loadOrders(storeId, account, id){
    if(!account || account.status !== 'connected'){
      message('cafeStatus', 'Cafe24가 연결되지 않았어요.'); message('orderNote', '연결 전');
      return;
    }
    var now = Date.now();
    message('lastSync', account.last_synced_at ? '마지막 주문 동기화: ' + time(account.last_synced_at) : '동기화 기록 없음');
    if(!core.hasTodayCoverage(account.last_synced_at, now)){
      message('cafeStatus', '오늘 주문 동기화 전이에요. 위의 주문 동기화 · 다시 조회를 눌러 주세요.');
      message('orderNote', '오늘 동기화 전'); return;
    }
    var result = await sb.from('orders').select('ordered_at,payment_amount')
      .eq('store_id',storeId).gte('ordered_at',core.kstStartIso(now))
      .lt('ordered_at',new Date(Date.parse(core.kstStartIso(now)) + 86400000).toISOString()).limit(5001);
    if(id !== requestId) return;
    if(result.error){ message('cafeStatus','주문 조회에 실패했어요.'); message('orderNote','조회 실패'); return; }
    if((result.data || []).length > 5000){
      message('cafeStatus','오늘 주문이 5,000건을 넘어 집계를 표시할 수 없어요.'); message('orderNote','집계 한도 초과'); return;
    }
    var summary = core.summarizeOrders(result.data);
    message('orderCount',summary.count.toLocaleString('ko-KR')+'건');
    message('orderAmount',won(summary.amount));
    message('orderNote','마지막 동기화 기준');
    message('cafeStatus','오늘 들어온 주문을 표시합니다. 취소·환불·미입금은 차감하지 않았어요.');
  }
  async function loadMeta(account, id){
    if(!account){ message('metaStatus','Meta 광고계정이 연결되지 않았어요.'); message('adNote','연결 전'); return; }
    if(account.status !== 'connected'){
      message('metaStatus',account.external_account_id ? 'Meta 인증이 끊어졌어요. 다시 연결해 주세요.' : 'Meta 광고계정 선택을 완료해 주세요.');
      message('adNote','연결 확인 필요'); return;
    }
    var result = await sb.functions.invoke('meta-insights',{body:{connected_account_id:account.id}});
    if(id !== requestId) return;
    var data = result.data;
    if(result.error || !data || data.ok !== true){
      message('metaStatus','Meta 성과를 불러오지 못했어요. 연결 상태를 확인해 주세요.');
      message('adNote','조회 실패'); return;
    }
    var today = data.today || {}, currency = data.account && data.account.currency;
    message('adSpend',metaMoney(today.spend,currency));
    message('adRoas',today.roas == null ? '—' : Math.round(today.roas * 100).toLocaleString('ko-KR')+'%');
    message('adNote','Meta 광고계정 시간대 기준');
    message('metaStatus','Meta 자체 귀속 기준의 광고 성과입니다.');
    message('metaPurchase',today.purchase_value_observed ? 'Meta 귀속 구매금액: '+metaMoney(today.purchase_value,currency) : 'Meta 구매금액은 측정되지 않았어요.');
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
    var id = ++requestId; loadSelected(this.value,id);
  });
  byId('refresh').addEventListener('click',async function(){
    if(!userId || syncing) return;
    var id = ++requestId, owner = userId, storeId = byId('storeSelect').value;
    if(!stores.some(function(store){return String(store.id) === storeId;})) return;
    syncing = true; this.disabled = true;
    message('pageMessage','Cafe24 주문을 동기화하고 있어요. 완료되면 수치를 다시 조회합니다.');
    var syncError = '';
    try{
      var accounts = await sb.from('connected_accounts').select('id,status').eq('store_id',storeId).eq('provider','cafe24').limit(1);
      if(accounts.error) syncError = 'Cafe24 연결 상태를 확인하지 못했어요.';
      else if(accounts.data && accounts.data[0] && accounts.data[0].status === 'connected'){
        var result = await sb.functions.invoke('cafe24-orders-sync',{body:{store_id:storeId}});
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
