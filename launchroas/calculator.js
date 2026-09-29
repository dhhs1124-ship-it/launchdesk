(function(){
  'use strict';
  var app=window.LaunchRoasApp, MC=window.launchdeskMarginCalc, Campaign=window.LaunchRoasCampaign;
  if(!app||!MC)return;
  var byId=function(id){return document.getElementById(id);}, mode='simple', adChoice='none', history=[], owner=null, stamp=0;
  var lastCalculation=null, exampleSnapshot=null, selectedExample='';
  var linkedAd=null,linkEpoch=0,savedLink=null,userPicked=false;
  var numeric={price:'calcPrice',qty:'calcQty',unitCost:'calcCost',sellerDiscount:'calcDiscount',customerShipping:'calcCustomerShip',actualShipping:'calcActualShip',packaging:'calcPackaging',otherCost:'calcOther',feeRate:'calcFee',pgRate:'calcPgRate',shippingFeeRate:'calcShipFeeRate',adRate:'calcAdRate',adAmount:'calcAdAmount',targetProfit:'calcTarget'};
  function raw(){
    var v={};Object.keys(numeric).forEach(function(key){v[key]=byId(numeric[key]).value;});
    v.feeBase=byId('calcFeeBase').value;v.feeVat=byId('calcFeeVat').value;v.shippingFeeMode=byId('calcShipFeeMode').value;v.platform=byId('calcPlatform').value;
    v.adMode=adChoice==='custom'?byId('calcAdKind').value:adChoice==='none'?'none':'rate';
    if(adChoice!=='custom'&&adChoice!=='none')v.adRate=adChoice;
    return v;
  }
  function put(values){
    Object.keys(numeric).forEach(function(key){var v=values[key];byId(numeric[key]).value=v==null?'':v;});
    ['feeBase','feeVat','shippingFeeMode'].forEach(function(key){byId({feeBase:'calcFeeBase',feeVat:'calcFeeVat',shippingFeeMode:'calcShipFeeMode'}[key]).value=values[key]||MC.defaults()[key];});
    byId('calcPlatform').value=values.platform||'';
    adChoice=values.adMode==='none'?'none':'custom';
    if(values.adMode==='rate'&&[6,10,20].indexOf(Number(values.adRate))>=0)adChoice=String(values.adRate);
    byId('calcAdKind').value=values.adMode==='amount'?'amount':'rate';
    byId('calcShippingType').value=Number(values.customerShipping)>0?'paid':'free';
    updateControls();renderPlatformHelp();render();
  }
  function addFact(label,value){var row=document.createElement('div');var l=document.createElement('span');l.textContent=label;var v=document.createElement('strong');v.textContent=value;row.append(l,v);return row;}
  function render(){
    byId('campaignTitle').textContent=(byId('calcProduct').value.trim()||'A상품')+' 광고 손익';
    var result=MC.calculate(raw()), touched=byId('calcPrice').value!==''||byId('calcCost').value!==''||byId('calcFee').value!=='';
    lastCalculation=result.ok?result:null;
    byId('calcEmpty').hidden=!!lastCalculation;
    byId('calcResult').hidden=!lastCalculation;
    byId('calcError').textContent=touched&&!result.ok?Object.values(result.errors)[0]||'입력값을 확인해 주세요.':'';
    if(!lastCalculation){byId('campaignResult').textContent='판매가·원가·수수료를 입력하면 광고 손익을 계산할 수 있어요.';return;}
    var r=result.result, facts=byId('calcFacts');facts.replaceChildren();
    byId('calcPostAd').textContent=MC.fmtWon(r.postAd);byId('calcPostAd').classList.toggle('deficit',r.postAd<0);
    facts.append(addFact('총 수입',MC.fmtWon(r.totalIncome)),addFact('원가',MC.fmtWon(r.productCostTotal)),
      addFact('판매·배송비·PG 수수료',MC.fmtWon(r.feeTotal)),addFact('배송·포장·기타 비용',MC.fmtWon(r.actualShipping+r.packaging+r.otherCost)),
      addFact('광고 전 예상 잔액',MC.fmtWon(r.preAd)),addFact('주문당 광고비',MC.fmtWon(r.adCost)),
      addFact('광고 후 예상 잔액률',MC.fmtPct(r.ratio)),
      addFact('광고 전 손익분기 ROAS',r.breakevenRoas==null?'계산 불가':MC.fmtPct(r.breakevenRoas)));
    if(r.adRoom!==null)facts.appendChild(addFact('목표 잔액을 남길 수 있는 광고비',MC.fmtWon(r.adRoom)));
    renderCampaign();
  }
  function renderCampaign(){
    var box=byId('campaignResult');box.replaceChildren();
    if(!lastCalculation)return;
    var spend=MC.toNum(byId('campaignSpend').value),orders=MC.toNum(byId('campaignOrders').value);
    if(spend===null||orders===null){box.textContent='광고비 총액과 광고로 발생한 주문 수를 모두 입력해 주세요.';return;}
    if(spend<0||orders<0||!Number.isInteger(orders)){box.textContent='광고비는 0원 이상, 주문 수는 0 이상의 정수로 입력해 주세요.';return;}
    var unit=lastCalculation.result.preAd, scenario=Campaign.calculate(unit,spend,orders);
    box.append(addFact('선택 상품 판매가',MC.fmtWon(lastCalculation.input.price)),addFact('광고 전 주문당 예상 잔액',MC.fmtWon(unit)),addFact('적용한 전환·주문 수',orders.toLocaleString('ko-KR')+'건'),
      addFact('주문당 실제 광고비 (CPA)',orders?MC.fmtWon(scenario.acquisitionCost):'주문 0건'),addFact('광고 후 전체 예상 잔액',MC.fmtWon(scenario.estimatedBalance)));
    if(unit>0)box.appendChild(addFact('손익분기 주문 수',scenario.breakevenOrders.toLocaleString('ko-KR')+'건'));
    else box.appendChild(addFact('손익분기 주문 수','상품 기본 비용부터 조정 필요'));
    if(!byId('linkedAdNotice').hidden){var caution=document.createElement('p');caution.className='small';caution.textContent='주의: Meta 전환에는 광고를 클릭한 뒤 다른 상품을 구매한 건도 포함될 수 있어요. 해당 상품의 실제 주문 수가 다르면 위 수치를 수정하세요. 부가세·세금·미입력 고정비 전의 추정 잔액입니다.';box.appendChild(caution);}
    box.classList.toggle('deficit',scenario.estimatedBalance<0);
  }
  function renderPlatformHelp(){
    var info=MC.PLATFORM_GUIDE[byId('calcPlatform').value];
    byId('calcPlatformHelp').textContent=info
      ? info.name+' · '+info.composition.join(' ')+' 판매자센터나 계약서에서 실제 요율과 부가세 포함 여부를 확인해 입력하세요.'
      : '판매자센터나 계약서에 표시된 수수료율을 직접 확인해 입력하세요.';
  }
  function updateControls(){
    byId('calcCustomerShipWrap').hidden=byId('calcShippingType').value!=='paid';
    byId('calcShipFeeRateWrap').hidden=mode!=='detailed'||byId('calcShipFeeMode').value!=='separate';
    document.querySelectorAll('[data-detail]').forEach(function(el){if(el.id!=='calcShipFeeRateWrap')el.hidden=mode!=='detailed';});
    document.querySelectorAll('[data-calc-mode]').forEach(function(btn){btn.setAttribute('aria-pressed',btn.getAttribute('data-calc-mode')===mode?'true':'false');});
    document.querySelectorAll('[data-calc-ad]').forEach(function(btn){btn.setAttribute('aria-pressed',btn.getAttribute('data-calc-ad')===adChoice?'true':'false');});
    byId('calcAdCustom').hidden=adChoice!=='custom';
    byId('calcAdRateWrap').hidden=byId('calcAdKind').value!=='rate';byId('calcAdAmountWrap').hidden=byId('calcAdKind').value!=='amount';
  }
  function historyRow(item){
    var row=document.createElement('div');row.className='history-row';var text=document.createElement('div');
    var title=document.createElement('strong'), sub=document.createElement('small');
    if(item.calc_version===2&&item.input&&item.result){
      title.textContent=(item.product_name||'상품')+' · '+MC.fmtWon(item.input.price)+' × '+(item.input.qty||1);
      sub.textContent=(item.date||'')+' · 광고비 '+MC.fmtWon(item.result.adCost||0)+' · 예상 잔액 '+MC.fmtWon(item.result.postAd);
      var load=document.createElement('button');load.type='button';load.className='inline-button';load.textContent='불러오기';
      load.addEventListener('click',function(){if(!window.confirm('현재 입력값을 이 기록으로 바꿀까요?'))return;byId('calcProduct').value=item.product_name||'';put(Object.assign({},item.input,{platform:item.platform||''}));byId('campaignSpend').value=item.campaign&&item.campaign.spend!=null?item.campaign.spend:'';byId('campaignOrders').value=item.campaign&&item.campaign.orders!=null?item.campaign.orders:'';render();});
      text.append(title,sub);row.append(text,load);
    }else{
      title.textContent='이전 계산 방식 · '+MC.fmtWon(item.price);sub.textContent=(item.date||'')+' · '+MC.fmtWon(item.profit)+' (불러오기 미지원)';text.append(title,sub);row.appendChild(text);
    }
    return row;
  }
  function savedItems(){return history.filter(function(item){return item.calc_version===2&&item.input&&item.result&&Number.isFinite(Number(item.result.preAd))&&Number.isFinite(Number(item.input.price));});}
  function renderSavedProducts(){
    var select=byId('savedProduct'),previous=select.value;select.replaceChildren();
    var empty=document.createElement('option');empty.value='';empty.textContent='직접 입력하거나 저장한 상품을 선택하세요';select.appendChild(empty);
    savedItems().forEach(function(item,index){var option=document.createElement('option');option.value=String(index);option.textContent=(item.product_name||'이름 없는 상품')+' · 판매가 '+MC.fmtWon(item.input.price)+' · 주문당 광고 전 '+MC.fmtWon(item.result.preAd);select.appendChild(option);});
    select.value=previous;
  }
  function selectSavedProduct(index){
    var item=savedItems()[index];if(!item)return;
    byId('calcProduct').value=item.product_name||'';
    put(Object.assign({},item.input,{platform:item.platform||''}));
    byId('savedProductInfo').textContent='선택 상품: '+(item.product_name||'이름 없는 상품')+' · 판매가 '+MC.fmtWon(item.input.price)+' · 주문당 광고 전 예상 잔액 '+MC.fmtWon(item.result.preAd)+' (저장한 계산 기준)';
    renderCampaign();
  }
  function restoreSavedLink(){
    if(!linkedAd||!savedLink||userPicked)return;
    var index=savedItems().findIndex(function(item){return item.saved_at===savedLink.source_saved_at&&item.product_name===savedLink.product_label;});
    if(index<0){byId('savedProductInfo').textContent='이 광고 세트에 연결된 계산 기록을 찾지 못했어요. 저장한 상품을 다시 선택해 주세요.';return;}
    byId('savedProduct').value=String(index);selectSavedProduct(index);
  }
  function renderHistory(){var box=byId('calcHistory');box.replaceChildren();renderSavedProducts();if(!history.length){box.textContent='아직 저장한 계산이 없어요.';return;}history.slice(0,5).forEach(function(item){box.appendChild(historyRow(item));});}
  app.subscribe(async function(ctx){
    if(ctx.userId===owner)return;
    owner=ctx.userId;history=[];linkedAd=null;savedLink=null;linkEpoch++;renderHistory();byId('saveProductLink').hidden=true;
    byId('calcForm').reset();byId('campaignSpend').value='';byId('campaignOrders').value='';byId('linkedAdNotice').hidden=true;
    byId('linkedAdNotice').textContent='';adChoice='none';mode='simple';selectedExample='';exampleSnapshot=null;
    byId('calcExample').value='';byId('calcExampleExit').hidden=true;byId('calcExampleNote').textContent='';byId('calcSave').disabled=false;
    updateControls();renderPlatformHelp();render();
    var id=++stamp;if(!owner)return;
    var result=await ctx.client.from('tool_records').select('data,created_at').eq('user_id',owner).eq('tool_type','margin_calc').order('created_at',{ascending:false}).limit(100);
    if(id!==stamp)return;
    if(result.error){byId('calcHistory').textContent='계산 기록을 불러오지 못했어요.';return;}
    history=(result.data||[]).map(function(row){return row.data;}).filter(function(row){return !!row;});renderHistory();restoreSavedLink();
  });
  byId('calcForm').addEventListener('submit',function(event){event.preventDefault();});
  byId('calcForm').addEventListener('input',render);
  byId('calcForm').addEventListener('change',function(){updateControls();render();});
  byId('calcPlatform').addEventListener('change',renderPlatformHelp);
  byId('calcShippingType').addEventListener('change',function(){if(this.value==='free')byId('calcCustomerShip').value='0';});
  ['campaignSpend','campaignOrders'].forEach(function(id){byId(id).addEventListener('input',renderCampaign);});
  byId('savedProduct').addEventListener('change',function(){
    userPicked=true;byId('saveProductLink').hidden=!linkedAd||this.value==='';
    if(this.value===''){byId('savedProductInfo').textContent='상품 조건을 직접 입력하세요.';return;}
    selectSavedProduct(Number(this.value));
  });
  byId('saveProductLink').addEventListener('click',async function(){
    var ctx=app.getContext(),index=Number(byId('savedProduct').value),item=savedItems()[index],ad=linkedAd;
    if(!ad||!item||!item.saved_at||!ctx.userId||String(ctx.storeId)!==String(ad.storeId))return;
    if(!Number.isFinite(Number(item.result.totalIncome))||!Number.isFinite(Number(item.result.preAd)))return;
    this.disabled=true;var token=linkEpoch;
    var payload={store_id:ctx.storeId,meta_adset_id:String(ad.adsetId),product_label:(item.product_name||'상품').trim().slice(0,40),
      calc_version:2,currency:'KRW',total_income:item.result.totalIncome,pre_ad:item.result.preAd,source_saved_at:item.saved_at};
    var response=await ctx.client.from('ad_margin_links').upsert(payload,{onConflict:'store_id,meta_adset_id'});
    if(token!==linkEpoch||!ctx.userId||ctx.userId!==app.getContext().userId)return;
    this.disabled=false;
    byId('savedProductInfo').textContent=response.error?'연결을 저장하지 못했어요. 광고 세트 연결 기능 설정을 확인해 주세요.':'상품 연결을 저장했어요. 다음에 이 광고 세트를 열면 저장한 계산을 불러옵니다.';
    if(!response.error)savedLink={source_saved_at:item.saved_at,product_label:payload.product_label};
  });
  window.addEventListener('launchroas:ad-selection',function(event){
    var ad=event.detail,ctx=app.getContext();
    if(!ad||!ctx.userId||String(ctx.storeId)!==String(ad.storeId))return;
    var krw=String(ad.currency).toUpperCase()==='KRW';
    linkedAd=ad.adsetId?ad:null;savedLink=null;userPicked=false;var token=++linkEpoch;
    byId('saveProductLink').hidden=true;
    byId('calcForm').reset();adChoice='none';selectedExample='';byId('calcSave').disabled=false;updateControls();
    byId('campaignSpend').value=krw?String(ad.spend):'';
    byId('campaignOrders').value=ad.purchase==null?'':String(ad.purchase);
    byId('savedProduct').value='';
    byId('savedProductInfo').textContent='저장한 상품 계산을 선택하면 판매가·원가·주문당 광고 전 예상 잔액을 불러옵니다.';
    var range=ad.range&&ad.range.since&&ad.range.until?ad.range.since+' ~ '+ad.range.until:'선택 기간';
    var note=byId('linkedAdNotice');note.hidden=false;
    note.textContent='선택한 광고: '+ad.adName+' · '+range+' · '+(krw?'광고비 '+MC.fmtWon(ad.spend)+' 자동 입력됨.':'Meta 광고비 '+Number(ad.spend).toLocaleString('ko-KR')+' '+ad.currency+'. 원화 환산 금액을 확인해 광고비 총액 칸에 직접 입력해 주세요.')+' Meta 전환 '+(ad.purchase==null?'측정 안 됨':ad.purchase+'건')+(ad.purchase==null?'은 직접 입력해 주세요.':'을 기본값으로 넣었어요. 다른 상품 구매가 포함됐다면 수정하세요.');
    if(savedItems().length===1){byId('savedProduct').value='0';selectSavedProduct(0);byId('saveProductLink').hidden=!linkedAd;}
    if(linkedAd){
      ctx.client.from('ad_margin_links').select('product_label,source_saved_at').eq('store_id',ctx.storeId).eq('meta_adset_id',String(ad.adsetId)).maybeSingle().then(function(response){
        if(token!==linkEpoch||String(app.getContext().storeId)!==String(ad.storeId)||response.error)return;
        savedLink=response.data;restoreSavedLink();
      });
    }
    render();
  });
  document.querySelectorAll('[data-calc-mode]').forEach(function(btn){btn.addEventListener('click',function(){mode=this.getAttribute('data-calc-mode');updateControls();render();});});
  document.querySelectorAll('[data-calc-ad]').forEach(function(btn){btn.addEventListener('click',function(){adChoice=this.getAttribute('data-calc-ad');updateControls();render();});});
  var examples=byId('calcExample');MC.EXAMPLES.forEach(function(ex){var option=document.createElement('option');option.value=ex.key;option.textContent=ex.title;examples.appendChild(option);});
  examples.addEventListener('change',function(){
    var ex=MC.EXAMPLES.find(function(item){return item.key===examples.value;});if(!ex)return;
    if(!exampleSnapshot)exampleSnapshot={values:raw(),product:byId('calcProduct').value,spend:byId('campaignSpend').value,orders:byId('campaignOrders').value};
    selectedExample=ex.key;byId('calcProduct').value='예시 · '+ex.title;put(ex.input);
    byId('calcExampleNote').textContent=ex.note;byId('calcExampleExit').hidden=false;byId('calcSave').disabled=true;
  });
  byId('calcExampleExit').addEventListener('click',function(){
    if(!exampleSnapshot)return;selectedExample='';byId('calcProduct').value=exampleSnapshot.product;put(exampleSnapshot.values);
    byId('campaignSpend').value=exampleSnapshot.spend;byId('campaignOrders').value=exampleSnapshot.orders;exampleSnapshot=null;examples.value='';
    byId('calcExampleNote').textContent='';this.hidden=true;byId('calcSave').disabled=false;render();
  });
  byId('calcSave').addEventListener('click',async function(){
    var ctx=app.getContext();if(!ctx.userId||selectedExample)return;
    var calc=MC.calculate(raw());if(!calc.ok){render();return;}
    var r=calc.result, record={calc_version:MC.CALC_VERSION,date:new Date().toLocaleString('ko-KR'),saved_at:new Date().toISOString(),
      product_name:byId('calcProduct').value.trim(),platform:byId('calcPlatform').value||null,input:calc.input,
      result:{totalIncome:r.totalIncome,productFee:r.productFee,shippingFee:r.shippingFee,pgFee:r.pgFee,feeTotal:r.feeTotal,preAd:r.preAd,adMode:r.adMode,adRate:r.adRate,adCost:r.adCost,postAd:r.postAd,ratio:r.ratio},
      campaign:{spend:MC.toNum(byId('campaignSpend').value),orders:MC.toNum(byId('campaignOrders').value)}};
    this.disabled=true;var result=await ctx.client.from('tool_records').insert({user_id:ctx.userId,tool_type:'margin_calc',data:record});this.disabled=false;
    if(ctx.userId!==app.getContext().userId)return;
    if(result.error){byId('calcError').textContent='계산 기록을 저장하지 못했어요.';return;}
    history.unshift(record);history=history.slice(0,5);renderHistory();byId('calcError').textContent='계산 결과를 저장했어요.';
  });
  byId('calcClear').addEventListener('click',async function(){
    if(!history.length||!window.confirm('저장한 계산 기록을 전부 지울까요? 되돌릴 수 없어요.'))return;
    var ctx=app.getContext();if(!ctx.userId)return;
    var result=await ctx.client.from('tool_records').delete().eq('user_id',ctx.userId).eq('tool_type','margin_calc');
    if(ctx.userId!==app.getContext().userId)return;
    if(result.error){byId('calcError').textContent='기록을 지우지 못했어요.';return;}
    history=[];renderHistory();
  });
  updateControls();renderPlatformHelp();render();renderHistory();
})();
