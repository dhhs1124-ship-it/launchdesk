(function(){
  'use strict';
  var app=window.LaunchRoasApp, builder=window.launchdeskAdlogMeta, AC=window.launchdeskAdlogCore, CH=window.LaunchRoasAdlogChange;
  if(!app || !builder || !AC || !CH) return;
  // 실행 기록(변경 · 결과) 저장 스위치 — 운영 메인(tools.js)의 호환 수정이 배포되기 전까지 꺼 둔다.
  // 공용 DB(tool_records ad_log)에 새 종류 기록이 들어가면 예전 메인 화면에 ₩NaN 줄이 생기기 때문(docs/ai/ad-improvement-loop-design.md 5-6).
  var CHANGE_ON=!!(window.LAUNCHROAS_FLAGS&&window.LAUNCHROAS_FLAGS.adlogChangeRecords===true);
  var ATTRIBUTION='API 기본(클릭 후 7일 · 조회 후 1일)'; // meta-adset-insights는 귀속 기간을 지정하지 않음(Meta 인사이트 레퍼런스 기본값)
  var byId=function(id){return document.getElementById(id);};
  var records=[], decisions=[], currentUser=null, currentStore=null, epoch=0, busy=false, draft=null, results={};
  var money=function(n){return '₩'+Math.round(Number(n)||0).toLocaleString('ko-KR');};
  function status(text){byId('adlogMessage').textContent=text||'';}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function cell(row,text){var td=document.createElement('td');td.textContent=text;row.appendChild(td);return td;}
  function today(){return new Date(Date.now()+9*3600e3).toISOString().slice(0,10);}

  function render(){
    var ctx=app.getContext(), storeId=String(ctx.storeId||''), ids=ctx.stores.map(function(s){return String(s.id);});
    var scope=records.filter(function(r){return String(r.store_id||'')===storeId && !!storeId;});
    var visible=records.filter(function(r){return String(r.store_id||'')===storeId || !r.store_id || ids.indexOf(String(r.store_id))<0;});
    var rows=byId('adlogRows');rows.replaceChildren();
    var sum=AC.summarize(scope,decisions.filter(function(d){return String(d.store_id||'')===storeId;})),links=AC.linkChanges(records);
    if(!visible.length){var empty=document.createElement('tr');cell(empty,'아직 기록이 없어요. 기록 추가나 Meta 성과 기록하기로 시작하세요.').colSpan=7;rows.appendChild(empty);}
    visible.forEach(function(r){
      var tr=document.createElement('tr'), matched=String(r.store_id||'')===storeId, dup=sum.duplicates[String(r.id)];
      var tags=AC.rowLabel(r,sum.duplicates,links).concat(!matched?[!r.store_id?'쇼핑몰 미지정 · 합계 제외':'삭제된 쇼핑몰 기록 · 합계 제외']:[]);
      var spend=AC.isAmount(r)?AC.toKrw(r,r.spend):null,revenue=AC.isAmount(r)?AC.toKrw(r,r.revenue):null;
      cell(tr,String(r.date||''));cell(tr,String(r.channel||''));
      var lc=cell(tr,String(r.name||''));
      tags.forEach(function(t){lc.appendChild(el('span','adlog-tag',t));});
      if(dup&&matched)lc.appendChild(decisionControl(r,dup));
      cell(tr,AC.moneyText(r,r.spend));cell(tr,AC.moneyText(r,r.revenue));
      cell(tr,revenue!=null&&spend>0?(revenue/spend).toFixed(1)+'x':'—');
      var actions=cell(tr,'');var del=document.createElement('button');del.type='button';del.className='delete-record';del.textContent='삭제';del.setAttribute('aria-label',String(r.name||'')+' 기록 삭제');
      del.addEventListener('click',function(){remove(r.id);});actions.appendChild(del);rows.appendChild(tr);
    });
    var ex=sum.excluded,notes=[];
    if(ex.duplicate)notes.push('확정 중복 '+ex.duplicate+'건 제외');
    if(ex.chosen)notes.push('선택으로 제외 '+ex.chosen+'건');
    if(ex.currency)notes.push('환율 없는 외화 '+ex.currency+'건 제외');
    if(sum.pending.count)notes.push('중복 가능 '+sum.pending.count+'건('+money(sum.pending.krw)+') 포함 · 선택 필요');
    byId('adlogTotalSpend').textContent=money(sum.totalSpend);
    byId('adlogTotalNote').textContent=notes.join(' · ');
    byId('adlogAverageRoas').textContent=sum.averageRoas!=null?sum.averageRoas.toFixed(1)+'x':'—';
    byId('adlogBest').textContent=sum.best?sum.best.name+' ('+sum.best.date+')':'—';
    byId('adlogMetaSave').disabled=busy || !ctx.userId || !ctx.storeId || !ctx.metaAccount || ctx.metaAccount.status!=='connected';
    renderChanges(links,storeId);
    renderDraft();
  }

  // 중복(확정 · 가능) 기록의 합계 포함 선택 — 선택은 tool_type='ad_log_decision'에 덧붙여 저장(최신 1건 사용)
  function decisionControl(r,dup){
    var wrap=el('label','adlog-decision'),sel=document.createElement('select');
    var cur=dup.decision===null?(dup.status==='confirmed'?'exclude':'include'):(dup.decision?'include':'exclude');
    [['include','합계에 포함'],['exclude','합계에서 제외']].forEach(function(o){var op=el('option','',o[1]);op.value=o[0];sel.appendChild(op);});
    sel.value=cur;sel.setAttribute('aria-label',String(r.name||'')+' 합계 포함 여부');
    sel.addEventListener('change',function(){saveDecision(r,sel.value==='include');});
    wrap.append(el('span','',dup.decision===null?(dup.status==='confirmed'?'확정 중복 · ':'선택 필요 · '):'선택함 · '),sel);
    wrap.title=dup.reason||'';
    return wrap;
  }
  async function saveDecision(r,include){
    var ctx=app.getContext(),owner=ctx.userId;if(!owner)return;
    var d={id:Date.now()*1000+Math.floor(Math.random()*1000),record_id:r.id,store_id:String(r.store_id),include:include,decided_at:new Date().toISOString()};
    var res=await ctx.client.from('tool_records').insert({user_id:owner,tool_type:'ad_log_decision',data:d});
    if(owner!==app.getContext().userId)return;
    if(res.error){status('합계 포함 여부를 저장하지 못했어요.');render();return;}
    decisions.push(d);status(include?'이 기록을 합계에 포함했어요.':'이 기록을 합계에서 뺐어요.');render();
  }

  // ---- 실행 기록 · 결과 비교 ----
  function metricLine(m,cur){
    if(!m)return '—';
    var buy=m.purchases.observed?m.purchases.value+'건':'미측정',roas=m.roas==null?'미측정':Math.round(m.roas*100)+'%';
    return '광고비 '+(cur==='KRW'?money(m.spend):cur+' '+m.spend.toFixed(2))+' · 구매 '+buy+' · ROAS '+roas+' · 클릭률 '+(m.link_ctr==null?'—':m.link_ctr.toFixed(2)+'%');
  }
  function renderChanges(links,storeId){
    var box=byId('adlogChanges');box.replaceChildren();
    var list=Object.keys(links.changes).map(function(k){return links.changes[k];}).filter(function(g){return String(g.change.store_id)===storeId;});
    var head=el('div','adlog-sub-head');head.append(el('h2','','실행 기록 · 결과 비교'),el('span','small',CHANGE_ON?'AI 개선안에서 바꾼 내용과 결과':'저장 꺼짐 · 운영 화면 호환 수정 배포 후 켜요'));
    box.appendChild(head);
    if(!list.length){box.appendChild(el('p','small','아직 실행 기록이 없어요. 운영 현황의 광고 개선안에서 “실행 기록”을 눌러 시작하세요.'));return;}
    list.forEach(function(g){box.appendChild(changeCard(g));});
  }
  function changeCard(g){
    var c=g.change,cur=c.basis&&c.basis.currency||'KRW',card=el('article','adlog-change'),latest=g.latest,live=results[c.action_id];
    var h=el('div','adlog-change-head');h.append(el('strong','',c.name),el('span','adlog-tag',latest?CH.STATUS_TEXT[latest.result.status]:'결과 대기'));card.appendChild(h);
    var dl=el('dl','adlog-change-dl');
    var add=function(k,v){if(v){dl.append(el('dt','',k),el('dd','',v));}};
    add('바꾼 것',c.change.element+' · '+(c.change.method==='new_ad'?'새 광고 추가 (ID '+c.ad.new_ad_id+')':'기존 광고 수정'));
    add('바꾼 내용',(c.change.before?c.change.before+' → ':'')+c.change.after);
    add('연결된 제안',c.suggestion?(c.suggestion.week+' 주간 점검 · '+(c.suggestion.verdict||'')+(c.suggestion.policy_version?' · 기준 '+c.suggestion.policy_version:' · 이전 기준 결과')):'직접 입력');
    add('비교 기간','변경 전 '+c.compare.before.since+' ~ '+c.compare.before.until+' / 변경 후 '+c.compare.after.since+' ~ '+c.compare.after.until+' ('+c.compare.days+'일씩)');
    add('변경 전 지표',metricLine(c.baseline.metrics,cur));
    add('당시 계산 기준',[cur+(c.basis.fx_krw_per_unit?' · 1 '+cur+' = '+c.basis.fx_krw_per_unit+'원':''),c.basis.attribution,c.basis.margin?'연결 상품 '+c.basis.margin.product_label+' 주문당 '+money(c.basis.margin.pre_ad):'연결 상품 마진 없음 · 이익 계산 안 함'].join(' · '));
    add('함께 바뀐 조건',c.concurrent.length?c.concurrent.join(' · ')+(c.concurrent_note?' — '+c.concurrent_note:''):'없음(사용자 입력)');
    if(c.memo)add('메모',c.memo);
    card.appendChild(dl);
    var shown=live||latest&&{after:latest.after,cmp:latest.result,saved:true};
    if(shown)card.appendChild(resultView(shown,cur));
    var ended=c.compare.after.until<today();
    var btn=el('button','secondary',live&&live.loading?'불러오는 중…':ended?'결과 비교하기':'비교 기간이 '+c.compare.after.until+'에 끝나요');
    btn.type='button';btn.disabled=!ended||!!(live&&live.loading);btn.addEventListener('click',function(){runCompare(c);});
    var act=el('div','form-actions');act.appendChild(btn);
    if(live&&live.cmp&&!live.saved){var sv=el('button','primary','결과 저장');sv.type='button';sv.disabled=!CHANGE_ON;sv.title=CHANGE_ON?'':'운영 화면 호환 수정 배포 전이라 저장을 꺼 두었어요';sv.addEventListener('click',function(){saveResult(c,live);});act.appendChild(sv);}
    card.appendChild(act);
    return card;
  }
  function resultView(x,cur){
    var r=x.cmp,box=el('div','adlog-result');
    if(x.error){box.appendChild(el('p','small',x.error));return box;}
    if(!r)return box;
    box.appendChild(el('p','adlog-result-verdict',(x.saved?'저장된 결과 · ':'')+CH.STATUS_TEXT[r.status]+(r.provisional?' (잠정)':'')+' — '+r.reasons.join(' · ')));
    var g=el('div','adlog-result-grid');
    var tile=function(k,v,n){var t=el('div','');t.append(el('span','',k),el('strong','',v));if(n)t.appendChild(el('small','',n));g.appendChild(t);};
    var sp=r.spend;
    tile('① 실제 지출 변화',!sp?'—':sp.diff===0?'변화 없음':(sp.diff<0?'−':'+')+(cur==='KRW'?money(Math.abs(sp.diff)):cur+' '+Math.abs(sp.diff).toFixed(2)),sp&&sp.diff<0?'지출 감소 · 개선 판단과 별개':'같은 길이 기간 · 같은 통화');
    var pf=r.profit;
    tile('② 같은 계산 범위 예상 이익',pf?(pf.diff<0?'−':'+')+money(Math.abs(pf.diff)):'계산 안 함',pf?pf.basis:'연결 상품 마진 · 구매 측정이 필요해요');
    var mc=r.missingCost||r.missing_cost;
    tile('③ 비용 누락 발견',mc?'주문당 '+money(mc.per_order):'없음',mc?mc.note:'①②와 더하지 않아요');
    box.appendChild(g);
    if(x.after)box.appendChild(el('p','small','변경 후 지표: '+metricLine(x.after,cur)));
    if(r.warnings&&r.warnings.length){var ul=el('ul','adlog-warn');r.warnings.forEach(function(w){ul.appendChild(el('li','',w));});box.appendChild(ul);}
    return box;
  }

  // meta-adset-insights(scope=ads)를 하루씩 불러 기간 합산 — 서버 변경 없이 쓰는 기존 함수
  async function dailyAds(ctx,adsetId,adId,since,until){
    var rows=[],currency=null,d=since;
    while(d<=until){
      var res=await ctx.client.functions.invoke('meta-adset-insights',{body:{store_id:ctx.storeId,scope:'ads',period:'date',date:d,adset_id:adsetId}});
      if(!res.error&&res.data&&res.data.ok){currency=res.data.account&&res.data.account.currency||currency;var hit=(res.data.ads||[]).filter(function(a){return String(a.ad_id)===String(adId);})[0];rows.push({date:d,metrics:hit?hit.metrics:null});}
      d=CH.addDays(d,1);
    }
    return {agg:CH.aggregate(rows,since,until),currency:currency};
  }
  async function findAdset(ctx,adId){
    var res=await ctx.client.functions.invoke('meta-adset-insights',{body:{store_id:ctx.storeId,scope:'adsets',period:'month'}});
    if(res.error||!res.data||!res.data.ok)return null;
    var sets=[];(res.data.campaigns||[]).forEach(function(c){(c.adsets||[]).forEach(function(s){sets.push(String(s.adset_id));});});
    for(var i=0;i<sets.length;i++){
      var a=await ctx.client.functions.invoke('meta-adset-insights',{body:{store_id:ctx.storeId,scope:'ads',period:'month',adset_id:sets[i]}});
      if(!a.error&&a.data&&a.data.ok&&(a.data.ads||[]).some(function(x){return String(x.ad_id)===String(adId);}))return sets[i];
    }
    return null;
  }
  async function marginFor(ctx,adsetId){
    var res=await ctx.client.from('ad_margin_links').select('meta_adset_id,product_label,pre_ad,source_saved_at').eq('store_id',ctx.storeId).eq('meta_adset_id',String(adsetId));
    var m=!res.error&&res.data&&res.data[0];
    return m?{product_label:m.product_label,pre_ad:Number(m.pre_ad),source_saved_at:m.source_saved_at||null}:null;
  }
  function basisFor(ctx,currency,margin){
    var fx=ctx.fx&&currency!=='KRW'&&ctx.fx.currency===currency?ctx.fx:null;
    return {currency:currency||'KRW',fx_krw_per_unit:fx?Number(fx.krw_per_unit):null,fx_saved_at:fx?fx.saved_at:null,attribution:ATTRIBUTION,margin:margin};
  }
  async function runCompare(c){
    var ctx=app.getContext();results[c.action_id]={loading:true};render();
    try{
      var target=c.change.method==='new_ad'?c.ad.new_ad_id:c.ad.ad_id;
      var got=await dailyAds(ctx,c.ad.adset_id,target,c.compare.after.since,c.compare.after.until);
      var basis=basisFor(ctx,got.currency,await marginFor(ctx,c.ad.adset_id));
      var cmp=CH.compare(c,got.agg,basis,today());
      if(c.change.method==='new_ad')cmp.warnings.push('새 광고의 변경 후 기간을 기존 광고의 변경 전 기간과 비교했어요 · 같은 기간 두 광고 비교는 광고 성과 화면에서 확인하세요');
      results[c.action_id]={after:got.agg,cmp:cmp};
    }catch(e){results[c.action_id]={error:'결과 지표를 불러오지 못했어요.'};}
    render();
  }
  async function saveResult(c,live){
    if(!CHANGE_ON)return;
    var rec=CH.buildResultRecord(c,live.after,live.cmp,Date.now(),'');
    if(await insert(rec)){results[c.action_id]=null;status('결과를 저장했어요. 기존 실행 기록은 그대로 두고 결과만 덧붙였어요.');render();}
  }

  // 실행 기록 입력 — AI 개선안에서 열거나(prefill) 직접 연다
  function renderDraft(){
    var f=byId('adlogChangeForm');if(!f)return;
    f.hidden=!draft;if(!draft)return;
    byId('chgTarget').textContent=draft.ad.ad_name+' (광고 ID '+draft.ad.ad_id+')'+(draft.suggestion?' · '+draft.suggestion.week+' 주간 점검 제안':'');
    byId('chgSuggest').textContent=draft.suggestion&&draft.suggestion.proposed?'제안: '+draft.suggestion.proposed:'';
    byId('chgFlag').hidden=CHANGE_ON;
    byId('chgSave').disabled=!CHANGE_ON||busy;
    byId('chgStatus').textContent=draft.message||'';
  }
  function startChange(p){
    draft={ad:{ad_id:String(p.ad.ad_id),ad_name:p.ad.ad_name||'광고',adset_id:p.ad.adset_id||null},suggestion:p.suggestion||null,creative:p.creative||null,message:''};
    var sel=byId('chgElement');sel.value=p.element&&CH.ELEMENTS.indexOf(p.element)>=0?p.element:'문구';
    byId('chgBefore').value=p.before||'';byId('chgAfter').value=p.after||'';byId('chgStart').value=today();byId('chgDays').value='7';
    byId('chgMethod').value='new_ad';byId('chgNewAd').value='';byId('chgMemo').value='';byId('chgConcurrentNote').value='';
    document.querySelectorAll('#adlogChangeForm input[name=chgConcurrent]').forEach(function(b){b.checked=false;});
    if(app.showView)app.showView('records');
    render();byId('adlogChangeForm').scrollIntoView({block:'start'});
  }
  async function submitChange(event){
    event.preventDefault();
    var ctx=app.getContext();if(!draft||!ctx.userId||!ctx.storeId)return;
    if(!CHANGE_ON){draft.message='운영 화면 호환 수정이 배포되기 전이라 저장을 꺼 두었어요. 입력 내용은 저장되지 않아요.';renderDraft();return;}
    busy=true;draft.message='변경 전 지표와 당시 계산 기준을 불러오고 있어요.';renderDraft();
    try{
      var adsetId=draft.ad.adset_id||await findAdset(ctx,draft.ad.ad_id);
      if(!adsetId){draft.message='이 광고의 광고 세트를 찾지 못했어요(이번 달 집행 기준).';return;}
      var days=Number(byId('chgDays').value),start=byId('chgStart').value,p=CH.periods(start,days);
      var got=await dailyAds(ctx,adsetId,draft.ad.ad_id,p.before.since,p.before.until);
      var built=CH.buildChangeRecord({storeId:ctx.storeId,ad:{ad_id:draft.ad.ad_id,adset_id:adsetId,ad_name:draft.ad.ad_name},suggestion:draft.suggestion,
        element:byId('chgElement').value,before:byId('chgBefore').value,after:byId('chgAfter').value,method:byId('chgMethod').value,newAdId:byId('chgNewAd').value.trim(),
        startDate:start,compareDays:days,baseline:{metrics:got.agg,fetched_at:new Date().toISOString(),source:'meta-adset-insights · 하루 단위 합산'},
        basis:basisFor(ctx,got.currency,await marginFor(ctx,adsetId)),creative:draft.creative,
        concurrent:[].slice.call(document.querySelectorAll('#adlogChangeForm input[name=chgConcurrent]:checked')).map(function(b){return b.value;}),
        concurrentNote:byId('chgConcurrentNote').value,memo:byId('chgMemo').value},Date.now());
      if(!built.ok){draft.message='확인해 주세요: '+built.errors.join(', ');return;}
      if(await insert(built.record)){draft=null;status('실행 기록을 저장했어요. 비교 기간이 끝나면 “결과 비교하기”를 눌러 주세요.');}
    }catch(e){draft.message='실행 기록을 저장하지 못했어요.';}
    finally{busy=false;render();}
  }

  async function load(ctx){
    records=[];decisions=[];results={};render();var stamp=++epoch;
    if(!ctx.userId) return;
    var q=function(type){return ctx.client.from('tool_records').select('data,created_at').eq('user_id',ctx.userId).eq('tool_type',type).order('created_at',{ascending:false});};
    var both=await Promise.all([q('ad_log'),q('ad_log_decision')]);
    if(stamp!==epoch)return;
    if(both[0].error){status('광고 기록을 불러오지 못했어요.');return;}
    records=(both[0].data||[]).map(function(row){return row.data;}).filter(function(row){return !!row;});
    decisions=both[1].error?[]:(both[1].data||[]).map(function(row){return row.data;}).filter(Boolean);
    status(both[1].error?'합계 포함 선택을 불러오지 못해 기본 판정으로 계산했어요.':'');render();
  }
  window.LaunchRoasAdlog={refresh:function(){return load(app.getContext());},startChange:startChange,changeEnabled:CHANGE_ON};
  async function insert(record){
    var ctx=app.getContext(), owner=ctx.userId;
    if(!owner)return false;
    var result=await ctx.client.from('tool_records').insert({user_id:owner,tool_type:'ad_log',data:record});
    if(owner!==app.getContext().userId)return false;
    if(result.error){status(result.error.code==='23505'?'같은 쇼핑몰·광고계정·날짜의 Meta 기록이 이미 있어요.':'기록을 저장하지 못했어요.');return false;}
    records.unshift(record);render();return true;
  }
  async function remove(id){
    if(!window.confirm('이 광고 기록을 삭제할까요?'))return;
    var ctx=app.getContext(),owner=ctx.userId;
    if(!owner)return;
    var result=await ctx.client.from('tool_records').delete().eq('user_id',owner).eq('tool_type','ad_log').eq('data->>id',String(id));
    if(owner!==app.getContext().userId)return;
    if(result.error){status('기록을 삭제하지 못했어요.');return;}
    records=records.filter(function(r){return String(r.id)!==String(id);});status('기록을 삭제했어요.');render();
  }
  app.subscribe(function(ctx){
    if(ctx.userId!==currentUser){currentUser=ctx.userId;currentStore=ctx.storeId;load(ctx);}
    else if(ctx.storeId!==currentStore){currentStore=ctx.storeId;draft=null;status('');render();}
    else render();
  });
  CH.ELEMENTS.forEach(function(x){var o=el('option','',x);o.value=x;byId('chgElement').appendChild(o);});
  CH.CONCURRENT.forEach(function(x){var l=el('label','adlog-check'),b=document.createElement('input');b.type='checkbox';b.name='chgConcurrent';b.value=x;l.append(b,document.createTextNode(x));byId('chgConcurrentBox').appendChild(l);});
  byId('adlogChangeForm').addEventListener('submit',submitChange);
  byId('chgCancel').addEventListener('click',function(){draft=null;render();});
  byId('adlogAdd').addEventListener('click',function(){byId('adlogForm').hidden=false;byId('adlogDate').value=today();});
  byId('adlogCancel').addEventListener('click',function(){byId('adlogForm').hidden=true;});
  byId('adlogChannel').addEventListener('change',function(){byId('adlogAccountWrap').hidden=this.value!=='메타';});
  byId('adlogForm').addEventListener('submit',async function(event){
    event.preventDefault();var ctx=app.getContext();if(!ctx.userId || !ctx.storeId)return;
    var name=byId('adlogName').value.trim(),spend=Number(byId('adlogSpend').value),revenue=Number(byId('adlogRevenue').value),channel=byId('adlogChannel').value;
    if(!name||!Number.isFinite(spend)||spend<0||!Number.isFinite(revenue)||revenue<0)return;
    var record={id:Date.now()*1000+Math.floor(Math.random()*1000),store_id:String(ctx.storeId),date:byId('adlogDate').value,name:name,spend:spend,revenue:revenue,channel:channel,currency:'KRW'};
    // 메타 기록이면 광고계정 · 집계 범위를 함께 남겨 같은 날 Meta 하루 합계와의 중복을 판정한다(모르면 비워 둠)
    var acc=byId('adlogAccount').value,scope=byId('adlogScope').value;
    if(channel==='메타'&&acc==='connected'&&ctx.metaAccount&&ctx.metaAccount.external_account_id)record.meta_account_id=String(ctx.metaAccount.external_account_id);
    if(channel==='메타'&&scope)record.scope=scope;
    if(await insert(record)){this.reset();this.hidden=true;status('광고 기록을 저장했어요.');}
  });
  byId('adlogMetaDate').max=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10);
  byId('adlogMetaDate').addEventListener('change',function(){byId('adlogMetaSave').textContent='Meta 성과 기록하기 ('+(this.value||'어제')+')';});
  byId('adlogMetaSave').addEventListener('click',async function(){
    var ctx=app.getContext();if(busy||!ctx.userId||!ctx.storeId||!ctx.metaAccount||ctx.metaAccount.status!=='connected')return;
    busy=true;render();status('Meta 하루 합계를 조회하고 있어요.');
    try{
      var date=byId('adlogMetaDate').value,body={connected_account_id:ctx.metaAccount.id,period:date?'date':'yesterday'};
      if(date)body.date=date;
      var response=await ctx.client.functions.invoke('meta-insights',{body:body});
      if(ctx.userId!==app.getContext().userId||ctx.storeId!==app.getContext().storeId)return;
      if(response.error||!response.data||response.data.ok!==true){status('Meta 하루 합계를 불러오지 못했어요.');return;}
      var built=builder.buildMetaAdlogRecord(ctx.storeId,response.data,Date.now());
      if(!built.ok){status(built.message);return;}
      if(await insert(built.record))status(built.record.date+' Meta 하루 합계를 기록했어요.');
    }catch(e){status('Meta 성과를 기록하지 못했어요.');}
    finally{busy=false;render();}
  });
})();
