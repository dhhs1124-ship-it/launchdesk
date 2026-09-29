(function(){
  'use strict';
  var app=window.LaunchRoasApp;if(!app)return;
  var byId=function(id){return document.getElementById(id);},generation=0;
  function say(value){byId('connectionMessage').textContent=value||'';}
  function same(ctx){var now=app.getContext();return now.userId===ctx.userId&&String(now.storeId)===String(ctx.storeId);}
  function refresh(ctx){
    var select=byId('connectionStore');select.replaceChildren();
    (ctx.stores||[]).forEach(function(store){var option=document.createElement('option');option.value=store.id;option.textContent=store.name;select.appendChild(option);});
    select.value=ctx.storeId||'';
    byId('connectionStatus').textContent=ctx.storeId
      ? 'Cafe24 '+(ctx.cafeAccount&&ctx.cafeAccount.status==='connected'?'연결됨':'미연결')+' · Meta '+(ctx.metaAccount&&ctx.metaAccount.status==='connected'?'연결됨':ctx.metaAccount?'광고계정 선택 필요':'미연결')
      : '쇼핑몰을 먼저 등록하세요.';
    byId('connectCafe').disabled=!ctx.storeId;byId('connectMeta').disabled=!ctx.storeId;
    byId('metaAccountPicker').hidden=true;
    if(ctx.metaAccount&&ctx.metaAccount.status!=='connected')loadAdAccounts(ctx);
  }
  async function loadAdAccounts(ctx){
    var ticket=++generation,box=byId('metaAccountPicker');say('연결할 Meta 광고계정을 불러오는 중이에요.');
    var response=await ctx.client.functions.invoke('meta-adaccounts',{body:{connected_account_id:ctx.metaAccount.id}});
    if(ticket!==generation||!same(ctx))return;
    if(response.error||!response.data||response.data.ok!==true){say('광고계정 목록을 불러오지 못했어요. Meta를 재연결해 주세요.');return;}
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
      if(result.error||!result.data||result.data.ok!==true){say('광고계정을 연결하지 못했어요. 다시 시도해 주세요.');return;}
      say('Meta 광고계정을 연결했어요.');await app.selectStore(ctx.storeId);
    }finally{this.disabled=false;}
  });
  var params=new URLSearchParams(window.location.search),cafe=params.get('cafe24'),meta=params.get('meta');
  if(cafe||meta){
    history.replaceState(null,'',window.location.pathname+window.location.hash);
    window.addEventListener('load',function(){document.querySelector('[data-view="connections"]').click();say((cafe||meta)==='connected'?(meta?'Meta 인증을 마쳤어요. 광고계정을 선택해 주세요.':'Cafe24가 연결됐어요.'): '인증을 마치지 못했어요. 연결을 다시 시도해 주세요.');});
  }
})();
