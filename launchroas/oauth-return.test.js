// OAuth 복귀 후 쇼핑몰 선택 — 실제 app.js·connections.js를 가짜 DOM·가짜 Supabase(쇼핑몰 2개)로 실행한다.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const USER='user-a', KEY='launchroas.oauthTarget';
function el(tag){
  const n={tag,children:[],hidden:false,textContent:'',dataset:{},disabled:false,_value:'',events:{},
    // 브라우저 <select>처럼 선택된 옵션이 없을 때 추가된 첫 옵션이 선택된다.
    addEventListener(type,fn){this.events[type]=fn;},append(...c){this.children.push(...c);},appendChild(c){if(tag==='select'&&!this.children.some(o=>o.selected))c.selected=true;this.children.push(c);},
    replaceChildren(...c){this.children=c;},setAttribute(){},focus(){},reset(){},closest(){return null;},
    querySelector(){return el('button');},cloneNode(){return el(tag);},classList:{toggle(){}}};
  Object.defineProperty(n,'options',{get(){return this.children;}});
  Object.defineProperty(n,'value',{get(){
    if(tag!=='select')return this._value;
    const o=this.children.find(c=>c.selected);return o?String(o.value):'';
  },set(v){
    if(tag!=='select'){this._value=v;return;}
    this.children.forEach(c=>{c.selected=String(c.value)===String(v);});
  }});
  return n;
}
function query(rows){const q={};['select','eq','in','gte','lt','limit','order'].forEach(k=>{q[k]=()=>q;});q.then=(ok,fail)=>Promise.resolve({data:rows,error:null}).then(ok,fail);return q;}
// app.js는 인증 콜백을 setTimeout으로 넘기므로 타이머까지 기다린다.
async function settle(){for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,5));}

async function boot({search='',stored,user=USER,storage=new Map()}){
  const nodes={},replaced=[],invoked=[],assigned=[];
  if(stored!==undefined)storage.set(KEY,JSON.stringify(stored));
  const document={getElementById(id){if(!nodes[id])nodes[id]=el(/Select$|Store$|Choice$/.test(id)?'select':'div');return nodes[id];},
    createElement:el,querySelectorAll(){return [];},querySelector(){return el('button');}};
  const client={
    auth:{onAuthStateChange(cb){setTimeout(()=>cb('SIGNED_IN',{user:{id:user,email:'a@example.com'}}),0);},signOut:async()=>({}),getUser:async()=>({data:{}})},
    from(table){return query({user_policy_consents:[{id:1}],stores:[{id:4,name:'운영 쇼핑몰',platform:'cafe24'},{id:5,name:'[TEST] 쇼핑몰',platform:'cafe24'}],
      connected_accounts:[],orders:[]}[table]||[]);},
    functions:{invoke:async(name,opt)=>{invoked.push({name,body:opt&&opt.body});
      if(name==='meta-oauth-start')return {data:{authorization_url:'https://www.facebook.com/v21.0/dialog/oauth?state=x'},error:null};
      return {data:{ok:true,ad_accounts:[]},error:null};}}
  };
  const sandbox={document,URLSearchParams,URL,Intl,Date,Math,Number,String,JSON,Promise,Object,Array,Error,setTimeout,console,
    location:{search,pathname:'/',hash:'#_=_',origin:'https://launchroas.vercel.app',assign(url){assigned.push(url);}},
    history:{replaceState(_s,_t,url){replaced.push(url);}},
    sessionStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    addEventListener(){},CustomEvent:function(){},dispatchEvent(){},scrollTo(){},supabase:{createClient:()=>client}};
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  for(const f of ['policy-consent-core.js','core.js','ops-period-core.js','app.js','connections.js'])
    vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),sandbox,{filename:f});
  await settle();
  return {app:sandbox.LaunchRoasApp,get ctx(){return sandbox.LaunchRoasApp.getContext();},nodes,storage,replaced,invoked,assigned};
}

test('시작 → 복귀: 연결을 시작한 쇼핑몰이 시작 기록에 저장되고, 복귀 후 그 쇼핑몰이 선택된다',async()=>{
  const start=await boot({});
  assert.equal(start.ctx.storeId,'4');
  await start.app.selectStore('5');await settle();
  await start.nodes.connectMeta.events.click();await settle();
  const call=start.invoked.find(c=>c.name==='meta-oauth-start');
  assert.equal(call.body.store_id,'5');
  assert.equal(call.body.return_origin,'https://launchroas.vercel.app');
  assert.equal(start.assigned.length,1,'인증 화면으로 이동한다');
  const saved=JSON.parse(start.storage.get(KEY));
  assert.deepEqual({provider:saved.provider,storeId:saved.storeId,userId:saved.userId},{provider:'meta',storeId:'5',userId:USER});
  assert.ok(Date.now()-saved.at<5000);
  const back=await boot({search:'?meta=connected',storage:start.storage});
  assert.equal(back.ctx.storeId,'5','첫 쇼핑몰(4)로 바뀌지 않는다');
  assert.equal(back.storage.has(KEY),false);
});

test('인증 주소를 받지 못하면 시작 기록을 남기지 않는다',async()=>{
  const r=await boot({});
  const client=r.ctx.client,orig=client.functions.invoke;
  client.functions.invoke=async(name,opt)=>name==='meta-oauth-start'?{data:null,error:{message:'x'}}:orig(name,opt);
  await r.nodes.connectMeta.events.click();await settle();
  assert.equal(r.storage.has(KEY),false);
  assert.equal(r.assigned.length,0);
});
const fresh=(over)=>Object.assign({provider:'meta',storeId:'5',userId:USER,at:Date.now()-60*1000},over);

test('성공 복귀: 인증을 시작한 두 번째 쇼핑몰을 다시 선택하고 그 쇼핑몰 기준으로 안내한다',async()=>{
  const r=await boot({search:'?meta=connected',stored:fresh()});
  assert.equal(r.ctx.storeId,'5');
  assert.equal(r.nodes.connectionStore.value,'5');
  assert.equal(r.nodes.connectionReturn.hidden,false);
  assert.match(r.nodes.connectionReturn.textContent,/^\[TEST\] 쇼핑몰 · Meta 인증을 마쳤어요/);
  assert.equal(r.storage.has(KEY),false,'시작 기록은 한 번 쓰고 지운다');
  assert.equal(r.replaced[0],'/','복귀 파라미터와 #_=_를 지운다');
});

test('취소·오류 복귀도 같은 쇼핑몰을 선택하고 실패로 안내한다',async()=>{
  for(const status of ['denied','server_error']){
    const r=await boot({search:'?meta='+status,stored:fresh()});
    assert.equal(r.ctx.storeId,'5',status);
    assert.match(r.nodes.connectionReturn.textContent,/\[TEST\] 쇼핑몰 · Meta 인증을 마치지 못했어요/,status);
  }
  const c=await boot({search:'?cafe24=connected',stored:fresh({provider:'cafe24'})});
  assert.equal(c.ctx.storeId,'5');
  assert.match(c.nodes.connectionReturn.textContent,/Cafe24가 연결됐어요/);
});

test('대상을 확인할 수 없으면 첫 쇼핑몰로 바꾸지 않고 다시 선택하게 한다',async()=>{
  const cases={
    '시작 기록 없음':undefined,
    '다른 사용자의 기록':fresh({userId:'user-b'}),
    '다른 제공자의 예전 기록':fresh({provider:'cafe24'}),
    '유효 시간이 지난 기록':fresh({at:Date.now()-16*60*1000}),
    '현재 사용자의 쇼핑몰이 아님':fresh({storeId:'99'}),
  };
  for(const [name,stored] of Object.entries(cases)){
    const r=await boot({search:'?meta=connected',stored});
    assert.equal(r.ctx.storeId,'',name);
    assert.equal(r.nodes.pageMessage.textContent,'인증을 시작한 쇼핑몰을 확인할 수 없어요. 쇼핑몰을 다시 선택해 주세요.',name);
    assert.match(r.nodes.connectionReturn.textContent,/인증을 시작한 쇼핑몰을 확인할 수 없어요/,name);
    assert.equal(r.nodes.connectionStatus.textContent,'연결할 쇼핑몰을 선택하세요.',name);
    assert.equal(r.invoked.some(c=>c.name==='meta-adaccounts'),false,name+': 광고계정 목록을 엉뚱한 쇼핑몰로 부르지 않는다');
    assert.equal(r.storage.has(KEY),false,name);
  }
});

test('복귀가 아니면 시작 기록을 쓰지 않고 평소처럼 첫 쇼핑몰을 연다',async()=>{
  const r=await boot({stored:fresh()});
  assert.equal(r.ctx.storeId,'4');
  assert.equal(r.nodes.connectionReturn.hidden,true);
  assert.equal(r.storage.has(KEY),true,'복귀 전에는 시작 기록을 지우지 않는다');
});
