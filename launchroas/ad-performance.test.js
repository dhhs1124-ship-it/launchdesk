const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function node(tag){
  return {tag,children:[],dataset:{},hidden:false,textContent:'',events:{},
    append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
    replaceChildren(...items){this.children=items;},setAttribute(key,value){this[key]=value;},
    addEventListener(key,fn){this.events[key]=fn;}};
}
async function settle(){await new Promise(resolve=>setImmediate(resolve));}
// select().eq().order().limit() 체인을 흉내 내고, await하면 표별 데이터를 돌려준다.
function query(data,upserts){const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,upsert:(p,o)=>{(upserts||[]).push({p,o});return q;},then:(ok,fail)=>Promise.resolve({data,error:null}).then(ok,fail)};return q;}
const find=(n,cls)=>String(n.className||'').split(' ').includes(cls)?n:(n.children||[]).map(c=>find(c,cls)).find(Boolean);
function texts(el){return [el.textContent,...(el.children||[]).flatMap(texts)].filter(Boolean);}
test('광고 세트 자세히: 광고 보기는 개별 광고를 불러오고, 상품 연결은 저장한 상품 마진에서 골라 광고 화면에서 저장한다',async()=>{
  const list=node('div'),message=node('p'),more=node('button'),calls=[],upserts=[],events={};
  const productLink={store_id:'store',product_no:152,variant_code:'',product_label:'가족티',linked_at:'2026-10-05T08:00:00.000Z',
    input:{price:21900,qty:1,unitCost:9000,feeRate:3,actualShipping:3000,packaging:500,customerShipping:0,sellerDiscount:0,otherCost:0,pgRate:0,feeBase:'after_discount',feeVat:'included',shippingFeeMode:'none',adMode:'none'}};
  const client={from:(table)=>query(table==='tool_records'?[{tool_type:'product_margin_link',data:productLink}]:[],upserts),functions:{invoke:async (name,options)=>{
    calls.push({name,body:options.body});
    if(options.body.scope==='adsets')return {data:{ok:true,account:{currency:'usd'},campaigns:[{campaign_name:'캠페인',adsets:[{adset_id:'123',adset_name:'광고 세트',metrics:{spend:10000,purchase:{observed:true,value:2}}}]}]}};
    return {data:{ok:true,ads:[{ad_id:'456',ad_name:'광고 A',metrics:{spend:7000,purchase:{observed:true,value:1},roas:2,link_clicks:15}}]}};
  }}};
  const ctx={client,userId:'user',storeId:'store',metaAccount:{id:'meta',status:'connected'},period:{kind:'today',date:null}};
  const app={subscribe(fn){fn(ctx);},getContext(){return ctx;}};
  const document={getElementById(id){return id==='adPerformanceList'?list:id==='adPerformanceMore'?more:message;},createElement:node};
  const dispatched=[];
  vm.runInNewContext(fs.readFileSync(__dirname+'/ad-performance.js','utf8'),{window:{LaunchRoasApp:app,addEventListener(t,fn){events[t]=fn;},dispatchEvent(e){dispatched.push(e.type);},
    launchdeskMarginCalc:require('./margin-calc.js'),LaunchRoasSales:require('./sales-core.js')},
    document,Intl,Number,CustomEvent:function(t){this.type=t;},Option:function(text,value){return Object.assign(node('option'),{textContent:text,value});}});
  await settle();
  assert.equal(calls[0].body.scope,'adsets');
  const row=list.children[0];
  await find(row,'adset-toggle').events.click();
  assert.equal(calls[1].body.scope,'ads');assert.equal(calls[1].body.adset_id,'123');
  const card=find(row,'adset-details').children[0];
  assert.equal(find(card,'secondary'),undefined,'개별 광고 카드에는 계산기로 가는 버튼이 없다');
  const linker=find(row,'adset-linker'),[pick,save]=linker.children;
  assert.deepEqual(pick.children.map(o=>o.textContent),['연결할 상품 선택','가족티']);
  pick.value='0';await save.events.click();await settle();
  assert.equal(upserts.length,1);
  const p=upserts[0].p;
  assert.deepEqual({adset:p.meta_adset_id,label:p.product_label,income:p.total_income,pre:p.pre_ad,currency:p.currency},{adset:'123',label:'가족티',income:21900,pre:21900-9000-657-3500,currency:'KRW'});
  assert.equal(upserts[0].o.onConflict,'store_id,meta_adset_id');
  assert.ok(dispatched.includes('launchroas:margin-linked'),'저장 후 광고 목록을 다시 불러온다');
});

async function summaries(links,records,{currency='KRW',spend=30000,fx=null}={}){
  const list=node('div'),adsets=links.map((_,i)=>({adset_id:String(100+i),adset_name:'세트'+i,metrics:{spend,purchase:{observed:true,value:4}}}));
  const client={from:(table)=>query(table==='ad_margin_links'?links:records.map(data=>({tool_type:'margin_calc',data}))),functions:{invoke:async()=>({data:{ok:true,account:{currency},campaigns:[{campaign_name:'캠페인',adsets}]}})}};
  const ctx={client,userId:'user',storeId:'store',metaAccount:{id:'meta',status:'connected'},period:{kind:'today',date:null},fx};
  const document={getElementById(id){return id==='adPerformanceList'?list:node('p');},createElement:node};
  vm.runInNewContext(fs.readFileSync(__dirname+'/ad-performance.js','utf8'),{window:{LaunchRoasApp:{subscribe(fn){fn(ctx);},getContext(){return ctx;}},addEventListener(){},LaunchRoasSales:require('./sales-core.js')},document,Intl,Number,Date,Math,String,Promise});
  await settle();await settle();
  return list.children.map(row=>texts(find(row,'ad-margin-summary')).join(' | '));
}
test('예상 잔액 카드는 계산 근거·미반영 항목·저장 시점을 보여주고, 확인 가능할 때만 갱신 필요를 표시한다',async()=>{
  const linkedAt='2026-09-01T00:00:00.000Z';
  const calc=(name,saved_at,preAd)=>({calc_version:2,product_name:name,saved_at,result:{preAd}});
  const [changed,same,olderOnly,noDate]=await summaries([
    {meta_adset_id:'100',product_label:'타월A',pre_ad:10000,source_saved_at:linkedAt},
    {meta_adset_id:'101',product_label:'타월B',pre_ad:10000,source_saved_at:linkedAt},
    {meta_adset_id:'102',product_label:'타월C',pre_ad:10000,source_saved_at:linkedAt},
    {meta_adset_id:'103',product_label:'타월D',pre_ad:10000,source_saved_at:null}
  ],[calc('타월A','2026-09-20T00:00:00.000Z',8000),calc('타월B','2026-09-20T00:00:00.000Z',10000),calc('타월C','2026-08-01T00:00:00.000Z',5000),calc('타월D','2026-09-20T00:00:00.000Z',5000)]);
  assert.match(changed,/광고 전환 기준 예상 잔액 \(광고별 추정\) \| 10,000원/); // 10,000원 × 4건 − 30,000원
  assert.match(changed,/실제 광고별 이익이 아니에요/);
  assert.match(changed,/Meta가 집계한 구매 수로 계산/);
  assert.match(changed,/취소·환불, 부가세·세금·고정비 미반영 · 확정 순이익 아님/);
  assert.match(changed,/사용한 마진 기준: 타월A · 주문당 광고 전 잔액 10,000원 · 2026\. 9\. 1\./);
  assert.match(changed,/마진 기준 갱신 필요.*8,000원/);
  assert.doesNotMatch(same,/갱신 필요/);
  assert.doesNotMatch(olderOnly,/갱신 필요/); // 연결 이전 기록과는 비교하지 않는다
  assert.match(noDate,/저장 시점 확인 불가/);
  assert.doesNotMatch(noDate,/갱신 필요/); // 연결 시점을 모르면 판단하지 않는다
});

test('USD 광고계정은 저장한 환율이 있을 때만 광고별 추정을 계산하고, 없으면 0원 대신 환율을 안내한다',async()=>{
  const link=[{meta_adset_id:'100',product_label:'타월A',pre_ad:10000,source_saved_at:'2026-09-01T00:00:00.000Z'}];
  const [noFx]=await summaries(link,[],{currency:'USD',spend:20});
  assert.match(noFx,/계산 안 함 \| 광고비 환율을 저장하면 계산해요/);
  const [withFx]=await summaries(link,[],{currency:'USD',spend:20,fx:{currency:'USD',krw_per_unit:1400}});
  assert.match(withFx,/\| 12,000원 \|/); // 10,000원 × 4건 − 20달러 × 1,400원
  assert.match(withFx,/광고비 28,000원 \(저장한 환율 적용\)/);
});

test('광고 세트 첫 줄은 광고비 · ROAS · 판단만 보이고, 자세한 지표는 자세히를 눌러야 보인다',async()=>{
  const list=node('div');
  const adsets=[{adset_id:'100',adset_name:'세트',metrics:{spend:50000,roas:2.5,link_clicks:10,purchase:{observed:true,value:5}}},
    {adset_id:'101',adset_name:'세트2',metrics:{spend:50000,roas:9,link_clicks:10,purchase:{observed:true,value:1}}}];
  const links=[{meta_adset_id:'100',product_label:'A',pre_ad:10000,total_income:30000,source_saved_at:null},{meta_adset_id:'101',product_label:'A',pre_ad:10000,total_income:30000,source_saved_at:null}];
  const client={from:(table)=>query(table==='ad_margin_links'?links:[]),functions:{invoke:async()=>({data:{ok:true,account:{currency:'KRW'},campaigns:[{campaign_name:'캠페인',adsets}]}})}};
  const ctx={client,userId:'user',storeId:'store',metaAccount:{id:'meta',status:'connected'},period:{kind:'today',date:null}};
  const document={getElementById(id){return id==='adPerformanceList'?list:node('p');},createElement:node};
  vm.runInNewContext(fs.readFileSync(__dirname+'/ad-performance.js','utf8'),{window:{LaunchRoasApp:{subscribe(fn){fn(ctx);},getContext(){return ctx;}},addEventListener(){},LaunchRoasSales:require('./sales-core.js')},document,Intl,Number,Date,Math,String,Promise});
  await settle();await settle();
  const [below,few]=list.children;
  assert.deepEqual(texts(find(below,'adset-summary')).filter(x=>/광고비|ROAS|손익|보류/.test(x)),['광고비','ROAS','손익분기 미달']);
  assert.equal(find(below,'adset-extra').hidden,true,'자세한 지표는 접혀 있다');
  assert.match(texts(find(few,'adset-summary')).join(' '),/판단 보류 Meta 구매 1건 — 3건 미만/);
  find(below,'adset-more').events.click();
  assert.equal(find(below,'adset-extra').hidden,false);
  assert.match(texts(find(below,'adset-extra')).join(' '),/손익분기 ROAS 300%/);
});
