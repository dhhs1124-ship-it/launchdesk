/* 실제 판매 기준 예상 이익 패널 — Cafe24 주문 상품(취소·반품 반영) × 저장한 상품 마진 − 원화 광고비.
   Meta 전환수는 별도 숫자로만 보여 주고 판매 수량 대신 쓰지 않는다. */
(function(){
  'use strict';
  var app=window.LaunchRoasApp,S=window.LaunchRoasSales,MC=window.launchdeskMarginCalc,periods=window.launchdeskOpsPeriodCore;
  if(!app||!S||!MC||!periods)return;
  var byId=function(id){return document.getElementById(id);};
  var LINK='product_margin_link',FX='ad_fx_rate',CALC='margin_calc';
  var dataKey='',ticket=0,state={orders:null,error:'',truncated:false,links:[],calcs:[],fxRecord:null,range:null};
  var EXCLUDED_LABEL={canceled:'취소',canceledBeforePayment:'입금 전 취소',returned:'반품',exchangedOriginal:'교환 원상품',unpaid:'미입금',claimPending:'취소·반품 진행 중',unknown:'상태 확인 필요'};

  function won(n){return Math.round(Number(n)).toLocaleString('ko-KR')+'원';}
  function count(n,unit){return Number(n||0).toLocaleString('ko-KR')+(unit||'개');}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function row(label,value,notes,tone){
    var box=el('div','sales-row'+(tone?' '+tone:''));box.append(el('span','sales-label',label),el('strong','sales-value',value));
    (notes||[]).filter(Boolean).forEach(function(n){box.appendChild(el('small','',n));});return box;
  }
  function metaPeriod(ctx){
    var m=ctx.metaData;if(!m||m.error)return null;
    var k=ctx.period.kind;return (k==='month'?m.month:k==='today'?m.today:m.selected)||null;
  }
  function metaState(ctx){
    if(!ctx.metaAccount)return {text:'미연동',note:'Meta 광고계정을 연결하면 표시돼요.'};
    if(ctx.metaAccount.status!=='connected')return {text:'연결 확인 필요',note:'연결 관리에서 광고계정을 선택해 주세요.'};
    if(!ctx.metaData)return {text:'조회 중',note:''};
    if(ctx.metaData.error)return {text:'조회 실패',note:'Meta 성과를 불러오지 못했어요. 0건이 아닙니다.'};
    return null;
  }

  async function load(ctx,key){
    var id=++ticket,range=periods.resolve(ctx.period.kind,ctx.period.date,Date.now());
    state={orders:null,error:'',truncated:false,links:[],calcs:[],fxRecord:null,range:range};render(ctx);
    var records=await ctx.client.from('tool_records').select('id,data,created_at,tool_type').eq('user_id',ctx.userId)
      .in('tool_type',[LINK,FX,CALC]).order('created_at',{ascending:false}).limit(300);
    if(id!==ticket)return;
    if(!records.error){
      var rows=records.data||[],store=String(ctx.storeId);
      state.links=S.latestLinks(rows.filter(function(r){return r.tool_type===LINK&&String(r.data&&r.data.store_id)===store;}).map(function(r){return Object.assign({_id:r.id},r.data);}));
      state.calcs=rows.filter(function(r){return r.tool_type===CALC&&r.data&&r.data.calc_version===2&&r.data.input;}).map(function(r){return r.data;});
      state.fxRecord=rows.find(function(r){return r.tool_type===FX&&String(r.data&&r.data.store_id)===store;})||null;
      app.setFx(state.fxRecord?{currency:state.fxRecord.data.currency,krw_per_unit:state.fxRecord.data.krw_per_unit,saved_at:state.fxRecord.data.saved_at}:null);
    }
    if(!ctx.cafeAccount||ctx.cafeAccount.status!=='connected'){state.error='Cafe24를 연결하면 실제 판매 수량을 볼 수 있어요.';render(app.getContext());return;}
    if(!range){state.error='기간을 다시 선택해 주세요.';render(app.getContext());return;}
    try{
      var res=await ctx.client.functions.invoke('cafe24-order-items',{body:{store_id:ctx.storeId,start_date:range.since,end_date:range.until}});
      if(id!==ticket)return;
      if(res.error||!res.data||res.data.ok!==true)state.error='Cafe24 주문 상품을 불러오지 못했어요. 판매 수량을 0개로 보지 마세요.';
      else if(res.data.truncated){state.truncated=true;state.error='주문이 조회 한도(5,000건)를 넘어 일부가 빠졌어요. 이 기간은 계산하지 않습니다.';}
      else state.orders=res.data.orders||[];
    }catch(e){if(id===ticket)state.error='Cafe24 주문 상품 조회 중 오류가 발생했어요.';}
    if(id===ticket)render(app.getContext());
  }

  function render(ctx){
    var figures=byId('salesFigures'),msg=byId('salesMessage'),fxBox=byId('salesFx');
    figures.replaceChildren();
    var range=state.range;
    byId('salesPeriod').textContent=range?('Cafe24 주문일 '+range.since+(range.until!==range.since?' ~ '+range.until:'')+' (한국 시간)'):'';
    if(!ctx.userId||!ctx.storeId){msg.textContent='쇼핑몰을 선택하면 볼 수 있어요.';fxBox.hidden=true;renderHero(null,null,null,false,[]);
      renderGuide(setupSteps(ctx,null,null,null,metaState(ctx),null),!!ctx.userId&&!(ctx.stores||[]).length);renderSpend(null,metaState(ctx),'',null,null);
      window.dispatchEvent(new CustomEvent('launchroas:sales-state',{detail:{ready:!!ctx.userId&&!!ctx.connectionsLoaded,loading:false,error:'',summary:null,profit:null,partial:false,spendKrw:null,meta:null,metaIssue:'',steps:setupSteps(ctx,null,null,null,metaState(ctx),null).map(function(x){return {title:x.title,done:x.done,text:x.text};})}}));return;}
    msg.textContent=state.orders||state.error?'':'불러오는 중…';

    // 예전에 저장한 연결에 계산 입력값이 없으면 같은 저장 시각의 계산 기록에서 찾아 실제 결제 기준에 쓴다.
    var links=state.links.map(function(l){
      if(l.input)return l;
      var at=Date.parse(l.source_saved_at),c=state.calcs.find(function(c){return Date.parse(c.saved_at)===at;});
      return c?Object.assign({},l,{input:c.input}):l;
    });
    var s=state.orders?S.summarize(state.orders,links):null;
    var mp=metaPeriod(ctx),ms=metaState(ctx),currency=ctx.metaData&&ctx.metaData.account&&String(ctx.metaData.account.currency||'').toUpperCase();
    var tz=ctx.metaData&&ctx.metaData.account&&ctx.metaData.account.timezone_name;

    // 1. 판매 수량
    if(s){
      var ex=Object.keys(s.excluded).map(function(k){return EXCLUDED_LABEL[k]+' '+count(s.excluded[k]);});
      figures.appendChild(row('판매 수량 (취소·반품 반영)',count(s.soldQty),[
        '유효 주문 '+count(s.validOrders,'건')+' / 전체 주문 '+count(s.orders,'건'),
        '마진 반영 '+count(s.linkedQty)+' · 마진 미등록 '+count(s.unlinkedQty),
        ex.length?'제외: '+ex.join(' · '):'제외된 수량 없음',
        Object.keys(s.unknownCodes).length?'상태 확인 필요 코드: '+Object.keys(s.unknownCodes).join(', '):''
      ]));
    }else figures.appendChild(row('판매 수량 (취소·반품 반영)','—',[state.error||'불러오는 중']));

    // 2. Meta 구매 전환수 — 판매 수량과 별개
    figures.appendChild(row('Meta 구매 전환수',ms?ms.text:count(mp&&mp.purchase_count,'건'),[
      ms?ms.note:'Meta가 광고에 귀속한 구매 수예요. 실제 판매 수량과 다른 숫자이며 계산에 쓰지 않아요.'
    ]));

    // 3. 광고 전 상품 마진 — 주문 금액이 맞는 주문은 실제 결제(payment_amount + naver_point),
    //    확인할 수 없는 주문은 Cafe24가 기록한 주문 당시 판매가로 추정한다. 미등록 상품은 0원으로 더하지 않는다.
    var partial=!!(s&&s.partial),scope=partial?'일부 상품 기준 ':'';
    var rule=s&&s.ordersWithLinked?'배송·포장·기타: 실제 택배 지출액을 알 수 없어 저장한 설정값으로 추정 — 추정 규칙: 주문 1건에 한 번, 담긴 상품 중 가장 큰 설정값'+(s.margin.multiCodeOrders?' · Cafe24 배송코드가 나뉜 주문 '+count(s.margin.multiCodeOrders,'건')+'도 실제 분할 발송을 확인할 수 없어 한 번으로 계산':''):'';
    var cpn=s&&s.ordersWithLinked?s.margin.coupon:null;
    var couponNote=cpn&&(cpn.shipping||cpn.product||cpn.unknown||cpn.ambiguous)?'쿠폰 종류는 쿠폰 이름 기준 추정(Cafe24가 종류를 주지 않음) — 무료배송 쿠폰 '+count(cpn.shipping||0,'건')+'(고객 배송비에서 뺌) · 상품 쿠폰 '+count(cpn.product||0,'건')+((cpn.ambiguous||cpn.unknown)?' · 이름이 모호하거나 조회 못 함 '+count((cpn.ambiguous||0)+(cpn.unknown||0),'건')+'(분류하지 않고 상품 할인으로 계산 — 상품 · 배송비 수수료율이 다르면 쿠폰 금액 × 요율 차이만큼 수수료가 달라질 수 있음)':''):'';
    var payNote=s&&s.ordersWithLinked?'적립금 사용 '+count(s.margin.pointsOrders,'건')+'은 쇼핑몰이 지급한 혜택이라 판매자 부담으로 따로 뺌 · 예치금 '+count(s.margin.creditsOrders,'건')+' · 네이버페이(포인트 포함)는 정산되는 결제라 빼지 않음':'';
    var ship=s&&s.ordersWithLinked?s.margin.ship:null;
    var shipNote=ship?'고객 배송비: 주문에 실제 부과된 금액(현재 무료배송 조건으로 다시 계산하지 않음) — 부과 '+count(ship.charged,'건')+' · 0원 '+count(ship.free,'건')+(ship.unknown?' · 확인 불가 '+count(ship.unknown,'건')+'(0원으로 계산)':''):'';
    var margin=s?s.marginTotal:null,mm=s?s.margin:null;
    var ESTIMATED={savedPrice:'Cafe24 판매가 정보 없음(저장한 판매가로 추정)',partialStatus:'일부 취소·클레임 주문',amountMismatch:'결제금액이 맞지 않는 주문(마켓 등)',zeroPayment:'결제금액 0원 주문',noAmount:'결제 내역 없음'};
    var est=mm?Object.keys(mm.estimated).map(function(k){return ESTIMATED[k]+' '+count(mm.estimated[k],'건');}).join(' · '):'';
    figures.appendChild(row(scope+'상품 마진',margin==null?'—':won(margin),s&&s.linkedQty?[
      partial?'판매 '+count(s.soldQty)+' 중 '+count(s.linkedQty)+'만 계산 · 미등록 '+count(s.unlinkedQty)+'는 0원으로 보지 않고 제외':'판매 '+count(s.soldQty)+' 전부 반영',
      '실제 결제 '+count(mm.actualOrders,'건')+(mm.estimatedOrders?' · 주문 당시 판매가로 추정 '+count(mm.estimatedOrders,'건')+' ('+won(mm.estimatedTotal)+')':'')+(mm.savedOnlyOrders?' · 저장한 1개당 마진만 '+count(mm.savedOnlyOrders,'건'):''),
      est?'추정 사유: '+est:'',
      '상품 금액은 옵션 추가금 · 쿠폰 · 할인이 반영된 Cafe24 주문 금액(판매가 0원 사은품은 매출 0원 · 원가는 반영), 원가 · 수수료율은 저장한 값(옵션별 원가가 있으면 우선)',
      shipNote,couponNote,payNote,rule
    ]:[s&&s.soldQty?'판매된 상품에 마진을 연결하면 계산돼요.':''],partial?'partial':''));

    // 4. 원화 광고비
    var spendKrw=null,spendNotes=[];
    fxBox.hidden=true;
    if(ms){spendNotes.push(ms.note);}
    else if(mp){
      spendKrw=S.adSpendKrw(mp.spend,currency,ctx.fx);
      if(currency!=='KRW'){
        fxBox.hidden=false;byId('salesFxCurrency').textContent=currency||'외화';
        if(!byId('salesFxRate').matches(':focus'))byId('salesFxRate').value=ctx.fx&&ctx.fx.currency===currency?ctx.fx.krw_per_unit:'';
        spendNotes.push('원본 '+currency+' '+Number(mp.spend||0).toLocaleString('en-US',{maximumFractionDigits:2}));
        spendNotes.push(spendKrw==null?'환율을 입력·저장하면 원화로 바꿔 계산해요.':'적용 환율 1 '+currency+' = '+Number(ctx.fx.krw_per_unit).toLocaleString('ko-KR')+'원 (직접 저장한 값 · 일별 환율 아님)');
      }
      spendNotes.push('Meta 광고계정 시간대'+(tz?' '+tz:'')+' 기준 같은 날짜 범위'+(tz&&tz!=='Asia/Seoul'?' — 한국 시간과 달라 날짜 경계가 몇 시간 어긋날 수 있어요.':''));
    }
    figures.appendChild(row('원화 광고비',ms?ms.text:spendKrw==null?'환율 입력 필요':won(spendKrw),spendNotes));
    renderSpend(mp,ms,currency,spendKrw,ctx.fx);

    // 5. 광고비 빼고 남은 금액 — 필요한 값이 없으면 0원으로 표시하지 않는다.
    var base=margin,profitNotes=[],profit=null;
    if(base==null)profitNotes.push('마진이 연결된 판매 상품이 필요해요.');
    if(ms)profitNotes.push('광고비를 확인할 수 없어 계산하지 않았어요.');
    else if(mp&&spendKrw==null)profitNotes.push('광고비 환율이 필요해요.');
    if(base!=null&&spendKrw!=null)profit=base-spendKrw;
    var p=row(partial?'일부 상품 기준 남은 금액':'광고비 빼고 남은 금액',profit==null?'계산 불가':won(profit),profitNotes,(profit!=null&&profit<0?'deficit ':'')+(partial?'partial':''));
    if(profit!=null){
      p.appendChild(el('small','','상품 마진 '+won(base)+' − 원화 광고비 '+won(spendKrw)));
      if(partial)p.appendChild(el('small','sales-partial-note','미등록 '+count(s.unlinkedQty)+'의 마진 없이 광고비 전체를 뺐어요 · 쇼핑몰 전체 손익 아님'));
      p.appendChild(el('p','estimate-caution','부가세·세금·고정비·반품 배송비 미반영 · 확정 순이익 아님'));
    }
    figures.appendChild(p);
    renderBreakdown(s,spendKrw,profit);

    // 맨 위 요약: 금액 하나 · "상품 마진 − 광고비" 한 줄 · 해석에 꼭 필요한 짧은 상태만.
    var chips=[];
    if(state.error)chips.push({text:ctx.cafeAccount&&ctx.cafeAccount.status==='connected'?'Cafe24 조회 실패':'Cafe24 미연결',tone:'warn'});
    if(ms)chips.push({text:'Meta '+ms.text,tone:ms.text==='조회 중'?'':'warn'});
    // 미등록은 상품 종류(옵션은 같은 상품)와 판매 수량을 함께 — '19개'가 종류로 오해되지 않게.
    if(s&&s.unlinkedQty)chips.push({text:'비용 미입력 상품 '+count(s.unlinkedKinds,'종')+' (판매 '+count(s.unlinkedQty)+') · 입력하기',tone:'warn',action:'products'});
    if(s&&s.margin.estimatedOrders)chips.push({text:'판매가 추정 '+count(s.margin.estimatedOrders,'건'),tone:''});
    if(s&&s.margin.savedOnlyOrders)chips.push({text:'저장 판매가 기준 '+count(s.margin.savedOnlyOrders,'건'),tone:''});
    if(!ms&&mp&&spendKrw==null)chips.push({text:'환율 입력 필요',tone:'warn',action:'fx'});
    if(s&&!s.soldQty)chips.push({text:'판매 없음',tone:''});
    renderHero(profit,base,spendKrw,partial,chips,s);
    var ready=!!ctx.connectionsLoaded;
    renderGuide(setupSteps(ctx,s,profit,spendKrw,ms,mp),ready);
    // 개선 점검 패널 · 사용법 안내가 같은 상태를 쓰도록 알린다(조회 중이면 loading — 0원으로 보지 않게).
    window.dispatchEvent(new CustomEvent('launchroas:sales-state',{detail:{ready:ready,loading:!s&&!state.error,error:state.error||'',summary:s,links:links,profit:profit,partial:partial,spendKrw:spendKrw,meta:mp||null,metaIssue:ms?ms.text:'',currency:currency||'',fx:ctx.fx||null,steps:setupSteps(ctx,s,profit,spendKrw,ms,mp).map(function(x){return {title:x.title,done:x.done,text:x.text};}),range:state.range}}));
  }

  // ---- 처음 설정 안내 · 현재 상황 한 줄 — 둘 다 실제 저장 상태로만 판단한다(버튼을 눌렀다고 완료로 보지 않음) ----
  function openProducts(productNo){app.showView('calculator');window.dispatchEvent(new CustomEvent('launchroas:open-product-picker',{detail:{product_no:typeof productNo==='number'||typeof productNo==='string'?productNo:null}}));}
  function openFx(){app.showView('calculator');var f=byId('salesFxRate');if(f){f.scrollIntoView({block:'center'});f.focus({preventScroll:true});}}
  window.LaunchRoasOpenFx=openFx;
  function goResult(){app.showView('overview');var p=document.querySelector('.key-profit');if(p)p.scrollIntoView({block:'start',behavior:'smooth'});}
  function setupSteps(ctx,s,profit,spendKrw,ms,mp){
    var cafeOk=!!(ctx.cafeAccount&&ctx.cafeAccount.status==='connected'),metaOk=!!(ctx.metaAccount&&ctx.metaAccount.status==='connected');
    var conn={title:'쇼핑몰 · 광고 계정 연결',done:cafeOk&&metaOk,
      text:!(ctx.stores||[]).length?'쇼핑몰을 등록하고 Cafe24 · Meta를 연결하세요':'Cafe24 '+(cafeOk?'연결됨':'미연결')+' · Meta '+(metaOk?'연결됨':ctx.metaAccount?'광고계정 선택 필요':'미연결'),
      button:cafeOk&&metaOk?null:{label:'연결 관리로 이동',run:function(){app.showView('connections');}}};
    var cost={title:'상품 비용 입력',done:false,button:{label:'상품 비용 입력하기',run:openProducts}};
    // 앞 단계가 필요한 단계에는 버튼을 두지 않는다(누를 수 있는 곳을 하나로).
    if(!cafeOk){cost.text='Cafe24를 연결하면 판매 상품이 보여요.';cost.button=null;}
    else if(!s)cost.text=state.error?'판매 상품을 불러오지 못했어요.':'판매 상품을 확인하는 중이에요.';
    else if(!s.soldQty)cost.text='이 기간 판매가 없어 확인할 상품이 없어요.';
    else if(!s.unlinkedQty){cost.done=true;cost.text='판매 상품 '+count(s.productKinds,'종')+' 모두 비용 저장됨';cost.button=null;}
    else cost.text=(state.range?state.range.label+' ':'')+'판매 상품 '+count(s.productKinds,'종')+' 중 '+count(s.productKinds-s.unlinkedKinds,'종')+' 저장 · 남은 '+count(s.unlinkedKinds,'종')+' (판매 '+count(s.unlinkedQty)+')';
    if(s&&s.unlinkedList&&s.unlinkedQty)cost.items=s.unlinkedList;
    // 일부 상품만 계산되면 결과는 볼 수 있어도 완료로 표시하지 않는다(전체 손익으로 오해 방지).
    var partialResult=profit!=null&&!!(s&&s.partial);
    var result={title:'광고비 빼고 남은 금액 확인',done:profit!=null&&!partialResult,button:profit!=null?{label:'결과 보기',run:goResult}:null};
    result.text=profit!=null?(partialResult?'지금은 일부 상품 기준(판매 '+count(s.soldQty)+' 중 '+count(s.linkedQty)+')이에요':'전체 판매 상품 기준으로 확인할 수 있어요')
      :!metaOk?'Meta 광고계정 연결이 필요해요':ms?'Meta '+ms.text:mp&&spendKrw==null?'광고비 환율 입력이 필요해요':'상품 비용 입력이 필요해요';
    if(profit==null&&mp&&spendKrw==null&&!ms)result.button={label:'환율 입력',run:openFx};
    return [conn,cost,result];
  }
  function renderGuide(steps,ready){
    var box=byId('setupGuide'),list=byId('setupSteps');
    var done=steps.filter(function(x){return x.done;}).length;
    box.hidden=!ready||done===steps.length;
    if(box.hidden)return;
    byId('setupProgress').textContent=done+'/'+steps.length+' 완료';
    list.replaceChildren();
    var next=steps.findIndex(function(x){return !x.done;});
    steps.forEach(function(x,i){
      var li=el('li','setup-step'+(x.done?' done':'')+(i===next?' next':''));
      li.append(el('span','setup-num',x.done?'✓':String(i+1)));
      var body=el('div','setup-body');body.append(el('strong','',x.title),el('small','',x.text));li.appendChild(body);
      if(x.items&&!x.done){
        // 남은 상품 이름을 바로 보여주고, 누르면 그 상품의 비용 입력 화면을 연다.
        var ul=el('ul','setup-items');
        x.items.slice(0,3).forEach(function(p){var li2=el('li'),b=el('button','inline-button',(p.product_name||'상품 '+p.product_no)+' · 판매 '+count(p.soldQty));b.type='button';b.addEventListener('click',function(){openProducts(p.product_no);});li2.appendChild(b);ul.appendChild(li2);});
        if(x.items.length>3)ul.appendChild(el('li','small','외 '+count(x.items.length-3,'종')));
        body.appendChild(ul);
      }
      if(x.button&&!x.done){var b=el('button',i===next?'primary setup-btn':'secondary setup-btn',x.button.label);b.type='button';b.addEventListener('click',x.button.run);li.appendChild(b);}
      list.appendChild(li);
    });
  }
  // 광고비 카드 — 외화면 저장한 환율로 원화, 구매금액을 측정하지 못했으면 ROAS를 0%로 보이지 않게 한다.
  function money(v,cur){try{return new Intl.NumberFormat('en-US',{style:'currency',currency:cur||'USD',maximumFractionDigits:2}).format(Number(v)||0);}catch(e){return (cur||'')+' '+Number(v||0).toLocaleString('en-US');}}
  function renderSpend(mp,ms,currency,spendKrw,fx){
    var value,notes=[];
    if(ms){value=ms.text==='미연동'?'미연결':ms.text;notes.push(ms.note);}
    else if(!mp){value='—';notes.push('Meta 광고비를 불러오는 중이에요');}
    else{
      value=currency==='KRW'?won(mp.spend):spendKrw!=null?won(spendKrw):money(mp.spend,currency);
      if(currency!=='KRW')notes.push(money(mp.spend,currency)+(spendKrw!=null?' · 1 '+currency+' = '+Number(fx.krw_per_unit).toLocaleString('ko-KR')+'원':' · 환율을 저장하면 원화로 보여요'));
      notes.push(mp.purchase_value_observed&&mp.roas!=null?'ROAS '+Math.round(Number(mp.roas)*100).toLocaleString('ko-KR')+'% · Meta 구매 '+count(mp.purchase_count,'건'):'구매금액 측정 안 됨 · ROAS 표시 안 함');
    }
    byId('adSpend').textContent=value;byId('adNote').textContent=notes.filter(Boolean).join(' · ');
  }

  var revealKey='';
  function renderHero(profit,base,spendKrw,partial,chips,s){
    var amount=byId('salesAmount'),text=profit==null?'—':won(profit),M=window.LaunchRoasMotion;
    var changed=amount.textContent!==text||byId('salesScope').hidden!==!(partial&&profit!=null);
    amount.textContent=text;
    amount.classList.toggle('deficit',profit!=null&&profit<0);
    byId('salesScope').hidden=!(partial&&profit!=null);
    // 금액(부호 · 단위)과 '일부 상품 기준' 표시는 한 덩어리(.key-amount)로 함께 움직인다. 조회 중('—')에는 연출하지 않는다.
    if(M&&profit!=null){
      var key=app.getContext().storeId+'|'+(state.range?state.range.since+'~'+state.range.until:'');
      if(key!==revealKey){revealKey=key;M.stagger([document.querySelector('.key-amount'),byId('salesFormula')]);}
      else if(changed)M.play(document.querySelector('.key-amount'),'fx-kinetic');
    }
    // 일부 상품만 계산됐으면 마진이 판매 몇 개분인지, 광고비는 전체인지를 계산식 줄에 바로 붙인다.
    byId('salesFormula').textContent=profit==null?'상품 마진 − 광고비로 계산해요':'상품 마진 '+won(base)+(partial&&s?' (판매 '+count(s.soldQty)+'개 중 '+count(s.linkedQty)+'개)':'')+' − 광고비 '+won(spendKrw);
    var box=byId('salesChips');box.replaceChildren();
    chips.forEach(function(c){
      var chip=el(c.action?'button':'span','sales-chip'+(c.tone?' '+c.tone:''),c.text);
      if(c.action){chip.type='button';chip.addEventListener('click',function(){
        if(c.action==='products')openProducts();
        else openFx();
      });}
      box.appendChild(chip);
    });
  }

  // 주문 금액 → 원가·비용 → 광고비 → 남은 금액 순서의 계산 내역(대조용).
  function renderBreakdown(s,spendKrw,profit){
    var box=byId('salesBreakdown'),m=s&&s.margin;box.replaceChildren();
    box.parentElement.hidden=!(s&&s.marginTotal!=null);
    if(box.parentElement.hidden)return;
    var computed=m.revenue+m.customerShipping-m.points-m.unitCost-m.fees-m.orderCosts,lines=[
      ['상품 금액 (실제 결제 '+count(m.actualOrders,'건')+(m.estimatedOrders?' · 추정 '+count(m.estimatedOrders,'건'):'')+')',m.revenue,'+'],
      ['고객에게 받은 배송비',m.customerShipping,'+'],['적립금 사용 (판매자 부담)',m.points,'−'],['상품 원가',m.unitCost,'−'],
      ['판매 수수료 (상품금액 · 적립금 포함 × 판매 수수료율)',m.feeSales,'−'],['PG 수수료 (적립금 · 예치금 뺀 결제분 × PG 수수료율)',m.feePg,'−'],['배송비 수수료',m.feeShip,'−'],['배송·포장·기타 (설정값 추정)',m.orderCosts,'−']];
    if(m.savedOnlyOrders)lines.push(['저장한 1개당 마진으로만 계산한 주문 '+count(m.savedOnlyOrders,'건'),m.total-computed,'+']);
    lines.push(['상품 마진',m.total,'=']);
    if(spendKrw!=null){lines.push(['원화 광고비 (전체)',spendKrw,'−']);lines.push([s.partial?'일부 상품 기준 남은 금액':'남은 금액',profit,'=']);}
    lines.forEach(function(l){var r=el('div','breakdown-row'+(l[2]==='='?' total':''));r.append(el('span','',l[2]+' '+l[0]),el('strong','',won(l[1])));box.appendChild(r);});
  }

  byId('salesFxSave').addEventListener('click',async function(){
    var ctx=app.getContext(),rate=Number(byId('salesFxRate').value),currency=byId('salesFxCurrency').textContent;
    if(!ctx.userId||!ctx.storeId||!(rate>0)||!/^[A-Z]{3}$/.test(currency)){byId('salesFxNote').textContent='0보다 큰 환율을 입력해 주세요.';return;}
    var data={store_id:String(ctx.storeId),currency:currency,krw_per_unit:rate,saved_at:new Date().toISOString()};
    this.disabled=true;
    // tool_records는 수정(UPDATE) 권한이 없다 — 새로 저장한 뒤 이 쇼핑몰의 이전 환율 기록을 지운다.
    var res=await ctx.client.from('tool_records').insert({user_id:ctx.userId,tool_type:FX,data:data}).select('id').single();
    if(!res.error&&state.fxRecord)await ctx.client.from('tool_records').delete().eq('id',state.fxRecord.id).eq('user_id',ctx.userId).eq('tool_type',FX);
    this.disabled=false;
    if(res.error){byId('salesFxNote').textContent='환율을 저장하지 못했어요.';return;}
    state.fxRecord={id:res.data.id,data:data};
    byId('salesFxNote').textContent='환율을 저장했어요.';
    app.setFx({currency:currency,krw_per_unit:rate,saved_at:data.saved_at});
  });

  function refresh(ctx){
    var key=[ctx.userId,ctx.storeId,ctx.period.kind,ctx.period.date||'',ctx.cafeAccount&&ctx.cafeAccount.status].join('|');
    // 앱이 연결 상태를 다시 읽는 중이면(기간 변경 · 주문 동기화 · 쇼핑몰 전환) 다 읽은 뒤 주문 상품도 다시 불러온다.
    if(!ctx.connectionsLoaded)dataKey='';
    if(ctx.userId&&ctx.storeId&&ctx.connectionsLoaded&&key!==dataKey){dataKey=key;load(ctx,key);return;}
    if(!ctx.userId||!ctx.storeId){dataKey='';ticket++;state.orders=null;state.error='';}
    render(ctx);
  }
  app.subscribe(refresh);
  // 마진 계산기에서 상품 비용을 저장하면 같은 기간으로 다시 계산한다.
  window.addEventListener('launchroas:product-margin-saved',function(event){
    if(String(event.detail&&event.detail.storeId)!==String(app.getContext().storeId))return;
    dataKey='';refresh(app.getContext());
  });
})();
