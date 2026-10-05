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
  var I=window.LaunchRoasInsights,app=window.LaunchRoasApp,S=window.LaunchRoasSales,sales=null,ads=null,lastSig='';
  var wk={state:'idle',data:null,message:'',storeId:null,busy:false};
  function byId(id){return document.getElementById(id);}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function won(v){return v==null?'—':(v<0?'−':'')+Math.abs(Math.round(v)).toLocaleString('ko-KR')+'원';}
  function n(v,u){return v==null?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2})+(u||'');}
  function money(v,cur){return v==null?'—':cur==='KRW'?won(v):Number(v).toLocaleString('en-US',{maximumFractionDigits:2})+' '+(cur||'');}
  function delta(a,b){if(a==null||b==null)return '';if(!b)return ' (전주 '+n(b)+')';var p=Math.round((a-b)/Math.abs(b)*1000)/10;return ' (전주 대비 '+(p>0?'+':'')+p+'%)';}

  function render(){
    var box=byId('insightsBody');if(!box)return;
    var r=I.build(sales,ads),sig=JSON.stringify(r)+'|'+JSON.stringify(wk);
    if(sig===lastSig)return;lastSig=sig; // 같은 내용이면 다시 그리지 않음(다시 등장하는 효과 방지)
    box.replaceChildren(renderWeekly());
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

  // ---- 주간 AI 점검 ----
  var STATUS_TEXT={completed:'점검 완료',partial:'부분 완료',failed:'분석 실패',no_data:'데이터 부족',running:'진행 중'};
  function renderWeekly(){
    var card=el('section','ai-card weekly'),head=el('div','ai-head'),d=wk.data,q=d&&d.quota;
    var badge=wk.busy?'분석 중':wk.state==='unavailable'?'준비 중':wk.state==='off'?'AI 미연결':d&&d.status?STATUS_TEXT[d.status]||d.status:'대기';
    head.append(el('h3','insight-sub','주간 AI 광고 점검'),el('span','ai-badge '+(d&&d.status||wk.state),badge));card.appendChild(head);
    var resetTxt=q?'다음 갱신 '+new Date(q.resets_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}):'';
    card.appendChild(el('small','ai-note','지난주(월~일)를 그 전주와 비교해요 · 계정당 주 1회 무료 · 한국 시간 월요일 00시 갱신(이월 없음)'+(resetTxt?' · '+resetTxt:'')));
    if(wk.message)card.appendChild(el('p','small '+(wk.state==='error'?'ai-error':''),wk.message));
    if(d&&d.result)card.appendChild(renderResult(d.result,d.status));
    else if(d&&d.error)card.appendChild(el('p','small ai-error',d.error));
    var canRun=!wk.busy&&wk.state!=='unavailable'&&(!q||q.can_run);
    var label=d&&d.status==='partial'?'남은 광고 이어서 점검':'주간 AI 점검';
    var btn=el('button','secondary ai-run',wk.busy?'점검 중…':label);btn.type='button';btn.disabled=!canRun||!(sales&&sales.links);
    btn.addEventListener('click',run);
    var row=el('div','ai-actions');row.appendChild(btn);
    if(q&&q.used&&!q.can_run)row.appendChild(el('small','ai-note','이번 주 점검을 사용했어요.'));
    card.appendChild(row);
    return card;
  }
  function renderResult(r,status){
    var wrap=el('div','ai-result');
    var cov=r.coverage||{},p=r.snapshot&&r.snapshot.period||(r.summary&&r.summary.period);
    // 분석 범위
    var scope=el('p','weekly-scope','광고 '+n(cov.total,'개')+' 중 '+n(cov.analyzed,'개')+' 분석'+((cov.skipped&&cov.skipped.length)||(cov.failed_ads&&cov.failed_ads.length)?' · 누락 '+((cov.skipped||[]).length+(cov.failed_ads||[]).length)+'개':'')+(status==='partial'?' · 일부만 분석된 결과예요':''));
    wrap.appendChild(scope);
    // 전체 요약
    var s=r.summary||{},c=s.cafe24||{},m=s.meta||{},ep=s.expected_profit||{};
    var sum=el('dl','insight-facts weekly-summary');
    function add(k,v){sum.append(el('dt','',k),el('dd','',v));}
    add('Cafe24 상품 판매금액',won(c.current&&c.current.gross_sales_krw)+delta(c.current&&c.current.gross_sales_krw,c.previous&&c.previous.gross_sales_krw));
    add('Meta 광고비',money(m.current&&m.current.spend,m.currency)+delta(m.current&&m.current.spend,m.previous&&m.previous.spend));
    add('예상 이익'+(ep.partial?' (일부 상품 기준)':''),won(ep.current)+delta(ep.current,ep.previous));
    add('Meta 귀속 구매값',money(m.current&&m.current.purchase_value,m.currency)+' · Cafe24 매출과 다른 값');
    wrap.appendChild(sum);
    // 이번 주 우선순위
    if(r.priorities&&r.priorities.length){
      var pr=el('ol','weekly-priorities');wrap.appendChild(el('span','ai-ev-title','이번 주 우선순위'));
      r.priorities.forEach(function(x){var li=el('li');li.append(el('strong','',x.ad_name),el('span','',' — '+x.action));pr.appendChild(li);});
      wrap.appendChild(pr);
    }
    // 광고별 목록
    var list=el('ul','weekly-ads');
    (r.ads||[]).forEach(function(a){
      var an=a.analysis,li=el('li','weekly-ad');
      var top=el('div','weekly-ad-head');top.append(el('strong','',a.ad_name||a.ad_id),el('span','weekly-scope-tag',a.scope?a.scope.label:'지표 확인'));
      if(a.new_ad)top.appendChild(el('span','weekly-new','신규'));
      li.appendChild(top);
      var cm=a.current||{};
      li.appendChild(el('small','weekly-metrics','광고비 '+money(cm.spend,m.currency)+' · CTR '+n(cm.link_ctr_pct,'%')+' · 구매 '+(cm.purchases==null?'미측정':n(cm.purchases,'건'))+' · ROAS '+(cm.roas==null?'—':Math.round(cm.roas*100)+'%')));
      if(an){
        li.appendChild(el('p','weekly-verdict',an.verdict+' · '+an.headline));
        if(an.next_action)li.appendChild(el('p','weekly-next','다음 행동: '+an.next_action));
        li.appendChild(detail(a,an));
      }else li.appendChild(el('p','small','AI 분석 결과 없음(누락)'));
      list.appendChild(li);
    });
    wrap.appendChild(list);
    var skipped=(cov.skipped||[]).map(function(x){return (x.ad_name||x.ad_id)+' — '+x.reason;}).concat((cov.failed_ads||[]).map(function(id){return id+' — AI 응답 없음(재시도 대상)';}));
    var notes=(r.notes||[]).concat(skipped);
    if(notes.length){var g=el('details','insight-gaps');g.appendChild(el('summary','','기간 · 집계 기준과 누락 '+notes.length+'개'));var ul=el('ul');notes.forEach(function(t){ul.appendChild(el('li','',t));});g.appendChild(ul);wrap.appendChild(g);}
    return wrap;
  }
  function detail(a,an){
    var d=el('details','weekly-detail');d.appendChild(el('summary','','상세 분석 보기'));
    var dl=el('dl','insight-facts');
    function add(k,v){if(v){dl.append(el('dt','',k),el('dd','',v));}}
    add('전주 대비',an.changes);
    add('의심 구간',an.funnel&&(an.funnel.stage+(an.funnel.evidence?' — '+an.funnel.evidence:'')));
    add('비교 광고',an.peers);
    add('실제 근거',(an.evidence||[]).map(function(e){return e.metric+' = '+e.value+(e.note?' ('+e.note+')':'');}).join(' / '));
    (an.hypotheses||[]).forEach(function(h,i){add('가설 '+(i+1),h.text+(h.basis?' · 근거: '+h.basis:'')+(h.check?' · 확인: '+h.check:''));});
    var rec=an.recommendation;
    if(rec){
      add('현재안',rec.current);add('변경안 (검증할 가설)',rec.proposed);
      add(rec.example_is_provisional?'수정 예시 (추가 정보 확인 전 예시)':'수정 예시',rec.example);
      if(rec.needs_info&&rec.needs_info.length)add('필요한 정보',rec.needs_info.join(', '));
      add('테스트 방법',[rec.test.method,rec.test.compare_metrics.length?'비교 지표: '+rec.test.compare_metrics.join(', '):'',rec.test.decision_rule?'판단 조건: '+rec.test.decision_rule:'',rec.test.sample_note].filter(Boolean).join(' · '));
    }
    add('예산 판단',an.budget_note);
    add('판단 한계',(an.limits||[]).join(' / '));
    add('소재',(a.creative&&a.creative.notes||[]).join(' / '));
    d.appendChild(dl);return d;
  }

  // 지난주 · 그 전주 Cafe24 집계(개인정보 없이 합계만)를 계산해 함께 보낸다
  async function weekSales(ctx,range){
    var res=await ctx.client.functions.invoke('cafe24-order-items',{body:{store_id:ctx.storeId,start_date:range.since,end_date:range.until}});
    if(!res.data||!res.data.ok||res.data.truncated)return null;
    var s=S.summarize(res.data.orders||[],sales.links||[]);
    return {gross_sales_krw:Math.round(s.grossSales),sold_qty:s.soldQty,linked_qty:s.linkedQty,margin_total_krw:s.marginTotal,partial:s.partial,estimated_orders:s.margin.estimatedOrders};
  }
  function lastWeeks(){
    var now=new Date(Date.now()+9*3600e3),dow=(now.getUTCDay()+6)%7,mon=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-dow*864e5,f=function(ms){return new Date(ms).toISOString().slice(0,10);};
    return {current:{since:f(mon-7*864e5),until:f(mon-864e5)},previous:{since:f(mon-14*864e5),until:f(mon-8*864e5)}};
  }
  async function call(ctx,body){
    var res=await ctx.client.functions.invoke('ai-weekly-review',{body:body});
    if(res.error&&!res.data){
      // 함수가 아직 배포되지 않았거나 응답 실패 — 성공으로 보이지 않게
      var ctxErr=res.error&&res.error.context;var st=ctxErr&&ctxErr.status;
      return {unavailable:st===404,error:true,body:ctxErr&&ctxErr.json?await ctxErr.json().catch(function(){return null;}):null};
    }
    return {data:res.data};
  }
  async function loadStatus(){
    var ctx=app.getContext();if(!ctx.storeId||wk.storeId===ctx.storeId)return;
    wk={state:'idle',data:null,message:'',storeId:ctx.storeId,busy:false};render();
    var r=await call(ctx,{store_id:ctx.storeId,action:'status'});
    if(app.getContext().storeId!==ctx.storeId)return;
    if(r.unavailable||r.error)wk.state='unavailable',wk.message='주간 AI 점검은 아직 준비 중이에요(서버 미적용).';
    else{wk.data=r.data;wk.state=r.data.enabled?'ready':'off';if(!r.data.enabled)wk.message='AI 연결 전이라 아직 실행할 수 없어요.';}
    render();
  }
  async function run(){
    if(wk.busy)return; // 연속 클릭 방지(서버도 동시 요청을 막는다)
    var ctx=app.getContext();wk.busy=true;wk.message='지난주 · 그 전주 판매를 집계하는 중이에요.';render();
    try{
      var w=lastWeeks(),cur=await weekSales(ctx,w.current),prev=await weekSales(ctx,w.previous);
      wk.message='광고와 소재를 확인하고 분석하는 중이에요. 광고가 많으면 1~2분 걸릴 수 있어요.';render();
      var r=await call(ctx,{store_id:ctx.storeId,action:'run',sales:{current:cur,previous:prev},fx_krw_per_unit:ctx.fx&&ctx.fx.krw_per_unit||null});
      var d=r.data||r.body||{};
      if(r.unavailable){wk.state='unavailable';wk.message='주간 AI 점검은 아직 준비 중이에요(서버 미적용).';}
      else{
        if(d.quota)wk.data=d;
        if(d.ok){wk.state='ready';wk.message='';if(window.LaunchRoasMotion)window.LaunchRoasMotion.toast(d.status==='partial'?'일부 광고만 분석했어요':'주간 점검 완료');}
        else{wk.state=d.code==='AI_NOT_CONFIGURED'?'off':'error';wk.message=d.message||(d.error)||'점검에 실패했어요. 이용 횟수는 차감되지 않았어요.';}
      }
    }catch(e){wk.state='error';wk.message='점검 요청에 실패했어요. 이용 횟수는 차감되지 않았어요.';}
    wk.busy=false;render();
  }

  window.addEventListener('launchroas:sales-state',function(e){sales=e.detail;render();loadStatus();});
  window.addEventListener('launchroas:adsets-state',function(e){ads=e.detail;render();});
})();
