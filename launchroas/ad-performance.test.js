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

// rows: tool_records 행(created_at 최신순) — margin_calc · product_margin_link
async function render(links,rows,{currency='KRW',spend=30000,fx=null}={}){
  const list=node('div'),adsets=links.map((_,i)=>({adset_id:String(100+i),adset_name:'세트'+i,metrics:{spend,roas:3,purchase:{observed:true,value:4}}}));
  const client={from:(table)=>query(table==='ad_margin_links'?links:rows),functions:{invoke:async()=>({data:{ok:true,account:{currency},campaigns:[{campaign_name:'캠페인',adsets}]}})}};
  const ctx={client,userId:'user',storeId:'store',metaAccount:{id:'meta',status:'connected'},period:{kind:'today',date:null},fx};
  const document={getElementById(id){return id==='adPerformanceList'?list:node('p');},createElement:node};
  vm.runInNewContext(fs.readFileSync(__dirname+'/ad-performance.js','utf8'),{window:{LaunchRoasApp:{subscribe(fn){fn(ctx);},getContext(){return ctx;}},addEventListener(){},dispatchEvent(){},
    launchdeskMarginCalc:require('./margin-calc.js'),LaunchRoasSales:require('./sales-core.js')},
    document,Intl,Number,Date,Math,String,Promise,Option:function(text,value){return Object.assign(node('option'),{textContent:text,value});}});
  await settle();await settle();
  return list.children;
}
async function summaries(links,records,opts){
  return (await render(links,records.map(data=>({tool_type:'margin_calc',data})),opts)).map(row=>texts(find(row,'ad-margin-summary')).join(' | '));
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
  // 마진 기준이 최근 저장값과 다르면(갱신 필요) 예상 잔액을 계산하지 않는다 — 비용 정보가 맞지 않으면 손익 판단 보류
  assert.match(changed,/광고 전환 기준 예상 잔액 \(광고별 추정\) \| 계산 안 함 \| 연결한 상품 마진이 최근 저장값과 달라/);
  assert.match(same,/광고 전환 기준 예상 잔액 \(광고별 추정\) \| 10,000원/); // 10,000원 × 4건 − 30,000원
  assert.match(same,/실제 광고별 이익이 아니에요/);
  assert.match(same,/Meta가 집계한 구매 수로 계산/);
  assert.match(same,/취소·환불, 부가세·세금·고정비 미반영 · 확정 순이익 아님/);
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
  assert.deepEqual(texts(find(below,'adset-summary')).filter(x=>/광고비|ROAS|손익|보류|참고값/.test(x)),['광고비','ROAS','참고값 미달','일부 상품 기준 손익분기 참고값 · 광고 전체 손익 아님']);
  assert.equal(find(below,'adset-extra').hidden,true,'자세한 지표는 접혀 있다');
  assert.match(texts(find(few,'adset-summary')).join(' '),/판단 보류 Meta 구매 1건 — 3건 미만/);
  find(below,'adset-more').events.click();
  assert.equal(find(below,'adset-extra').hidden,false);
  assert.match(texts(find(below,'adset-extra')).join(' '),/손익분기 ROAS \(참고\) 300%/);
});

// ---- 마진 갱신 필요(판단 보류) 판정 — 연결한 상품 기록 · 저장 시각 기준 ----
// 가족티 기본: 21,900 − 9,000 − 657(수수료 3%) − 3,500(배송 · 포장) = 주문당 광고 전 잔액 8,743원
const T0='2026-10-07T03:00:00.000Z',T1='2026-10-07T05:00:00.000Z',T2='2026-10-07T06:00:00.000Z',BEFORE='2026-09-01T00:00:00.000Z';
const familyInput=unitCost=>({price:21900,qty:1,unitCost,feeRate:3,actualShipping:3000,packaging:500,customerShipping:0,sellerDiscount:0,otherCost:0,pgRate:0,feeBase:'after_discount',feeVat:'included',shippingFeeMode:'none',adMode:'none'});
// 마진 계산기 저장 형식(tool_records · product_margin_link) — 다시 저장하면 이전 기록은 지워지고 linked_at이 새로 생긴다
const saved=(variant,at,unitCost)=>({tool_type:'product_margin_link',data:{store_id:'store',product_no:152,variant_code:variant,product_label:'가족티',linked_at:at,source_saved_at:at,input:familyInput(unitCost)}});
const calcRow=(saved_at,preAd)=>({tool_type:'margin_calc',data:{calc_version:2,product_name:'가족티',saved_at,result:{preAd}}});
// 광고 세트 연결(ad_margin_links) — 연결 저장은 고른 상품 기록의 linked_at을 source_saved_at으로 남긴다
const adLink=(at,pre)=>({meta_adset_id:'100',product_label:'가족티',pre_ad:pre,total_income:21900,source_saved_at:at});
async function judge(link,rows){
  const [row]=await render([link],rows);
  return {verdict:texts(find(row,'adset-summary')).join(' | '),summary:texts(find(row,'ad-margin-summary')).join(' | ')};
}
function current(r,amount){
  assert.doesNotMatch(r.verdict,/판단 보류/);assert.match(r.verdict,/참고값/);
  assert.doesNotMatch(r.summary,/갱신 필요|계산 안 함/);
  if(amount)assert.match(r.summary,new RegExp('\| '+amount+' \|'));
}
function stale(r,newer){
  assert.match(r.verdict,/판단 보류 \| 연결한 상품 마진이 최근 저장값과 달라요/);
  assert.match(r.summary,/계산 안 함 \| 연결한 상품 마진이 최근 저장값과 달라/);
  assert.match(r.summary,new RegExp('마진 기준 갱신 필요 · 같은 상품의 최근 저장 계산은 주문당 광고 전 잔액 '+newer));
}

test('A · B: 연결 후 변경이 없으면 계산하고, 연결 뒤 같은 상품 비용을 다시 저장해 마진이 바뀌면 판단 보류(다시 연결하면 해소)',async()=>{
  current(await judge(adLink(T0,8743),[saved('',T0,9000)]),'4,972원'); // A: 8,743 × 4 − 30,000
  stale(await judge(adLink(T0,8743),[saved('',T2,9500)]),'8,243원'); // B: 원가 9,000 → 9,500
  current(await judge(adLink(T2,8243),[saved('',T2,9500)]),'2,972원'); // B 후 다시 연결
});

test('C: 기본 상품에 연결한 뒤 같은 상품의 다른 옵션만 옵션별로 저장해도 연결은 갱신 필요가 아니다',async()=>{
  current(await judge(adLink(T0,8743),[saved('V1',T1,11000),saved('',T0,9000)]),'4,972원');
  // 옵션에 연결했으면 그 뒤 기본 상품을 다시 저장해도 옵션 연결은 그대로
  current(await judge(adLink(T1,6743),[saved('',T2,9500),saved('V1',T1,11000)]));
});

test('C: 연결한 상품 기록이 그대로여도 그 기록의 마진이 연결 값과 다르면 갱신 필요다',async()=>{
  stale(await judge(adLink(T0,9999),[saved('V1',T1,11000),saved('',T0,9000)]),'8,743원');
});

test('D: 연결 이전의 예전 margin_calc 기록이 더 최근 상품 비용 저장을 가리지 않는다',async()=>{
  stale(await judge(adLink(T0,8743),[saved('',T2,9500),calcRow(BEFORE,1)]),'8,243원');
  // 저장 시각을 읽을 수 없는 예전 계산 기록도 최근 기록으로 고르지 않는다
  stale(await judge(adLink(T0,8743),[saved('',T2,9500),calcRow('날짜 아님',1)]),'8,243원');
  stale(await judge(adLink(T0,8743),[saved('',T2,9500),calcRow(undefined,1)]),'8,243원');
});

test('같은 이름 후보가 여럿이면 목록 순서가 아니라 저장 시각이 가장 최근인 기록과 비교한다',async()=>{
  // 연결한 기본 상품 기록(T0)은 다시 저장돼 없어짐 — 예전 계산 · 옵션(T1) · 다시 저장한 기본 상품(T2) 중 T2
  stale(await judge(adLink(T0,8743),[saved('',T2,9500),saved('V1',T1,11000),calcRow(BEFORE,1)]),'8,243원');
  // 한꺼번에 옮긴 예전 계산 기록처럼 조회 순서와 저장 시각 순서가 다를 때도 저장 시각 기준
  stale(await judge(adLink(T0,8743),[calcRow(BEFORE,1),calcRow(T2,7000)]),'7,000원');
});

test('저장 시각이 연결 시각과 같은 기록: 연결한 기록 자신이면 정상, 다른 기록이 같은 시각에 다른 마진이면 갱신 필요(연결 시점 포함)',async()=>{
  current(await judge(adLink(T0,8743),[saved('',T0,9000)]),'4,972원');
  stale(await judge(adLink(T0,8743),[calcRow(T0,7000)]),'7,000원');
});

test('연결 시각을 읽을 수 없거나 비교할 기록의 저장 시각이 모두 없으면 갱신 필요로 판단하지 않는다',async()=>{
  current(await judge(adLink('날짜 아님',8743),[saved('',T2,9500)]),'4,972원');
  current(await judge(adLink(T0,8743),[calcRow(null,7000),calcRow('날짜 아님',7000)]),'4,972원');
});
