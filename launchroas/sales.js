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
    if(!ctx.userId||!ctx.storeId){msg.textContent='쇼핑몰을 선택하면 볼 수 있어요.';fxBox.hidden=true;renderHero(null,null,null,false,[]);return;}
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
    var rule=s&&s.ordersWithLinked?'주문당 비용(배송·포장·기타)은 주문마다 한 번 — 마진 상품이 2종 이상 담긴 주문 '+count(s.ordersMultiLinked,'건')+'은 그중 비용이 가장 큰 상품 기준으로 한 번만 뺐어요.':'';
    var margin=s?s.marginTotal:null,mm=s?s.margin:null;
    var ESTIMATED={partialStatus:'일부 취소·클레임 주문',amountMismatch:'결제금액이 맞지 않는 주문(마켓 등)',zeroPayment:'결제금액 0원 주문',noAmount:'결제 내역 없음'};
    var est=mm?Object.keys(mm.estimated).map(function(k){return ESTIMATED[k]+' '+count(mm.estimated[k],'건');}).join(' · '):'';
    figures.appendChild(row(scope+'상품 마진',margin==null?'—':won(margin),s&&s.linkedQty?[
      partial?'판매 '+count(s.soldQty)+' 중 '+count(s.linkedQty)+'만 계산 · 미등록 '+count(s.unlinkedQty)+'는 0원으로 보지 않고 제외':'판매 '+count(s.soldQty)+' 전부 반영',
      '실제 결제 '+count(mm.actualOrders,'건')+(mm.estimatedOrders?' · 주문 당시 판매가로 추정 '+count(mm.estimatedOrders,'건')+' ('+won(mm.estimatedTotal)+')':'')+(mm.savedOnlyOrders?' · 저장한 1개당 마진만 '+count(mm.savedOnlyOrders,'건'):''),
      est?'추정 사유: '+est:'',
      '판매가·할인은 Cafe24 주문 금액, 원가·수수료율·주문당 비용은 저장한 계산값(과거 주문에도 현재 값)',
      rule
    ]:[s&&s.soldQty?'판매된 상품에 마진을 연결하면 계산돼요.':''],partial?'partial':''));

    // 4. 원화 광고비
    var spendKrw=null,spendNotes=[];
    fxBox.hidden=true;
    if(ms){spendNotes.push(ms.note);}
    else if(mp){
      spendKrw=S.adSpendKrw(mp.spend,currency,ctx.fx);
      if(currency!=='KRW'){
        // 환율 입력칸은 환율이 필요할 때나 '환율 변경'을 눌렀을 때만 연다.
        fxBox.hidden=!(spendKrw==null||state.fxEdit);byId('salesFxCurrency').textContent=currency||'외화';
        if(!byId('salesFxRate').matches(':focus'))byId('salesFxRate').value=ctx.fx&&ctx.fx.currency===currency?ctx.fx.krw_per_unit:'';
        spendNotes.push('원본 '+currency+' '+Number(mp.spend||0).toLocaleString('en-US',{maximumFractionDigits:2}));
        spendNotes.push(spendKrw==null?'환율을 입력·저장하면 원화로 바꿔 계산해요.':'적용 환율 1 '+currency+' = '+Number(ctx.fx.krw_per_unit).toLocaleString('ko-KR')+'원 (직접 저장한 값 · 일별 환율 아님)');
      }
      spendNotes.push('Meta 광고계정 시간대'+(tz?' '+tz:'')+' 기준 같은 날짜 범위'+(tz&&tz!=='Asia/Seoul'?' — 한국 시간과 달라 날짜 경계가 몇 시간 어긋날 수 있어요.':''));
    }
    var spendRow=row('원화 광고비',ms?ms.text:spendKrw==null?'환율 입력 필요':won(spendKrw),spendNotes);
    if(!ms&&mp&&currency!=='KRW'&&spendKrw!=null){var edit=el('button','inline-button','환율 변경');edit.type='button';edit.addEventListener('click',function(){state.fxEdit=true;byId('salesFx').hidden=false;byId('salesFxRate').focus();});spendRow.appendChild(edit);}
    figures.appendChild(spendRow);

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
    if(s&&s.unlinkedQty)chips.push({text:'마진 미등록 '+count(s.unlinkedQty)+' → 입력하기',tone:'warn',action:'products'});
    if(s&&s.margin.estimatedOrders)chips.push({text:'판매가 추정 '+count(s.margin.estimatedOrders,'건'),tone:''});
    if(s&&s.margin.savedOnlyOrders)chips.push({text:'저장 판매가 기준 '+count(s.margin.savedOnlyOrders,'건'),tone:''});
    if(!ms&&mp&&spendKrw==null)chips.push({text:'환율 입력 필요',tone:'warn',action:'fx'});
    if(s&&!s.soldQty)chips.push({text:'판매 없음',tone:''});
    renderHero(profit,base,spendKrw,partial,chips,s);
  }

  function renderHero(profit,base,spendKrw,partial,chips,s){
    var amount=byId('salesAmount');
    amount.textContent=profit==null?'—':won(profit);
    amount.classList.toggle('deficit',profit!=null&&profit<0);
    byId('salesScope').hidden=!(partial&&profit!=null);
    // 일부 상품만 계산됐으면 마진이 판매 몇 개분인지, 광고비는 전체인지를 계산식 줄에 바로 붙인다.
    byId('salesFormula').textContent='상품 마진 '+(base==null?'?':won(base))+(partial&&s?' (판매 '+count(s.soldQty)+' 중 '+count(s.linkedQty)+')':'')+' − 실제 광고비 '+(spendKrw==null?'?':won(spendKrw))+(partial?' (전체)':'');
    var box=byId('salesChips');box.replaceChildren();
    chips.forEach(function(c){
      var chip=el(c.action?'button':'span','sales-chip'+(c.tone?' '+c.tone:''),c.text);
      if(c.action){chip.type='button';chip.addEventListener('click',function(){
        if(c.action==='products'){app.showView('calculator');window.dispatchEvent(new CustomEvent('launchroas:open-product-picker'));}
        else byId('salesFxRate').focus();
      });}
      box.appendChild(chip);
    });
  }

  // 주문 금액 → 원가·비용 → 광고비 → 남은 금액 순서의 계산 내역(대조용).
  function renderBreakdown(s,spendKrw,profit){
    var box=byId('salesBreakdown'),m=s&&s.margin;box.replaceChildren();
    box.parentElement.hidden=!(s&&s.marginTotal!=null);
    if(box.parentElement.hidden)return;
    var computed=m.revenue+m.customerShipping-m.unitCost-m.fees-m.orderCosts,lines=[
      ['상품 금액 (실제 결제 '+count(m.actualOrders,'건')+(m.estimatedOrders?' · 추정 '+count(m.estimatedOrders,'건'):'')+')',m.revenue,'+'],
      ['고객 부담 배송비',m.customerShipping,'+'],['상품 원가',m.unitCost,'−'],
      ['판매·PG·배송비 수수료',m.fees,'−'],['주문당 비용 (배송·포장·기타)',m.orderCosts,'−']];
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
    byId('salesFxNote').textContent='';state.fxEdit=false;
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
