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
test('외화 광고도 계산 화면으로 이동하고 Meta 구매 수는 참고값으로만 전달한다',async()=>{
  const list=node('div'),message=node('p'),more=node('button'),calls=[],opened=[];
  const client={functions:{invoke:async (name,options)=>{
    calls.push({name,body:options.body});
    if(options.body.scope==='adsets')return {data:{ok:true,account:{currency:'usd'},range:{since:'2026-09-29',until:'2026-09-29'},campaigns:[{campaign_name:'캠페인',adsets:[{adset_id:'123',adset_name:'광고 세트',metrics:{spend:10000,purchase:{observed:true,value:2}}}]}]}};
    return {data:{ok:true,ads:[{ad_id:'456',ad_name:'광고 A',metrics:{spend:7000,purchase:{observed:true,value:1},roas:2,link_clicks:15}}]}};
  }}};
  let subscriber,ctx={client,userId:'user',storeId:'store',metaAccount:{id:'meta',status:'connected'},period:{kind:'today',date:null}};
  const app={subscribe(fn){subscriber=fn;fn(ctx);},getContext(){return ctx;},openCalculatorFromAd(data){opened.push(data);}};
  const document={getElementById(id){return id==='adPerformanceList'?list:id==='adPerformanceMore'?more:message;},createElement:node};
  vm.runInNewContext(fs.readFileSync(__dirname+'/ad-performance.js','utf8'),{window:{LaunchRoasApp:app},document,Intl,Number});
  await settle();
  assert.equal(calls[0].body.scope,'adsets');
  const row=list.children[0],toggle=row.children[0].children[1];
  await toggle.events.click();
  assert.equal(calls[1].body.scope,'ads');
  assert.equal(calls[1].body.adset_id,'123');
  const detail=row.children[2],button=detail.children[0].children[2];
  assert.notEqual(button.disabled,true);
  button.events.click();
  assert.equal(opened[0].spend,7000);
  assert.equal(opened[0].currency,'USD');
  assert.equal(opened[0].purchase,1);
  assert.equal(Object.hasOwn(opened[0],'orders'),false);
  ctx={...ctx,storeId:'other',metaAccount:null};
  subscriber(ctx);
  button.events.click();
  assert.equal(opened.length,1);
});
