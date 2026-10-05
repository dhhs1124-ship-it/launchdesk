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
const paidOrder=(items,pay,amounts)=>({order_id:'X',payment_amount:pay,actual_order_amount:Object.assign({shipping_fee:0},amounts),items});

test('할인이 없으면 실제 결제 기준 마진은 등록 판매가 기준과 같다(고객 배송비 포함)',()=>{
  const input=calcInput({customerShipping:3000,shippingFeeMode:'same'});
  const s=S.summarize([paidOrder([item({quantity:3,product_price:30000,option_price:0})],30000*3+3000,{shipping_fee:3000})],[linkFor(1,input)]);
  assert.equal(s.actual.orders,1);
  assert.equal(s.actual.margin,s.marginTotal);
  assert.equal(s.marginTotal,MC.calculate(Object.assign({},input,{qty:3})).result.preAd);
  assert.deepEqual({rev:s.actual.revenue,ship:s.actual.customerShipping,cost:s.actual.unitCost,orderCosts:s.actual.orderCosts},{rev:90000,ship:3000,cost:36000,orderCosts:3500});
});

test('주문 단위 쿠폰·적립금은 등록가 소계 비율로 상품에 나눠 실제 결제 기준에 반영한다',()=>{
  const a=calcInput({unitCost:10000}),b=calcInput({price:10000,unitCost:4000});
  // 등록가 소계 30,000 + 10,000 = 40,000, 쿠폰 4,000 → 실제 상품 결제액 36,000을 3:1로 27,000 / 9,000
  const order=paidOrder([item({product_no:1,quantity:1,product_price:30000}),item({product_no:2,variant_code:'P2',quantity:1,product_price:10000})],36000+3000,
    {shipping_fee:3000,coupon_discount_price:4000});
  const s=S.summarize([order],[linkFor(1,a),linkFor(2,b)]);
  assert.equal(s.actual.revenue,36000);
  assert.equal(s.actual.unitCost,14000);
  assert.equal(s.actual.fees,Math.round(27000*0.05)+Math.round(9000*0.05));
  assert.equal(s.actual.orderCosts,3500,'두 상품 주문이어도 주문당 비용은 한 번');
  assert.equal(s.ordersMultiLinked,1);
  assert.equal(s.actual.margin,36000+3000-14000-1800-3500);
  assert.ok(s.actual.margin<s.marginTotal+3000,'쿠폰만큼 등록가 기준보다 낮다');
});

test('실제 결제 기준에서 빼는 주문: 일부 취소가 섞인 주문 · 결제금액 0원 · 계산 입력값 없음 (사유별로 센다)',()=>{
  const input=calcInput({}),link=linkFor(1,input);
  const s=S.summarize([
    paidOrder([item({quantity:2,product_price:30000}),item({status_code:'C2',order_status:'C40',quantity:1,product_price:30000})],60000,{}), // 부분 취소(줄 분리)
    paidOrder([item({quantity:1,product_price:30000})],0,{}),
    paidOrder([item({product_no:5,variant_code:'P5',quantity:1,product_price:30000})],30000,{})
  ],[link,Object.assign({},linkFor(5,input,'P5'),{input:undefined})]);
  assert.equal(s.soldQty,4,'부분 취소 주문의 남은 2개는 판매 수량에 들어간다');
  assert.deepEqual(s.actual.excluded,{partialStatus:1,zeroPayment:1,noInput:1});
  assert.equal(s.actual.margin,null,'계산 가능한 주문이 없으면 0원이 아니라 계산 없음');
  assert.notEqual(s.marginTotal,null,'등록 판매가 기준은 그대로 계산된다');
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
  assert.deepEqual(pending.actual.excluded,{},'연결 상품이 없으면 실제 결제 기준 대상도 아니다');
  const linked=S.summarize([paidOrder([item({quantity:3,claim_quantity:1,order_status:'N40',product_price:30000})],90000,{})],[linkFor(1,calcInput({}))]);
  assert.deepEqual(linked.actual.excluded,{partialStatus:1},'클레임 진행 중 주문은 결제금액 배분이 확정되지 않아 실제 결제 기준에서 뺀다');
});

test('일부 상품만 마진이 연결되면 부분 계산으로 표시한다',()=>{
  const s=S.summarize([paidOrder([item({quantity:1}),item({product_no:9,variant_code:'P9',quantity:2})],1,{})],[linkFor(1,calcInput({}))]);
  assert.equal(s.partial,true);assert.equal(s.linkedQty,1);assert.equal(s.unlinkedQty,2);
  assert.equal(S.summarize([paidOrder([item({quantity:1})],1,{})],[linkFor(1,calcInput({}))]).partial,false);
  assert.equal(S.summarize([paidOrder([item({quantity:1})],1,{})],[]).partial,false,'연결 상품이 없으면 부분 계산이 아니다');
});

test('두 기준은 같은 주문끼리만 비교하고, 실제 결제 기준이 일부 주문만 계산하면 완전하지 않다고 표시한다',()=>{
  const input=calcInput({}),link=linkFor(1,input);
  const s=S.summarize([
    paidOrder([item({quantity:1,product_price:30000})],27000,{coupon_discount_price:3000}), // 계산 가능
    paidOrder([item({quantity:7,product_price:30000})],0,{})                                 // 결제금액 0원 → 실제 결제 기준 제외
  ],[link]);
  assert.equal(s.actual.orders,1);assert.equal(s.actual.complete,false);
  assert.equal(s.actual.registeredMargin,link.unit_margin*1+link.order_adjust,'같은 주문(1개짜리)만의 등록가 기준');
  assert.equal(s.marginTotal,link.unit_margin*8+link.order_adjust*2,'등록 판매가 기준은 두 주문 모두');
  assert.ok(s.actual.margin<s.actual.registeredMargin,'쿠폰 3,000원만큼 실제 결제 기준이 낮다');
});
