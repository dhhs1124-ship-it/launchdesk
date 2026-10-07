(function(){
  'use strict';
  var app=window.LaunchRoasApp;if(!app)return;
  var byId=function(id){return document.getElementById(id);},generation=0,RETURN_KEY='launchroas.oauthTarget';
  var LABEL={cafe24:'Cafe24',meta:'Meta'};
  function say(value){byId('connectionMessage').textContent=value||'';}
  // 복귀 안내는 판정된 쇼핑몰이 선택돼 있을 때만(대상 없음이면 아무것도 선택되지 않았을 때만) 보인다.
  function showReturn(ctx){
    var r=ctx.returnResult,box=byId('connectionReturn');
    box.hidden=!r||(r.storeId?String(ctx.storeId)!==r.storeId:!!ctx.storeId);
    if(box.hidden)return;
    if(!r.storeId){box.textContent=LABEL[r.provider]+' 인증 후 돌아왔지만 인증을 시작한 쇼핑몰을 확인할 수 없어요. 연결할 쇼핑몰을 다시 선택한 뒤 연결 상태를 확인해 주세요.';return;}
    var store=(ctx.stores||[]).find(function(s){return String(s.id)===r.storeId;}),name=store?store.name:'선택한 쇼핑몰';
    box.textContent=name+' · '+(r.status!=='connected'?LABEL[r.provider]+' 인증을 마치지 못했어요. 연결을 다시 시도해 주세요.':r.provider==='meta'?'Meta 인증을 마쳤어요. 아래에서 이 쇼핑몰의 광고계정을 선택해 주세요.':'Cafe24가 연결됐어요.');
  }
  function same(ctx){var now=app.getContext();return now.userId===ctx.userId&&String(now.storeId)===String(ctx.storeId);}
  function refresh(ctx){
    var select=byId('connectionStore');select.replaceChildren();
    (ctx.stores||[]).forEach(function(store){var option=document.createElement('option');option.value=store.id;option.textContent=store.name;select.appendChild(option);});
    select.value=ctx.storeId||'';
    var selected=(ctx.stores||[]).find(function(store){return String(store.id)===String(ctx.storeId);});
    showReturn(ctx);
    byId('connectionStatus').textContent=!ctx.storeId?((ctx.stores||[]).length?'연결할 쇼핑몰을 선택하세요.':'쇼핑몰을 먼저 등록하세요.'):!ctx.connectionsLoaded?'연결 상태 확인 중…':
      (selected?selected.name+' · ':'')+'Cafe24 '+(ctx.cafeAccount&&ctx.cafeAccount.status==='connected'?'연결됨':'미연결')+' · Meta '+(ctx.metaAccount&&ctx.metaAccount.status==='connected'?'연결됨':ctx.metaAccount?'광고계정 선택 필요':'미연결');
    byId('connectCafe').disabled=!ctx.storeId;byId('connectMeta').disabled=!ctx.storeId;
    byId('metaAccountPicker').hidden=true;
    if(ctx.connectionsLoaded&&ctx.metaAccount&&ctx.metaAccount.status!=='connected')loadAdAccounts(ctx);
  }
  async function loadAdAccounts(ctx){
    var ticket=++generation,box=byId('metaAccountPicker');say('연결할 Meta 광고계정을 불러오는 중이에요.');
    var response=await ctx.client.functions.invoke('meta-adaccounts',{body:{connected_account_id:ctx.metaAccount.id}});
    if(ticket!==generation||!same(ctx))return;
    if(response.error||!response.data||response.data.ok!==true){
      // 재연결이 필요한 경우에만 재연결을 안내한다(요청 한도 · 일시 오류 · 서버 오류는 다시 시도)
      var core=window.LaunchRoasCore,failure=await core.readFunctionError(response);
      if(ticket!==generation||!same(ctx))return;
      say(core.functionErrorNotice('meta',failure,'광고계정 목록을 불러오지 못했어요. 다시 시도해 주세요.').message);return;
    }
    var select=byId('metaAccountChoice');select.replaceChildren();
    (response.data.ad_accounts||[]).forEach(function(account){var option=document.createElement('option');option.value=account.id;option.textContent=account.name||account.id;select.appendChild(option);});
    box.hidden=!select.options.length;say(select.options.length?'Meta 광고계정을 선택하면 연결이 완료돼요.':'접근 가능한 광고계정이 없습니다.');
  }
  app.subscribe(refresh);
  byId('connectionStore').addEventListener('change',function(){app.selectStore(this.value);});
  byId('storeCreateForm').addEventListener('submit',async function(event){
    event.preventDefault();var ctx=app.getContext();if(!ctx.userId)return;
    var name=byId('newStoreName').value.trim(),url=byId('newStoreUrl').value.trim(),parsed;
    try{parsed=new URL(url);}catch(e){say('올바른 쇼핑몰 주소를 입력해 주세요.');return;}
    if(parsed.protocol!=='https:'&&parsed.protocol!=='http:'){say('http 또는 https 주소만 입력할 수 있어요.');return;}
    var button=this.querySelector('button');button.disabled=true;
    try{
      var result=await ctx.client.from('stores').insert({user_id:ctx.userId,name:name,platform:'cafe24',store_url:parsed.href,is_active:true}).select('id').single();
      if(ctx.userId!==app.getContext().userId)return;
      if(result.error||!result.data){say('쇼핑몰을 등록하지 못했어요. 입력 내용을 확인해 주세요.');return;}
      await app.reloadStores();await app.selectStore(result.data.id);byId('connectionStore').value=result.data.id;this.reset();say('쇼핑몰을 등록했어요. Cafe24와 Meta를 연결해 주세요.');
    }finally{button.disabled=false;}
  });
  async function start(provider){
    var ctx=app.getContext();if(!ctx.userId||!ctx.storeId)return;
    var button=byId(provider==='cafe24'?'connectCafe':'connectMeta');
    var body={store_id:ctx.storeId,return_origin:window.location.origin};
    if(provider==='cafe24'){
      body.mall_id=byId('connectionMallId').value.trim();
      if(!/^[a-zA-Z0-9_-]+$/.test(body.mall_id)){say('Cafe24 쇼핑몰 ID를 입력해 주세요.');return;}
    }
    button.disabled=true;say(provider==='cafe24'?'Cafe24 인증 화면을 여는 중이에요.':'Meta 인증 화면을 여는 중이에요.');
    try{
      var result=await ctx.client.functions.invoke(provider+'-oauth-start',{body:body});
      if(!same(ctx))return;
      if(result.error||!result.data||!result.data.authorization_url){say('연결을 시작하지 못했어요. 다시 시도해 주세요.');return;}
      var target=new URL(result.data.authorization_url);
      if(provider==='cafe24'? !/^[a-z0-9_-]+\.cafe24api\.com$/i.test(target.hostname): !['www.facebook.com','facebook.com'].includes(target.hostname))throw Error('잘못된 인증 주소');
      if(target.protocol!=='https:')throw Error('잘못된 인증 주소');
      // 복귀 후 같은 쇼핑몰을 다시 고르기 위한 시작 기록. 새로 시작할 때마다 덮어쓴다.
      try{sessionStorage.setItem(RETURN_KEY,JSON.stringify({provider:provider,storeId:String(ctx.storeId),userId:ctx.userId,at:Date.now()}));}catch(e){}
      window.location.assign(target.href);
    }catch(e){say('연결을 시작하지 못했어요. 다시 시도해 주세요.');}
    finally{button.disabled=false;}
  }
  byId('connectCafe').addEventListener('click',function(){start('cafe24');});
  byId('connectMeta').addEventListener('click',function(){start('meta');});
  byId('chooseMetaAccount').addEventListener('click',async function(){
    var ctx=app.getContext(),id=byId('metaAccountChoice').value;if(!ctx.metaAccount||!id)return;
    this.disabled=true;
    try{
      var result=await ctx.client.functions.invoke('meta-account-select',{body:{connected_account_id:ctx.metaAccount.id,ad_account_id:id}});
      if(!same(ctx))return;
      if(result.error||!result.data||result.data.ok!==true){
        var core=window.LaunchRoasCore,failure=await core.readFunctionError(result);
        if(!same(ctx))return;
        say(core.functionErrorNotice('meta',failure,'광고계정을 연결하지 못했어요. 다시 시도해 주세요.').message);return;
      }
      say('Meta 광고계정을 연결했어요.');await app.selectStore(ctx.storeId);
    }finally{this.disabled=false;}
  });
  var params=new URLSearchParams(window.location.search),returned=params.get('meta')?'meta':params.get('cafe24')?'cafe24':null;
  if(returned){
    // 시작 기록은 복귀 때 한 번만 읽고 지운다. 예전 시도의 값이 다음 복귀에 쓰이지 않게 한다.
    var target=null;try{target=JSON.parse(sessionStorage.getItem(RETURN_KEY)||'null');sessionStorage.removeItem(RETURN_KEY);}catch(e){}
    app.expectReturn({provider:returned,status:params.get(returned),target:target});
    history.replaceState(null,'',window.location.pathname+(window.location.hash==='#_=_'?'':window.location.hash));
    window.addEventListener('load',function(){document.querySelector('[data-view="connections"]').click();});
  }
})();
