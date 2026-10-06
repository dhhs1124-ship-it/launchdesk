/* 운영 현황 — 주간 AI 점검 카드 · 먼저 확인할 광고 · 광고/비용 요약.
   AI 결과는 서버(ai-weekly-review)가 검증해 저장한 값만 쓴다. 사용자 화면에는 내부 필드명 · 코드 · JSON 값을 내보내지 않고
   한국어 지표명으로 바꿔 보여 준다(아래 순수 함수 — node --test로 검증). */
(function(root,factory){
  var api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&typeof root==='object')root.LaunchRoasInsights=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  var LABELS={spend:'광고비',impressions:'노출',reach:'도달',frequency:'빈도',link_clicks:'링크 클릭',link_ctr_pct:'클릭률',link_cpc:'클릭당 비용',
    cpm:'1,000회 노출당 비용',landing_page_view:'랜딩 페이지 조회',add_to_cart:'장바구니',initiate_checkout:'결제 시작',purchases:'구매',
    purchase_value:'구매금액',roas:'ROAS',landing_rate_pct:'랜딩률',add_to_cart_rate_pct:'장바구니율',checkout_rate_pct:'결제 시작률',
    purchase_rate_pct:'구매율',funnel_note:'전환 단계 데이터',funnel_ratio_usable:'전환 단계 비율 계산 가능 여부',attribution:'귀속 기준',
    optimization_goal:'최적화 목표',objective:'캠페인 목표',new_ad:'신규 광고 여부',link_domain:'연결 페이지 주소',title:'광고 제목',body:'광고 문구',
    description:'광고 설명',cta:'버튼 문구',format:'소재 형식',cards:'캐러셀 카드',variants:'동적 소재 문구',notes:'소재 확인 범위',
    median_link_ctr_pct:'비교 광고 클릭률 중앙값',median_link_cpc:'비교 광고 클릭당 비용 중앙값',median_roas:'비교 광고 ROAS 중앙값',
    median_purchase_rate_pct:'비교 광고 구매율 중앙값',note:'비교 광고'};
  var CODES={LPV_EXCEEDS_LINK_CLICKS:'랜딩 페이지 조회가 링크 클릭보다 많음',LPV_NOT_OBSERVED:'랜딩 페이지 조회 미측정',NO_LINK_CLICKS:'링크 클릭 없음',
    CLICK_THROUGH:'클릭 후',VIEW_THROUGH:'조회 후',ENGAGED_VIDEO_VIEW:'영상 참여 후',OFFSITE_CONVERSIONS:'웹사이트 전환',OUTCOME_SALES:'판매',
    SHOP_NOW:'지금 구매하기',BUY_NOW:'구매하기',LEARN_MORE:'더 알아보기',ORDER_NOW:'주문하기',SIGN_UP:'가입하기',GET_OFFER:'혜택 받기'};
  var MONEY={spend:1,link_cpc:1,cpm:1,purchase_value:1,median_link_cpc:1};

  // 근거 경로(예: metrics_current.link_ctr_pct) → 한국어 지표명
  function metricName(path){
    var p=String(path||'').split('.'),head=p[0],key=p[p.length-1];
    if(head==='metrics_current')return '지난주 '+(LABELS[p[1]]||p[1]);
    if(head==='metrics_previous')return '그 전주 '+(LABELS[p[1]]||p[1]);
    if(head==='change')return (LABELS[p[1]]||p[1])+(key==='pct'?' 전주 대비 변화율':key==='before'?' (그 전주)':key==='now'?' (지난주)':' 전주 대비');
    if(head==='peers')return LABELS[key]||'비교 광고';
    if(head==='creative')return LABELS[p[1]]||'광고 소재';
    return LABELS[key]||LABELS[head]||'기타 지표';
  }
  function money(v,cur){
    if(v==null||!Number.isFinite(Number(v)))return '—';
    if(!cur||cur==='KRW')return Math.round(Number(v)).toLocaleString('ko-KR')+'원';
    try{return new Intl.NumberFormat('en-US',{style:'currency',currency:cur,maximumFractionDigits:2}).format(Number(v));}catch(e){return Number(v).toLocaleString('en-US')+' '+cur;}
  }
  // 목록용 짧은 금액 — 18.5만원 · $137
  function shortMoney(v,cur){
    if(v==null||!Number.isFinite(Number(v)))return '—';var n=Number(v);
    if(!cur||cur==='KRW'){var a=Math.abs(n);return a>=1e8?(Math.round(n/1e7)/10)+'억원':a>=1e4?(Math.round(n/1e3)/10)+'만원':Math.round(n).toLocaleString('ko-KR')+'원';}
    try{return new Intl.NumberFormat('en-US',{style:'currency',currency:cur,maximumFractionDigits:Math.abs(n)>=100?0:2}).format(n);}catch(e){return Math.round(n)+' '+cur;}
  }
  function koText(text){
    if(text==null)return '';
    return String(text)
      .replace(/funnel_ratio_usable\s*=\s*false/g,'전환 단계 비율 계산 불가').replace(/funnel_ratio_usable\s*=\s*true/g,'전환 단계 비율 계산 가능')
      .replace(/\b(?:metrics_current|metrics_previous|change|creative|peers)\.[a-z_]+(?:\.[a-z_]+)*/g,metricName)
      .replace(/\b([A-Z][A-Z_]{3,})\b/g,function(m){return CODES[m]||m;})
      .replace(/\b([a-z]+(?:_[a-z]+)+|attribution|roas|peers)\b/g,function(m){return m==='roas'?'ROAS':m==='peers'?'비교 광고':LABELS[m]||m;})
      .replace(/(클릭 후|조회 후|영상 참여 후) (\d+)일/g,'$1 $2일');
  }
  // 근거 값 → 화면 표시
  function formatValue(path,v,cur){
    var key=String(path||'').split('.').pop();
    if(v===null||v===undefined||v==='')return '없음';
    if(typeof v==='boolean')return v?'예':'아니오';
    if(typeof v==='string')return koText(v);
    if(/^change\./.test(path)&&key==='pct')return (v>0?'+':'')+v+'%';
    if(key==='roas'||key==='median_roas')return Math.round(v*100).toLocaleString('ko-KR')+'%';
    if(/_pct$/.test(key))return v+'%';
    if(MONEY[key]||MONEY[String(path).split('.')[1]])return money(v,cur);
    if(key==='frequency')return v+'회';
    return Number(v).toLocaleString('ko-KR');
  }
  var VERDICT={'개선 필요':{label:'점검',tone:'check',rank:0},'판단 보류':{label:'판단 보류',tone:'hold',rank:1},'유지':{label:'유지',tone:'keep',rank:2}};
  function verdictView(v){return VERDICT[v]||{label:'분석 없음',tone:'none',rank:3};}
  // 핵심 변화 한 줄 — 실제 지표로만(구매 · ROAS, 부족하면 광고비)
  function changeLine(a,cur){
    var c=a&&a.current||{},p=a&&a.previous;
    if(!p)return '신규 광고 · 비교할 전주 없음';
    var parts=[],r=function(x){return Math.round(x*100).toLocaleString('ko-KR')+'%';};
    if(c.purchases!=null&&p.purchases!=null)parts.push('구매 '+p.purchases+'→'+c.purchases+'건');
    if(c.roas!=null&&p.roas!=null)parts.push('ROAS '+r(p.roas)+'→'+r(c.roas));
    if(parts.length<2&&c.spend!=null&&p.spend>0)parts.push('광고비 '+(c.spend>=p.spend?'+':'')+Math.round((c.spend-p.spend)/p.spend*100)+'%');
    return parts.length?parts.join(' · '):'전주와 비교할 지표 없음';
  }
  function numbersLine(a,cur){
    var c=a&&a.current||{};
    return [shortMoney(c.spend,cur),'구매 '+(c.purchases==null?'미측정':c.purchases+'건'),'ROAS '+(c.roas==null?'미측정':Math.round(c.roas*100).toLocaleString('ko-KR')+'%')].join(' · ');
  }
  // 먼저 확인할 순서: 점검 → 판단 보류 → 유지, 같은 판정이면 AI 우선순위 · 광고비 큰 순
  function orderAds(ads){
    return (ads||[]).slice().sort(function(x,y){
      var a=verdictView(x.analysis&&x.analysis.verdict),b=verdictView(y.analysis&&y.analysis.verdict);
      return a.rank-b.rank||((x.analysis&&x.analysis.priority)||9)-((y.analysis&&y.analysis.priority)||9)||((y.current&&y.current.spend)||0)-((x.current&&x.current.spend)||0);
    });
  }
  return {metricName:metricName,koText:koText,formatValue:formatValue,verdictView:verdictView,changeLine:changeLine,numbersLine:numbersLine,orderAds:orderAds,shortMoney:shortMoney,money:money};
});


(function(){
  if(typeof document==='undefined'||!window.LaunchRoasApp)return;
  var I=window.LaunchRoasInsights,app=window.LaunchRoasApp,S=window.LaunchRoasSales,sales=null,ads=null,lastSig='';
  var wk={state:'idle',data:null,message:'',storeId:null,busy:false},ui={open:null,all:false};
  function byId(id){return document.getElementById(id);}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function won(v){return v==null?'—':(v<0?'−':'')+Math.abs(Math.round(v)).toLocaleString('ko-KR')+'원';}
  function day(s,withDow){var d=new Date(s+'T00:00:00Z');return (d.getUTCMonth()+1)+'월 '+d.getUTCDate()+'일'+(withDow?'('+'일월화수목금토'[d.getUTCDay()]+')':'');}
  function lastWeeks(){
    var now=new Date(Date.now()+9*3600e3),dow=(now.getUTCDay()+6)%7,mon=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-dow*864e5,f=function(ms){return new Date(ms).toISOString().slice(0,10);};
    return {current:{since:f(mon-7*864e5),until:f(mon-864e5)},previous:{since:f(mon-14*864e5),until:f(mon-8*864e5)},next:f(mon+7*864e5)};
  }

  function render(){
    var box=byId('insightsBody');if(!box)return;
    var sig=JSON.stringify([wk,ui,sales&&[sales.ready,sales.loading,sales.error,sales.currency,sales.fx,sales.summary&&[sales.summary.unlinkedKinds,sales.summary.productKinds],sales.links&&sales.links.length],ads&&[ads.loading,ads.error,ads.rows&&ads.rows.length]]);
    if(sig===lastSig)return;lastSig=sig;
    box.replaceChildren(renderWeekly());
    renderSide();
  }

  // ---- 주간 AI 점검 ----
  function renderWeekly(){
    var d=wk.data,q=d&&d.quota,w=lastWeeks(),r=d&&d.result,wrap=el('div','wk');
    var head=el('div','wk-head'),title=el('div','wk-title');
    title.append(el('h2','','주간 AI 점검'),el('p','wk-period','분석 기간 '+day(w.current.since,true)+' ~ '+day(w.current.until,true)+' · 그 전주와 비교'));
    head.appendChild(title);
    var canRun=!wk.busy&&wk.state!=='unavailable'&&wk.state!=='off'&&(!q||q.can_run)&&!!(sales&&sales.links);
    if(!(q&&q.used&&!q.can_run)){
      var btn=el('button','primary wk-run',wk.busy?'점검 중…':d&&d.status==='partial'?'남은 광고 이어서 점검 →':'이번 주 점검하기 →');
      btn.type='button';btn.disabled=!canRun;btn.addEventListener('click',run);head.appendChild(btn);
    }else head.appendChild(el('span','wk-done','이번 주 점검 완료'));
    wrap.appendChild(head);
    if(wk.message)wrap.appendChild(el('p','wk-message'+(wk.state==='error'?' is-error':''),wk.message));
    else if(d&&d.error&&!r)wrap.appendChild(el('p','wk-message is-error',I.koText(d.error)));
    if(r)wrap.appendChild(renderResult(r,d.status));
    else if(!wk.busy&&wk.state==='ready')wrap.appendChild(el('p','wk-empty','지난주 광고별 지표 · 문구 · 이미지를 보고 이번 주에 먼저 확인할 광고를 골라 드려요.'));
    wrap.appendChild(el('small','wk-foot','계정당 주 1회 · 한국 시간 월요일 00시 갱신(다음 '+day(w.next)+') · 위의 기간 선택과 관계없이 지난주 고정'));
    return wrap;
  }
  function renderResult(r,status){
    var frag=el('div','wk-result'),s=r.summary||{},c=s.cafe24&&s.cafe24.current,m=s.meta||{},ep=s.expected_profit||{},cur=m.currency;
    var last=el('p','wk-last');
    last.append(el('span','wk-last-label','지난주'),el('span','','주문 '+(c?won(c.gross_sales_krw):'—')),el('span','','광고비 '+I.money(m.current&&m.current.spend,cur)),
      el('span','','예상 남은 금액 '+won(ep.current)+(ep.partial?'(일부 상품)':'')));
    frag.appendChild(last);
    var list=I.orderAds(r.ads),shown=ui.all?list:list.slice(0,3);
    var h=el('div','wk-list-head');h.append(el('h3','',list.length?'이번 주 먼저 확인할 광고 '+shown.length+'개':'분석한 광고가 없어요'));
    if(status==='partial')h.appendChild(el('span','wk-partial','일부만 분석됨'));
    frag.appendChild(h);
    var ol=el('ol','wk-ads');
    shown.forEach(function(a,i){ol.appendChild(renderAd(a,i,cur));});
    frag.appendChild(ol);
    if(list.length>3){var more=el('button','wk-all',ui.all?'접기 ↑':'분석한 광고 전체 '+list.length+'개 보기 ↓');more.type='button';more.addEventListener('click',function(){ui.all=!ui.all;render();});frag.appendChild(more);}
    var cov=r.coverage||{},notes=(r.notes||[]).map(I.koText).concat((cov.skipped||[]).map(function(x){return (x.ad_name||'광고')+' — '+I.koText(x.reason);}));
    var basis=el('details','wk-basis');basis.appendChild(el('summary','','분석 범위 · 기준 (광고 '+(cov.total||0)+'개 중 '+(cov.analyzed||0)+'개 분석)'));
    var ul=el('ul');notes.forEach(function(t){ul.appendChild(el('li','',t));});basis.appendChild(ul);frag.appendChild(basis);
    return frag;
  }
  function renderAd(a,i,cur){
    var an=a.analysis,v=I.verdictView(an&&an.verdict),li=el('li','wk-ad'+(ui.open===a.ad_id?' is-open':''));
    var row=el('button','wk-ad-row');row.type='button';row.setAttribute('aria-expanded',ui.open===a.ad_id?'true':'false');
    var main=el('span','wk-ad-main');
    main.append(el('strong','wk-ad-name',a.ad_name||'이름 없는 광고'),el('span','wk-change',I.changeLine(a,cur)),el('span','wk-next',an?I.koText(an.next_action):'AI 분석 결과가 없어요(재시도 대상)'));
    row.append(el('span','wk-rank',String(i+1)),el('span','wk-badge '+v.tone,v.label),main,el('span','wk-nums',I.numbersLine(a,cur)),el('span','wk-more',ui.open===a.ad_id?'접기':'상세'));
    row.addEventListener('click',function(){ui.open=ui.open===a.ad_id?null:a.ad_id;render();});
    li.appendChild(row);
    if(ui.open===a.ad_id&&an)li.appendChild(renderDetail(a,an,v,cur));
    return li;
  }
  function section(title){var s=el('section','wk-sec');s.appendChild(el('h4','',title));return s;}
  function renderDetail(a,an,v,cur){
    var box=el('div','wk-detail');
    // 1. 판단 이유
    var why=section('판단 이유');why.appendChild(el('p','wk-lead',I.koText(an.headline)));
    var dl=el('dl','wk-ev');
    (an.evidence||[]).slice(0,5).forEach(function(e){
      var dd=el('dd');dd.append(el('strong','',I.formatValue(e.metric,e.value,cur)));if(e.note)dd.appendChild(el('small','',I.koText(e.note)));
      dl.append(el('dt','',I.metricName(e.metric)),dd);
    });
    why.appendChild(dl);
    if(an.funnel&&an.funnel.stage&&an.funnel.stage!=='문제 없음')why.appendChild(el('p','wk-sub','의심 구간: '+an.funnel.stage+(an.funnel.evidence?' — '+I.koText(an.funnel.evidence):'')));
    box.appendChild(why);
    // 2. 지금 할 일
    var todo=section('지금 할 일');todo.appendChild(el('p','wk-lead',I.koText(an.next_action)));
    var checks=(an.hypotheses||[]).map(function(h){return h.check;}).filter(Boolean).slice(0,3);
    if(checks.length){var ul=el('ul','wk-checks');checks.forEach(function(t){ul.appendChild(el('li','',I.koText(t)));});todo.appendChild(ul);}
    if(an.budget_note)todo.appendChild(el('p','wk-sub','예산: '+I.koText(an.budget_note)));
    box.appendChild(todo);
    // 3. 변경 예시와 테스트 — 변경안이 없으면 만들지 않는다
    var ch=section('변경 예시와 테스트'),rec=an.recommendation;
    if(rec){
      var g=el('dl','wk-rec');
      var add=function(k,t){if(t){g.append(el('dt','',k),el('dd','',I.koText(t)));}};
      add('현재',rec.current);add('바꿔 볼 것',rec.proposed);
      if(rec.example){g.append(el('dt','',rec.example_is_provisional?'수정 예시 (정보 확인 전 임시)':'수정 예시'));var ex=el('dd','wk-example',rec.example);g.appendChild(ex);}
      if(rec.needs_info&&rec.needs_info.length)add('먼저 확인할 정보',rec.needs_info.join(' / '));
      var t=rec.test||{};
      add('테스트 방법',t.method);
      if(t.compare_metrics&&t.compare_metrics.length)add('비교 지표',t.compare_metrics.map(function(x){return /^[a-z_]+$/.test(x)?I.metricName(x):x;}).join(', '));
      add('판단 기준',t.decision_rule);add('필요한 표본',t.sample_note);
      ch.appendChild(g);
    }else ch.appendChild(el('p','wk-sub',v.tone==='hold'?'표본이 작아 변경안을 만들지 않았어요. 데이터가 더 쌓인 뒤 다시 확인해요.':'지금은 바꿀 것을 권하지 않았어요. 현재 광고를 유지하며 지켜봐요.'));
    box.appendChild(ch);
    // 분석 전문 — 기본은 접힘
    var full=el('details','wk-full');full.appendChild(el('summary','','분석 전문 보기'));
    var fl=el('dl','wk-rec');
    var addf=function(k,t){if(t){fl.append(el('dt','',k),el('dd','',I.koText(t)));}};
    addf('전주 대비',an.changes);addf('비교 광고',an.peers);
    (an.hypotheses||[]).forEach(function(h,i){addf('원인 가설 '+(i+1),h.text+(h.basis?' · 근거: '+h.basis:'')+(h.check?' · 확인: '+h.check:''));});
    addf('판단 한계',(an.limits||[]).join(' / '));
    addf('분석 범위',(a.scope&&a.scope.label?a.scope.label:'')+(a.creative&&a.creative.notes&&a.creative.notes.length?' · '+a.creative.notes.join(' / '):''));
    full.appendChild(fl);box.appendChild(full);
    return box;
  }

  // ---- 오른쪽 요약 ----
  function row(dl,k,v,tone){var dd=el('dd',tone||'',v);dl.append(el('dt','',k),dd);}
  function renderSide(){
    var sa=byId('sideAds'),sc=byId('sideCost');if(!sa||!sc)return;
    sa.replaceChildren();sc.replaceChildren();
    var rows=ads&&ads.rows?ads.rows.filter(function(r){return Number(r.metrics&&r.metrics.spend)>0;}):null;
    row(sa,'광고비 집행 광고 세트',ads&&ads.error?'조회 실패':ads&&ads.loading||!ads?'확인 중':rows.length+'개');
    var r=wk.data&&wk.data.result,list=r?r.ads||[]:[];
    var need=list.filter(function(a){return a.analysis&&a.analysis.verdict==='개선 필요';}).length;
    row(sa,'점검 필요 (지난주 AI)',r?need+'개':'—',need?'is-warn':'');
    var q=wk.data&&wk.data.quota,st=wk.data&&wk.data.status;
    row(sa,'이번 주 AI 점검',wk.busy?'진행 중':st==='completed'?'완료':st==='partial'?'일부 완료':q&&q.can_run?'아직 안 함':'—');
    var s=sales&&sales.summary,links=sales&&sales.links||[],saved={};
    links.forEach(function(l){saved[l.product_no]=1;});
    row(sc,'상품 비용',sales&&sales.loading?'확인 중':Object.keys(saved).length+'개 저장');
    if(s&&s.unlinkedKinds)row(sc,'선택 기간 미입력 상품',s.unlinkedKinds+'종','is-warn');
    var cur=sales&&sales.currency,fx=sales&&sales.fx;
    row(sc,'광고비 환율',!cur?'—':cur==='KRW'?'원화 계정 · 필요 없음':fx&&fx.currency===cur?'1 '+cur+' = '+Number(fx.krw_per_unit).toLocaleString('ko-KR')+'원':'입력 필요',cur&&cur!=='KRW'&&!(fx&&fx.currency===cur)?'is-warn':'');
  }

  // ---- 실행 ----
  async function weekSales(ctx,range){
    var res=await ctx.client.functions.invoke('cafe24-order-items',{body:{store_id:ctx.storeId,start_date:range.since,end_date:range.until}});
    if(!res.data||!res.data.ok||res.data.truncated)return null;
    var s=S.summarize(res.data.orders||[],sales.links||[]);
    return {gross_sales_krw:Math.round(s.grossSales),sold_qty:s.soldQty,linked_qty:s.linkedQty,margin_total_krw:s.marginTotal,partial:s.partial,estimated_orders:s.margin.estimatedOrders};
  }
  async function call(ctx,body){
    var res=await ctx.client.functions.invoke('ai-weekly-review',{body:body});
    if(res.error&&!res.data){
      var ctxErr=res.error&&res.error.context;var st=ctxErr&&ctxErr.status;
      return {unavailable:st===404,error:true,body:ctxErr&&ctxErr.json?await ctxErr.json().catch(function(){return null;}):null};
    }
    return {data:res.data};
  }
  async function loadStatus(){
    var ctx=app.getContext();if(!ctx.storeId||wk.storeId===ctx.storeId)return;
    wk={state:'idle',data:null,message:'',storeId:ctx.storeId,busy:false};ui={open:null,all:false};render();
    var r=await call(ctx,{store_id:ctx.storeId,action:'status'});
    if(app.getContext().storeId!==ctx.storeId)return;
    if(r.unavailable)wk.state='unavailable',wk.message='주간 AI 점검을 준비하고 있어요.';
    else if(r.error)wk.state='error',wk.message='점검 상태를 불러오지 못했어요. 잠시 후 다시 열어 주세요.';
    else{wk.data=r.data;wk.state=r.data.enabled?'ready':'off';if(!r.data.enabled)wk.message='AI 연결 전이라 아직 실행할 수 없어요.';}
    render();
  }
  async function run(){
    if(wk.busy)return; // 연속 클릭 방지(서버도 동시 요청을 막는다)
    var ctx=app.getContext();wk.busy=true;wk.message='지난주 · 그 전주 판매를 집계하는 중이에요.';render();
    try{
      var w=lastWeeks(),cur=await weekSales(ctx,w.current),prev=await weekSales(ctx,w.previous);
      wk.message='광고와 소재를 확인하고 분석하는 중이에요. 1~2분 걸릴 수 있어요.';render();
      var r=await call(ctx,{store_id:ctx.storeId,action:'run',sales:{current:cur,previous:prev},fx_krw_per_unit:ctx.fx&&ctx.fx.krw_per_unit||null});
      var d=r.data||r.body||{};
      if(r.unavailable){wk.state='unavailable';wk.message='주간 AI 점검을 준비하고 있어요.';}
      else{
        if(d.quota)wk.data=d;
        if(d.ok){wk.state='ready';wk.message='';if(window.LaunchRoasMotion)window.LaunchRoasMotion.toast(d.status==='partial'?'일부 광고만 분석했어요':'주간 점검 완료');}
        // 서버 오류 코드는 보이지 않고 서버가 준 한국어 안내만
        else{wk.state=d.code==='AI_NOT_CONFIGURED'?'off':'error';wk.message=d.message||d.error||'점검에 실패했어요. 이용 횟수는 차감되지 않았어요.';}
      }
    }catch(e){wk.state='error';wk.message='점검 요청에 실패했어요. 이용 횟수는 차감되지 않았어요.';}
    wk.busy=false;render();
  }

  window.addEventListener('launchroas:sales-state',function(e){sales=e.detail;render();loadStatus();});
  window.addEventListener('launchroas:adsets-state',function(e){ads=e.detail;render();});
  var fxBtn=byId('sideFx');if(fxBtn)fxBtn.addEventListener('click',function(){if(window.LaunchRoasOpenFx)window.LaunchRoasOpenFx();});
})();
