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
test('광고 세트와 광고를 계산기에 연결하며 Meta 전환 수를 전달한다',async()=>{
  const list=node('div'),message=node('p'),more=node('button'),calls=[],opened=[];
  const client={from:()=>({select:()=>({eq:async()=>({data:[],error:null})})}),functions:{invoke:async (name,options)=>{
    calls.push({name,body:options.body});
    if(options.body.scope==='adsets')return {data:{ok:true,account:{currency:'usd'},range:{since:'2026-09-29',until:'2026-09-29'},campaigns:[{campaign_name:'캠페인',adsets:[{adset_id:'123',adset_name:'광고 세트',metrics:{spend:10000,purchase:{observed:true,value:2}}}]}]}};
    return {data:{ok:true,ads:[{ad_id:'456',ad_name:'광고 A',metrics:{spend:7000,purchase:{observed:true,value:1},roas:2,link_clicks:15}}]}};
  }}};
  let subscriber,ctx={client,userId:'user',storeId:'store',metaAccount:{id:'meta',status:'connected'},period:{kind:'today',date:null}};
  const app={subscribe(fn){subscriber=fn;fn(ctx);},getContext(){return ctx;},openCalculatorFromAd(data){opened.push(data);}};
  const document={getElementById(id){return id==='adPerformanceList'?list:id==='adPerformanceMore'?more:message;},createElement:node};
  vm.runInNewContext(fs.readFileSync(__dirname+'/ad-performance.js','utf8'),{window:{LaunchRoasApp:app,addEventListener(){}},document,Intl,Number});
  await settle();
  assert.equal(calls[0].body.scope,'adsets');
  const row=list.children[0],toggle=row.children[0].children[1];
  row.children[3].events.click();
  assert.equal(opened[0].adId,'123');
  assert.equal(opened[0].purchase,2);
  await toggle.events.click();
  assert.equal(calls[1].body.scope,'ads');
  assert.equal(calls[1].body.adset_id,'123');
  const detail=row.children[4],button=detail.children[0].children[2];
  assert.notEqual(button.disabled,true);
  button.events.click();
  assert.equal(opened[1].spend,7000);
  assert.equal(opened[1].currency,'USD');
  assert.equal(opened[1].purchase,1);
  assert.equal(Object.hasOwn(opened[1],'orders'),false);
  ctx={...ctx,storeId:'other',metaAccount:null};
  subscriber(ctx);
  button.events.click();
  assert.equal(opened.length,2);
});
