const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('./sales-core.js');
const MC=require('./margin-calc.js');

const item=(o)=>Object.assign({product_no:1,variant_code:'P1A',product_name:'타월',quantity:1,claim_quantity:0,order_status:'N40',status_code:'N1'},o);

test('실제 응답에서 확인한 상태 조합: 정상만 판매, 취소·입금 전 취소·교환 원상품은 제외',()=>{
  assert.deepEqual(S.classifyItem(item({quantity:2})),{sold:2,excluded:{}});
  assert.deepEqual(S.classifyItem(item({order_status:'N50'})),{sold:1,excluded:{}});
  assert.deepEqual(S.classifyItem(item({status_code:'C2',order_status:'C40',quantity:3})),{sold:0,excluded:{canceled:3}});
  assert.deepEqual(S.classifyItem(item({status_code:'C1',order_status:'C47'})),{sold:0,excluded:{canceledBeforePayment:1}});
  // 교환: 원 상품(E1)은 빼고 교환 상품(N2)만 센다 — 같은 수량이 두 번 잡히지 않는다.
  assert.deepEqual(S.classifyItem(item({status_code:'E1',order_status:'E40',quantity:6})),{sold:0,excluded:{exchangedOriginal:6}});
  assert.deepEqual(S.classifyItem(item({status_code:'N2',order_status:'N40',quantity:6})),{sold:6,excluded:{}});
});

test('반품·입금 전·부분 클레임·모르는 코드는 판매에서 뺀다',()=>{
  assert.deepEqual(S.classifyItem(item({status_code:'C3',order_status:'R40',quantity:2})),{sold:0,excluded:{returned:2}});
  assert.deepEqual(S.classifyItem(item({order_status:'N00',quantity:2})),{sold:0,excluded:{unpaid:2}});
  assert.deepEqual(S.classifyItem(item({quantity:3,claim_quantity:1,order_status:'N20'})),{sold:2,excluded:{claimPending:1}});
  assert.deepEqual(S.classifyItem(item({status_code:'Z9',quantity:1})),{sold:0,excluded:{unknown:1}});
});

test('주문당 비용은 상품 수량만큼 곱하지 않고 주문에 한 번만 뺀다',()=>{
  const input={price:30000,qty:1,sellerDiscount:0,unitCost:12000,customerShipping:0,actualShipping:3000,packaging:500,feeRate:5,
    feeBase:'after_discount',feeVat:'included',shippingFeeMode:'none',shippingFeeRate:null,pgRate:0,otherCost:0,adMode:'none',adRate:null,adAmount:null,targetProfit:null};
  const split=S.splitMargin(input,MC);
  assert.deepEqual(split,{unitMargin:16500,orderAdjust:-3500}); // 30,000 − 12,000 − 1,500 / 배송 3,000 + 포장 500
  const full=MC.calculate(input).result.preAd;
  assert.equal(split.unitMargin+split.orderAdjust,full,'수량 1개 주문은 저장한 주문당 잔액과 같다');
  const links=[{product_no:1,variant_code:'',unit_margin:split.unitMargin,order_adjust:split.orderAdjust}];
  const s=S.summarize([{order_id:'A',items:[item({quantity:3})]}],links);
  assert.equal(s.marginTotal,16500*3-3500,'3개 주문: 배송·포장비는 한 번');
  assert.equal(MC.calculate(Object.assign({},input,{qty:3})).result.preAd,s.marginTotal,'계산기의 3개 주문 결과와 같다');
});

test('합계: 미등록 상품은 계산에서 빼고 수량만 따로 센다, 취소 주문은 유효 주문이 아니다',()=>{
  const links=[{product_no:1,variant_code:'',unit_margin:10000,order_adjust:-3000},{product_no:2,variant_code:'P2B',unit_margin:5000,order_adjust:-4000}];
  const orders=[
    {order_id:'A',items:[item({quantity:2}),item({product_no:2,variant_code:'P2B'})]},       // 연결 2종 → 주문 비용은 더 큰 4,000원 한 번
    {order_id:'B',items:[item({product_no:3,variant_code:'P3A',quantity:5})]},              // 미등록 상품만
    {order_id:'C',items:[item({quantity:1}),item({product_no:3,variant_code:'P3A'})]},     // 연결 + 미등록 섞임
    {order_id:'D',items:[item({status_code:'C2',order_status:'C40',quantity:4})]},         // 전체 취소
    {order_id:'E',items:[item({product_no:2,variant_code:'P2C'})]}                          // 다른 옵션 → 미등록
  ];
  const s=S.summarize(orders,links);
  assert.equal(s.orders,5);assert.equal(s.validOrders,4);
  assert.equal(s.soldQty,2+1+5+1+1+1);
  assert.equal(s.linkedQty,4);assert.equal(s.unlinkedQty,7);
  assert.deepEqual(s.excluded,{canceled:4});
  assert.equal(s.marginTotal,(10000*2+5000-4000)+(10000-3000));
  assert.equal(s.ordersWithLinked,2);assert.equal(s.ordersMixed,1);
  assert.equal(s.products.find(p=>p.product_no===3).link,null);
  assert.equal(S.summarize([],links).marginTotal,null,'판매가 없으면 0원이 아니라 계산 없음');
});

test('외화 광고비는 저장한 환율이 있을 때만 원화로 바꾼다',()=>{
  assert.equal(S.adSpendKrw(79.75,'USD',{currency:'USD',krw_per_unit:1400}),111650);
  assert.equal(S.adSpendKrw(79.75,'USD',null),null);
  assert.equal(S.adSpendKrw(79.75,'USD',{currency:'EUR',krw_per_unit:1500}),null);
  assert.equal(S.adSpendKrw(50000,'krw',null),50000);
});

const calcInput=(o)=>Object.assign({price:30000,qty:1,sellerDiscount:0,unitCost:12000,customerShipping:0,actualShipping:3000,packaging:500,feeRate:5,
  feeBase:'after_discount',feeVat:'included',shippingFeeMode:'none',shippingFeeRate:null,pgRate:0,otherCost:0,adMode:'none',adRate:null,adAmount:null,targetProfit:null},o);
const linkFor=(product_no,input,variant='')=>{const sp=S.splitMargin(input,MC);return {product_no,variant_code:variant,input,unit_margin:sp.unitMargin,order_adjust:sp.orderAdjust};};
// 주문 당시 상품 소계는 Cafe24 필드(order_price_amount)를 따로 주지 않으면 줄 가격으로 채운다.
const paidOrder=(items,pay,amounts,extra)=>{
  const sub=items.reduce((t,i)=>t+((i.product_price||0)+(i.option_price||0))*(i.quantity||0),0);
  return Object.assign({order_id:'X',payment_amount:pay,actual_order_amount:Object.assign({order_price_amount:sub,shipping_fee:0},amounts),items},extra);
};

test('실제 결제: 할인이 없으면 계산기의 같은 수량 결과와 같다(고객 배송비 포함)',()=>{
  const input=calcInput({customerShipping:3000,shippingFeeMode:'same'});
  const s=S.summarize([paidOrder([item({quantity:3,product_price:30000,option_price:0})],30000*3+3000,{shipping_fee:3000})],[linkFor(1,input)]);
  assert.equal(s.margin.actualOrders,1);
  assert.equal(s.marginTotal,MC.calculate(Object.assign({},input,{qty:3})).result.preAd);
  assert.deepEqual({rev:s.margin.revenue,ship:s.margin.customerShipping,cost:s.margin.unitCost,orderCosts:s.margin.orderCosts},{rev:90000,ship:3000,cost:36000,orderCosts:3500});
});

test('실제 결제: 주문 단위 쿠폰은 등록가 소계 비율로 상품에 나누고, 주문당 비용은 한 번',()=>{
  const a=calcInput({unitCost:10000}),b=calcInput({price:10000,unitCost:4000});
  const order=paidOrder([item({product_no:1,quantity:1,product_price:30000}),item({product_no:2,variant_code:'P2',quantity:1,product_price:10000})],36000+3000,
    {shipping_fee:3000,coupon_discount_price:4000});
  const s=S.summarize([order],[linkFor(1,a),linkFor(2,b)]);
  assert.equal(s.margin.actualOrders,1);
  assert.equal(s.margin.revenue,36000);assert.equal(s.margin.unitCost,14000);
  assert.equal(s.margin.fees,Math.round(27000*0.05)+Math.round(9000*0.05));
  assert.equal(s.margin.orderCosts,3500);assert.equal(s.ordersMultiLinked,1);
  assert.equal(s.marginTotal,36000+3000-14000-1800-3500);
});

test('네이버페이: payment_amount 0원 + naver_point = 소계 + 배송비면 실제 결제로 계산한다(실제 응답 55/55건 일치)',()=>{
  const link=linkFor(1,calcInput({}));
  const naver=paidOrder([item({quantity:3,product_price:21900})],0,{shipping_fee:3000},{order_place_id:'NCHECKOUT',naver_point:65700+3000});
  const s=S.summarize([naver],[link]);
  assert.equal(s.margin.actualOrders,1);assert.deepEqual(s.margin.estimated,{});
  assert.equal(s.margin.revenue,65700,'저장한 판매가(30,000원)가 아니라 주문 당시 판매가(21,900원) 기준');
  assert.equal(s.marginTotal,65700+3000-12000*3-Math.round(65700*0.05)-3500);
});

test('실제 금액을 확인할 수 없는 주문은 주문 당시 판매가로 추정하고 사유별로 센다',()=>{
  const link=linkFor(1,calcInput({}));
  const s=S.summarize([
    paidOrder([item({quantity:2,product_price:21900}),item({status_code:'C2',order_status:'C40',quantity:1,product_price:21900})],43800,{}), // 일부 취소
    paidOrder([item({quantity:1,product_price:21900})],15000,{},{order_place_id:'ably'}),   // 금액 불일치(마켓)
    paidOrder([item({quantity:1,product_price:21900})],0,{})                                 // 결제금액 0원(경로 불명)
  ],[link]);
  assert.equal(s.margin.actualOrders,0);
  assert.deepEqual(s.margin.estimated,{partialStatus:1,amountMismatch:1,zeroPayment:1});
  assert.equal(s.margin.revenue,21900*4,'추정 주문은 Cafe24가 기록한 주문 당시 판매가 × 판매 수량');
  assert.equal(s.margin.estimatedTotal,s.marginTotal);
});

test('저장한 판매가를 고쳐도 결과는 같다 — 판매가는 Cafe24 주문에서, 계산에서는 원가·수수료·주문당 비용만 쓴다',()=>{
  const order=paidOrder([item({quantity:2,product_price:21900})],43800+3000,{shipping_fee:3000});
  const oldPrice=S.summarize([order],[linkFor(1,calcInput({price:30000}))]).marginTotal;
  const newPrice=S.summarize([order],[linkFor(1,calcInput({price:21900}))]).marginTotal;
  assert.equal(oldPrice,newPrice);
});

test('Cafe24 상품가가 0원이면 저장한 판매가로 추정하고, 계산 입력값이 없을 때만 저장한 1개당 마진을 쓴다',()=>{
  const link=linkFor(1,calcInput({customerShipping:3000}));
  const noPrice=S.summarize([paidOrder([item({quantity:2})],0,{})],[link]);
  assert.equal(noPrice.margin.savedOnlyOrders,0);assert.deepEqual(noPrice.margin.estimated,{savedPrice:1});
  assert.equal(noPrice.margin.revenue,60000);assert.equal(noPrice.margin.customerShipping,0,'저장 설정의 고객 배송비 3,000원을 더하지 않는다');
  const noInput=S.summarize([paidOrder([item({quantity:1,product_price:30000})],30000,{})],[Object.assign({},link,{input:undefined})]);
  assert.equal(noInput.margin.savedOnlyOrders,1);
});

// 아래 두 테스트는 Cafe24 공식 상태값(status_code · order_status · claim_quantity)에 근거한 해석 검사다.
// 운영 쇼핑몰 3개월 응답에는 반품·부분 클레임 사례가 없어 실제 응답으로는 확인하지 못했다.
test('반품: status_code C3(반품)은 order_status가 R10~R43 어느 단계든 판매에서 뺀다',()=>{
  for(const st of ['R10','R30','R34','R40','R43']){
    const s=S.summarize([paidOrder([item({status_code:'C3',order_status:st,quantity:2})],0,{})],[]);
    assert.equal(s.soldQty,0,st);assert.deepEqual(s.excluded,{returned:2},st);
  }
});

test('부분 취소·반품 요청: 줄이 나뉘면 남은 정상 줄만, 같은 줄의 claim_quantity는 진행 중으로 뺀다',()=>{
  const split=S.summarize([paidOrder([item({quantity:2}),item({status_code:'C2',order_status:'C40',quantity:1})],1,{})],[]);
  assert.equal(split.soldQty,2);assert.deepEqual(split.excluded,{canceled:1});
  const pending=S.summarize([paidOrder([item({quantity:3,claim_quantity:1,order_status:'N40'})],1,{})],[]);
  assert.equal(pending.soldQty,2);assert.deepEqual(pending.excluded,{claimPending:1});
  assert.deepEqual(pending.margin.estimated,{},'연결 상품이 없으면 마진 계산 대상이 아니다');
  const linked=S.summarize([paidOrder([item({quantity:3,claim_quantity:1,order_status:'N40',product_price:30000})],90000,{})],[linkFor(1,calcInput({}))]);
  assert.deepEqual(linked.margin.estimated,{partialStatus:1},'클레임 진행 중 주문은 결제금액 배분이 확정되지 않아 주문 당시 판매가로 추정한다');
});

test('일부 상품만 마진이 연결되면 부분 계산으로 표시한다',()=>{
  const s=S.summarize([paidOrder([item({quantity:1}),item({product_no:9,variant_code:'P9',quantity:2})],1,{})],[linkFor(1,calcInput({}))]);
  assert.equal(s.partial,true);assert.equal(s.linkedQty,1);assert.equal(s.unlinkedQty,2);
  assert.equal(S.summarize([paidOrder([item({quantity:1})],1,{})],[linkFor(1,calcInput({}))]).partial,false);
  assert.equal(S.summarize([paidOrder([item({quantity:1})],1,{})],[]).partial,false,'연결 상품이 없으면 부분 계산이 아니다');
});

test('광고 판단: 근거가 충분할 때만 손익분기 미달·이상, 아니면 판단 보류(권고 없음)',()=>{
  const link={pre_ad:10000,total_income:30000}; // 손익분기 ROAS 300%
  const m=(roas,purchases,spend=100)=>({roas,spend,purchase:{observed:purchases!=null,value:purchases||0}});
  assert.equal(S.adVerdict(link,m(2.5,5)).label,'손익분기 미달');
  assert.equal(S.adVerdict(link,m(3.0,5)).label,'손익분기 이상');
  assert.deepEqual(S.adVerdict(null,m(9,9)),{label:'판단 보류',tone:'hold',reason:'상품 마진 미연결'});
  assert.equal(S.adVerdict(link,m(9,2)).label,'판단 보류','구매 3건 미만');
  assert.equal(S.adVerdict(link,m(null,null)).label,'판단 보류','구매 집계 없음');
  assert.equal(S.adVerdict({pre_ad:-500,total_income:30000},m(9,9)).label,'판단 보류','광고 전 잔액이 0원 이하');
  assert.equal(S.adVerdict(link,m(5,9,0)).label,'판단 보류','광고비 없음');
  for(const v of [S.adVerdict(link,m(2.5,5)),S.adVerdict(link,m(3,5)),S.adVerdict(null,m(1,1))])
    assert.doesNotMatch(JSON.stringify(v),/중단|증액|늘리|줄이|끄세요/,'권고 문구 없음');
});

test('같은 상품 · 옵션의 연결이 여러 개 남아 있으면 가장 최근(목록 앞쪽) 것만 쓴다',()=>{
  const latest=S.latestLinks([{product_no:1,variant_code:'',unit_margin:2},{product_no:1,variant_code:'',unit_margin:1},{product_no:1,variant_code:'V',unit_margin:3}]);
  assert.deepEqual(latest.map(l=>l.unit_margin),[2,3]);
});

test('미등록은 판매 수량(개)과 상품 종류(옵션은 같은 상품)로 따로 센다',()=>{
  const s=S.summarize([{order_id:'A',items:[item({product_no:1,variant_code:'M',quantity:2}),item({product_no:1,variant_code:'L',quantity:1}),item({product_no:2,variant_code:'X',quantity:4})]}],
    [{product_no:1,variant_code:'M',unit_margin:1,order_adjust:0}]);
  assert.equal(s.unlinkedQty,5,'판매 수량: L 1개 + 상품2 4개');
  assert.equal(s.productKinds,2);assert.equal(s.unlinkedKinds,2,'상품1은 L 옵션이 미등록이라 남은 설정에 포함');
});

test('남은 상품 이름을 상품 단위로 판매 많은 순으로 준다',()=>{
  const s=S.summarize([{order_id:'A',items:[item({product_no:1,variant_code:'M',quantity:1,product_name:'티'}),item({product_no:2,variant_code:'X',quantity:3,product_name:'후드'}),item({product_no:2,variant_code:'Y',quantity:1,product_name:'후드'})]}],[]);
  assert.deepEqual(s.unlinkedList.map(p=>[p.product_name,p.soldQty]),[['후드',4],['티',1]]);
});


// ---- 주문 사례 — 실제 운영 쇼핑몰 31일 응답에서 확인한 형태(유료배송 · 조건부 무료배송 · 옵션 추가금 · 합배송 · 추가 비용 상품의 별도 배송코드) ----
test('유료배송 주문은 부과된 3,000원, 조건부 무료배송 주문은 0원 — 현재 설정(고객 배송비 3,000원)으로 다시 계산하지 않는다',()=>{
  const link=linkFor(1,calcInput({customerShipping:3000,unitCost:10000}));
  const paid=S.summarize([paidOrder([item({quantity:1,product_price:21900})],24900,{shipping_fee:3000})],[link]);
  assert.equal(paid.margin.customerShipping,3000);assert.deepEqual(paid.margin.ship,{charged:1,free:0,unknown:0});
  const free=S.summarize([paidOrder([item({quantity:7,product_price:21900})],153300,{shipping_fee:0})],[link]);
  assert.equal(free.margin.customerShipping,0);assert.deepEqual(free.margin.ship,{charged:0,free:1,unknown:0});
  assert.equal(free.margin.orderCosts,3500,'무료배송이어도 판매자 택배 · 포장비(설정값)는 뺀다');
});

test('배송비 쿠폰으로 0원이 된 주문은 고객 배송비 0원, 주문 금액 정보가 없으면 0원이 아니라 확인 불가로 센다',()=>{
  const link=linkFor(1,calcInput({}));
  const waived=S.summarize([paidOrder([item({quantity:1,product_price:30000})],30000,{shipping_fee:3000,coupon_shipping_fee_amount:3000})],[link]);
  assert.equal(waived.margin.customerShipping,0);assert.equal(waived.margin.actualOrders,1);
  const unknown=S.summarize([{order_id:'U',payment_amount:0,actual_order_amount:null,items:[item({quantity:1,product_price:30000})]}],[link]);
  assert.deepEqual(unknown.margin.ship,{charged:0,free:0,unknown:1});assert.deepEqual(unknown.margin.estimated,{noAmount:1});
});

test('옵션 추가금은 1개 기준으로 수량만큼, 결제금액에 이미 들어 있어 다시 더하지 않는다 · 옵션 원가는 옵션 값 우선, 없으면 상품 기본',()=>{
  const base=linkFor(1,calcInput({unitCost:15000})),xl=linkFor(1,calcInput({unitCost:18000}),'XL');
  const order=paidOrder([item({variant_code:'M',quantity:2,product_price:38900,option_price:0}),item({variant_code:'XL',quantity:1,product_price:38900,option_price:9000})],
    38900*2+47900+3000,{shipping_fee:3000});
  const s=S.summarize([order],[base,xl]);
  assert.equal(s.margin.actualOrders,1);
  assert.equal(s.margin.revenue,38900*2+47900,'옵션가 9,000원은 1번만(× 수량 1)');
  assert.equal(s.margin.unitCost,15000*2+18000,'M은 상품 기본 원가, XL은 옵션 원가');
  assert.equal(s.unlinkedQty,0,'원가가 같은 옵션(M)은 따로 입력하지 않아도 된다');
});

test('배송코드가 나뉘어도 실제 발송 여부를 알 수 없어 배송 · 포장비는 주문당 한 번(가장 큰 설정값) — 추가 비용 상품에 택배비를 넣어도 두 번 빠지지 않는다',()=>{
  const tee=linkFor(1,calcInput({unitCost:10000,actualShipping:3000,packaging:500})),hood=linkFor(2,calcInput({unitCost:20000,actualShipping:3500,packaging:500}));
  const press=linkFor(9,calcInput({price:5000,unitCost:1000})); // 사용자가 택배비 3,000 · 포장 500을 그대로 둔 경우
  const order=paidOrder([item({product_no:1,quantity:1,product_price:30000,shipping_code:'D1'}),item({product_no:2,variant_code:'H',quantity:1,product_price:30000,shipping_code:'D1'}),
    item({product_no:9,variant_code:'',quantity:3,product_price:5000,shipping_code:'D2'})],75000+3000,{shipping_fee:3000});
  const s=S.summarize([order],[tee,hood,press]);
  assert.equal(s.margin.orderCosts,4000,'세 상품 중 가장 큰 3,500+500 한 번');
  assert.equal(s.margin.multiCodeOrders,1,'나뉜 배송코드는 참고로만 센다');
});

test('무료배송쿠폰(일반 쿠폰 칸에 기록)은 쿠폰 이름으로 배송비 쿠폰으로 보고, 쿠폰을 못 가져오면 상품 할인 · 구분 불가로 센다',()=>{
  const link=linkFor(1,calcInput({unitCost:10000,shippingFeeMode:'same'}));
  const base=()=>paidOrder([item({quantity:2,product_price:21900})],43800,{shipping_fee:3000,coupon_discount_price:3000});
  const named=Object.assign(base(),{coupons:[{order_item_code:null,coupon_name:'무료배송쿠폰',coupon_value_final:null}]});
  const s=S.summarize([named],[link]);
  assert.equal(s.margin.revenue,43800);assert.equal(s.margin.customerShipping,0);assert.deepEqual(s.margin.coupon,{shipping:1});
  const unknown=S.summarize([base()],[link]);
  assert.equal(unknown.margin.revenue,40800);assert.equal(unknown.margin.customerShipping,3000);assert.deepEqual(unknown.margin.coupon,{unknown:1});
  assert.equal(s.marginTotal-unknown.marginTotal,0,'수수료율이 같으면(배송비도 상품과 같은 요율) 합계 차이 없음');
  const twoCoupons=Object.assign(paidOrder([item({quantity:1,product_price:62700})],62700+3000-6135,{shipping_fee:3000,coupon_discount_price:6135}),
    {coupons:[{coupon_name:'무료배송쿠폰'},{coupon_name:'5% 할인 쿠폰'}]});
  const t2=S.summarize([twoCoupons],[link]);
  assert.equal(t2.margin.customerShipping,0);assert.equal(t2.margin.revenue,62700-3135,'남는 3,135원은 상품 할인');
});

test('적립금은 판매자 부담 혜택으로 따로 빼고, 예치금 · 네이버페이(포인트 포함)는 정산되는 결제라 빼지 않는다 — 같은 금액을 두 번 빼지 않는다',()=>{
  const link=linkFor(1,calcInput({unitCost:10000,actualShipping:0,packaging:0,feeRate:0,pgRate:3}));
  const pts=paidOrder([item({quantity:1,product_price:43800})],43800+3000-1000,{shipping_fee:3000,points_spent_amount:1000});
  const a=S.summarize([pts],[link]);
  assert.equal(a.margin.actualOrders,1);assert.equal(a.margin.revenue,43800,'상품 판매금액은 적립금 포함');
  assert.equal(a.margin.points,1000);assert.equal(a.margin.pointsOrders,1);
  assert.equal(a.margin.fees,Math.round(43800*(45800/46800)*0.03)+Math.round(3000*(45800/46800)*0.03),'PG 수수료는 적립금 제외 결제분에만');
  assert.equal(a.marginTotal,43800+3000-1000-10000-a.margin.fees);
  const cr=paidOrder([item({quantity:1,product_price:43800})],43800+3000-5000,{shipping_fee:3000,credits_spent_amount:5000});
  const b=S.summarize([cr],[link]);
  assert.equal(b.margin.actualOrders,1);assert.equal(b.margin.revenue,43800);assert.equal(b.margin.points,0,'예치금은 빼지 않음');assert.equal(b.margin.creditsOrders,1);
  const naver=paidOrder([item({quantity:1,product_price:43800})],0,{shipping_fee:3000},{order_place_id:'NCHECKOUT',naver_point:46800});
  assert.equal(S.summarize([naver],[link]).margin.revenue,43800);
});

test('실제 0원 판매(사은품)는 매출 0원 · 원가 반영, 판매가 값이 없을 때만 저장 판매가로 추정',()=>{
  const tee=linkFor(1,calcInput({unitCost:10000})),gift=linkFor(5,calcInput({price:0,unitCost:800,actualShipping:0,packaging:0}));
  const order=paidOrder([item({quantity:1,product_price:21900}),item({product_no:5,variant_code:'',quantity:1,product_price:0,option_price:0})],21900+3000,{shipping_fee:3000});
  const s=S.summarize([order],[tee,gift]);
  assert.equal(s.margin.actualOrders,1);assert.equal(s.margin.revenue,21900,'사은품 매출 0원');assert.equal(s.margin.unitCost,10800,'사은품 원가 800원 반영');
  const missing=S.summarize([paidOrder([item({quantity:1,product_price:null})],0,{})],[linkFor(1,calcInput({}))]);
  assert.deepEqual(missing.margin.estimated,{savedPrice:1});assert.equal(missing.margin.revenue,30000);
});

test('쿠폰 이름이 모호하면(배송 · 상품 신호가 함께 있거나 둘 다 없음) 확정하지 않고 상품 할인으로 계산한다',()=>{
  const link=linkFor(1,calcInput({}));
  const mk=(name)=>Object.assign(paidOrder([item({quantity:1,product_price:30000})],30000,{shipping_fee:3000,coupon_discount_price:3000}),{coupons:[{coupon_name:name}]});
  const kind=(name)=>Object.keys(S.summarize([mk(name)],[link]).margin.coupon)[0];
  assert.equal(kind('무료배송쿠폰'),'shipping');assert.equal(kind('5% 할인 쿠폰'),'product');
  assert.equal(kind('가을 이벤트 쿠폰'),'ambiguous');assert.equal(kind('무료배송+10% 할인'),'ambiguous');
  const amb=S.summarize([mk('가을 이벤트 쿠폰')],[link]);
  assert.equal(amb.margin.customerShipping,3000,'모호하면 배송비 쿠폰으로 보지 않음');
});

test('수수료 내역: 판매 수수료는 적립금 포함 상품금액 기준, PG는 적립금을 뺀 결제분 기준',()=>{
  const sales=linkFor(1,calcInput({unitCost:25000,actualShipping:3000,packaging:200,feeRate:6,pgRate:0}));
  const pts=paidOrder([item({quantity:2,product_price:54750})],111500,{shipping_fee:3000,points_spent_amount:1000});
  const a=S.summarize([pts],[sales]).margin;
  assert.deepEqual({s:a.feeSales,p:a.feePg,sh:a.feeShip},{s:6570,p:0,sh:0},'109,500 × 6% = 6,570, PG 0%');
  const pg=linkFor(1,calcInput({unitCost:25000,feeRate:0,pgRate:6,shippingFeeMode:'none'}));
  const b=S.summarize([pts],[pg]).margin;
  assert.equal(b.feePg,Math.round(109500*111500/112500*0.06)+Math.round(3000*111500/112500*0.06),'PG는 (결제 111,500 ÷ 적립금 포함 112,500) 비율만');
});

test('쇼핑몰 전체 상품 판매금액: 비용 미입력 상품 포함 · 취소 제외 · 주문 당시 판매가 × 수량',()=>{
  const s=S.summarize([{order_id:'A',items:[item({quantity:2,product_price:10000,option_price:2000}),item({product_no:9,variant_code:'',quantity:1,product_price:5000}),item({status_code:'C2',order_status:'C40',quantity:3,product_price:10000})]}],[]);
  assert.equal(s.grossSales,24000+5000);
});
