// 광고 카드 → 계산기 → "이 광고 세트에 상품 연결 저장" 경로를 실제 calculator.js로 실행한다.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function el(tag){
  const n={tag,children:[],hidden:false,textContent:'',value:'',dataset:{},disabled:false,checked:false,events:{},
    addEventListener(type,fn){this.events[type]=fn;},append(...c){this.children.push(...c);},appendChild(c){this.children.push(c);},
    replaceChildren(...c){this.children=c;},setAttribute(){},focus(){},reset(){},cloneNode(){return el(tag);},
    querySelector(){return el('button');},classList:{toggle(){}}};
  return n;
}
function query(rows,calls,table,link=null){
  const q={};['select','eq','order','limit','delete'].forEach(k=>{q[k]=()=>q;});
  q.upsert=(payload,opt)=>{calls.push({table,payload,opt});return q;};
  q.maybeSingle=()=>Promise.resolve({data:table==='ad_margin_links'?link:null,error:null});
  q.then=(ok,fail)=>Promise.resolve({data:rows,error:null}).then(ok,fail);
  return q;
}
async function settle(){for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,5));}

test('광고 카드에서 저장한 상품 연결은 그 광고 세트·쇼핑몰로 저장되고 운영 화면 재조회를 요청한다',async()=>{
  const nodes={},handlers={},dispatched=[],upserts=[];
  const record={calc_version:2,product_name:'[TEST] 타월',saved_at:'2026-10-04T00:00:00.000Z',platform:'',
    input:{price:29000,qty:1,unitCost:12000,feeRate:5.5,customerShipping:0,actualShipping:3000,packaging:500,adMode:'none'},
    result:{totalIncome:29000,preAd:11905,adCost:0,postAd:11905}};
  const client={from:(table)=>query(table==='tool_records'?[{id:1,data:record,created_at:record.saved_at}]:[],upserts,table)};
  const ctx={client,userId:'u',storeId:'4',stores:[{id:4}],metaAccount:{id:9,status:'connected'},period:{kind:'today',date:null}};
  const document={getElementById(id){return nodes[id]||(nodes[id]=el('x'));},createElement:el,querySelectorAll(){return [];}};
  const sandbox={document,Intl,Date,Math,Number,String,JSON,Promise,Object,Array,setTimeout,console,
    addEventListener(type,fn){handlers[type]=fn;},dispatchEvent(e){dispatched.push(e);},CustomEvent:function(type,init){this.type=type;this.detail=init.detail;},
    confirm(){return false;}};
  sandbox.window=sandbox;
  sandbox.LaunchRoasApp={subscribe(fn){fn(ctx);},getContext(){return ctx;}};
  vm.createContext(sandbox);
  for(const f of ['margin-calc.js','campaign-core.js','calculator.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),sandbox,{filename:f});
  await settle();
  handlers['launchroas:ad-selection']({detail:{adId:'100',adsetId:'100',adName:'세트',spend:12.5,purchase:3,currency:'USD',range:null,storeId:'4'}});
  await settle();
  assert.equal(nodes.campaignSpend.value,'','외화 광고비는 자동 입력하지 않는다');
  assert.equal(nodes.campaignOrders.value,'3','Meta 전환 수를 주문 수 기본값으로 넣는다');
  assert.equal(nodes.saveProductLink.hidden,false,'저장한 계산이 1개면 바로 연결 저장 버튼을 보인다');
  await nodes.saveProductLink.events.click.call(nodes.saveProductLink);
  assert.equal(upserts.length,1);
  assert.deepEqual({store:upserts[0].payload.store_id,adset:upserts[0].payload.meta_adset_id,pre:upserts[0].payload.pre_ad,label:upserts[0].payload.product_label},
    {store:'4',adset:'100',pre:11905,label:'[TEST] 타월'});
  assert.equal(upserts[0].opt.onConflict,'store_id,meta_adset_id');
  assert.ok(dispatched.some(e=>e.type==='launchroas:margin-linked'&&e.detail.storeId==='4'),'운영 화면 광고 카드를 다시 조회한다');
});

test('저장된 광고 세트 연결은 DB 시각 형식(+00:00)이 달라도 같은 계산 기록을 다시 불러온다',async()=>{
  const nodes={},handlers={},upserts=[];
  const make=(name,saved_at,preAd)=>({calc_version:2,product_name:name,saved_at,platform:'',
    input:{price:30000,qty:1,unitCost:12000,feeRate:5.5,customerShipping:0,actualShipping:3000,packaging:500,adMode:'none'},
    result:{totalIncome:30000,preAd,adCost:0,postAd:preAd}});
  const records=[make('[TEST] 다른 상품','2026-10-04T13:20:29.000Z',11905),make('A상품','2026-09-29T07:41:58.564Z',10100),make('A상품','2026-09-29T07:01:33.000Z',10100)];
  const link={product_label:'A상품',source_saved_at:'2026-09-29T07:41:58.564+00:00'};
  const client={from:(table)=>query(table==='tool_records'?records.map((data,i)=>({id:i+1,data,created_at:data.saved_at})):[],upserts,table,link)};
  const ctx={client,userId:'u',storeId:'4',stores:[{id:4}],metaAccount:{id:9,status:'connected'},period:{kind:'month',date:null}};
  const document={getElementById(id){return nodes[id]||(nodes[id]=el('x'));},createElement:el,querySelectorAll(){return [];}};
  const sandbox={document,Intl,Date,Math,Number,String,JSON,Promise,Object,Array,setTimeout,console,
    addEventListener(type,fn){handlers[type]=fn;},dispatchEvent(){},CustomEvent:function(){},confirm(){return false;}};
  sandbox.window=sandbox;
  sandbox.LaunchRoasApp={subscribe(fn){fn(ctx);},getContext(){return ctx;}};
  vm.createContext(sandbox);
  for(const f of ['margin-calc.js','campaign-core.js','calculator.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),sandbox,{filename:f});
  await settle();
  handlers['launchroas:ad-selection']({detail:{adId:'100',adsetId:'100',adName:'세트',spend:79.83,purchase:5,currency:'USD',range:null,storeId:'4'}});
  await settle();
  assert.equal(nodes.savedProduct.value,'1','두 번째 저장 기록(같은 시각의 A상품)을 선택한다');
  assert.match(nodes.savedProductInfo.textContent,/^선택 상품: A상품 .*10,100원/);
});
