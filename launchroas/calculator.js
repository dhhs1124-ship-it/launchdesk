/* 마진 계산기 = 상품별 마진 설정. 쇼핑몰 상품을 골라 원가 · 수수료 · 배송 · 포장 비용을 입력하고 그 상품에 바로 저장한다.
   광고비는 여기서 넣지 않는다(운영 현황에서 실제 광고비를 한 번만 뺀다). 판매가는 Cafe24 주문 금액을 쓰고,
   여기 판매가는 미리보기용이다. 저장 형식은 tool_records(tool_type 'product_margin_link')의 기존 연결과 같다. */
(function(){
  'use strict';
  var app=window.LaunchRoasApp,MC=window.launchdeskMarginCalc,S=window.LaunchRoasSales,periods=window.launchdeskOpsPeriodCore;
  if(!app||!MC||!S||!periods)return;
  var byId=function(id){return document.getElementById(id);},LINK='product_margin_link',CALC='margin_calc',RECENT_DAYS=31;
  var numeric={price:'calcPrice',unitCost:'calcCost',sellerDiscount:'calcDiscount',customerShipping:'calcCustomerShip',actualShipping:'calcActualShip',
    packaging:'calcPackaging',otherCost:'calcOther',feeRate:'calcFee',pgRate:'calcPgRate',shippingFeeRate:'calcShipFeeRate'};
  var mode='simple',ticket=0,st={key:'',products:null,links:[],calcs:[],error:'',target:null};

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function won(n){return Math.round(Number(n)).toLocaleString('ko-KR')+'원';}
  function say(text){byId('pmMessage').textContent=text||'';}

  function raw(){
    var v={qty:1,adMode:'none',adRate:null,adAmount:null,targetProfit:null};
    Object.keys(numeric).forEach(function(k){v[k]=byId(numeric[k]).value;});
    v.feeBase=byId('calcFeeBase').value;v.feeVat=byId('calcFeeVat').value;v.shippingFeeMode=byId('calcShipFeeMode').value;v.platform=byId('calcPlatform').value;
    return v;
  }
  function put(input){
    var d=MC.defaults(),v=Object.assign({},d,input||{});
    Object.keys(numeric).forEach(function(k){byId(numeric[k]).value=v[k]==null?'':v[k];});
    byId('calcFeeBase').value=v.feeBase;byId('calcFeeVat').value=v.feeVat;byId('calcShipFeeMode').value=v.shippingFeeMode;
    byId('calcPlatform').value=v.platform||'';
    byId('calcShippingType').value=Number(v.customerShipping)>0?'paid':'free';
    updateControls();render();
  }
  function updateControls(){
    byId('calcCustomerShipWrap').hidden=byId('calcShippingType').value!=='paid';
    byId('calcShipFeeRateWrap').hidden=mode!=='detailed'||byId('calcShipFeeMode').value!=='separate';
    document.querySelectorAll('[data-detail]').forEach(function(e){if(e.id!=='calcShipFeeRateWrap')e.hidden=mode!=='detailed';});
    document.querySelectorAll('[data-calc-mode]').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-calc-mode')===mode?'true':'false');});
  }
  function fact(label,value){var r=el('div');r.append(el('span','',label),el('strong','',value));return r;}

  // 광고비 차감 전: 1개 판매 주문의 상품 마진과, 그 안의 1개당 마진 · 주문당 비용.
  function render(){
    var calc=MC.calculate(raw()),ok=calc.ok,touched=byId('calcCost').value!==''||byId('calcFee').value!=='';
    byId('calcEmpty').hidden=ok;byId('calcResult').hidden=!ok;
    byId('calcError').textContent=touched&&!ok?Object.values(calc.errors)[0]||'입력값을 확인해 주세요.':'';
    byId('pmSave').disabled=!ok||!st.target;
    if(!ok)return null;
    var r=calc.result,split=S.splitMargin(calc.input,MC),facts=byId('calcFacts');
    byId('calcPostAd').textContent=MC.fmtWon(r.preAd);byId('calcPostAd').classList.toggle('deficit',r.preAd<0);
    facts.replaceChildren(
      fact('총 수입',MC.fmtWon(r.totalIncome)),fact('원가',MC.fmtWon(r.productCostTotal)),fact('수수료',MC.fmtWon(r.feeTotal)),
      fact('배송·포장·기타 (주문당)',MC.fmtWon(r.actualShipping+r.packaging+r.otherCost)),
      fact('상품 1개당 마진',split?MC.fmtWon(split.unitMargin):'—'),fact('주문당 비용·조정 (주문마다 한 번)',split?MC.fmtWon(split.orderAdjust):'—'),
      fact('손익분기 ROAS',r.breakevenRoas==null?'계산 불가':MC.fmtPct(r.breakevenRoas)));
    return {calc:calc,split:split};
  }

  // ---- 상품 목록: 최근 31일 Cafe24 주문 상품 + 이미 저장한 상품 ----
  function linkFor(productNo,variant){return st.links.find(function(l){return String(l.product_no)===String(productNo)&&(l.variant_code||'')===(variant||'');});}
  function overrides(productNo){return st.links.filter(function(l){return String(l.product_no)===String(productNo)&&l.variant_code;});}
  function buildProducts(orders){
    var map={},list=[];
    (orders||[]).forEach(function(o){(o.items||[]).forEach(function(i){
      if(i.product_no==null)return;
      var p=map[i.product_no]||(map[i.product_no]={product_no:i.product_no,name:i.product_name||('상품 번호 '+i.product_no),sold:0,price:null,variants:{}});
      var c=S.classifyItem(i),price=(Number(i.product_price)||0)+(Number(i.option_price)||0);
      p.sold+=c.sold;if(price>0)p.price=Number(i.product_price)||p.price;
      if(i.variant_code){var v=p.variants[i.variant_code]||(p.variants[i.variant_code]={variant_code:i.variant_code,option:i.option_value||i.variant_code,sold:0,price:null});v.sold+=c.sold;if(price>0)v.price=price;}
    });});
    st.links.forEach(function(l){if(!map[l.product_no])map[l.product_no]={product_no:l.product_no,name:l.cafe24_product_name||l.product_label,sold:0,price:null,variants:{}};});
    Object.keys(map).forEach(function(k){var p=map[k];p.variants=Object.keys(p.variants).map(function(v){return p.variants[v];}).sort(function(a,b){return b.sold-a.sold;});list.push(p);});
    return list.sort(function(a,b){return b.sold-a.sold;});
  }
  // 판매된 옵션 중 비용이 없는 것이 있으면 아직 설정이 남은 상품이다(상품 기본 값은 모든 옵션에 적용).
  function needsSetup(p){
    if(linkFor(p.product_no,''))return false;
    return !p.variants.length||p.variants.some(function(v){return v.sold>0&&!linkFor(p.product_no,v.variant_code);});
  }
  function status(p){
    var base=linkFor(p.product_no,''),ov=overrides(p.product_no).length;
    if(base)return '저장됨'+(ov?' · 옵션별 '+ov+'개':'');
    return needsSetup(p)?(ov?'옵션 일부만 저장':'비용 미입력'):'옵션별 저장됨';
  }
  function renderList(){
    var box=byId('pmList'),q=byId('pmSearch').value.trim().toLowerCase();box.replaceChildren();
    if(st.error){box.textContent=st.error;return;}
    if(!st.products){box.textContent='상품을 불러오는 중이에요.';return;}
    var shown=st.products.filter(function(p){return !q||p.name.toLowerCase().indexOf(q)>=0;});
    if(!shown.length){box.textContent=q?'검색 결과가 없어요.':'최근 '+RECENT_DAYS+'일 판매 상품이 없어요.';return;}
    shown.forEach(function(p){
      var b=el('button','pm-item'),s=status(p);b.type='button';
      b.append(el('strong','',p.name),el('small','',(p.sold?'최근 '+RECENT_DAYS+'일 판매 '+p.sold+'개':'최근 판매 없음')+(p.price?' · '+won(p.price):'')),el('span','pm-status'+(needsSetup(p)?' missing':''),s));
      b.addEventListener('click',function(){select(p,'');});
      box.appendChild(b);
    });
  }
  async function loadProducts(){
    var ctx=app.getContext(),id=++ticket;
    if(!ctx.userId||!ctx.storeId){st.products=[];st.error='쇼핑몰을 먼저 선택하세요.';renderList();return;}
    st.products=null;st.error='';renderList();
    var recs=await ctx.client.from('tool_records').select('id,tool_type,data,created_at').eq('user_id',ctx.userId).in('tool_type',[LINK,CALC]).order('created_at',{ascending:false}).limit(300);
    if(id!==ticket)return;
    var rows=recs.error?[]:recs.data||[],store=String(ctx.storeId);
    st.links=S.latestLinks(rows.filter(function(r){return r.tool_type===LINK&&String(r.data&&r.data.store_id)===store;}).map(function(r){return Object.assign({_id:r.id},r.data);}));
    st.linkIds=rows.filter(function(r){return r.tool_type===LINK&&String(r.data&&r.data.store_id)===store;}).map(function(r){return {id:r.id,key:r.data.product_no+'|'+(r.data.variant_code||'')};});
    st.calcs=rows.filter(function(r){return r.tool_type===CALC&&r.data&&r.data.input;}).map(function(r){return r.data;});
    var orders=[];
    if(ctx.cafeAccount&&ctx.cafeAccount.status==='connected'){
      var today=periods.kstDate(Date.now()),since=new Date(Date.parse(today+'T00:00:00Z')-(RECENT_DAYS-1)*86400000).toISOString().slice(0,10);
      var res=await ctx.client.functions.invoke('cafe24-order-items',{body:{store_id:ctx.storeId,start_date:since,end_date:today}});
      if(id!==ticket)return;
      if(res.error||!res.data||res.data.ok!==true)st.error='Cafe24 상품을 불러오지 못했어요. 연결 상태를 확인해 주세요.';
      else orders=res.data.orders||[];
    }else st.error='Cafe24를 연결하면 판매 상품을 고를 수 있어요.';
    st.products=buildProducts(orders);
    if(st.error&&st.products.length)st.error='';
    renderList();
    if(st.target)renderVariants();
  }

  // ---- 상품 선택 → 저장값 불러오기 ----
  function inputOf(link){
    if(!link)return null;
    if(link.input)return link.input;
    var at=Date.parse(link.source_saved_at),c=st.calcs.find(function(x){return Date.parse(x.saved_at)===at;});
    return c?c.input:null;
  }
  function select(p,variant){
    var v=variant?p.variants.find(function(x){return x.variant_code===variant;}):null;
    var own=linkFor(p.product_no,variant),base=linkFor(p.product_no,'');
    st.target={product:p,variant_code:variant||'',option:v?v.option:''};
    var input=Object.assign({},inputOf(own)||inputOf(base)||{});
    var price=v&&v.price||p.price;if(price)input.price=price; // 미리보기 판매가는 최근 Cafe24 주문 가격
    byId('calcProduct').value=p.name+(v?' · '+v.option:'');
    byId('pmFormTitle').textContent=v?'옵션별 비용':'상품 비용';
    byId('pmSelected').textContent=own?'저장된 값을 불러왔어요':variant&&base?'상품 기본 값에서 시작해요':'아직 저장 전이에요';
    byId('pmPicker').hidden=true;byId('pmEditor').hidden=false;byId('pmNext').hidden=true;
    put(input);say('');renderVariants();
    byId('pmEditor').scrollIntoView({block:'start'});
  }
  function renderVariants(){
    var box=byId('pmVariants'),t=st.target;box.replaceChildren();
    var wrap=byId('pmVariantsBox');wrap.hidden=!t||!t.product.variants.length;
    if(wrap.hidden)return;
    byId('pmVariantsCount').textContent='('+t.product.variants.length+')';
    t.product.variants.forEach(function(v){
      var own=linkFor(t.product.product_no,v.variant_code),row=el('div','pm-variant'+(t.variant_code===v.variant_code?' current':''));
      row.append(el('span','',v.option),el('small','',(v.sold?'판매 '+v.sold+'개 · ':'')+(own?'옵션별 저장됨':linkFor(t.product.product_no,'')?'상품 기본 적용':'미등록')));
      var b=el('button','inline-button',t.variant_code===v.variant_code?'편집 중':'이 옵션만 설정');b.type='button';b.disabled=t.variant_code===v.variant_code;
      b.addEventListener('click',function(){select(t.product,v.variant_code);});
      row.appendChild(b);box.appendChild(row);
    });
    if(t.variant_code){var back=el('button','inline-button','상품 기본으로 돌아가기');back.type='button';back.addEventListener('click',function(){select(t.product,'');});box.appendChild(back);}
  }

  async function save(){
    var ctx=app.getContext(),t=st.target,out=render();
    if(!t||!out||!ctx.userId)return;
    var now=new Date().toISOString(),name=t.product.name;
    var data={store_id:String(ctx.storeId),product_no:t.product.product_no,variant_code:t.variant_code,cafe24_product_name:name,
      product_label:String(name).trim().slice(0,40),unit_margin:out.split.unitMargin,order_adjust:out.split.orderAdjust,
      input:out.calc.input,source_saved_at:now,linked_at:now};
    // tool_records는 수정(UPDATE) 권한이 없다 — 새로 저장한 뒤 같은 상품 · 옵션의 이전 기록을 지운다.
    var key=t.product.product_no+'|'+t.variant_code,oldIds=(st.linkIds||[]).filter(function(x){return x.key===key;}).map(function(x){return x.id;});
    var btn=byId('pmSave');btn.disabled=true;
    var res=await ctx.client.from('tool_records').insert({user_id:ctx.userId,tool_type:LINK,data:data}).select('id').single();
    if(!res.error&&oldIds.length)await ctx.client.from('tool_records').delete().in('id',oldIds).eq('user_id',ctx.userId).eq('tool_type',LINK);
    btn.disabled=false;
    if(res.error){say('저장하지 못했어요. 다시 시도해 주세요.');return;}
    var saved=Object.assign({_id:res.data&&res.data.id},data);
    st.links=[saved].concat(st.links.filter(function(l){return l.product_no+'|'+(l.variant_code||'')!==key;}));
    st.linkIds=[{id:saved._id,key:key}].concat((st.linkIds||[]).filter(function(x){return x.key!==key;}));
    say((t.variant_code?t.option+' 옵션':'상품')+' 비용을 저장했어요. 운영 현황에 바로 반영돼요.');
    byId('pmSelected').textContent='저장된 값을 불러왔어요';
    renderVariants();renderList();
    var left=(st.products||[]).filter(needsSetup).length;
    byId('pmNextProduct').hidden=!left;byId('pmNextProduct').textContent='다음 미입력 상품 ('+left+'종 남음)';byId('pmNext').hidden=false;
    window.dispatchEvent(new CustomEvent('launchroas:product-margin-saved',{detail:{storeId:ctx.storeId}}));
  }

  function openPicker(){byId('pmPicker').hidden=false;byId('pmSearch').focus();if(!st.products)loadProducts();else renderList();}
  byId('pmPick').addEventListener('click',openPicker);
  byId('pmClose').addEventListener('click',function(){byId('pmPicker').hidden=true;});
  byId('pmSearch').addEventListener('input',renderList);
  byId('pmSave').addEventListener('click',save);
  byId('pmNextProduct').addEventListener('click',function(){var next=(st.products||[]).find(needsSetup);if(next)select(next,'');});
  byId('pmGoResult').addEventListener('click',function(){app.showView('overview');var p=document.querySelector('.sales-profit');if(p)p.scrollIntoView({block:'start'});});
  byId('calcForm').addEventListener('submit',function(e){e.preventDefault();});
  byId('calcForm').addEventListener('input',render);
  byId('calcForm').addEventListener('change',function(){updateControls();render();});
  byId('calcShippingType').addEventListener('change',function(){if(this.value==='free')byId('calcCustomerShip').value='0';});
  document.querySelectorAll('[data-calc-mode]').forEach(function(b){b.addEventListener('click',function(){mode=this.getAttribute('data-calc-mode');updateControls();});});
  // 운영 현황의 "마진 미등록 → 입력하기"에서 바로 상품 목록을 연다.
  window.addEventListener('launchroas:open-product-picker',function(){st.products=null;openPicker();});
  app.subscribe(function(ctx){
    var key=ctx.userId+'|'+ctx.storeId;
    if(key===st.key)return;
    st={key:key,products:null,links:[],calcs:[],error:'',target:null};ticket++;
    byId('pmEditor').hidden=true;byId('pmPicker').hidden=true;byId('pmNext').hidden=true;byId('pmSelected').textContent='';say('');
    byId('calcForm').reset();put({});
  });
  updateControls();render();
})();
