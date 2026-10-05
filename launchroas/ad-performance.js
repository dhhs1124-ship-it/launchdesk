(function(){
  'use strict';
  var app=window.LaunchRoasApp;
  if(!app)return;
  var list=document.getElementById('adPerformanceList');
  var message=document.getElementById('adPerformanceMessage');
  var more=document.getElementById('adPerformanceMore');
  var currentKey='',generation=0,accountCurrency='KRW',activeRange=null,marginLinks={},marginRecords=null,currentFx=null;
  function money(value){
    try{return new Intl.NumberFormat('ko-KR',{style:'currency',currency:accountCurrency,maximumFractionDigits:2}).format(Number(value)||0);}
    catch(e){return (accountCurrency+' '+(Number(value)||0).toLocaleString('ko-KR'));}
  }
  function number(value){return Number(value||0).toLocaleString('ko-KR');}
  function percent(value){return value==null?'—':Math.round(Number(value)*100).toLocaleString('ko-KR')+'%';}
  function element(tag,className,content){var el=document.createElement(tag);if(className)el.className=className;if(content!=null)el.textContent=content;return el;}
  function metric(label,value){var el=element('div','ad-perf-metric');el.append(element('span','',label),element('strong','',value));return el;}
  function won(value){return new Intl.NumberFormat('ko-KR').format(Math.round(Number(value)))+'원';}
  function savedDate(iso){
    if(!iso||!Number.isFinite(Date.parse(iso)))return '저장 시점 확인 불가';
    return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))+' 저장';
  }
  // 같은 상품명의 가장 최근 저장 계산이 연결 시점 이후의 것이고 주문당 광고 전 잔액이 다를 때만 갱신 필요로 본다.
  // 기록을 못 읽었거나, 연결 시점·비교할 기록이 없으면 판단하지 않는다(경과 시간은 보지 않는다).
  function newerMargin(link){
    var linkedAt=Date.parse(link.source_saved_at||'');
    if(!marginRecords||!Number.isFinite(linkedAt))return null;
    var label=String(link.product_label||'').trim();
    var latest=marginRecords.find(function(r){return r&&r.calc_version===2&&r.result&&Number.isFinite(Number(r.result.preAd))&&String(r.product_name||'').trim().slice(0,40)===label;});
    if(!latest||!(Date.parse(latest.saved_at||'')>=linkedAt))return null;
    return Math.round(Number(latest.result.preAd))!==Math.round(Number(link.pre_ad))?latest:null;
  }
  function marginSummary(adset,m){
    var link=marginLinks[String(adset.adset_id)],box=element('div','ad-margin-summary');
    if(!link){box.textContent='연결된 상품·마진 없음';return box;}
    // 외화 계정은 사용자가 저장한 환율로만 원화 환산한다(없으면 계산하지 않음).
    var spendKrw=window.LaunchRoasSales?window.LaunchRoasSales.adSpendKrw(m.spend||0,accountCurrency,currentFx):(accountCurrency==='KRW'?Number(m.spend||0):null);
    var observed=!!(m.purchase&&m.purchase.observed),computable=spendKrw!=null&&observed;
    var title=element('div','ad-margin-title');
    title.append(element('span','','광고 전환 기준 예상 잔액 (광고별 추정)'),element('strong','',computable?won(Number(link.pre_ad)*Number(m.purchase.value)-spendKrw):'계산 안 함'));
    box.append(title);
    box.append(element('small','',computable?'Meta가 집계한 구매 수로 계산 · 구매 '+number(m.purchase.value)+'건 × 주문당 광고 전 잔액 − 광고비 '+won(spendKrw)+(accountCurrency!=='KRW'?' (저장한 환율 적용)':'')
      :spendKrw==null?'광고비 환율을 저장하면 계산해요(실제 판매 기준 패널).':'Meta가 집계한 구매가 없어 계산하지 않았어요.'));
    if(computable)box.append(element('p','estimate-caution','취소·환불, 부가세·세금·고정비 미반영 · 확정 순이익 아님'));
    box.append(element('small','','사용한 마진 기준: '+link.product_label+' · 주문당 광고 전 잔액 '+won(link.pre_ad)+' · '+savedDate(link.source_saved_at)));
    var newer=newerMargin(link);
    if(newer)box.append(element('p','margin-stale','마진 기준 갱신 필요 · 같은 상품의 최근 저장 계산은 주문당 광고 전 잔액 '+won(newer.result.preAd)+'이에요. 상품·마진 연결에서 다시 연결해 주세요.'));
    if(computable)box.append(element('small','','광고별 주문 귀속은 Meta 전환 기준이라 실제 광고별 이익이 아니에요. Meta 구매에는 다른 상품 구매가 포함될 수 있어요.'));
    return box;
  }
  function params(ctx,scope,adsetId){var body={store_id:ctx.storeId,scope:scope,period:ctx.period.kind};if(ctx.period.kind==='date')body.date=ctx.period.date;if(adsetId)body.adset_id=adsetId;return body;}
  function valid(ctx,key){var latest=app.getContext();return key===currentKey && latest.userId===ctx.userId && latest.storeId===ctx.storeId && latest.period.kind===ctx.period.kind && latest.period.date===ctx.period.date;}
  function purchases(m){return m.purchase&&m.purchase.observed?number(m.purchase.value)+'건':'0건';}
  function verdictOf(link,m){return window.LaunchRoasSales?window.LaunchRoasSales.adVerdict(link,m):{label:'판단 보류',tone:'hold',reason:''};}
  function verdictBadge(v){
    var box=element('div','ad-verdict-box');box.appendChild(element('span','ad-verdict '+v.tone,v.label));
    if(v.reason)box.appendChild(element('small','',v.reason));return box;
  }
  function renderAd(ad,adset,ctx,key){
    var m=ad.metrics||{},card=element('div','ad-item'),heading=element('div','ad-item-heading');
    heading.append(element('strong','',ad.ad_name||'이름 없는 광고'),element('span','','Meta 구매 '+purchases(m)+' · 링크 클릭 '+number(m.link_clicks)));
    var stats=element('div','ad-perf-stats');
    stats.append(metric('광고비',money(m.spend)),metric('ROAS',percent(m.roas)),verdictBadge(verdictOf(marginLinks[String(adset.adset_id)],m)));
    var button=element('button','secondary','상품·마진 연결 →');button.type='button';
    button.addEventListener('click',function(){
      if(!valid(ctx,key))return;
      app.openCalculatorFromAd({adId:ad.ad_id,adsetId:adset.adset_id,adName:ad.ad_name||'이름 없는 광고',spend:Number(m.spend)||0,
        purchase:m.purchase&&m.purchase.observed?Number(m.purchase.value):null,currency:accountCurrency,
        range:activeRange,storeId:ctx.storeId});
    });
    card.append(heading,stats,button);return card;
  }
  function renderAdset(adset,campaign,ctx,key){
    var row=element('article','adset-row'),head=element('div','adset-head'),name=element('div','adset-name');
    name.append(element('small','',campaign.campaign_name||'캠페인'),element('strong','',adset.adset_name||'이름 없는 광고 세트'));
    var m=adset.metrics||{},link=marginLinks[String(adset.adset_id)],verdict=verdictOf(link,m);
    // 먼저 보이는 줄: 광고비 · ROAS · 판단. 나머지는 "자세히"를 눌렀을 때.
    var stats=element('div','ad-perf-stats adset-summary');
    stats.append(metric('광고비',money(m.spend)),metric('ROAS',percent(m.roas)),verdictBadge(verdict));
    var more=element('button','adset-more','자세히 ↓');more.type='button';more.setAttribute('aria-expanded','false');
    var extra=element('div','adset-extra');extra.hidden=true;
    more.addEventListener('click',function(){extra.hidden=!extra.hidden;more.textContent=extra.hidden?'자세히 ↓':'접기 ↑';more.setAttribute('aria-expanded',extra.hidden?'false':'true');});
    var facts=element('div','ad-perf-stats');
    facts.append(metric('Meta 구매',purchases(m)),metric('링크 클릭',number(m.link_clicks)),
      metric('손익분기 ROAS',verdict.breakeven?percent(verdict.breakeven):link&&Number(link.pre_ad)>0&&Number(link.total_income)>0?percent(Number(link.total_income)/Number(link.pre_ad)):'—'));
    var button=element('button','adset-toggle','광고 보기 ↓');button.type='button';button.setAttribute('aria-expanded','false');
    var details=element('div','adset-details');details.hidden=true;
    button.addEventListener('click',async function(){
      if(!valid(ctx,key))return;
      if(!details.hidden){details.hidden=true;button.textContent='광고 보기 ↓';button.setAttribute('aria-expanded','false');return;}
      details.hidden=false;button.textContent='광고 닫기 ↑';button.setAttribute('aria-expanded','true');
      if(details.dataset.loaded)return;
      details.textContent='광고별 성과를 불러오는 중이에요.';button.disabled=true;
      try{
        var response=await ctx.client.functions.invoke('meta-adset-insights',{body:params(ctx,'ads',adset.adset_id)});
        if(!valid(ctx,key)||details.hidden)return;
        if(response.error||!response.data||response.data.ok!==true){details.textContent='광고 성과 조회에 실패했어요. 연결 상태를 확인한 뒤 다시 열어 주세요.';return;}
        var data=response.data;details.replaceChildren();
        if(data.truncated){details.textContent='조회 한도를 넘어서 일부 광고가 누락됐어요. 이 결과로 마진을 계산하지 마세요.';return;}
        if(!data.ads||!data.ads.length){details.textContent='선택 기간에 성과가 잡힌 광고가 없어요.';details.dataset.loaded='true';return;}
        data.ads.slice().sort(function(a,b){return Number(b.metrics&&b.metrics.spend||0)-Number(a.metrics&&a.metrics.spend||0);})
          .forEach(function(ad){details.appendChild(renderAd(ad,adset,ctx,key));});
        details.dataset.loaded='true';
      }catch(e){if(valid(ctx,key))details.textContent='광고 성과 조회에 실패했어요.';}
      finally{button.disabled=false;}
    });
    var connect=element('button','adset-connect','상품·마진 연결 →');connect.type='button';
    connect.addEventListener('click',function(){
      if(!valid(ctx,key))return;
      app.openCalculatorFromAd({adId:adset.adset_id,adsetId:adset.adset_id,adName:(campaign.campaign_name||'캠페인')+' · '+(adset.adset_name||'광고 세트'),spend:Number(m.spend)||0,
        purchase:m.purchase&&m.purchase.observed?Number(m.purchase.value):null,currency:accountCurrency,
        range:activeRange,storeId:ctx.storeId});
    });
    var actions=element('div','adset-actions');actions.append(connect,button);
    extra.append(facts,element('small','adset-basis','판단 기준: Meta ROAS와 연결한 상품 마진의 손익분기 ROAS(총 수입 ÷ 광고 전 잔액) 비교 · Meta 구매 '+(window.LaunchRoasSales?window.LaunchRoasSales.MIN_PURCHASES:3)+'건 이상일 때만'),
      marginSummary(adset,m),actions,details);
    head.append(name,more);row.append(head,stats,extra);return row;
  }
  more.addEventListener('click',function(){
    var expanded=this.getAttribute('aria-expanded')!=='true';
    this.setAttribute('aria-expanded',expanded?'true':'false');
    this.textContent=expanded?'광고 세트 접기 ↑':'광고 세트 전체 보기 ↓';
    Array.from(list.children).forEach(function(row,index){row.hidden=!expanded&&index>=3;});
  });
  app.subscribe(async function(ctx){
    var key=ctx.userId+'|'+ctx.storeId+'|'+(ctx.metaAccount&&ctx.metaAccount.id)+'|'+ctx.period.kind+'|'+(ctx.period.date||'')+'|'+JSON.stringify(ctx.fx||null);
    if(key===currentKey)return;
    currentKey=key;currentFx=ctx.fx||null;var id=++generation;list.replaceChildren();marginLinks={};marginRecords=null;more.hidden=true;more.setAttribute('aria-expanded','false');more.textContent='광고 세트 전체 보기 ↓';
    if(!ctx.userId||!ctx.storeId){message.textContent='쇼핑몰을 선택하면 광고별 성과를 볼 수 있어요.';return;}
    if(!ctx.metaAccount||ctx.metaAccount.status!=='connected'){message.textContent='Meta 광고계정을 연결하면 광고별 성과가 표시돼요.';return;}
    message.textContent='광고별 성과를 불러오는 중이에요.';
    try{
      var response=await ctx.client.functions.invoke('meta-adset-insights',{body:params(ctx,'adsets')});
      if(id!==generation||!valid(ctx,key))return;
      if(response.error||!response.data||response.data.ok!==true){message.textContent='광고별 성과를 불러오지 못했어요. Meta 연결을 확인해 주세요.';return;}
      var data=response.data;accountCurrency=String(data.account&&data.account.currency||'KRW').toUpperCase();activeRange=data.range;
      if(data.truncated){message.textContent='조회 한도를 넘어 일부 광고 세트가 누락됐어요. 이 기간의 광고별 성과를 계산에 사용하지 마세요.';return;}
      var loaded=await Promise.all([
        ctx.client.from('ad_margin_links').select('meta_adset_id,product_label,pre_ad,total_income,source_saved_at').eq('store_id',ctx.storeId),
        ctx.client.from('tool_records').select('data').eq('user_id',ctx.userId).eq('tool_type','margin_calc').order('created_at',{ascending:false}).limit(100)
      ]),linked=loaded[0];
      if(id!==generation||!valid(ctx,key))return;
      if(linked.error){message.textContent='저장된 광고·마진 연결을 불러오지 못했어요. 연결 상태를 확인해 주세요.';return;}
      (linked.data||[]).forEach(function(row){marginLinks[String(row.meta_adset_id)]=row;});
      if(!loaded[1].error)marginRecords=(loaded[1].data||[]).map(function(row){return row.data;});
      var rows=[];(data.campaigns||[]).forEach(function(campaign){(campaign.adsets||[]).forEach(function(adset){rows.push({adset:adset,campaign:campaign});});});
      rows.sort(function(a,b){return Number(b.adset.metrics&&b.adset.metrics.spend||0)-Number(a.adset.metrics&&a.adset.metrics.spend||0);});
      rows.forEach(function(row,index){var el=renderAdset(row.adset,row.campaign,ctx,key);el.hidden=index>=3;list.appendChild(el);});
      var count=rows.length;
      more.hidden=count<=3;if(count>3)more.textContent='광고 세트 전체 '+count+'개 보기 ↓';
      message.textContent=count?'광고 세트 '+count+'개':'선택 기간에 성과가 잡힌 광고 세트가 없어요.';
    }catch(e){if(id===generation&&valid(ctx,key))message.textContent='광고별 성과 조회 중 오류가 발생했어요.';}
  });
  window.addEventListener('launchroas:margin-linked',function(event){
    if(String(event.detail.storeId)!==String(app.getContext().storeId))return;
    currentKey='';app.selectStore(app.getContext().storeId);
  });
})();
