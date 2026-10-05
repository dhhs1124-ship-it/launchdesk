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
      facts:'Meta ROAS '+pct((num(m.roas)||0)*100)+' < 연결 상품 손익분기 '+pct(row.verdict.breakeven*100)+' (구매 '+cnt(purchases)+'건)',
      cause:'확인: 연결한 상품 마진 기준으로 이 광고 세트는 손익분기에 못 미침(Meta 귀속 기준)',
      test:'소재 1개를 바꾼 새 광고를 같은 예산으로 1주 운영해 ROAS 비교'});
    return out;
  }

  function missing(row){
    var m=row.metrics||{},list=[],purchases=obs(m.purchase);
    if((num(m.impressions)||0)<MIN_IMPRESSIONS)list.push('노출 '+cnt(num(m.impressions))+'회(기준 '+cnt(MIN_IMPRESSIONS)+'회 미만)');
    if(purchases==null)list.push('구매 이벤트 미측정');else if(purchases<MIN_PURCHASES)list.push('구매 '+cnt(purchases)+'건(판단에 '+MIN_PURCHASES+'건 이상 필요)');
    if(m.funnel_status&&!m.funnel_status.usable)list.push(m.funnel_status.code==='LPV_EXCEEDS_LINK_CLICKS'?'랜딩 조회가 클릭보다 많아 퍼널 비율 사용 불가(픽셀 설정 확인)':'랜딩 페이지 조회 미측정');
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
    if(sales.meta&&sales.meta.roas!=null)status.push('Meta ROAS '+pct(Number(sales.meta.roas)*100)+' · 광고비 '+(sales.spendKrw!=null?won(sales.spendKrw):'환율 입력 필요')+' (Meta 귀속 기준)');
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
  return {build:build,adsetSuggestions:adsetSuggestions};
});

(function(){
  if(typeof document==='undefined'||!window.LaunchRoasApp)return;
  var I=window.LaunchRoasInsights,sales=null,ads=null,lastSig='';
  function byId(id){return document.getElementById(id);}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function render(){
    var box=byId('insightsBody');if(!box)return;
    var r=I.build(sales,ads),sig=JSON.stringify(r);
    if(sig===lastSig)return;lastSig=sig; // 같은 내용이면 다시 그리지 않음(다시 등장하는 효과 방지)
    box.replaceChildren();
    if(r.loading){box.appendChild(el('p','small','판매 · 광고 데이터를 확인하는 중이에요.'));return;}
    if(r.status.length){var st=el('ul','insight-status');r.status.forEach(function(t){st.appendChild(el('li','',t));});box.appendChild(st);}
    if(r.adsLoading)box.appendChild(el('p','small','광고 세트 지표를 불러오는 중이에요.'));
    if(r.items.length){
      var list=el('ol','insight-list');
      r.items.forEach(function(x,i){
        var li=el('li','insight-item');li.style.setProperty('--i',i);
        li.append(el('strong','insight-action',x.action),el('span','insight-adset',x.adset));
        var dl=el('dl','insight-facts');
        [['근거 지표',x.facts],[x.cause.indexOf('확인')===0?'판단':'추정 원인',x.cause.replace(/^(추정|확인): /,'')],['테스트 방법',x.test]].forEach(function(p){dl.append(el('dt','',p[0]),el('dd','',p[1]));});
        li.appendChild(dl);list.appendChild(li);
      });
      box.appendChild(list);
    }else if(!r.adsLoading)box.appendChild(el('p','small','지금 지표로는 뚜렷한 개선 신호가 없어요.'));
    if(r.gaps.length){var g=el('details','insight-gaps');g.appendChild(el('summary','','부족한 데이터 '+r.gaps.length+'개'));var ul=el('ul');r.gaps.forEach(function(t){ul.appendChild(el('li','',t));});g.appendChild(ul);box.appendChild(g);}
  }
  window.addEventListener('launchroas:sales-state',function(e){sales=e.detail;render();});
  window.addEventListener('launchroas:adsets-state',function(e){ads=e.detail;render();});
})();
