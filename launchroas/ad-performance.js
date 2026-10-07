(function(){
  'use strict';
  var app=window.LaunchRoasApp;
  if(!app)return;
  var list=document.getElementById('adPerformanceList');
  var message=document.getElementById('adPerformanceMessage');
  var more=document.getElementById('adPerformanceMore');
  var currentKey='',generation=0,accountCurrency='KRW',marginLinks={},marginRecords=null,currentFx=null,productLinks=[];
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
    var observed=!!(m.purchase&&m.purchase.observed),stale=newerMargin(link),computable=spendKrw!=null&&observed&&!stale;
    var title=element('div','ad-margin-title');
    title.append(element('span','','광고 전환 기준 예상 잔액 (광고별 추정)'),element('strong','',computable?won(Number(link.pre_ad)*Number(m.purchase.value)-spendKrw):'계산 안 함'));
    box.append(title);
    box.append(element('small','',computable?'Meta가 집계한 구매 수로 계산 · 구매 '+number(m.purchase.value)+'건 × 주문당 광고 전 잔액 − 광고비 '+won(spendKrw)+(accountCurrency!=='KRW'?' (저장한 환율 적용)':'')
      :stale?'연결한 상품 마진이 최근 저장값과 달라 계산하지 않았어요. 다시 연결해 주세요.':spendKrw==null?'광고비 환율을 저장하면 계산해요(실제 판매 기준 패널).':'Meta가 집계한 구매가 없어 계산하지 않았어요.'));
    if(computable)box.append(element('p','estimate-caution','취소·환불, 부가세·세금·고정비 미반영 · 확정 순이익 아님'));
    box.append(element('small','','사용한 마진 기준: '+link.product_label+' · 주문당 광고 전 잔액 '+won(link.pre_ad)+' · '+savedDate(link.source_saved_at)));
    var newer=stale;
    if(newer)box.append(element('p','margin-stale','마진 기준 갱신 필요 · 같은 상품의 최근 저장 계산은 주문당 광고 전 잔액 '+won(newer.result.preAd)+'이에요. 상품·마진 연결에서 다시 연결해 주세요.'));
    if(computable)box.append(element('small','','광고별 주문 귀속은 Meta 전환 기준이라 실제 광고별 이익이 아니에요. Meta 구매에는 다른 상품 구매가 포함될 수 있어요.'));
    return box;
  }
  function params(ctx,scope,adsetId){var body={store_id:ctx.storeId,scope:scope,period:ctx.period.kind};if(ctx.period.kind==='date')body.date=ctx.period.date;if(adsetId)body.adset_id=adsetId;return body;}
  function valid(ctx,key){var latest=app.getContext();return key===currentKey && latest.userId===ctx.userId && latest.storeId===ctx.storeId && latest.period.kind===ctx.period.kind && latest.period.date===ctx.period.date;}
  function purchases(m){return m.purchase&&m.purchase.observed?number(m.purchase.value)+'건':'미측정';}
  // 연결한 상품 마진이 최근 저장값과 다르면(갱신 필요) 손익분기 참고값도 믿을 수 없어 판단을 보류한다
  function verdictOf(link,m){
    if(link&&newerMargin(link))return {label:'판단 보류',tone:'hold',reason:'연결한 상품 마진이 최근 저장값과 달라요 — 다시 연결한 뒤 판단'};
    return window.LaunchRoasSales?window.LaunchRoasSales.adVerdict(link,m):{label:'판단 보류',tone:'hold',reason:''};
  }
  function verdictBadge(v){
    var box=element('div','ad-verdict-box');box.appendChild(element('span','ad-verdict '+v.tone,v.label));
    if(v.reason)box.appendChild(element('small','',v.reason));return box;
  }
  function renderAd(ad,adset,ctx,key){
    var m=ad.metrics||{},card=element('div','ad-item'),heading=element('div','ad-item-heading');
    heading.append(element('strong','',ad.ad_name||'이름 없는 광고'),element('span','','Meta 구매 '+purchases(m)+' · 링크 클릭 '+number(m.link_clicks)));
    var stats=element('div','ad-perf-stats');
    stats.append(metric('광고비',money(m.spend)),metric('ROAS',percent(m.roas)),verdictBadge(verdictOf(marginLinks[String(adset.adset_id)],m)));
    card.append(heading,stats);return card;
  }
  // 상품별 마진 설정(마진 계산기에서 저장)의 1개 판매 주문 결과 — 광고 세트의 손익분기 ROAS 기준으로 쓴다.
  function preAdOf(link){
    var MC=window.launchdeskMarginCalc;if(!MC||!link||!link.input)return null;
    var c=MC.calculate(Object.assign({},link.input,{qty:1,adMode:'none',adRate:null,adAmount:null}));
    return c.ok?{preAd:c.result.preAd,totalIncome:c.result.totalIncome}:null;
  }
  // 광고 세트 ↔ 상품 연결은 광고 카드 안에서. 전체 손익 계산에는 필요 없고, 이 광고의 손익분기 판단에만 쓴다.
  function linker(adset,ctx,key){
    var box=element('div','adset-linker');
    if(!productLinks.length){box.appendChild(element('small','','마진 계산기에서 상품 비용을 저장하면 이 광고에 연결할 수 있어요.'));return box;}
    var pick=element('select');pick.setAttribute('aria-label','이 광고에 연결할 상품');
    pick.appendChild(new Option('연결할 상품 선택',''));
    productLinks.forEach(function(l,i){pick.appendChild(new Option(l.product_label+(l.variant_code?' · 옵션별':''),String(i)));});
    var save=element('button','secondary','연결 저장');save.type='button';
    save.addEventListener('click',async function(){
      var l=productLinks[Number(pick.value)],r=preAdOf(l);
      if(pick.value===''||!r||!valid(ctx,key))return;
      save.disabled=true;
      var res=await ctx.client.from('ad_margin_links').upsert({store_id:ctx.storeId,meta_adset_id:String(adset.adset_id),
        product_label:String(l.product_label).trim().slice(0,40),calc_version:2,currency:'KRW',total_income:r.totalIncome,pre_ad:r.preAd,
        source_saved_at:l.linked_at||l.source_saved_at||new Date().toISOString()},{onConflict:'store_id,meta_adset_id'});
      save.disabled=false;
      if(res.error){box.appendChild(element('small','','연결을 저장하지 못했어요.'));return;}
      window.dispatchEvent(new CustomEvent('launchroas:margin-linked',{detail:{storeId:ctx.storeId}}));
    });
    box.append(pick,save);return box;
  }
  function publish(detail){if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('launchroas:adsets-state',{detail:detail}));}
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
      metric('손익분기 ROAS (참고)',link&&newerMargin(link)?'갱신 필요':verdict.breakeven?percent(verdict.breakeven):link&&Number(link.pre_ad)>0&&Number(link.total_income)>0?percent(Number(link.total_income)/Number(link.pre_ad)):'—'));
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
    var actions=element('div','adset-actions');actions.append(linker(adset,ctx,key),button);
    extra.append(facts,element('small','adset-basis','판단 기준(참고): Meta ROAS와 이 광고 세트에 연결한 상품 1개 마진의 손익분기 ROAS(총 수입 ÷ 광고 전 잔액) 비교 — 일부 상품 기준이라 광고 전체 손익 아님 · Meta 구매 '+(window.LaunchRoasSales?window.LaunchRoasSales.MIN_PURCHASES:3)+'건 이상일 때만'),
      marginSummary(adset,m),actions,details);
    // AI 점검 전에도 보이는 짧은 확인 신호(규칙 기반 · 실제 측정값과 조건만)
    var sig=window.LaunchRoasInsights?window.LaunchRoasInsights.ruleSignals(m,!!link,verdict):[],sigEl=null;
    if(sig.length){sigEl=element('p','ad-signal');sigEl.append(element('span','ad-signal-tag','확인 신호 · 규칙 기반 · 참고 기준'),element('span','',sig.join(' · ')));}
    head.append(name,more);row.append(head,stats);if(sigEl)row.appendChild(sigEl);row.appendChild(extra);return row;
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
    currentKey=key;currentFx=ctx.fx||null;var id=++generation;list.replaceChildren();marginLinks={};marginRecords=null;productLinks=[];more.hidden=true;more.setAttribute('aria-expanded','false');more.textContent='광고 세트 전체 보기 ↓';
    if(!ctx.userId||!ctx.storeId){message.textContent='쇼핑몰을 선택하면 광고별 성과를 볼 수 있어요.';return;}
    if(!ctx.metaAccount||ctx.metaAccount.status!=='connected'){message.textContent='Meta 광고계정을 연결하면 광고별 성과가 표시돼요.';publish({key:key,error:'Meta 광고계정 미연결'});return;}
    message.textContent='광고별 성과를 불러오는 중이에요.';publish({key:key,loading:true});
    try{
      var response=await ctx.client.functions.invoke('meta-adset-insights',{body:params(ctx,'adsets')});
      if(id!==generation||!valid(ctx,key))return;
      if(response.error||!response.data||response.data.ok!==true){message.textContent='광고별 성과를 불러오지 못했어요. Meta 연결을 확인해 주세요.';publish({key:key,error:'광고 세트 성과를 불러오지 못함'});return;}
      var data=response.data;accountCurrency=String(data.account&&data.account.currency||'KRW').toUpperCase();
      if(data.truncated){message.textContent='조회 한도를 넘어 일부 광고 세트가 누락됐어요. 이 기간의 광고별 성과를 계산에 사용하지 마세요.';publish({key:key,error:'광고 세트 일부 누락'});return;}
      var loaded=await Promise.all([
        ctx.client.from('ad_margin_links').select('meta_adset_id,product_label,pre_ad,total_income,source_saved_at').eq('store_id',ctx.storeId),
        ctx.client.from('tool_records').select('tool_type,data').eq('user_id',ctx.userId).in('tool_type',['margin_calc','product_margin_link']).order('created_at',{ascending:false}).limit(300)
      ]),linked=loaded[0];
      if(id!==generation||!valid(ctx,key))return;
      if(linked.error){message.textContent='저장된 광고·마진 연결을 불러오지 못했어요. 연결 상태를 확인해 주세요.';publish({key:key,error:'광고·마진 연결 조회 실패'});return;}
      (linked.data||[]).forEach(function(row){marginLinks[String(row.meta_adset_id)]=row;});
      if(!loaded[1].error){
        var recs=loaded[1].data||[];
        productLinks=window.LaunchRoasSales.latestLinks(recs.filter(function(r){return r.tool_type==='product_margin_link'&&r.data&&String(r.data.store_id)===String(ctx.storeId)&&r.data.input;}).map(function(r){return r.data;}));
        // 갱신 필요 판단: 예전 계산 기록 + 상품별 마진 설정(같은 이름 · 더 최근 저장)
        marginRecords=recs.filter(function(r){return r.tool_type==='margin_calc';}).map(function(r){return r.data;})
          .concat(productLinks.map(function(l){var r=preAdOf(l);return r?{calc_version:2,product_name:l.product_label,saved_at:l.linked_at,result:{preAd:r.preAd}}:null;}).filter(Boolean));
      }
      var rows=[];(data.campaigns||[]).forEach(function(campaign){(campaign.adsets||[]).forEach(function(adset){rows.push({adset:adset,campaign:campaign});});});
      rows.sort(function(a,b){return Number(b.adset.metrics&&b.adset.metrics.spend||0)-Number(a.adset.metrics&&a.adset.metrics.spend||0);});
      rows.forEach(function(row,index){var el=renderAdset(row.adset,row.campaign,ctx,key);el.hidden=index>=3;list.appendChild(el);});
      // 개선 점검 패널에 같은 데이터(실제로 받은 지표만)를 넘긴다.
      publish({key:key,currency:accountCurrency,rows:rows.map(function(r){var link=marginLinks[String(r.adset.adset_id)];return {name:r.adset.adset_name||'이름 없는 광고 세트',metrics:r.adset.metrics||{},linked:!!link,verdict:verdictOf(link,r.adset.metrics||{})};})});
      var count=rows.length;
      more.hidden=count<=3;if(count>3)more.textContent='광고 세트 전체 '+count+'개 보기 ↓';
      message.textContent=count?'광고 세트 '+count+'개':'선택 기간에 성과가 잡힌 광고 세트가 없어요.';
    }catch(e){if(id===generation&&valid(ctx,key)){message.textContent='광고별 성과 조회 중 오류가 발생했어요.';publish({key:key,error:'광고별 성과 조회 오류'});}}
  });
  window.addEventListener('launchroas:margin-linked',function(event){
    if(String(event.detail.storeId)!==String(app.getContext().storeId))return;
    currentKey='';app.selectStore(app.getContext().storeId);
  });
})();
