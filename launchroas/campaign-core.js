/* 광고로 발생한 특정 상품의 주문 수는 사용자가 직접 확인해 입력한다.
   주문당 광고비 배분액은 사용하지 않고, 광고 전 잔액 × 주문 수 − 캠페인 총 광고비. */
(function(root,factory){
  var api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&typeof root==='object')root.LaunchRoasCampaign=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function calculate(preAd,spend,orders){
    if(!Number.isFinite(preAd)||!Number.isFinite(spend)||spend<0||!Number.isInteger(orders)||orders<0)return null;
    return {
      acquisitionCost:orders>0?spend/orders:null,
      estimatedBalance:Math.round(preAd*orders-spend),
      breakevenOrders:preAd>0?Math.ceil(spend/preAd):null
    };
  }
  return {calculate:calculate};
});
