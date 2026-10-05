/* 개선 점검 — 규칙 기반(AI 분석 아님). 지금 연결에서 실제로 받는 값만 쓴다:
   Cafe24 주문 금액으로 계산한 남은 금액(일부 상품 기준일 수 있음), Meta 광고 세트 지표
   (광고비 · 노출 · 빈도 · 링크 클릭 · 링크 CTR · 랜딩 페이지 조회 · 장바구니 · 결제 시작 · 구매 · ROAS).
   광고 소재 이미지 · 상세페이지 내용은 받지 않으므로 "본 것처럼" 말하지 않고 원인은 '추정'으로만 쓴다.
   기준값은 일반적인 출발점이며 업종마다 다르다. */
(function(root,factory){
  var api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&typeof root==='object')root.LaunchRoasInsights=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  var MIN_IMPRESSIONS=2000,MIN_PURCHASES=3,MIN_CLICKS=30,MIN_LPV=50;
  function num(v){var x=Number(v);return Number.isFinite(x)?x:null;}
  function pct(v){return v==null?'—':(Math.round(v*10)/10).toLocaleString('ko-KR')+'%';}
  function won(v){return v==null?'—':(v<0?'−':'')+Math.abs(Math.round(v)).toLocaleString('ko-KR')+'원';}
  function cnt(v,u){return Math.round(v||0).toLocaleString('ko-KR')+(u||'');}
  function obs(x){return x&&x.observed?num(x.value):null;}

  // 광고 세트 하나 → 제안 목록. 각 제안: action(추천 행동) · facts(확인한 지표) · cause(추정 원인) · test(테스트 방법)
  function adsetSuggestions(row){
    var m=row.metrics||{},out=[],imp=num(m.impressions)||0,clicks=num(m.link_clicks)||0;
    var lpv=obs(m.landing_page_view),purchases=obs(m.purchase),atc=obs(m.add_to_cart);
    var ctr=num(m.link_ctr),freq=num(m.frequency),usable=m.funnel_status&&m.funnel_status.usable;
    if(imp>=MIN_IMPRESSIONS&&ctr!=null&&ctr<1)out.push({score:3,
      action:'썸네일 · 첫 문구만 바꾼 소재 1개를 추가해 보세요',
      facts:'링크 CTR '+pct(ctr)+' (노출 '+cnt(imp)+'회 · 링크 클릭 '+cnt(clicks)+'회)',
      cause:'추정: 피드에서 첫 화면(썸네일 · 첫 문구)이 클릭을 끌지 못함 — 소재 자체는 확인하지 않았어요',
      test:'같은 광고 세트 · 같은 예산에서 썸네일만 다른 소재를 3~7일 돌려 링크 CTR 비교'});
    if(freq!=null&&freq>=3)out.push({score:2,
      action:'새 소재를 추가해 같은 사람에게 반복 노출을 줄여 보세요',
      facts:'빈도 '+(Math.round(freq*10)/10)+'회 (도달 '+cnt(num(m.reach))+'명)',
      cause:'추정: 같은 소재 반복 노출로 반응이 떨어질 수 있음',
      test:'새 소재 추가 후 빈도와 링크 CTR 변화를 1주 비교'});
    if(usable&&clicks>=MIN_CLICKS&&m.landing_rate!=null&&m.landing_rate<70)out.push({score:3,
      action:'광고 링크 주소와 페이지 로딩 속도를 점검해 보세요',
      facts:'링크 클릭 '+cnt(clicks)+'회 중 랜딩 페이지 조회 '+cnt(lpv)+'회 ('+pct(m.landing_rate)+')',
      cause:'추정: 클릭 후 페이지가 늦게 열리거나 연결 주소 문제로 이탈',
      test:'모바일에서 광고 링크를 직접 열어 로딩 시간 확인 → 개선 후 랜딩 비율 전후 비교'});
    if(usable&&lpv!=null&&lpv>=MIN_LPV&&purchases!=null&&m.purchase_rate!=null&&m.purchase_rate<1){
      var atcLow=atc!=null&&m.add_to_cart_rate!=null&&m.add_to_cart_rate<5;
      var cartLow=!atcLow&&atc!=null&&atc>=10&&m.checkout_rate!=null&&m.checkout_rate<40;
      out.push({score:4,
        action:cartLow?'장바구니 → 결제 단계(배송비 · 쿠폰 안내)를 점검해 보세요':'상세페이지 첫 화면(대표 이미지 · 가격 · 혜택)을 점검해 보세요',
        facts:'랜딩 페이지 조회 '+cnt(lpv)+'회 · 구매 '+cnt(purchases)+'건 (구매율 '+pct(m.purchase_rate)+')'+(atc!=null?' · 장바구니 '+cnt(atc)+'건':'')+(cartLow?' · 결제 시작 비율 '+pct(m.checkout_rate):''),
        cause:cartLow?'추정: 결제 직전 배송비 · 총액에서 이탈 — 결제 화면은 확인하지 않았어요':'추정: 첫 화면에서 구매 이유가 바로 보이지 않음 — 상세페이지는 확인하지 않았어요',
        test:cartLow?'장바구니에 배송비 · 무료배송 조건을 미리 보여준 뒤 결제 시작 비율 전후 비교':'첫 화면의 대표 이미지나 혜택 문구 한 가지만 바꾸고 구매율을 1~2주 전후 비교'});
    }
    if(row.linked&&row.verdict&&row.verdict.tone==='below')out.push({score:5,
      action:'예산을 늘리기 전에 이 광고 세트의 소재 · 타깃부터 테스트해 보세요',
      facts:'Meta ROAS '+Math.round((num(m.roas)||0)*100)+'% < 연결 상품 손익분기 '+Math.round(row.verdict.breakeven*100)+'%'+' (구매 '+cnt(purchases)+'건)',
      cause:'확인: 연결한 상품 마진 기준으로 이 광고 세트는 손익분기에 못 미침(Meta 귀속 기준)',
      test:'소재 1개를 바꾼 새 광고를 같은 예산으로 1주 운영해 ROAS 비교'});
    return out;
  }

  function missing(row){
    var m=row.metrics||{},list=[],purchases=obs(m.purchase);
    if((num(m.impressions)||0)<MIN_IMPRESSIONS)list.push('노출 '+cnt(num(m.impressions))+'회(기준 '+cnt(MIN_IMPRESSIONS)+'회 미만)');
    if(purchases==null)list.push('구매 이벤트 미측정');else if(purchases<MIN_PURCHASES)list.push('구매 '+cnt(purchases)+'건(판단에 '+MIN_PURCHASES+'건 이상 필요)');
    if(m.funnel_status&&!m.funnel_status.usable)list.push(m.funnel_status.code==='LPV_EXCEEDS_LINK_CLICKS'?'랜딩 조회가 링크 클릭보다 많음 — 두 지표의 정의 · 집계 범위 · 귀속 기준 비교 확인 필요(그 전까지 랜딩 · 구매 비율은 쓰지 않음)':'랜딩 페이지 조회 미측정');
    if(!row.linked)list.push('상품 마진 미연결');
    return list;
  }

  // 현재 상태(확인한 사실만) + 광고 세트별 제안(최대 3개) + 부족한 데이터
  function build(sales,ads){
    var status=[],gaps=[],items=[];
    if(!sales||sales.loading)return {loading:true};
    var s=sales.summary;
    if(sales.profit!=null){
      status.push((sales.partial?'일부 상품 기준(판매 '+cnt(s.soldQty,'개')+' 중 '+cnt(s.linkedQty,'개')+') ':'')+'광고비 빼고 남은 금액 '+won(sales.profit));
      if(sales.partial)status.push(sales.profit<0?'미등록 상품의 마진이 빠져 있어 광고 전체가 적자인지는 판단할 수 없어요':'미등록 상품까지 넣으면 금액이 달라져요');
    }else gaps.push(sales.error?'Cafe24 판매를 불러오지 못함':'남은 금액 계산 전(상품 비용 · 광고비 확인 필요)');
    if(sales.meta&&sales.meta.roas!=null)status.push('Meta ROAS '+Math.round(Number(sales.meta.roas)*100).toLocaleString('ko-KR')+'%'+' · 광고비 '+(sales.spendKrw!=null?won(sales.spendKrw):'환율 입력 필요')+' (Meta 귀속 기준)');
    else if(sales.metaIssue)gaps.push('Meta '+sales.metaIssue);
    if(s&&s.unlinkedQty)gaps.push('비용 미입력 상품 '+cnt(s.unlinkedKinds,'종')+' (판매 '+cnt(s.unlinkedQty,'개')+')');
    if(!ads||ads.loading)return {status:status,gaps:gaps,items:[],adsLoading:true};
    if(ads.error){gaps.push(ads.error);return {status:status,gaps:gaps,items:[]};}
    var rows=(ads.rows||[]).filter(function(r){return (num(r.metrics&&r.metrics.spend)||0)>0;});
    if(!rows.length)gaps.push('선택 기간에 광고비가 잡힌 광고 세트 없음');
    var below=rows.filter(function(r){return r.verdict&&r.verdict.tone==='below';}).length,judged=rows.filter(function(r){return r.verdict&&r.verdict.tone!=='hold';}).length;
    if(rows.length)status.push('광고 세트 '+cnt(rows.length,'개')+' 중 손익분기 판단 가능 '+cnt(judged,'개')+(judged?' · 미달 '+cnt(below,'개'):''));
    rows.forEach(function(r){
      adsetSuggestions(r).forEach(function(x){items.push(Object.assign({adset:r.name,spend:num(r.metrics.spend)||0},x));});
    });
    items.sort(function(a,b){return b.score-a.score||b.spend-a.spend;});
    var thin=rows.slice().sort(function(a,b){return (num(b.metrics.spend)||0)-(num(a.metrics.spend)||0);}).slice(0,3)
      .map(function(r){var g=missing(r);return g.length?r.name+': '+g.join(' · '):null;}).filter(Boolean);
    return {status:status,gaps:gaps.concat(thin),items:items.slice(0,3)};
  }
  // ---- AI 분석에 보낼 데이터 — 실제로 받은 값만, 이름을 붙여 평평하게 ----
  function r2(v){var x=num(v);return x==null?null:Math.round(x*100)/100;}
  function salesBlock(s,profit,partial){
    if(!s)return null;var m=s.margin;
    return {profit_krw:profit==null?null:Math.round(profit),partial:!!partial,sold_qty:s.soldQty,linked_qty:s.linkedQty,unlinked_qty:s.unlinkedQty,
      unlinked_kinds:s.unlinkedKinds,margin_total_krw:s.marginTotal,revenue_krw:m.revenue,customer_shipping_krw:m.customerShipping,points_krw:m.points,
      unit_cost_krw:m.unitCost,fee_sales_krw:m.feeSales,fee_pg_krw:m.feePg,fee_shipping_krw:m.feeShip,ship_pack_cost_estimated_krw:m.orderCosts,
      orders_actual_payment:m.actualOrders,orders_estimated_amount:m.estimatedOrders};
  }
  function adsetBlock(r){
    var m=r.metrics||{};
    return {name:r.name,spend:r2(m.spend),impressions:num(m.impressions),reach:num(m.reach),frequency:r2(m.frequency),link_clicks:num(m.link_clicks),
      link_ctr_pct:r2(m.link_ctr),link_cpc:r2(m.link_cpc),cpm:r2(m.cpm),landing_page_view:obs(m.landing_page_view),add_to_cart:obs(m.add_to_cart),
      initiate_checkout:obs(m.initiate_checkout),purchases:obs(m.purchase),purchase_value:obs(m.purchase_value),roas:r2(m.roas),
      landing_rate_pct:r2(m.landing_rate),add_to_cart_rate_pct:r2(m.add_to_cart_rate),checkout_rate_pct:r2(m.checkout_rate),purchase_rate_pct:r2(m.purchase_rate),
      funnel_ratio_usable:!!(m.funnel_status&&m.funnel_status.usable),funnel_note:m.funnel_status&&m.funnel_status.code||null,
      margin_linked:!!r.linked,breakeven_roas:r.verdict&&r.verdict.breakeven?r2(r.verdict.breakeven):null,verdict:r.verdict?r.verdict.label:null};
  }
  function topAdsets(rows){
    return (rows||[]).filter(function(r){return (num(r.metrics&&r.metrics.spend)||0)>0;})
      .sort(function(a,b){return (num(b.metrics.spend)||0)-(num(a.metrics.spend)||0);}).slice(0,5).map(adsetBlock);
  }
  function buildPayload(sales,ads,prev){
    var range=sales&&sales.range,rule=build(sales,ads);
    return {
      period:range?{label:range.label,since:range.since,until:range.until,timezone:'Asia/Seoul'}:null,
      current:{sales:salesBlock(sales.summary,sales.profit,sales.partial),
        meta_account:sales.meta?{roas:r2(sales.meta.roas),spend_krw:sales.spendKrw,purchases:num(sales.meta.purchase_count)}:null,
        adsets:topAdsets(ads&&ads.rows),ad_currency:ads&&ads.currency||null},
      previous:prev||null,
      definitions:{
        profit_krw:'상품 마진(비용 저장 상품만) − 실제 광고비 전체. partial이면 일부 상품 기준',
        ship_pack_cost_estimated_krw:'실제 택배 지출이 아니라 저장한 설정값, 주문당 1회(가장 큰 값)',
        link_clicks:'Meta inline_link_clicks — 광고 안 링크 클릭',
        landing_page_view:'Meta 픽셀/전환 이벤트 landing_page_view — 클릭 후 페이지 로드. 링크 클릭과 집계 방식 · 귀속이 달라 클릭보다 많을 수 있음',
        purchases:'Meta가 광고에 귀속한 구매(Cafe24 실제 판매 수량과 다름)',
        attribution:'요청에 귀속 기간을 지정하지 않음 — Meta 기본값 적용, 응답에 명시되지 않음',
        roas:'Meta 구매 전환값 ÷ 광고비 (Meta 귀속 기준)'},
      rules:rule.items?rule.items.map(function(x){return {action:x.action,facts:x.facts,adset:x.adset};}):[],
      data_gaps:rule.gaps||[]
    };
  }
  // 같은 길이의 직전 기간(한국 날짜 기준)
  function previousRange(since,until){
    var d=function(s){return Date.parse(s+'T00:00:00Z');},day=86400000,len=Math.round((d(until)-d(since))/day)+1;
    var end=new Date(d(since)-day),start=new Date(end.getTime()-(len-1)*day);
    return {since:start.toISOString().slice(0,10),until:end.toISOString().slice(0,10),days:len};
  }
  return {build:build,adsetSuggestions:adsetSuggestions,buildPayload:buildPayload,salesBlock:salesBlock,topAdsets:topAdsets,previousRange:previousRange};
});


(function(){
  if(typeof document==='undefined'||!window.LaunchRoasApp)return;
  var I=window.LaunchRoasInsights,app=window.LaunchRoasApp,S=window.LaunchRoasSales,sales=null,ads=null,lastSig='',ai={state:'idle'},aiKey='';
  function byId(id){return document.getElementById(id);}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function won(v){return v==null?'—':(v<0?'−':'')+Math.abs(Math.round(v)).toLocaleString('ko-KR')+'원';}
  // 공식 요금(platform.claude.com/docs/en/about-claude/pricing, 2026-10-05 확인): USD / 100만 토큰
  var PRICE={'claude-sonnet-5-5':[2,10],'claude-haiku-4-5':[1,5],'claude-haiku-4-5-20251001':[1,5]},USD_KRW=1400;
  function costKrw(model,u){var p=PRICE[model];if(!p||!u||u.input_tokens==null)return null;return (u.input_tokens*p[0]+u.output_tokens*p[1])/1e6*USD_KRW;}

  function render(){
    var box=byId('insightsBody');if(!box)return;
    var r=I.build(sales,ads),sig=JSON.stringify(r)+'|'+JSON.stringify(ai);
    if(sig===lastSig)return;lastSig=sig; // 같은 내용이면 다시 그리지 않음(다시 등장하는 효과 방지)
    box.replaceChildren();
    box.appendChild(renderAi());
    var rules=el('section','insight-rules');rules.appendChild(el('h3','insight-sub','규칙 기반 점검 · 데이터 확인'));box.appendChild(rules);
    if(r.loading){rules.appendChild(el('p','small','판매 · 광고 데이터를 확인하는 중이에요.'));return;}
    if(r.status.length){var st=el('ul','insight-status');r.status.forEach(function(t){st.appendChild(el('li','',t));});rules.appendChild(st);}
    if(r.adsLoading)rules.appendChild(el('p','small','광고 세트 지표를 불러오는 중이에요.'));
    if(r.items.length){
      var list=el('ol','insight-list');
      r.items.forEach(function(x,i){
        var li=el('li','insight-item');li.style.setProperty('--i',i);
        li.append(el('strong','insight-action',x.action),el('span','insight-adset',x.adset));
        var dl=el('dl','insight-facts');
        [['근거 지표',x.facts],[x.cause.indexOf('확인')===0?'판단':'추정 원인',x.cause.replace(/^(추정|확인): /,'')],['테스트 방법',x.test]].forEach(function(p){dl.append(el('dt','',p[0]),el('dd','',p[1]));});
        li.appendChild(dl);list.appendChild(li);
      });
      rules.appendChild(list);
    }else if(!r.adsLoading)rules.appendChild(el('p','small','규칙상 뚜렷한 신호가 없어요.'));
    if(r.gaps.length){var g=el('details','insight-gaps');g.appendChild(el('summary','','부족한 데이터 '+r.gaps.length+'개'));var ul=el('ul');r.gaps.forEach(function(t){ul.appendChild(el('li','',t));});g.appendChild(ul);rules.appendChild(g);}
  }

  // ---- AI 분석 카드: 실제 호출 결과만 'AI 분석 완료'로 표시. 실패 · 미연결이면 그렇게 표시하고 규칙 점검만 보여준다. ----
  function renderAi(){
    var card=el('section','ai-card'),head=el('div','ai-head');
    var badge={idle:'대기',loading:'분석 중',ok:'AI 분석 완료',not_configured:'AI 미연결',failed:'AI 분석 실패'}[ai.state];
    head.append(el('h3','insight-sub','AI 분석'),el('span','ai-badge '+ai.state,badge));card.appendChild(head);
    var ready=!!(sales&&!sales.loading&&sales.summary&&ads&&!ads.loading&&!ads.error);
    if(ai.state==='ok')card.appendChild(renderResult(ai));
    else if(ai.state==='not_configured')card.appendChild(el('p','small','AI API 키가 아직 설정되지 않아 AI를 호출하지 않았어요. 아래 규칙 기반 점검만 보여줘요.'));
    else if(ai.state==='failed')card.appendChild(el('p','small ai-error',(ai.message||'AI 호출에 실패했어요.')+' AI 결과는 없고, 아래 규칙 기반 점검만 보여줘요.'));
    if(ai.compare)card.appendChild(renderCompare(ai.compare));
    var btn=el('button','secondary ai-run',ai.state==='loading'?'분석 중…':ai.state==='ok'?'다시 분석':'AI 분석 요청');btn.type='button';
    btn.disabled=!ready||ai.state==='loading';btn.addEventListener('click',run);
    var row=el('div','ai-actions');row.append(btn,el('small','ai-note','누를 때만 호출 · 1회 약 20원(Claude Sonnet 5.5 기준) · 실제 지표와 계산 기준만 보냄'));card.appendChild(row);
    if(!ready&&ai.state!=='loading')card.appendChild(el('small','ai-note',sales&&sales.summary?'광고 세트 지표를 불러오면 분석할 수 있어요.':'판매 데이터를 불러오면 분석할 수 있어요.'));
    return card;
  }
  function renderResult(a){
    var r=a.result,box=el('div','ai-result'),dl=el('dl','insight-facts ai-facts');
    function add(k,v){if(v)dl.append(el('dt','',k),el('dd','',v));}
    box.appendChild(el('strong','insight-action ai-action','우선 테스트: '+r.action));
    add('현재 상태',r.status);
    add('점검 가설',r.hypothesis);
    add('테스트 방법',[r.test.method,r.test.duration].filter(Boolean).join(' · '));
    add('이후 비교할 지표',r.test.compare_metrics.join(', '));
    add('직전 기간 비교',r.comparison);
    box.appendChild(dl);
    var ev=el('ul','ai-evidence');
    r.evidence.forEach(function(e){var li=el('li');li.append(el('code','',e.metric+' = '+e.actual),el('span','',' '+(e.meaning||'')));ev.appendChild(li);});
    var evWrap=el('div','ai-ev-wrap');evWrap.append(el('span','ai-ev-title','판단 근거(보낸 데이터의 실제 값)'),ev);box.appendChild(evWrap);
    if(r.cautions.length){var c=el('ul','ai-cautions');r.cautions.forEach(function(t){c.appendChild(el('li','',t));});box.appendChild(c);}
    var cost=costKrw(a.model,a.usage);
    box.appendChild(el('small','ai-note','모델 '+a.model+' · 입력 '+(a.usage.input_tokens||0).toLocaleString()+' / 출력 '+(a.usage.output_tokens||0).toLocaleString()+' 토큰'+(cost!=null?' · 약 '+Math.round(cost)+'원':'')+(r.dropped.length?' · 근거로 확인되지 않은 지표 '+r.dropped.length+'개 제외':'')));
    return box;
  }
  function renderCompare(c){
    var wrap=el('div','ai-compare');wrap.appendChild(el('span','ai-ev-title','직전 같은 길이 기간 '+c.range.since+' ~ '+c.range.until+' (계산값)'));
    var ul=el('ul');c.lines.forEach(function(t){ul.appendChild(el('li','',t));});wrap.appendChild(ul);return wrap;
  }

  // 직전 동일 길이 기간: Cafe24는 같은 날짜 범위로 다시 조회 · Meta 광고 세트는 하루 단위 기간일 때만(현재 함수가 날짜 하나만 받음)
  async function previous(ctx){
    var range=sales.range;if(!range)return {data:null,lines:['기간 정보 없음 — 비교하지 않음'],range:{since:'—',until:'—'}};
    var pr=I.previousRange(range.since,range.until),out={range:pr,sales:null,adsets:null,notes:[]},lines=[];
    try{
      var res=await ctx.client.functions.invoke('cafe24-order-items',{body:{store_id:ctx.storeId,start_date:pr.since,end_date:pr.until}});
      if(res.data&&res.data.ok&&!res.data.truncated){
        var s=S.summarize(res.data.orders||[],sales.links||[]);out.sales=I.salesBlock(s,null,s.partial);
        out.notes.push('직전 기간 남은 금액은 그 기간 원화 광고비를 함께 확인하지 못해 계산하지 않음');
        lines.push('판매 '+s.soldQty+'개 → 지금 '+sales.summary.soldQty+'개');
        lines.push('상품 마진(같은 비용 설정) '+won(s.marginTotal)+' → 지금 '+won(sales.summary.marginTotal));
      }else{out.notes.push('직전 기간 Cafe24 주문을 불러오지 못함');lines.push('Cafe24 직전 기간: 불러오지 못함(비교하지 않음)');}
    }catch(e){out.notes.push('직전 기간 Cafe24 조회 오류');lines.push('Cafe24 직전 기간: 조회 오류');}
    if(pr.days===1){
      try{
        var m=await ctx.client.functions.invoke('meta-adset-insights',{body:{store_id:ctx.storeId,scope:'adsets',period:'date',date:pr.since}});
        if(m.data&&m.data.ok&&!m.data.truncated){
          var rows=[];(m.data.campaigns||[]).forEach(function(c){(c.adsets||[]).forEach(function(a){rows.push({name:a.adset_name||'이름 없는 광고 세트',metrics:a.metrics||{},linked:false,verdict:null});});});
          out.adsets=I.topAdsets(rows);
          var sp=rows.reduce(function(t,r){return t+(Number(r.metrics.spend)||0);},0);
          lines.push('Meta 광고 세트 광고비 합계 '+sp.toLocaleString('en-US',{maximumFractionDigits:2})+' '+(m.data.account&&m.data.account.currency||''));
        }else{out.notes.push('직전 기간 Meta 광고 세트를 불러오지 못함');lines.push('Meta 직전 기간: 불러오지 못함(비교하지 않음)');}
      }catch(e){out.notes.push('직전 기간 Meta 조회 오류');lines.push('Meta 직전 기간: 조회 오류');}
    }else{out.notes.push('Meta 광고 세트는 하루 단위 기간만 직전 기간을 조회할 수 있음 — 이번 기간은 Meta 비교 없음');lines.push('Meta 직전 기간: 여러 날 기간은 아직 조회 미지원(비교하지 않음)');}
    return {data:out,lines:lines,range:pr};
  }

  async function run(){
    var ctx=app.getContext(),key=ctx.storeId+'|'+(sales.range?sales.range.since+'~'+sales.range.until:'');
    aiKey=key;ai={state:'loading'};render();
    var prev=await previous(ctx);
    if(aiKey!==key)return;
    var payload=I.buildPayload(sales,ads,prev.data);
    try{
      var res=await ctx.client.functions.invoke('ai-insights',{body:{payload:payload}});
      if(aiKey!==key)return;
      var d=res.data;
      if(d&&d.ok&&d.result)ai={state:'ok',result:d.result,model:d.model,usage:d.usage||{},compare:prev};
      else if(d&&d.code==='AI_NOT_CONFIGURED')ai={state:'not_configured',compare:prev};
      else ai={state:'failed',message:(d&&d.message)||'AI 호출에 실패했어요.',compare:prev};
    }catch(e){ai={state:'failed',message:'AI 호출에 실패했어요.',compare:prev};}
    render();
  }

  window.addEventListener('launchroas:sales-state',function(e){
    var k=e.detail&&e.detail.range?app.getContext().storeId+'|'+e.detail.range.since+'~'+e.detail.range.until:'';
    if(aiKey&&k!==aiKey){aiKey='';ai={state:'idle'};} // 기간 · 쇼핑몰이 바뀌면 이전 AI 결과를 지운다
    sales=e.detail;render();
  });
  window.addEventListener('launchroas:adsets-state',function(e){ads=e.detail;render();});
})();
