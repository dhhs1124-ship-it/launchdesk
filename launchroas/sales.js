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
      state.links=rows.filter(function(r){return r.tool_type===LINK&&String(r.data&&r.data.store_id)===store;}).map(function(r){return Object.assign({_id:r.id},r.data);});
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
    var figures=byId('salesFigures'),msg=byId('salesMessage'),fxBox=byId('salesFx'),products=byId('salesProducts');
    figures.replaceChildren();products.replaceChildren();
    var range=state.range;
    byId('salesPeriod').textContent=range?('Cafe24 주문일 '+range.since+(range.until!==range.since?' ~ '+range.until:'')+' (한국 시간)'):'';
    if(!ctx.userId||!ctx.storeId){msg.textContent='쇼핑몰을 선택하면 실제 판매 기준 이익을 볼 수 있어요.';fxBox.hidden=true;return;}
    msg.textContent=state.error||(state.orders?'':'주문 상품을 불러오는 중이에요.');

    var s=state.orders?S.summarize(state.orders,state.links):null;
    var mp=metaPeriod(ctx),ms=metaState(ctx),currency=ctx.metaData&&ctx.metaData.account&&String(ctx.metaData.account.currency||'').toUpperCase();
    var tz=ctx.metaData&&ctx.metaData.account&&ctx.metaData.account.timezone_name;

    // 1. 판매 수량
    if(s){
      var ex=Object.keys(s.excluded).map(function(k){return EXCLUDED_LABEL[k]+' '+count(s.excluded[k]);});
      figures.appendChild(row('판매 수량 (취소·반품 반영)',count(s.soldQty),[
        '유효 주문 '+count(s.validOrders,'건')+' / 전체 주문 '+count(s.orders,'건'),
        ex.length?'제외: '+ex.join(' · '):'제외된 수량 없음',
        Object.keys(s.unknownCodes).length?'상태 확인 필요 코드: '+Object.keys(s.unknownCodes).join(', '):''
      ]));
    }else figures.appendChild(row('판매 수량 (취소·반품 반영)','—',[state.error||'불러오는 중']));

    // 2. Meta 구매 전환수 — 판매 수량과 별개
    figures.appendChild(row('Meta 구매 전환수',ms?ms.text:count(mp&&mp.purchase_count,'건'),[
      ms?ms.note:'Meta가 광고에 귀속한 구매 수예요. 실제 판매 수량과 다른 숫자이며 계산에 쓰지 않아요.'
    ]));

    // 3. 광고 전 상품 마진 합계
    var margin=s?s.marginTotal:null;
    figures.appendChild(row('광고 전 상품 마진 합계',margin==null?'—':won(margin),s?[
      s.linkedQty?'마진 연결 상품 '+count(s.linkedQty)+' 기준 · 주문당 배송·포장 등은 주문 '+count(s.ordersWithLinked,'건')+'에 한 번씩':'',
      s.unlinkedQty?'마진 미등록 '+count(s.unlinkedQty)+'는 계산에서 제외했어요. 아래 상품별 연결에서 등록하세요.':'',
      s.ordersMixed?'미등록 상품이 섞인 주문 '+count(s.ordersMixed,'건')+'은 연결 상품 마진과 주문당 비용만 반영했어요.':'',
      margin==null&&s.soldQty?'판매된 상품에 마진을 연결하면 계산돼요.':''
    ]:[]));

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

    // 5. 광고비 차감 후 예상 이익 — 필요한 값이 없으면 0원으로 표시하지 않는다
    var profitNotes=[],profit=null;
    if(margin==null)profitNotes.push('광고 전 상품 마진 합계가 필요해요.');
    if(ms)profitNotes.push('광고비를 확인할 수 없어 계산하지 않았어요.');
    else if(mp&&spendKrw==null)profitNotes.push('광고비 환율이 필요해요.');
    if(margin!=null&&spendKrw!=null)profit=margin-spendKrw;
    var p=row('광고비 차감 후 예상 이익',profit==null?'계산 불가':won(profit),profitNotes,profit!=null&&profit<0?'deficit':'');
    if(profit!=null){
      p.appendChild(el('p','estimate-caution','쇼핑몰 전체 추정 · 부가세·세금·고정비·반품 배송비 미반영 · 확정 순이익 아님'));
      p.appendChild(el('small','','상품 마진은 저장한 판매가·원가 기준이에요. 실제 결제 할인·쿠폰은 반영되지 않고, 과거 주문에도 현재 저장한 원가를 적용해요.'));
    }
    figures.appendChild(p);

    if(s)renderProducts(products,s,ctx);
  }

  function calcLabel(c){return (c.product_name||'이름 없는 상품')+' · 판매가 '+MC.fmtWon(c.input.price);}
  function renderProducts(box,s,ctx){
    if(!s.products.length){box.textContent='이 기간에 판매된 상품이 없어요.';return;}
    if(!state.calcs.length)box.appendChild(el('p','small','마진 계산기에서 상품 계산을 저장한 뒤 연결할 수 있어요.'));
    s.products.forEach(function(p){
      var line=el('div','sales-product');
      var name=el('div','sales-product-name');name.append(el('strong','',p.product_name||('상품 번호 '+p.product_no)),el('small','',(p.option_value?p.option_value+' · ':'')+'판매 '+count(p.soldQty)));
      var status=el('small',p.link?'':'sales-unlinked',p.link?('연결: '+p.link.product_label+' · 1개당 '+won(p.link.unit_margin)+' · 주문당 '+won(p.link.order_adjust)+(p.link.variant_code?' (이 옵션)':' (상품 전체)')):'마진 미등록 · 계산 제외');
      name.appendChild(status);line.appendChild(name);
      if(state.calcs.length){
        var pick=el('select');pick.appendChild(new Option('저장한 계산 선택',''));
        state.calcs.forEach(function(c,i){pick.appendChild(new Option(calcLabel(c),String(i)));});
        var scope=el('select');scope.append(new Option('이 옵션만',p.variant_code),new Option('상품 전체',''));
        if(!p.variant_code)scope.value='';
        var save=el('button','secondary','연결 저장');save.type='button';
        save.addEventListener('click',function(){saveLink(p,state.calcs[Number(pick.value)],scope.value,save);});
        var tools=el('div','sales-product-tools');tools.append(pick,scope,save);line.appendChild(tools);
      }
      box.appendChild(line);
    });
  }

  async function saveLink(product,calc,variant,button){
    var ctx=app.getContext();if(!calc||!ctx.userId)return;
    var split=S.splitMargin(calc.input,MC);
    if(!split){byId('salesMessage').textContent='이 계산은 다시 계산할 수 없어 연결하지 않았어요.';return;}
    var data={store_id:String(ctx.storeId),product_no:product.product_no,variant_code:variant||'',cafe24_product_name:product.product_name,
      product_label:String(calc.product_name||'상품').trim().slice(0,40),source_saved_at:calc.saved_at,unit_margin:split.unitMargin,order_adjust:split.orderAdjust,linked_at:new Date().toISOString()};
    var existing=state.links.find(function(l){return String(l.product_no)===String(product.product_no)&&(l.variant_code||'')===data.variant_code;});
    button.disabled=true;
    var res=existing
      ?await ctx.client.from('tool_records').update({data:data}).eq('id',existing._id).eq('user_id',ctx.userId)
      :await ctx.client.from('tool_records').insert({user_id:ctx.userId,tool_type:LINK,data:data});
    button.disabled=false;
    if(res.error){byId('salesMessage').textContent='마진 연결을 저장하지 못했어요.';return;}
    dataKey='';refresh(app.getContext());
  }

  byId('salesFxSave').addEventListener('click',async function(){
    var ctx=app.getContext(),rate=Number(byId('salesFxRate').value),currency=byId('salesFxCurrency').textContent;
    if(!ctx.userId||!ctx.storeId||!(rate>0)||!/^[A-Z]{3}$/.test(currency)){byId('salesFxNote').textContent='0보다 큰 환율을 입력해 주세요.';return;}
    var data={store_id:String(ctx.storeId),currency:currency,krw_per_unit:rate,saved_at:new Date().toISOString()};
    this.disabled=true;
    var res=state.fxRecord
      ?await ctx.client.from('tool_records').update({data:data}).eq('id',state.fxRecord.id).eq('user_id',ctx.userId)
      :await ctx.client.from('tool_records').insert({user_id:ctx.userId,tool_type:FX,data:data}).select('id').single();
    this.disabled=false;
    if(res.error){byId('salesFxNote').textContent='환율을 저장하지 못했어요.';return;}
    if(!state.fxRecord)state.fxRecord={id:res.data.id,data:data};else state.fxRecord.data=data;
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
})();
