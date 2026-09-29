const test=require('node:test');
const assert=require('node:assert/strict');
const margin=require('./margin-calc');
const campaign=require('./campaign-core');

test('A상품 주문당 광고비 시나리오와 캠페인 총 광고비는 중복 차감하지 않는다',()=>{
  const calc=margin.calculate({price:30000,qty:1,unitCost:12000,feeRate:6,actualShipping:3000,packaging:1000,adMode:'rate',adRate:10});
  assert.equal(calc.ok,true);
  assert.equal(calc.result.preAd,12200);
  assert.equal(calc.result.postAd,9200);
  const result=campaign.calculate(calc.result.preAd,100000,10);
  assert.equal(result.acquisitionCost,10000);
  assert.equal(result.estimatedBalance,22000);
  assert.equal(result.breakevenOrders,9);
});

test('광고비만 쓰고 주문이 0건이면 적자와 CPA 미산출을 구분한다',()=>{
  assert.deepEqual(campaign.calculate(10000,50000,0),{acquisitionCost:null,estimatedBalance:-50000,breakevenOrders:5});
  assert.equal(campaign.calculate(-500,50000,3).breakevenOrders,null);
  assert.equal(campaign.calculate(10000,50000,1.5),null);
});
