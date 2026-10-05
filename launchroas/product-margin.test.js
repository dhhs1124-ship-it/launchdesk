// 마진 계산기 = 상품별 마진 설정. 실제 calculator.js를 가짜 DOM · 가짜 Supabase로 실행한다.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function el(tag){
  const n={tag,children:[],hidden:false,textContent:'',dataset:{},disabled:false,events:{},_v:'',className:'',type:'',open:false,readOnly:false,
    addEventListener(t,fn){this.events[t]=fn;},append(...c){this.children.push(...c);},appendChild(c){this.children.push(c);},
    replaceChildren(...c){this.children=c;},setAttribute(){},getAttribute(){return null;},focus(){},scrollIntoView(){},reset(){},classList:{toggle(){}}};
  Object.defineProperty(n,'value',{get(){return this._v;},set(v){this._v=v==null?'':String(v);}});
  return n;
}
const texts=(n)=>[n.textContent,...(n.children||[]).flatMap(texts)].filter(Boolean);
const find=(n,pred)=>pred(n)?n:(n.children||[]).map(c=>find(c,pred)).find(Boolean);
function query(state,table){
  const q={_f:{}};['select','order','limit'].forEach(k=>{q[k]=()=>q;});
  q.in=(k,v)=>{if(k==='id')q._ids=v;return q;};
  q.delete=()=>{q._del=true;return q;};
  q.eq=(k,v)=>{q._f[k]=v;return q;};
  q.insert=(row)=>{const rec={id:state.nextId++,tool_type:row.tool_type,data:row.data,created_at:new Date().toISOString()};state.rows.push(rec);q._ins=rec;return q;};
  q.update=(patch)=>{q._patch=patch;return q;};
  q.single=async()=>({data:q._ins?{id:q._ins.id}:null,error:null});
  q.then=(ok,fail)=>{
    if(q._del){state.rows=state.rows.filter(x=>!(q._ids||[]).includes(x.id));state.deletes++;return Promise.resolve({error:null}).then(ok,fail);}
    if(q._patch){const r=state.rows.find(x=>x.id===q._f.id);if(r)r.data=q._patch.data;state.updates++;return Promise.resolve({error:null}).then(ok,fail);}
    return Promise.resolve({data:state.rows.slice(),error:null}).then(ok,fail);
  };
  return q;
}
async function settle(){for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,3));}

async function boot(state){
  const nodes={},events={};
  const sel=['calcShippingType','calcFeeBase','calcFeeVat','calcShipFeeMode','calcPlatform'];
  const document={getElementById(id){if(!nodes[id]){nodes[id]=el(sel.includes(id)?'select':'x');if(id==='calcFeeBase')nodes[id].value='after_discount';if(id==='calcFeeVat')nodes[id].value='included';if(id==='calcShipFeeMode')nodes[id].value='none';if(id==='calcShippingType')nodes[id].value='free';}return nodes[id];},
    createElement:el,querySelectorAll(){return [];}};
  const orders=[{order_id:'A',items:[
    {product_no:152,variant_code:'V-M',product_name:'가족티',option_value:'M',quantity:2,status_code:'N1',order_status:'N40',product_price:21900,option_price:0},
    {product_no:152,variant_code:'V-XL',product_name:'가족티',option_value:'XL',quantity:1,status_code:'N1',order_status:'N40',product_price:21900,option_price:2000},
    {product_no:7,variant_code:'P7',product_name:'후드티',option_value:'L',quantity:1,status_code:'N1',order_status:'N40',product_price:39000,option_price:0}]}];
  const ctx={client:{from:(t)=>query(state,t),functions:{invoke:async()=>({data:{ok:true,orders},error:null})}},userId:'u',storeId:'4',cafeAccount:{status:'connected'}};
  const sandbox={document,Intl,Date,Math,Number,String,JSON,Promise,Object,Array,setTimeout,console,
    addEventListener(t,fn){events[t]=fn;},dispatchEvent(e){state.dispatched.push(e.type);},CustomEvent:function(t,i){this.type=t;this.detail=i&&i.detail;}};
  sandbox.window=sandbox;
  sandbox.LaunchRoasApp={subscribe(fn){fn(ctx);},getContext(){return ctx;}};
  vm.createContext(sandbox);
  for(const f of ['margin-calc.js','ops-period-core.js','sales-core.js','calculator.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+f,'utf8'),sandbox,{filename:f});
  await settle();
  return {nodes,events,ctx};
}
const items=(r)=>r.nodes.pmList.children;
async function pick(r,name){r.nodes.pmPick.events.click();await settle();const b=items(r).find(x=>texts(x)[0]===name);b.events.click();await settle();}
function fill(r,v){Object.entries(v).forEach(([k,val])=>{r.nodes[k].value=val;});r.nodes.calcForm.events.input();}

test('상품 선택 → 비용 입력 → 이 상품에 저장 → 다시 열면 저장값이 보이고 운영 현황에 알린다',async()=>{
  const state={rows:[],nextId:1,updates:0,deletes:0,dispatched:[]};
  const r=await boot(state);
  r.nodes.pmPick.events.click();await settle();
  assert.deepEqual(items(r).map(x=>texts(x)[0]),['가족티','후드티'],'최근 판매 상품 목록(판매 많은 순)');
  assert.match(texts(items(r)[0]).join(' '),/비용 미입력/);
  await pick(r,'가족티');
  assert.equal(r.nodes.calcProduct.value,'가족티');
  assert.equal(r.nodes.calcPrice.value,'21900','미리보기 판매가는 최근 Cafe24 주문 가격');
  fill(r,{calcCost:'9000',calcFee:'3',calcActualShip:'3000',calcPackaging:'500'});
  assert.equal(r.nodes.pmSave.disabled,false);
  await r.nodes.pmSave.events.click();await settle();
  assert.equal(state.rows.length,1);
  const saved=state.rows[0].data;
  assert.deepEqual({p:saved.product_no,v:saved.variant_code,cost:saved.input.unitCost,ship:saved.input.actualShipping,ad:saved.input.adMode},{p:152,v:'',cost:9000,ship:3000,ad:'none'});
  assert.equal(saved.unit_margin,21900-9000-657);assert.equal(saved.order_adjust,-3500);
  assert.ok(state.dispatched.includes('launchroas:product-margin-saved'));
  assert.equal(r.nodes.pmNext.hidden,false,'저장 뒤 다음 단계 버튼');
  assert.equal(r.nodes.pmNextProduct.textContent,'다음 미입력 상품 (최근 31일 1종 남음)','상품 하나 저장했다고 끝난 것이 아니다');
  // 다른 상품을 열었다가 다시 열면 저장값이 그대로 보인다
  await pick(r,'후드티');assert.equal(r.nodes.calcCost.value,'');
  await pick(r,'가족티');
  assert.equal(r.nodes.calcCost.value,'9000');assert.equal(r.nodes.calcPackaging.value,'500');
  assert.match(r.nodes.pmSelected.textContent,/저장된 값/);
  assert.match(texts(items(r)[0]).join(' '),/저장됨/);
});

test('옵션별 설정은 필요할 때만, 옵션 저장은 상품 기본을 덮지 않고 따로 남는다',async()=>{
  const state={rows:[{id:1,tool_type:'product_margin_link',data:{store_id:'4',product_no:152,variant_code:'',product_label:'가족티',unit_margin:1,order_adjust:-1,
    input:{price:21900,qty:1,unitCost:9000,feeRate:3,actualShipping:3000,packaging:500,customerShipping:0,sellerDiscount:0,otherCost:0,pgRate:0,feeBase:'after_discount',feeVat:'included',shippingFeeMode:'none',adMode:'none'}}}],
    nextId:2,updates:0,deletes:0,dispatched:[]};
  const r=await boot(state);
  await pick(r,'가족티');
  assert.equal(r.nodes.pmVariantsBox.hidden,false);assert.equal(r.nodes.pmVariantsBox.open,false,'옵션 목록은 접혀 있다');
  const xl=find(r.nodes.pmVariants,n=>n.textContent==='이 옵션만 설정'&&texts(r.nodes.pmVariants).includes('XL'));
  const xlRow=r.nodes.pmVariants.children.find(row=>texts(row)[0]==='XL');
  xlRow.children.find(c=>c.textContent==='이 옵션만 설정').events.click();await settle();
  assert.equal(r.nodes.calcPrice.value,'23900','옵션 가격(판매가+옵션가)');
  assert.equal(r.nodes.calcCost.value,'9000','상품 기본 값에서 시작');
  fill(r,{calcCost:'11000'});
  await r.nodes.pmSave.events.click();await settle();
  assert.equal(state.rows.length,2,'옵션 저장은 새 기록');
  assert.equal(state.rows[0].data.input.unitCost,9000,'상품 기본은 그대로');
  assert.deepEqual({v:state.rows[1].data.variant_code,cost:state.rows[1].data.input.unitCost},{v:'V-XL',cost:11000});
  assert.ok(xl);
});

test('index.html은 계산 모듈을 쓰는 화면 스크립트보다 먼저 불러온다(순서가 틀리면 화면이 조용히 동작하지 않음)',()=>{
  const html=fs.readFileSync(__dirname+'/index.html','utf8');
  const order=[...html.matchAll(/<script src="\.\/([^"]+)"/g)].map(m=>m[1]);
  const before=(dep,user)=>assert.ok(order.indexOf(dep)>=0&&order.indexOf(dep)<order.indexOf(user),dep+' → '+user);
  for(const user of ['calculator.js','sales.js','ad-performance.js']){before('app.js',user);before('margin-calc.js',user);before('sales-core.js',user);}
  before('ops-period-core.js','calculator.js');before('ops-period-core.js','sales.js');
});

test('같은 상품을 다시 저장하면 새 값으로 바뀌고 이전 기록은 지운다(tool_records에 수정 권한이 없어 저장 후 삭제)',async()=>{
  const state={rows:[],nextId:1,updates:0,deletes:0,dispatched:[]};
  const r=await boot(state);
  await pick(r,'후드티');fill(r,{calcCost:'20000',calcFee:'3'});await r.nodes.pmSave.events.click();await settle();
  await pick(r,'후드티');assert.equal(r.nodes.calcCost.value,'20000');
  fill(r,{calcCost:'18000'});await r.nodes.pmSave.events.click();await settle();
  assert.equal(state.updates,0,'UPDATE를 쓰지 않는다');
  assert.equal(state.rows.length,1,'이전 기록은 지워진다');
  assert.equal(state.rows[0].data.input.unitCost,18000);
  await pick(r,'가족티');await pick(r,'후드티');
  assert.equal(r.nodes.calcCost.value,'18000','다시 열면 최신 값');
});
