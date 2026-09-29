(function(){
  'use strict';
  var app=window.LaunchRoasApp;
  if(!app)return;
  var list=document.getElementById('adPerformanceList');
  var message=document.getElementById('adPerformanceMessage');
  var currentKey='',generation=0,accountCurrency='KRW',activeRange=null;
  function money(value){
    try{return new Intl.NumberFormat('ko-KR',{style:'currency',currency:accountCurrency,maximumFractionDigits:2}).format(Number(value)||0);}
    catch(e){return (accountCurrency+' '+(Number(value)||0).toLocaleString('ko-KR'));}
  }
  function number(value){return Number(value||0).toLocaleString('ko-KR');}
  function percent(value){return value==null?'—':Math.round(Number(value)*100).toLocaleString('ko-KR')+'%';}
  function element(tag,className,content){var el=document.createElement(tag);if(className)el.className=className;if(content!=null)el.textContent=content;return el;}
  function metric(label,value){var el=element('div','ad-perf-metric');el.append(element('span','',label),element('strong','',value));return el;}
  function params(ctx,scope,adsetId){var body={store_id:ctx.storeId,scope:scope,period:ctx.period.kind};if(ctx.period.kind==='date')body.date=ctx.period.date;if(adsetId)body.adset_id=adsetId;return body;}
  function valid(ctx,key){var latest=app.getContext();return key===currentKey && latest.userId===ctx.userId && latest.storeId===ctx.storeId && latest.period.kind===ctx.period.kind && latest.period.date===ctx.period.date;}
  function renderAd(ad,adset,ctx,key){
    var m=ad.metrics||{},card=element('div','ad-item'),heading=element('div','ad-item-heading');
    heading.append(element('strong','',ad.ad_name||'이름 없는 광고'),element('span','',adset.adset_name||'광고 세트'));
    var stats=element('div','ad-perf-stats');
    stats.append(metric('광고비',money(m.spend)),metric('Meta 구매',m.purchase&&m.purchase.observed?number(m.purchase.value)+'건':'측정 안 됨'),metric('ROAS',percent(m.roas)),metric('링크 클릭',number(m.link_clicks)));
    var button=element('button','secondary','마진 계산 연결 →');button.type='button';button.disabled=accountCurrency!=='KRW';
    button.title=button.disabled?'원화 계정의 광고비만 계산기에 자동 입력할 수 있어요.':'';
    button.addEventListener('click',function(){
      if(!valid(ctx,key))return;
      app.openCalculatorFromAd({adId:ad.ad_id,adName:ad.ad_name||'이름 없는 광고',spend:Number(m.spend)||0,
        purchase:m.purchase&&m.purchase.observed?Number(m.purchase.value):null,currency:accountCurrency,
        range:activeRange,storeId:ctx.storeId});
    });
    card.append(heading,stats,button);return card;
  }
  function renderAdset(adset,campaign,ctx,key){
    var row=element('article','adset-row'),head=element('div','adset-head'),name=element('div','adset-name');
    name.append(element('small','',campaign.campaign_name||'캠페인'),element('strong','',adset.adset_name||'이름 없는 광고 세트'));
    var stats=element('div','ad-perf-stats'),m=adset.metrics||{};
    stats.append(metric('광고비',money(m.spend)),metric('Meta 구매',m.purchase&&m.purchase.observed?number(m.purchase.value)+'건':'측정 안 됨'),metric('ROAS',percent(m.roas)),metric('링크 클릭',number(m.link_clicks)));
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
    head.append(name,button);row.append(head,stats,details);return row;
  }
  app.subscribe(async function(ctx){
    var key=ctx.userId+'|'+ctx.storeId+'|'+(ctx.metaAccount&&ctx.metaAccount.id)+'|'+ctx.period.kind+'|'+(ctx.period.date||'');
    if(key===currentKey)return;
    currentKey=key;var id=++generation;list.replaceChildren();
    if(!ctx.userId||!ctx.storeId){message.textContent='쇼핑몰을 선택하면 광고별 성과를 볼 수 있어요.';return;}
    if(!ctx.metaAccount||ctx.metaAccount.status!=='connected'){message.textContent='Meta 광고계정을 연결하면 광고별 성과가 표시돼요.';return;}
    message.textContent='광고별 성과를 불러오는 중이에요.';
    try{
      var response=await ctx.client.functions.invoke('meta-adset-insights',{body:params(ctx,'adsets')});
      if(id!==generation||!valid(ctx,key))return;
      if(response.error||!response.data||response.data.ok!==true){message.textContent='광고별 성과를 불러오지 못했어요. Meta 연결을 확인해 주세요.';return;}
      var data=response.data;accountCurrency=data.account&&data.account.currency||'KRW';activeRange=data.range;
      if(data.truncated){message.textContent='조회 한도를 넘어 일부 광고 세트가 누락됐어요. 이 기간의 광고별 성과를 계산에 사용하지 마세요.';return;}
      var rows=[];(data.campaigns||[]).forEach(function(campaign){(campaign.adsets||[]).forEach(function(adset){rows.push({adset:adset,campaign:campaign});});});
      rows.sort(function(a,b){return Number(b.adset.metrics&&b.adset.metrics.spend||0)-Number(a.adset.metrics&&a.adset.metrics.spend||0);});
      rows.forEach(function(row){list.appendChild(renderAdset(row.adset,row.campaign,ctx,key));});
      var count=rows.length;
      message.textContent=count?'광고 세트 '+count+'개 · 광고 보기를 눌러 개별 광고를 확인하세요.':'선택 기간에 성과가 잡힌 광고 세트가 없어요.';
    }catch(e){if(id===generation&&valid(ctx,key))message.textContent='광고별 성과 조회 중 오류가 발생했어요.';}
  });
})();
