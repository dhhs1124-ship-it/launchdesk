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
    try{return new Intl.NumberFormat('en-US',{style:'currency',currency:cur,minimumFractionDigits:0,maximumFractionDigits:Math.abs(n)>=100?0:2}).format(n);}catch(e){return Math.round(n)+' '+cur;}
  }
  function koText(text){
    if(text==null)return '';
    return String(text)
      .replace(/\((?:title|body|cta|description|link_domain)\)/g,'').replace(/\(null\)/g,'').replace(/null입니다/g,'없습니다').replace(/null이고/g,'비어 있고')
      .replace(/구매당 지출/g,'구매당 광고비').replace(/\bCTR\b/g,'클릭률').replace(/\bCPC\b/g,'클릭당 비용').replace(/\bCPM\b/g,'1,000회 노출당 비용').replace(/spend\s*[÷\/]\s*purchases,?\s*/g,'')
      .replace(/funnel_ratio_usable\s*=\s*false/g,'전환 단계 비율 계산 불가').replace(/funnel_ratio_usable\s*=\s*true/g,'전환 단계 비율 계산 가능')
      .replace(/\b(?:metrics_current|metrics_previous|change|creative|peers)\.[a-z_]+(?:\.[a-z_]+)*/g,metricName)
      .replace(/\b([A-Z][A-Z_]{3,})\b/g,function(m){return CODES[m]||m;})
      .replace(/\b([a-z]+(?:_[a-z]+)+|attribution|roas|peers|title|body|cta|spend|purchases)\b/g,function(m){return m==='roas'?'ROAS':m==='peers'?'비교 광고':LABELS[m]||m;})
      .replace(/\bnull\b/g,'없음').replace(/\(\s*\)/g,'')
      .replace(/(클릭 후|조회 후|영상 참여 후) (\d+)일/g,'$1 $2일');
  }
  // 근거 값 → 화면 표시
  function formatValue(path,v,cur){
    var key=String(path||'').split('.').pop();
    if(v===null||v===undefined||v==='')return /^creative\./.test(path)?(LABELS[key]||'소재 정보')+' 없음':'없음';
    if(typeof v==='boolean')return v?'예':'아니오';
    if(typeof v==='string')return koText(v);
    if(/^change\./.test(path)&&key==='pct')return (v>0?'+':'')+v+'%';
    if(key==='roas'||key==='median_roas')return Math.round(v*100).toLocaleString('ko-KR')+'%';
    if(/_pct$/.test(key))return v+'%';
    if(MONEY[key]||MONEY[String(path).split('.')[1]])return money(v,cur);
    if(key==='frequency')return v+'회';
    return Number(v).toLocaleString('ko-KR');
  }
  var VERDICT={'개선 필요':{label:'우선 확인',tone:'check',rank:0},'추가 확인':{label:'확인 필요',tone:'hold',rank:1},'판단 보류':{label:'판단 보류',tone:'hold',rank:1},'유지':{label:'유지',tone:'keep',rank:2}};
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
  // 목록 핵심 숫자: 구매 변화 / 광고비 변화 / 현재 ROAS
  function keyLine(a,cur){
    var c=a&&a.current||{},p=a&&a.previous,parts=[];
    var roas='ROAS '+(c.roas==null?'미측정':Math.round(c.roas*100).toLocaleString('ko-KR')+'%');
    var buy=function(x){return x==null?'미측정':x+'건';};
    if(!p)return ['신규 광고','광고비 '+shortMoney(c.spend,cur),'구매 '+buy(c.purchases),roas].join(' / ');
    parts.push(c.purchases!=null&&p.purchases!=null?'구매 '+p.purchases+'→'+c.purchases+'건':'구매 '+buy(c.purchases));
    parts.push(c.spend!=null&&p.spend>0?'광고비 '+(c.spend>=p.spend?'+':'')+Math.round((c.spend-p.spend)/p.spend*100)+'%':'광고비 '+shortMoney(c.spend,cur));
    parts.push(roas);
    return parts.join(' / ');
  }
  // 권장 행동 한 줄 — 유지 · 판단 보류는 판정 그대로(수정안을 억지로 권하지 않음), 우선 확인은 AI 다음 행동의 첫 문장
  //   진행 중인 실행 기록 때문에 서버가 변경안을 뺀 광고는 판정과 관계없이 '결과 확인'을 그대로
  function actionLine(an){
    if(!an)return 'AI 분석 결과 없음';
    if((an.hold_scope||[]).indexOf('진행 중인 실행 기록')>=0)return koText(an.next_action);
    if(an.verdict==='유지')return '현재 광고 유지';
    if(an.verdict==='판단 보류')return '데이터를 더 쌓은 뒤 판단';
    return koText(String(an.next_action||'').split(/(?<=[.!?])\s+/)[0]);
  }
  // 근거 설명 줄이기 — 위에 보인 값만 다시 말하는 문장 · "단정하지 않음" 같은 반복 문장은 빼고 최대 2문장
  function trimNote(note,shown){
    var flat=function(x){return String(x).replace(/\s/g,'');},key=flat(shown).slice(-6,-1),out=[];
    String(note||'').replace(/^[^:]{2,40}:\s*/,function(m){return flat(m).indexOf(flat(shown).slice(0,6))===0?'':m;})
      .split(/(?<=[.!?])\s+/).forEach(function(s){
        var nums=s.match(/\d+(?:\.\d+)?/g)||[];
        if(!s.trim()||/단정하지(는)? 않/.test(s))return;
        if(nums.length&&nums.every(function(n){return String(shown).indexOf(n)>=0;}))return;
        if(!nums.length&&key.length>=4&&flat(s).indexOf(key)>=0)return;
        out.push(s.trim());
      });
    return out.slice(0,2).join(' ');
  }
  // AI 실행 전 확인 신호(규칙 기반 · AI 분석 아님) — 광고 세트 실제 측정값과 조건만, 최대 2개
  function pctTxt(v){return (Math.round(v*10)/10).toLocaleString('ko-KR')+'%';}
  function ruleSignals(m,linked,verdict){
    m=m||{};var out=[],n=function(v){var x=Number(v);return Number.isFinite(x)?x:null;},obsv=function(x){return x&&x.observed?n(x.value):null;};
    var imp=n(m.impressions)||0,clicks=n(m.link_clicks)||0,ctr=n(m.link_ctr),freq=n(m.frequency),lpv=obsv(m.landing_page_view),buy=obsv(m.purchase),usable=m.funnel_status&&m.funnel_status.usable;
    if(linked&&verdict&&verdict.tone==='below'&&verdict.breakeven)out.push('ROAS '+Math.round((n(m.roas)||0)*100)+'% · 일부 상품 기준 손익분기 참고값 '+Math.round(verdict.breakeven*100)+'%보다 낮음');
    if(imp>=2000&&ctr!=null&&ctr<1)out.push('클릭률 '+pctTxt(ctr)+' · 참고 기준 1% 미만(노출 '+imp.toLocaleString('ko-KR')+'회)');
    if(freq!=null&&freq>=3)out.push('빈도 '+(Math.round(freq*10)/10)+'회 · 참고 기준 3회 이상');
    if(usable&&clicks>=30&&n(m.landing_rate)!=null&&m.landing_rate<70)out.push('랜딩률 '+pctTxt(m.landing_rate)+' · 참고 기준 70% 미만');
    if(usable&&lpv!=null&&lpv>=50&&buy!=null&&n(m.purchase_rate)!=null&&m.purchase_rate<1)out.push('구매율 '+pctTxt(m.purchase_rate)+' · 참고 기준 1% 미만(랜딩 '+lpv+'회)');
    if(m.funnel_status&&m.funnel_status.code==='LPV_EXCEEDS_LINK_CLICKS')out.push('랜딩 조회가 링크 클릭보다 많음 · 집계 기준 확인');
    // Meta는 구매가 없을 때도 '기록 없음'으로 준다 — 픽셀 문제로 단정하지 않고, 클릭이 충분히 쌓였을 때만 신호
    if(buy==null){if(clicks>=100)out.push('링크 클릭 '+clicks.toLocaleString('ko-KR')+'회 · 구매 기록 없음(참고 기준 클릭 100회)');}else if(buy<3)out.push('구매 '+buy+'건 · 판단하기엔 표본 부족');
    return out.slice(0,2);
  }
  // 개선안을 보여 줄지 — 제목이 비었다는 이유만으로 나온 제목 제안은 제목이 보이는 게재 위치로 확인됐을 때만
  function recUsable(a,an){
    var rec=an&&an.recommendation,c=a&&a.creative||{};if(!rec)return false;
    var aboutTitle=/제목/.test([rec.current,rec.proposed,rec.example].join(' '));
    if(aboutTitle&&!c.title&&c.headline!=='all'&&c.headline!=='partial')return false;
    return true;
  }
  // 확인 사항 — 실제 지표의 데이터 상태로만
  function checkLine(a){
    var c=a&&a.current||{},out=[];
    if(c.funnel_note==='LPV_EXCEEDS_LINK_CLICKS')out.push('랜딩 조회 집계 기준 확인');
    else if(c.funnel_note==='LPV_NOT_OBSERVED')out.push('랜딩 페이지 조회 측정 설정 확인');
    if(c.purchases==null)out.push('구매 기록 없음');else if(c.purchases<3)out.push('구매 3건 미만 · 표본 부족');
    return out.join(' · ');
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
  // 주간 AI 점검 칸 표시 — AI가 켜져 있다고 서버가 답했을 때(ready)나 점검 중일 때만. 꺼짐 · 준비 중 · 상태 조회 실패 · 확인 전이면 칸 전체를 숨긴다
  //   (‘AI 미설정’ 안내 · 쓸 수 없는 점검 버튼을 보이지 않게 — AI를 다시 켜면 그대로 나타난다)
  function weeklyVisible(state,busy){return state==='ready'||!!busy;}
  // 사업 정보(점검 기준) — 서버(supabase/functions/_shared/ai-consult-core.mjs)와 같은 선택지 · 범위. 개인정보 없이 선택 · 숫자만 받는다
  var OBJECTIVES=['판매','신규 고객','재구매','브랜드 인지'],CANNOT_CHANGE=['예산 늘리기','할인 · 가격','새 사진 · 영상 촬영'];
  function profileInput(v){
    v=v||{};var errors=[],toNum=function(x){var s=String(x==null?'':x).replace(/[,\s원%]/g,'');return s===''?null:Number(s);};
    var objective=OBJECTIVES.indexOf(v.objective)>=0?v.objective:null,roas=toNum(v.target_roas_pct),cap=toNum(v.monthly_budget_cap_krw);
    if(!objective)errors.push('광고 목표를 골라 주세요.');
    if(roas!==null&&!(Number.isFinite(roas)&&roas>=50&&roas<=5000))errors.push('목표 ROAS는 50~5000% 사이로 입력해 주세요.');
    if(cap!==null&&!(Number.isFinite(cap)&&cap>=10000&&cap<=1e10))errors.push('월 광고 예산 상한은 10,000원 이상으로 입력해 주세요.');
    if(errors.length)return {ok:false,errors:errors};
    var cc=(v.cannot_change||[]).filter(function(x,i,a){return CANNOT_CHANGE.indexOf(x)>=0&&a.indexOf(x)===i;});
    return {ok:true,data:{objective:objective,target_roas_pct:roas===null?null:Math.round(roas),monthly_budget_cap_krw:cap===null?null:Math.round(cap),cannot_change:cc}};
  }
  // 이 쇼핑몰의 최신 기록(목록은 최신순) · 지울 예전 기록 — tool_records는 수정 권한이 없어 새로 저장한 뒤 예전 기록을 지운다
  function latestProfile(rows,storeId){
    var mine=(rows||[]).filter(function(r){return r&&r.data&&String(r.data.store_id)===String(storeId);});
    return mine.length?{id:mine[0].id,data:mine[0].data,stale:mine.slice(1).map(function(r){return r.id;})}:{id:null,data:null,stale:[]};
  }
  return {OBJECTIVES:OBJECTIVES,CANNOT_CHANGE:CANNOT_CHANGE,profileInput:profileInput,latestProfile:latestProfile,weeklyVisible:weeklyVisible,ruleSignals:ruleSignals,recUsable:recUsable,trimNote:trimNote,keyLine:keyLine,actionLine:actionLine,checkLine:checkLine,metricName:metricName,koText:koText,formatValue:formatValue,verdictView:verdictView,changeLine:changeLine,numbersLine:numbersLine,orderAds:orderAds,shortMoney:shortMoney,money:money};
});


(function(){
  if(typeof document==='undefined'||!window.LaunchRoasApp)return;
  var I=window.LaunchRoasInsights,app=window.LaunchRoasApp,S=window.LaunchRoasSales,sales=null,ads=null,lastSig='';
  var wk={state:'idle',data:null,message:'',storeId:null,busy:false,profile:null},ui={panel:{},all:false,profileOpen:false,draft:null};
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
    var sec=byId('insights');if(sec)sec.hidden=!I.weeklyVisible(wk.state,wk.busy);
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
    else if(!wk.busy){
      if(wk.state==='ready'){
        wrap.appendChild(el('p','wk-empty','지난주 광고별 지표 · 문구 · 이미지를 보고 어떤 광고를 왜 확인할지, 무엇을 바꾸면 되는지 알려 드려요.'));
        // 점검은 주 1회라, 목표 없이 쓰기 전에 알려 준다
        if(wk.profile&&wk.profile.status==='ok'&&!wk.profile.data)wrap.appendChild(el('p','wk-message','아래 점검 기준(광고 목표)을 먼저 저장하면 목표 기준 판단이 들어가요 · 점검은 주 1회예요.'));
      }
      wrap.appendChild(renderSignals());
    }
    if(wk.state==='ready')wrap.appendChild(renderProfile());
    wrap.appendChild(el('small','wk-foot','계정당 주 1회 · 한국 시간 월요일 00시 갱신(다음 '+day(w.next)+') · 위의 기간 선택과 관계없이 지난주 고정'));
    return wrap;
  }
  // 지표 도움말 — 누를 때만 보이는 짧은 설명(브라우저 기본 팝오버)
  var HELP={'클릭률':'링크 클릭 ÷ 노출. 광고를 본 사람 중 링크를 누른 비율이에요.','ROAS':'Meta가 광고에 귀속한 구매금액 ÷ 광고비. Cafe24 실제 매출과 다른 값이에요.',
    '랜딩 페이지 조회':'광고를 누른 뒤 페이지가 열린 횟수(Meta 픽셀 집계). 집계 방식이 달라 링크 클릭보다 많게 나올 수 있어요.',
    '귀속 기준':'Meta가 구매를 광고 성과로 인정하는 기간이에요(예: 클릭 후 7일, 조회 후 1일).','빈도':'한 사람에게 평균 몇 번 보였는지예요.',
    '클릭당 비용':'광고비 ÷ 링크 클릭.','구매당 광고비':'광고비 ÷ 구매 수.','결제 시작률':'장바구니 중 결제를 시작한 비율이에요.'},helpSeq=0;
  function withHelp(label){
    var wrap=el('span','term',label),term=Object.keys(HELP).find(function(k){return label.indexOf(k)>=0;});
    if(!term||!('popover' in HTMLElement.prototype))return wrap;
    var id='termHelp'+(++helpSeq),b=el('button','help');b.type='button';b.setAttribute('popovertarget',id);b.setAttribute('aria-label',term+' 설명');
    b.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r=".6" class="dot"/></svg>';
    var pop=el('div','help-pop');pop.id=id;pop.setAttribute('popover','');pop.append(el('strong','',term),el('p','',HELP[term]));
    wrap.append(b,pop);return wrap;
  }
  function renderResult(r,status){
    var frag=el('div','wk-result'),s=r.summary||{},c=s.cafe24&&s.cafe24.current,m=s.meta||{},ep=s.expected_profit||{},cur=m.currency;
    // 사장님용 요약(현재 상태 → 할 일 → 이유)이 있으면 맨 위에. 연결 전 결과는 예전처럼 지난주 숫자 한 줄
    if(r.brief)frag.appendChild(renderBrief(r.brief));
    else{
      var last=el('p','wk-last');
      last.append(el('span','wk-last-label','지난주'),el('span','','주문 '+(c?won(c.gross_sales_krw):'—')),el('span','','광고비 '+I.money(m.current&&m.current.spend,cur)),
        el('span','','광고비 차감 후 예상 이익 '+won(ep.current)+(ep.partial?' (일부 상품 기준)':'')));
      frag.appendChild(last);
    }
    var list=I.orderAds(r.ads),shown=ui.all?list:list.slice(0,3);
    var need=list.filter(function(a){return a.analysis&&a.analysis.verdict==='개선 필요';}).length;
    var h=el('div','wk-list-head');
    h.append(el('h3','',list.length?'점검 결과 '+list.length+'개':'분석한 광고가 없어요'));
    if(list.length)h.appendChild(el('span','wk-need'+(need?' is-warn':''),need?'우선 확인 '+need+'개':'우선 확인할 광고 없음'));
    if(status==='partial')h.appendChild(el('span','wk-partial','일부만 분석됨'));
    // 분석 기준 버전 — 사례 연결 전 결과는 '이전 기준'으로 표시(새 기준으로 다시 분석한 것처럼 보이지 않게)
    h.appendChild(el('span','wk-partial',r.policy_version?'분석 기준 '+r.policy_version:'이전 기준 결과'));
    frag.appendChild(h);
    var ol=el('ul','wk-ads');shown.forEach(function(a){ol.appendChild(renderAd(a,cur));});frag.appendChild(ol);
    if(list.length>3){var more=el('button','wk-all',ui.all?'접기 ↑':'점검 결과 전체 '+list.length+'개 보기 ↓');more.type='button';more.addEventListener('click',function(){ui.all=!ui.all;render();});frag.appendChild(more);}
    var cov=r.coverage||{},notes=(r.notes||[]).map(I.koText).concat((cov.skipped||[]).map(function(x){return (x.ad_name||'광고')+' — '+I.koText(x.reason);}));
    var basis=el('details','wk-basis');basis.appendChild(el('summary','','분석 범위 · 기준 (광고 '+(cov.total||0)+'개 중 '+(cov.analyzed||0)+'개 분석)'));
    var ul=el('ul');notes.forEach(function(t){ul.appendChild(el('li','',t));});basis.appendChild(ul);frag.appendChild(basis);
    return frag;
  }
  function renderAd(a,cur){
    // 개선 필요 + 쓸 수 있는 개선안이면 개선안을 기본으로 펼친다(사용자가 접으면 접힌 채로)
    var an=a.analysis,v=I.verdictView(an&&an.verdict),usable=I.recUsable(a,an);
    var open=Object.prototype.hasOwnProperty.call(ui.panel,a.ad_id)?ui.panel[a.ad_id]:(an&&an.verdict==='개선 필요'&&usable?'improve':null);
    var li=el('li','wk-ad'+(open?' is-open':''));
    var head=el('div','wk-ad-head');head.append(el('strong','wk-ad-name',a.ad_name||'이름 없는 광고'),el('span','wk-badge '+v.tone,v.label));
    var check=I.checkLine(a);
    li.append(head,el('p','wk-key',I.keyLine(a,cur)));
    var act=el('p','wk-line');act.append(el('span','wk-k','권장 행동'),el('span','',I.actionLine(an)));li.appendChild(act);
    if(check){var ck=el('p','wk-line');ck.append(el('span','wk-k','확인 사항'),el('span','',check));li.appendChild(ck);}
    // 서버가 규칙으로 뺀 변경안(진행 중인 실행 기록 · 예산을 못 늘림) — 왜 개선안이 없는지
    if(an&&an.consult_adjusted&&an.consult_adjusted.length){var adj=el('p','wk-line');adj.append(el('span','wk-k','참고'),el('span','',an.consult_adjusted.join(' · ')));li.appendChild(adj);}
    if(an&&an.recommendation&&!usable){var hold=el('p','wk-line wk-held');hold.append(el('span','wk-k','개선안'),el('span','','보류 · 제목이 보이는 게재 위치인지 확인되지 않아 보여 주지 않아요(다음 점검부터 확인)'));li.appendChild(hold);}
    if(an){
      var tabs=el('div','wk-tabs');
      var tab=function(key,label){var b=el('button','wk-tab',label);b.type='button';b.setAttribute('aria-expanded',open===key?'true':'false');
        b.addEventListener('click',function(){ui.panel[a.ad_id]=open===key?null:key;render();});tabs.appendChild(b);};
      tab('why','판단 근거');if(usable)tab('improve',v.tone==='keep'?'광고 개선안 (선택)':'광고 개선안');
      li.appendChild(tabs);
      if(open==='why')li.appendChild(renderWhy(a,an,cur));
      if(open==='improve'&&usable)li.appendChild(renderImprove(an,v,a));
    }
    return li;
  }
  // 판단 근거 — 근거 지표와 원인 가설만(목록에 이미 나온 행동 · 숫자는 반복하지 않음)
  function renderWhy(a,an,cur){
    var box=el('div','wk-panel'),dl=el('dl','wk-ev');
    (an.evidence||[]).filter(function(e){return !/^peers\./.test(e.metric);}).slice(0,4).forEach(function(e){
      var dd=el('dd'),shown=I.formatValue(e.metric,e.value,cur),note=I.trimNote(I.koText(e.note),shown);dd.appendChild(el('strong','',shown));if(note)dd.appendChild(el('small','',note));
      var dt=el('dt');dt.appendChild(withHelp(I.metricName(e.metric)));dl.append(dt,dd);
    });
    box.appendChild(dl);
    var hyp=(an.hypotheses||[]).slice(0,3);
    if(hyp.length){
      box.appendChild(el('h4','','원인 가설'));var ol=el('ol','wk-hyp');
      hyp.forEach(function(h){var li=el('li');li.appendChild(el('span','',I.koText(h.text)));if(h.check)li.appendChild(el('small','','확인: '+I.koText(h.check)));ol.appendChild(li);});
      box.appendChild(ol);
    }
    if(an.peers)box.appendChild(el('p','wk-sub','비교: '+I.koText(an.peers)));
    if(an.budget_note)box.appendChild(el('p','wk-sub','예산: '+I.koText(an.budget_note)));
    var full=el('details','wk-full');full.appendChild(el('summary','','분석 전문'));
    var fl=el('dl','wk-rec'),add=function(k,t){if(t){fl.append(el('dt','',k),el('dd','',I.koText(t)));}};
    add('판단 요약',an.headline);add('전주 대비',an.changes);add('의심 구간',an.funnel&&an.funnel.stage?an.funnel.stage+(an.funnel.evidence?' — '+an.funnel.evidence:''):'');
    add('판단 한계',(an.limits||[]).join(' / '));
    add('분석 범위',(a.scope&&a.scope.label?a.scope.label:'')+(a.creative&&a.creative.notes&&a.creative.notes.length?' · '+a.creative.notes.join(' / '):''));
    full.appendChild(fl);box.appendChild(full);
    return box;
  }
  // 광고 개선안 — 무엇을 바꿀지 → 수정 예시 → 비교 방법을 먼저, 세부 지표 · 판단 기준은 더 펼쳐서
  function renderImprove(an,v,a){
    var rec=an.recommendation,t=rec.test||{},box=el('div','wk-panel wk-improve'),g=el('dl','wk-rec');
    var add=function(dl,k,txt){if(txt){dl.append(el('dt','',k),el('dd','',I.koText(txt)));}};
    if(v.tone==='keep')box.appendChild(el('p','wk-sub wk-optional','지금 광고는 바꿀 필요가 없다는 판단이에요. 아래는 새 광고로 비교해 볼 수 있는 선택적 개선안이에요.'));
    add(g,'무엇을 바꿀지',String(rec.proposed||'').replace(/^현재 광고는 유지\s*·\s*새 광고로 비교\s*[:：]\s*/,''));
    if(rec.example)g.append(el('dt','',rec.example_is_provisional?'바로 쓸 수정 예시 (정보 확인 전 임시)':'바로 쓸 수정 예시'),el('dd','wk-example',rec.example));
    add(g,'비교 방법',t.method);
    add(g,'제안 근거',rec.basis);
    box.appendChild(g);
    var more=el('details','wk-full');more.appendChild(el('summary','','세부 지표 · 판단 기준'));
    var m=el('dl','wk-rec');
    add(m,'현재',rec.current);
    if(rec.needs_info&&rec.needs_info.length)add(m,'먼저 확인할 정보',rec.needs_info.join(' / '));
    if(t.compare_metrics&&t.compare_metrics.length)add(m,'비교 지표',t.compare_metrics.map(function(x){return /^[a-z_]+$/.test(x)?I.metricName(x):x;}).join(', '));
    add(m,'판단 기준',[t.decision_rule,t.sample_note].filter(Boolean).join(' '));
    more.appendChild(m);box.appendChild(more);
    // 실행 기록 — 광고 기록 화면의 입력 양식을 이 제안으로 채워 연다(광고 자체는 바꾸지 않음)
    if(a&&window.LaunchRoasAdlog&&window.LaunchRoasAdlog.startChange){
      var acts=el('div','wk-actions'),go=el('button','secondary','실행 기록');go.type='button';
      go.addEventListener('click',function(){
        var d=wk.data||{},r=d.result||{},cr=a.creative||{};
        window.LaunchRoasAdlog.startChange({ad:{ad_id:a.ad_id,ad_name:a.ad_name},element:rec.element||'문구',
          before:cr.body?String(cr.body).split(/\n/)[0]:'',after:rec.example||'',
          suggestion:{week:d.quota&&d.quota.week||null,ad_id:a.ad_id,verdict:an.verdict||null,proposed:rec.proposed||null,example:rec.example||null,
            model:r.model||null,effort:r.effort||null,policy_version:r.policy_version||null,case_ids:an.case_ids||[]},
          creative:{format:cr.format||null,title:cr.title||null,body:cr.body||null,headline_display:cr.headline||null,checked_week:d.quota&&d.quota.week||null,image_refs:null}});
      });
      acts.appendChild(go);box.appendChild(acts);
    }
    return box;
  }
  // AI 점검 전 — 광고 세트별 규칙 기반 확인 신호만 짧게(AI 분석과 구분)
  function renderSignals(){
    var box=el('div','wk-pre'),h=el('div','wk-list-head');
    h.append(el('h3','','AI 점검 전 확인 신호'),el('span','wk-rule-tag','규칙 기반 · 참고 기준 · AI 분석 아님'));box.appendChild(h);
    if(!ads||ads.loading){box.appendChild(el('p','wk-sub','광고 세트 지표를 불러오는 중이에요.'));return box;}
    if(ads.error){box.appendChild(el('p','wk-sub','광고 세트 지표를 불러오지 못했어요.'));return box;}
    var rows=(ads.rows||[]).filter(function(r){return Number(r.metrics&&r.metrics.spend)>0;}).sort(function(x,y){return Number(y.metrics.spend)-Number(x.metrics.spend);}).slice(0,3);
    if(!rows.length){box.appendChild(el('p','wk-sub','선택한 기간에 광고비가 쓰인 광고 세트가 없어요.'));return box;}
    var ul=el('ul','wk-ads');
    rows.forEach(function(r){
      var m=r.metrics||{},buy=m.purchase&&m.purchase.observed?m.purchase.value+'건':'미측정',sig=I.ruleSignals(m,r.linked,r.verdict),li=el('li','wk-ad');
      li.append(el('strong','wk-ad-name',r.name),el('p','wk-key',['광고비 '+I.shortMoney(m.spend,ads.currency),'구매 '+buy,'ROAS '+(m.roas==null?'미측정':Math.round(m.roas*100)+'%')].join(' / ')));
      var l=el('p','wk-line');l.append(el('span','wk-k','확인 신호'),el('span','',sig.length?sig.join(' · '):'뚜렷한 신호 없음'));li.appendChild(l);
      ul.appendChild(li);
    });
    box.append(ul,el('small','wk-foot','선택한 기간의 광고 세트 기준 · 기준값은 업종마다 다른 참고 기준이라 문제로 단정하지 않아요 · 원인 · 변경안은 AI 점검에서 확인해요'));
    return box;
  }

  // 사장님용 요약 — 지금 상태(확인한 숫자 · 기준) → 할 일(이유 · 출처) → 판단하지 않은 것(펼쳐서). 문장은 서버가 확인한 값으로만 만든다
  function renderBrief(b){
    var box=el('section','wk-brief');
    box.appendChild(el('h3','','지금 상태'));
    var st=el('ul','wk-brief-status');(b.status||[]).forEach(function(t){st.appendChild(el('li','',t));});box.appendChild(st);
    box.appendChild(el('h3','','할 일'));
    var ol=el('ol','wk-todos');
    (b.todos||[]).forEach(function(t){var li=el('li');li.append(el('strong','',t.what),el('small','','이유: '+t.why+' · '+t.source));ol.appendChild(li);});
    box.appendChild(ol);
    if(b.unknowns&&b.unknowns.length){
      var d=el('details','wk-unknowns');d.appendChild(el('summary','','판단하지 않은 것 · 기준 차이 '+b.unknowns.length+'개'));
      var ul=el('ul');b.unknowns.forEach(function(t){ul.appendChild(el('li','',t));});d.appendChild(ul);box.appendChild(d);
    }
    return box;
  }
  // 점검 기준(사업 정보) — AI가 켜져 있을 때만 보인다(주간 점검 칸 안). 저장해도 이미 끝난 점검은 바뀌지 않고 다음 점검부터
  function renderProfile(){
    var p=wk.profile||{status:'loading'},d=p.data,box=el('details','wk-profile');box.open=!!ui.profileOpen;
    box.addEventListener('toggle',function(){ui.profileOpen=box.open;});
    var sum=p.status==='loading'?'불러오는 중':p.status==='error'?'불러오지 못함':d?'저장됨 · '+[d.objective,d.target_roas_pct!=null?'목표 ROAS '+d.target_roas_pct+'%':null].filter(Boolean).join(' · '):'미입력 · 목표 기준 판단 안 함';
    box.appendChild(el('summary','','점검 기준 · 사업 정보 ('+sum+')'));
    if(p.status!=='ok'){if(p.note)box.appendChild(el('p','wk-sub',p.note));return box;}
    var dr=ui.draft||(ui.draft={objective:d&&d.objective||'',target_roas_pct:d&&d.target_roas_pct!=null?String(d.target_roas_pct):'',
      monthly_budget_cap_krw:d&&d.monthly_budget_cap_krw!=null?String(d.monthly_budget_cap_krw):'',cannot_change:(d&&d.cannot_change||[]).slice()});
    var form=el('div','wk-profile-form');
    var field=function(label,input,note){var l=el('label');l.append(el('span','',label),input);if(note)l.appendChild(el('small','',note));form.appendChild(l);};
    var sel=el('select');I.OBJECTIVES.forEach(function(o,i){if(!i)sel.appendChild(new Option('선택',''));sel.appendChild(new Option(o,o));});sel.value=dr.objective;
    sel.addEventListener('change',function(){dr.objective=sel.value;});field('광고 목표 (필수)',sel);
    var num=function(key,min,step,ph){var x=el('input');x.type='number';x.min=String(min);x.step=String(step);x.placeholder=ph;x.value=dr[key];x.addEventListener('input',function(){dr[key]=x.value;});return x;};
    field('목표 ROAS (%, 선택)',num('target_roas_pct',50,10,'예: 300'),'Meta 귀속 ROAS 기준 · Cafe24 실제 매출 기준 아님');
    field('월 광고 예산 상한 (원, 선택)',num('monthly_budget_cap_krw',10000,10000,'예: 1000000'));
    var fs=el('fieldset','wk-cannot');fs.appendChild(el('legend','','바꿀 수 없는 것 (선택)'));
    I.CANNOT_CHANGE.forEach(function(c){var l=el('label'),cb=el('input');cb.type='checkbox';cb.checked=dr.cannot_change.indexOf(c)>=0;
      cb.addEventListener('change',function(){dr.cannot_change=dr.cannot_change.filter(function(x){return x!==c;});if(cb.checked)dr.cannot_change.push(c);});
      l.append(cb,el('span','',c));fs.appendChild(l);});
    form.appendChild(fs);
    var save=el('button','secondary',p.saving?'저장 중…':'점검 기준 저장');save.type='button';save.disabled=!!p.saving;save.addEventListener('click',saveProfile);
    box.append(el('p','wk-sub','목표가 있어야 목표 대비 판단을 해요. 광고별 이익은 판단하지 않아요(광고별 주문 연결 없음). 개인정보는 받지 않아요.'),form,save);
    if(p.note)box.appendChild(el('p','wk-sub',p.note));
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
    row(sa,'지난주 점검 결과',r?list.length+'개':'—');
    row(sa,'우선 확인',r?need+'개':'—',need?'is-warn':'');
    var st=wk.data&&wk.data.status,q=wk.data&&wk.data.quota;
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
    wk={state:'idle',data:null,message:'',storeId:ctx.storeId,busy:false,profile:null};ui={panel:{},all:false,profileOpen:false,draft:null};render();
    var r=await call(ctx,{store_id:ctx.storeId,action:'status'});
    if(app.getContext().storeId!==ctx.storeId)return;
    if(r.unavailable)wk.state='unavailable',wk.message='주간 AI 점검을 준비하고 있어요.';
    else if(r.error)wk.state='error',wk.message='점검 상태를 불러오지 못했어요. 잠시 후 다시 열어 주세요.';
    else{wk.data=r.data;wk.state=r.data.enabled?'ready':'off';if(!r.data.enabled)wk.message='AI 연결 전이라 아직 실행할 수 없어요.';}
    render();
    if(wk.state==='ready')loadProfile(ctx); // AI가 꺼져 있으면 사업 정보도 읽지 않는다(칸이 숨겨져 있음)
  }
  // 사업 정보(tool_records business_profile) — 쇼핑몰별 최신 기록. 조회 실패는 '미입력'과 구분해 표시
  async function loadProfile(ctx){
    var mine=wk;wk.profile={status:'loading',id:null,data:null,stale:[],saving:false,note:''};render();
    var res=await ctx.client.from('tool_records').select('id,data,created_at').eq('user_id',ctx.userId).eq('tool_type','business_profile').order('created_at',{ascending:false}).limit(20);
    if(wk!==mine)return;
    if(res.error){wk.profile={status:'error',id:null,data:null,stale:[],saving:false,note:'사업 정보를 불러오지 못했어요. 새로고침해 주세요.'};render();return;}
    var p=I.latestProfile(res.data||[],ctx.storeId);
    wk.profile={status:'ok',id:p.id,data:p.data,stale:p.stale,saving:false,note:''};render();
  }
  // 저장 — 수정 권한이 없어 새로 저장한 뒤 이 쇼핑몰의 예전 기록을 지운다(지우기 실패면 다음 저장 때 다시). 쇼핑몰을 바꾸면 결과를 버린다
  async function saveProfile(){
    var ctx=app.getContext(),mine=wk,p=wk.profile;if(!ctx.userId||!ctx.storeId||!p||p.status!=='ok'||p.saving)return;
    var v=I.profileInput(ui.draft||{});
    if(!v.ok){p.note=v.errors.join(' ');render();return;}
    p.saving=true;p.note='저장하고 있어요.';render();
    var data=Object.assign({store_id:String(ctx.storeId),saved_at:new Date().toISOString()},v.data),old=[p.id].concat(p.stale||[]).filter(function(x){return x!=null;});
    try{
      var ins=await ctx.client.from('tool_records').insert({user_id:ctx.userId,tool_type:'business_profile',data:data}).select('id').single();
      if(wk!==mine)return;
      if(ins.error){p.saving=false;p.note='사업 정보를 저장하지 못했어요.';render();return;}
      var del=old.length?await ctx.client.from('tool_records').delete().in('id',old).eq('user_id',ctx.userId).eq('tool_type','business_profile'):{error:null};
      if(wk!==mine)return;
      wk.profile={status:'ok',id:ins.data&&ins.data.id,data:data,stale:del&&del.error?old:[],saving:false,note:'저장했어요 · 다음 점검부터 반영돼요.'};ui.draft=null;render();
    }catch(e){if(wk===mine){p.saving=false;p.note='사업 정보를 저장하지 못했어요.';render();}}
  }
  async function run(){
    if(wk.busy)return; // 연속 클릭 방지(서버도 동시 요청을 막는다)
    var ctx=app.getContext();wk.busy=true;wk.message='지난주 · 그 전주 판매를 집계하는 중이에요.';render();
    var mine=wk; // 실행 중 쇼핑몰을 바꾸면 loadStatus가 wk를 새로 만든다 — 그 뒤 결과는 버린다
    try{
      var w=lastWeeks(),cur=await weekSales(ctx,w.current),prev=await weekSales(ctx,w.previous);
      if(wk!==mine)return;
      wk.message='광고와 소재를 확인하고 분석하는 중이에요. 1~2분 걸릴 수 있어요.';render();
      var r=await call(ctx,{store_id:ctx.storeId,action:'run',sales:{current:cur,previous:prev},fx_krw_per_unit:ctx.fx&&ctx.fx.krw_per_unit||null});
      if(wk!==mine)return;
      var d=r.data||r.body||{};
      if(r.unavailable){wk.state='unavailable';wk.message='주간 AI 점검을 준비하고 있어요.';}
      else{
        if(d.quota)wk.data=d;
        if(d.ok){wk.state='ready';wk.message='';if(window.LaunchRoasMotion)window.LaunchRoasMotion.toast(d.status==='partial'?'일부 광고만 분석했어요':'주간 점검 완료');}
        // 서버 오류 코드는 보이지 않고 서버가 준 한국어 안내만
        else{wk.state=d.code==='AI_NOT_CONFIGURED'?'off':'error';wk.message=d.message||d.error||'점검에 실패했어요. 이용 횟수는 차감되지 않았어요.';}
      }
    }catch(e){if(wk!==mine)return;wk.state='error';wk.message='점검 요청에 실패했어요. 이용 횟수는 차감되지 않았어요.';}
    wk.busy=false;render();
  }

  window.addEventListener('launchroas:sales-state',function(e){sales=e.detail;render();loadStatus();});
  window.addEventListener('launchroas:adsets-state',function(e){ads=e.detail;render();});
  var fxBtn=byId('sideFx');if(fxBtn)fxBtn.addEventListener('click',function(){if(window.LaunchRoasOpenFx)window.LaunchRoasOpenFx();});
})();
