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

  function n(v){var x=Number(v);return Number.isFinite(x)?x:0;}
  function feeMult(input){return input.feeVat==='excluded'?1.1:1;}
  function shipRate(input){return input.shippingFeeMode==='same'?n(input.feeRate):input.shippingFeeMode==='separate'?n(input.shippingFeeRate):0;}

  // 실제 결제 기준 한 주문(연결 상품만). Cafe24 목록 응답에는 상품별 결제액이 없어(items.payment_amount 비어 있음)
  // 상품 결제액 = 주문 결제금액 − 고객이 낸 배송비, 이를 등록가 소계(판매가+옵션가)×수량 비율로 상품에 나눈다.
  // 원가 · 수수료율 · 주문당 비용은 연결한 계산의 입력값을 쓴다(계산기 margin-calc.js와 같은 식).
  function actualOrder(order,soldLines,costLink){
    var a=order.actual_order_amount||{},pay=n(order.payment_amount);
    var shipPaid=Math.max(0,n(a.shipping_fee)-n(a.coupon_shipping_fee_amount)-n(a.shipping_fee_discount_amount));
    var productPaid=Math.max(0,pay-shipPaid),subtotal=0;
    soldLines.forEach(function(l){subtotal+=l.gross;});
    var out={revenue:0,customerShipping:shipPaid,unitCost:0,fees:0,orderCosts:0,margin:0};
    soldLines.forEach(function(l){
      if(!l.link)return;
      var input=l.link.input,r=subtotal>0?productPaid*l.gross/subtotal:0,m=feeMult(input);
      var feeBase=input.feeBase==='before_discount'?l.gross:r;
      var cost=n(input.unitCost)*l.sold,fee=Math.round(feeBase*n(input.feeRate)/100*m),pg=Math.round(r*n(input.pgRate)/100*m);
      out.revenue+=r;out.unitCost+=cost;out.fees+=fee+pg;
    });
    var L=costLink.input,mL=feeMult(L);
    out.fees+=Math.round(shipPaid*shipRate(L)/100*mL)+Math.round(shipPaid*n(L.pgRate)/100*mL);
    out.orderCosts=Math.round(n(L.actualShipping))+Math.round(n(L.packaging))+Math.round(n(L.otherCost));
    out.margin=out.revenue+out.customerShipping-out.unitCost-out.fees-out.orderCosts;
    return out;
  }

  function summarize(orders,links){
    var s={orders:0,validOrders:0,soldQty:0,excluded:{},linkedQty:0,unlinkedQty:0,unitMarginTotal:0,orderAdjustTotal:0,
      ordersWithLinked:0,ordersMixed:0,ordersMultiLinked:0,products:{},unknownCodes:{},
      actual:{orders:0,linkedQty:0,revenue:0,customerShipping:0,unitCost:0,fees:0,orderCosts:0,margin:0,registeredMargin:0,excluded:{}}};
    (orders||[]).forEach(function(order){
      s.orders++;
      var sold=0,costLink=null,hasUnlinked=false,hasExcluded=false,lines=[],distinct={};
      (order.items||[]).forEach(function(item){
        var c=classifyItem(item);
        Object.keys(c.excluded).forEach(function(k){s.excluded[k]=(s.excluded[k]||0)+c.excluded[k];hasExcluded=true;});
        if(c.excluded.unknown)s.unknownCodes[item.status_code||'없음']=(s.unknownCodes[item.status_code||'없음']||0)+c.excluded.unknown;
        if(!c.sold)return;
        sold+=c.sold;
        var key=item.product_no+'|'+(item.variant_code||''),link=findLink(links,item.product_no,item.variant_code);
        var p=s.products[key]||(s.products[key]={product_no:item.product_no,variant_code:item.variant_code||'',product_name:item.product_name||'',option_value:item.option_value||'',soldQty:0,link:null});
        p.soldQty+=c.sold;p.link=link||null;
        lines.push({sold:c.sold,link:link||null,gross:(n(item.product_price)+n(item.option_price))*c.sold});
        if(link){
          s.linkedQty+=c.sold;s.unitMarginTotal+=Number(link.unit_margin)*c.sold;
          distinct[(link.product_no)+'|'+(link.variant_code||'')]=true;
          // 주문당 비용은 주문에 한 번만 — 연결 상품이 여럿이면 비용이 가장 큰(조정액이 가장 작은) 상품 하나 기준.
          if(!costLink||Number(link.order_adjust)<Number(costLink.order_adjust))costLink=link;
        }else{s.unlinkedQty+=c.sold;hasUnlinked=true;}
      });
      if(!sold)return;
      s.validOrders++;s.soldQty+=sold;
      if(!costLink)return;
      s.ordersWithLinked++;s.orderAdjustTotal+=Number(costLink.order_adjust)||0;
      if(hasUnlinked)s.ordersMixed++;
      if(Object.keys(distinct).length>1)s.ordersMultiLinked++;
      // 실제 결제 기준은 금액을 상품에 나눌 수 있는 주문만 — 아니면 사유별로 세고 빼다.
      var reason=hasExcluded?'partialStatus':!order.actual_order_amount?'noAmount':!(n(order.payment_amount)>0)?'zeroPayment':
        lines.some(function(l){return l.link&&!l.link.input;})?'noInput':null;
      if(reason){s.actual.excluded[reason]=(s.actual.excluded[reason]||0)+1;return;}
      var r=actualOrder(order,lines,costLink);
      s.actual.orders++;
      // 같은 주문을 등록 판매가 기준으로 계산한 값 — 두 기준을 같은 주문끼리 비교하기 위함.
      s.actual.registeredMargin+=Number(costLink.order_adjust)||0;
      lines.forEach(function(l){if(l.link){s.actual.linkedQty+=l.sold;s.actual.registeredMargin+=Number(l.link.unit_margin)*l.sold;}});
      ['revenue','customerShipping','unitCost','fees','orderCosts','margin'].forEach(function(k){s.actual[k]+=r[k];});
    });
    s.marginTotal=s.linkedQty?Math.round(s.unitMarginTotal+s.orderAdjustTotal):null;
    s.partial=s.linkedQty>0&&s.unlinkedQty>0; // 하나도 연결되지 않았으면 부분 계산이 아니라 계산 없음
    ['revenue','customerShipping','unitCost','fees','orderCosts','margin'].forEach(function(k){s.actual[k]=Math.round(s.actual[k]);});
    s.actual.registeredMargin=Math.round(s.actual.registeredMargin);
    s.actual.complete=s.actual.orders===s.ordersWithLinked;
    if(!s.actual.orders){s.actual.margin=null;s.actual.registeredMargin=null;}
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
