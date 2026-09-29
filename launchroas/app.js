(function(){
  'use strict';
  var PROJECT_URL = 'https://zzhvckikonnalqnyatgn.supabase.co';
  var PUBLISHABLE_KEY = 'sb_publishable_hu9XkhXJKyoWVL7zMQD8_g_iMmDymMK';
  var byId = function(id){ return document.getElementById(id); };
  var core = window.LaunchRoasCore;
  var sb = window.supabase && window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY);
  var userId = null, stores = [], requestId = 0;
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
    requestId++; userId = null; stores = [];
    byId('loginPanel').hidden = false; byId('dashboard').hidden = true;
    byId('accountEmail').hidden = true; byId('logout').hidden = true;
    byId('password').value = ''; resetCards();
  }
  async function signedIn(user){
    if(!user || user.is_anonymous){ signedOut(); return; }
    userId = user.id; var id = ++requestId;
    byId('loginPanel').hidden = true; byId('dashboard').hidden = false;
    byId('accountEmail').textContent = user.email || '로그인됨';
    byId('accountEmail').hidden = false; byId('logout').hidden = false;
    await loadStores(id);
  }
  async function loadStores(id){
    message('pageMessage', '쇼핑몰을 불러오는 중이에요.'); resetCards();
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
    if(!stores.length){
      message('pageMessage', '연결된 Cafe24 쇼핑몰이 아직 없어요. 런치데스크에서 쇼핑몰을 등록해 주세요.');
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
      message('cafeStatus', '오늘 주문 동기화 전이에요. 런치데스크에서 동기화한 뒤 다시 조회해 주세요.');
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
  byId('loginForm').addEventListener('submit', async function(event){
    event.preventDefault();
    if(!sb){ message('loginMessage','로그인 서비스를 불러오지 못했어요. 새로고침해 주세요.'); return; }
    var button = byId('loginSubmit'); button.disabled = true;
    message('loginMessage','로그인 중이에요.');
    var result = await sb.auth.signInWithPassword({email:byId('email').value.trim(),password:byId('password').value});
    button.disabled = false; byId('password').value = '';
    if(result.error) message('loginMessage','로그인하지 못했어요. 이메일·비밀번호와 인증 여부를 확인해 주세요.');
    else message('loginMessage','');
  });
  byId('logout').addEventListener('click', async function(){ await sb.auth.signOut(); signedOut(); });
  byId('storeSelect').addEventListener('change',function(){
    var id = ++requestId; loadSelected(this.value,id);
  });
  byId('refresh').addEventListener('click',function(){
    if(userId) loadStores(++requestId);
  });
  if(!sb){ message('loginMessage','로그인 서비스를 불러오지 못했어요. 새로고침해 주세요.'); return; }
  sb.auth.onAuthStateChange(function(_event, session){
    // Auth 콜백 안에서 Supabase 요청을 바로 await하지 않도록 다음 태스크에서 처리.
    setTimeout(function(){ if(session && session.user) signedIn(session.user); else signedOut(); },0);
  });
})();
