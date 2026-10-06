(function(){
  'use strict';
  var app=window.LaunchRoasApp, builder=window.launchdeskAdlogMeta, AC=window.launchdeskAdlogCore;
  if(!app || !builder || !AC) return;
  var byId=function(id){return document.getElementById(id);};
  var records=[], currentUser=null, currentStore=null, epoch=0, busy=false;
  var money=function(n){return '₩'+Math.round(Number(n)||0).toLocaleString('ko-KR');};
  function status(text){byId('adlogMessage').textContent=text||'';}
  function cell(row,text){var td=document.createElement('td');td.textContent=text;row.appendChild(td);return td;}
  function render(){
    var ctx=app.getContext(), storeId=String(ctx.storeId||''), ids=ctx.stores.map(function(s){return String(s.id);});
    var scope=records.filter(function(r){return String(r.store_id||'')===storeId && !!storeId;});
    var visible=records.filter(function(r){return String(r.store_id||'')===storeId || !r.store_id || ids.indexOf(String(r.store_id))<0;});
    var rows=byId('adlogRows');rows.replaceChildren();
    // 공통 계산 규칙(adlog-core.js — 메인과 같은 파일): 중복 직접 입력 · 원화 아닌 기록 · 변경/결과 기록
    var sum=AC.summarize(scope),links=AC.linkChanges(records);
    if(!visible.length){var empty=document.createElement('tr');cell(empty,'아직 기록이 없어요. 기록 추가나 Meta 성과 기록하기로 시작하세요.').colSpan=7;rows.appendChild(empty);}
    visible.forEach(function(r){
      var tr=document.createElement('tr'), matched=String(r.store_id||'')===storeId;
      var tags=AC.rowLabel(r,sum.duplicates,links).concat(!matched?[!r.store_id?'쇼핑몰 미지정 · 합계 제외':'삭제된 쇼핑몰 기록 · 합계 제외']:[]);
      var label=String(r.name||'')+(tags.length?' · '+tags.join(' · '):'');
      var spend=AC.isAmount(r)?AC.toKrw(r,r.spend):null,revenue=AC.isAmount(r)?AC.toKrw(r,r.revenue):null;
      cell(tr,String(r.date||''));cell(tr,String(r.channel||''));cell(tr,label);
      cell(tr,AC.moneyText(r,r.spend));cell(tr,AC.moneyText(r,r.revenue));
      cell(tr,revenue!=null&&spend>0?(revenue/spend).toFixed(1)+'x':'—');
      var actions=cell(tr,'');var del=document.createElement('button');del.type='button';del.className='delete-record';del.textContent='삭제';del.setAttribute('aria-label',label+' 기록 삭제');
      del.addEventListener('click',function(){remove(r.id);});actions.appendChild(del);rows.appendChild(tr);
    });
    var ex=sum.excluded,notes=[];
    if(ex.duplicate)notes.push('중복 가능 직접 입력 '+ex.duplicate+'건');
    if(ex.currency)notes.push('환율 없는 외화 기록 '+ex.currency+'건');
    byId('adlogTotalSpend').textContent=money(sum.totalSpend)+(notes.length?' (합계 제외: '+notes.join(', ')+')':'');
    byId('adlogAverageRoas').textContent=sum.averageRoas!=null?sum.averageRoas.toFixed(1)+'x':'—';
    byId('adlogBest').textContent=sum.best?sum.best.name+' ('+sum.best.date+')':'—';
    byId('adlogMetaSave').disabled=busy || !ctx.userId || !ctx.storeId || !ctx.metaAccount || ctx.metaAccount.status!=='connected';
  }
  async function load(ctx){
    records=[];render();var stamp=++epoch;
    if(!ctx.userId) return;
    var result=await ctx.client.from('tool_records').select('data,created_at').eq('user_id',ctx.userId).eq('tool_type','ad_log').order('created_at',{ascending:false});
    if(stamp!==epoch)return;
    if(result.error){status('광고 기록을 불러오지 못했어요.');return;}
    records=(result.data||[]).map(function(row){return row.data;}).filter(function(row){return !!row;});status('');render();
  }
  window.LaunchRoasAdlog={refresh:function(){return load(app.getContext());}};
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
    else if(ctx.storeId!==currentStore){currentStore=ctx.storeId;status('');render();}
    else render();
  });
  byId('adlogAdd').addEventListener('click',function(){byId('adlogForm').hidden=false;byId('adlogDate').value=new Date(Date.now()+9*3600000).toISOString().slice(0,10);});
  byId('adlogCancel').addEventListener('click',function(){byId('adlogForm').hidden=true;});
  byId('adlogForm').addEventListener('submit',async function(event){
    event.preventDefault();var ctx=app.getContext();if(!ctx.userId || !ctx.storeId)return;
    var name=byId('adlogName').value.trim(),spend=Number(byId('adlogSpend').value),revenue=Number(byId('adlogRevenue').value);
    if(!name||!Number.isFinite(spend)||spend<0||!Number.isFinite(revenue)||revenue<0)return;
    var record={id:Date.now()*1000+Math.floor(Math.random()*1000),store_id:String(ctx.storeId),date:byId('adlogDate').value,name:name,spend:spend,revenue:revenue,channel:byId('adlogChannel').value};
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
