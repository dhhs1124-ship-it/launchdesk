/* 실제 판매 기준 집계 — Cafe24 주문 상품(cafe24-order-items 응답) + 저장한 상품 마진.
   상태 판정은 Cafe24 Admin API 공식 문서의 status_code를 따른다:
   N1 정상 · N2 교환 상품 · C1 입금 전 취소 · C2 배송 전 취소 · C3 반품 · E1 교환(원 상품).
   order_status N00(입금 전)은 판매에서 뺀다. 그 밖의 코드는 추측하지 않고 "확인 필요"로 뺀다. */
(function(root,factory){
  var api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&typeof root==='object')root.LaunchRoasSales=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  var EXCLUDE={C1:'canceledBeforePayment',C2:'canceled',C3:'returned',E1:'exchangedOriginal'};

  // 주문 상품 한 줄 → {sold, excluded:{사유:수량}}
  function classifyItem(item){
    var qty=Math.max(0,Number(item.quantity)||0),out={sold:0,excluded:{}};
    var code=item.status_code;
    if(code==='N1'||code==='N2'){
      if(item.order_status==='N00'){out.excluded.unpaid=qty;return out;}
      var claim=Math.min(qty,Math.max(0,Number(item.claim_quantity)||0));
      out.sold=qty-claim;
      if(claim)out.excluded.claimPending=claim;
      return out;
    }
    out.excluded[EXCLUDE[code]||'unknown']=qty;
    return out;
  }

  // 저장한 계산(주문 1건 · 수량 qty 기준)을 "상품 1개당 마진"과 "주문당 조정액"으로 나눈다.
  // 주문당 조정액 = 고객배송비 수입 − 실제 배송비 − 포장비 − 기타 비용 − 판매자 할인 등 주문에 한 번만 생기는 금액.
  function splitMargin(input,MC){
    var base=Object.assign({},input,{qty:1,adMode:'none',adRate:null,adAmount:null,targetProfit:null});
    var unit=Object.assign({},base,{sellerDiscount:0,customerShipping:0,actualShipping:0,packaging:0,otherCost:0});
    var one=MC.calculate(base),u=MC.calculate(unit);
    if(!one.ok||!u.ok)return null;
    return {unitMargin:u.result.preAd,orderAdjust:one.result.preAd-u.result.preAd};
  }

  // 옵션(variant_code)까지 같은 연결 → 없으면 상품 전체('') 연결.
  function findLink(links,productNo,variant){
    var exact=null,any=null;
    (links||[]).forEach(function(l){
      if(String(l.product_no)!==String(productNo))return;
      if(l.variant_code&&l.variant_code===variant)exact=l;
      else if(!l.variant_code)any=l;
    });
    return exact||any;
  }

  function summarize(orders,links){
    var s={orders:0,validOrders:0,soldQty:0,excluded:{},linkedQty:0,unlinkedQty:0,unitMarginTotal:0,orderAdjustTotal:0,
      ordersWithLinked:0,ordersMixed:0,products:{},unknownCodes:{}};
    (orders||[]).forEach(function(order){
      s.orders++;
      var sold=0,adjust=null,hasUnlinked=false;
      (order.items||[]).forEach(function(item){
        var c=classifyItem(item);
        Object.keys(c.excluded).forEach(function(k){s.excluded[k]=(s.excluded[k]||0)+c.excluded[k];});
        if(c.excluded.unknown)s.unknownCodes[item.status_code||'없음']=(s.unknownCodes[item.status_code||'없음']||0)+c.excluded.unknown;
        if(!c.sold)return;
        sold+=c.sold;
        var key=item.product_no+'|'+(item.variant_code||''),link=findLink(links,item.product_no,item.variant_code);
        var p=s.products[key]||(s.products[key]={product_no:item.product_no,variant_code:item.variant_code||'',product_name:item.product_name||'',option_value:item.option_value||'',soldQty:0,link:null});
        p.soldQty+=c.sold;p.link=link||null;
        if(link){
          s.linkedQty+=c.sold;s.unitMarginTotal+=Number(link.unit_margin)*c.sold;
          // 주문당 조정액은 주문에 한 번만 — 연결 상품이 여럿이면 비용이 가장 큰(값이 가장 작은) 것 하나.
          var a=Number(link.order_adjust)||0;adjust=adjust===null?a:Math.min(adjust,a);
        }else{s.unlinkedQty+=c.sold;hasUnlinked=true;}
      });
      if(!sold)return;
      s.validOrders++;s.soldQty+=sold;
      if(adjust!==null){s.ordersWithLinked++;s.orderAdjustTotal+=adjust;if(hasUnlinked)s.ordersMixed++;}
    });
    s.marginTotal=s.linkedQty?Math.round(s.unitMarginTotal+s.orderAdjustTotal):null;
    s.products=Object.keys(s.products).map(function(k){return s.products[k];}).sort(function(a,b){return b.soldQty-a.soldQty;});
    return s;
  }

  // 광고비 원화 환산 — 원화 계정이면 그대로, 외화는 사용자가 저장한 환율이 있어야 한다(없으면 null).
  function adSpendKrw(spend,currency,fx){
    var amount=Number(spend);
    if(!Number.isFinite(amount))return null;
    if(String(currency||'').toUpperCase()==='KRW')return Math.round(amount);
    if(!fx||String(fx.currency).toUpperCase()!==String(currency).toUpperCase()||!(Number(fx.krw_per_unit)>0))return null;
    return Math.round(amount*Number(fx.krw_per_unit));
  }

  return {classifyItem:classifyItem,splitMargin:splitMargin,findLink:findLink,summarize:summarize,adSpendKrw:adSpendKrw};
});
