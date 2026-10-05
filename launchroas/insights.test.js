const test=require('node:test');
const assert=require('node:assert/strict');
const I=require('./insights.js');

const metrics=(o)=>Object.assign({spend:50000,impressions:10000,reach:4000,frequency:2.5,link_clicks:60,link_ctr:0.6,
  landing_page_view:{observed:true,value:50},add_to_cart:{observed:true,value:2},initiate_checkout:{observed:true,value:1},
  purchase:{observed:true,value:0},funnel_status:{usable:true,code:null},landing_rate:83,add_to_cart_rate:4,checkout_rate:50,purchase_rate:0,roas:0},o);

test('제안은 추천 행동 · 근거 지표 · 추정 원인 · 테스트 방법을 갖고, 원인은 확인/추정을 구분한다',()=>{
  const out=I.adsetSuggestions({name:'A',metrics:metrics(),linked:false,verdict:{tone:'hold'}});
  assert.ok(out.length>=2);
  for(const x of out){assert.ok(x.action&&x.facts&&x.test);assert.match(x.cause,/^(추정|확인): /);}
  assert.ok(out.some(x=>/썸네일/.test(x.action)),'링크 CTR 0.6% → 소재 · 썸네일 테스트');
  assert.ok(out.some(x=>/상세페이지 첫 화면/.test(x.action)),'구매율 0% · 장바구니 비율 4% → 첫 화면 점검');
});

test('지표가 측정되지 않았거나 표본이 작으면 제안하지 않고 부족한 데이터로 보여준다',()=>{
  const thin=metrics({impressions:500,link_ctr:0.2,link_clicks:3,landing_page_view:{observed:false,value:0},funnel_status:{usable:false,code:'LPV_NOT_OBSERVED'},purchase:{observed:false,value:0},purchase_rate:null,landing_rate:null});
  assert.deepEqual(I.adsetSuggestions({name:'B',metrics:thin,linked:false}),[]);
  const r=I.build({ready:true,profit:null,summary:null,meta:null,metaIssue:''},{rows:[{name:'B',metrics:thin,linked:false,verdict:{tone:'hold'}}]});
  assert.equal(r.items.length,0);assert.ok(r.gaps.some(g=>/B: .*구매 이벤트 미측정/.test(g)));
});

test('일부 상품 기준 음수는 광고 전체 적자로 판단하지 않는다',()=>{
  const r=I.build({ready:true,profit:-50000,partial:true,summary:{soldQty:25,linkedQty:10,unlinkedQty:15,unlinkedKinds:3},meta:{roas:3.2},spendKrw:120000},{rows:[]});
  assert.ok(r.status.some(t=>/일부 상품 기준/.test(t)));
  assert.ok(r.status.some(t=>/광고 전체가 적자인지는 판단할 수 없어요/.test(t)));
  assert.ok(!r.status.some(t=>/광고 전체(가)? 적자(예요|입니다)/.test(t)));
});

test('조회 중이면 아무 판단도 하지 않는다(0원으로 보지 않음)',()=>{
  assert.deepEqual(I.build({loading:true},null),{loading:true});
});
