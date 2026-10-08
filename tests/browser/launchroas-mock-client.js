/* LaunchROAS 모의 확인용 가짜 Supabase 클라이언트 — tests/browser/launchroas-mock-server.mjs가 index.html의 supabase-js 대신 넣는다.
   운영 배포와 무관하다. DB 조회 · 저장은 같은 로컬 서버의 메모리 DB로, 서버 함수 호출은 로컬에서 실행하는 실제 함수 코드로 보낸다. */
(function(){
  'use strict';
  var USER={id:'u-demo',email:'demo@launchroas.test'};
  function post(path,body){return fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
  function from(table){
    var q={table:table,op:'select',columns:null,values:null,options:null,filters:[],mode:'many',order:null,limit:null,range:null,returning:null};
    function f(kind){return function(col,val){q.filters.push([kind,col,val]);return b;};}
    function run(){return post('/__mock__/db',q).then(function(r){return r.json();}).catch(function(e){return {data:null,error:{message:String(e)}};});}
    var b={
      select:function(c){if(q.op==='select')q.columns=c||'*';else q.returning=c||'*';return b;},
      insert:function(v,o){q.op='insert';q.values=v;q.options=o||null;return b;},
      update:function(v,o){q.op='update';q.values=v;q.options=o||null;return b;},
      upsert:function(v,o){q.op='upsert';q.values=v;q.options=o||null;return b;},
      delete:function(){q.op='delete';return b;},
      eq:f('eq'),neq:f('neq'),in:f('in'),is:f('is'),gt:f('gt'),gte:f('gte'),lt:f('lt'),lte:f('lte'),
      order:function(col,opt){q.order=[col,!(opt&&opt.ascending===false)];return b;},
      limit:function(n){q.limit=n;return b;},
      range:function(a,z){q.range=[a,z];return b;},
      single:function(){q.mode='single';return run();},
      maybeSingle:function(){q.mode='maybeSingle';return run();},
      then:function(ok,bad){return run().then(ok,bad);}
    };
    return b;
  }
  // supabase-js와 같은 모양: 2xx면 {data}, 아니면 {error: FunctionsHttpError(context = 응답)}
  async function invoke(name,opt){
    var r=await post('/__mock__/fn/'+name,(opt&&opt.body)||{}),text=await r.text(),data=null;
    try{data=JSON.parse(text);}catch(e){}
    if(r.ok)return {data:data,error:null};
    return {data:null,error:{name:'FunctionsHttpError',message:'Edge Function returned a non-2xx status code',
      context:new Response(text,{status:r.status,headers:{'content-type':'application/json'}})}};
  }
  var client={
    from:from,
    rpc:function(n,a){return post('/__mock__/rpc/'+n,a||{}).then(function(r){return r.json();});},
    functions:{invoke:invoke},
    auth:{
      onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:USER});},0);return {data:{subscription:{unsubscribe:function(){}}}};},
      getUser:function(){return Promise.resolve({data:{user:USER},error:null});},
      getSession:function(){return Promise.resolve({data:{session:{user:USER}},error:null});},
      signOut:function(){return Promise.resolve({error:null});},
      signInWithPassword:function(){return Promise.resolve({data:{session:{user:USER}},error:null});},
      signUp:function(){return Promise.resolve({data:{session:null},error:null});}
    }
  };
  window.supabase={createClient:function(){return client;}};
  // 스크린샷에서 운영 화면과 구분되게
  document.addEventListener('DOMContentLoaded',function(){
    var t=document.createElement('div');t.textContent='모의 데이터 · 운영 DB · 유료 AI 호출 없음';
    t.setAttribute('style','position:fixed;left:12px;bottom:12px;z-index:99999;padding:6px 10px;border-radius:8px;background:#ffd27a;color:#1b1b1b;font:600 12px/1.2 sans-serif;pointer-events:none');
    document.body.appendChild(t);
  });
})();
