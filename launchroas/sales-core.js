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
  function shipCost(input){return Math.round(n(input.actualShipping))+Math.round(n(input.packaging))+Math.round(n(input.otherCost));}
  function shipRate(input){return input.shippingFeeMode==='same'?n(input.feeRate):input.shippingFeeMode==='separate'?n(input.shippingFeeRate):0;}

  var DISCOUNT_FIELDS=['coupon_discount_price','points_spent_amount','credits_spent_amount','membership_discount_amount',
    'shipping_fee_discount_amount','coupon_shipping_fee_amount','set_product_discount_amount','app_discount_amount','market_other_discount_amount'];
  // 쿠폰 종류는 Cafe24가 알려주지 않아 쿠폰 이름으로 추정한다(조회 성공 여부와 별개로 항상 추정).
  // 배송 · 상품 신호가 함께 있거나 둘 다 없으면 확정하지 않고 'ambiguous'로 둔다(상품 할인으로 계산).
  var SHIP_COUPON=/무료\s*배송|배송비/,PRODUCT_COUPON=/%|할인|상품/;
  function couponClass(name){
    var text=String(name||''),ship=SHIP_COUPON.test(text),prod=PRODUCT_COUPON.test(text.replace(SHIP_COUPON,''));
    return ship&&!prod?'shipping':prod&&!ship?'product':'ambiguous';
  }

  // 주문 금액 판정. 결제 수단을 셋으로 나눈다(공식 문서 actual_order_amount 필드):
  //  · 판매자에게 정산되는 결제 = payment_amount + naver_point(네이버페이 결제분, 네이버 포인트 포함 — 네이버가 정산)
  //    + credits_spent_amount(예치금 — 고객이 미리 낸 돈이라 매출에서 빼지 않는다)
  //  · 적립금 points_spent_amount — 쇼핑몰이 지급한 혜택이라 판매자 부담. 상품 판매금액에는 넣고 '적립금 사용'으로 따로 뺀다.
  //  결제 + 예치금 + 적립금 = 상품 소계 + 배송비 − 쿠폰 · 할인 일 때만 실제 결제로 쓴다(운영 쇼핑몰 7~10월 비취소 주문 284/289건 일치).
  //  아니면(일부 취소 · 마켓 주문 등) Cafe24가 기록한 주문 당시 판매가(상품가+옵션가)×수량으로 추정한다.
  function orderAmounts(order,lines,hasExcluded){
    var a=order.actual_order_amount,gross=0;
    lines.forEach(function(l){gross+=l.gross;});
    // 고객 배송비는 주문에 실제 부과된 값(배송비 − 배송비 할인 · 배송비 쿠폰)만 쓴다. 현재 무료배송 조건으로 다시 계산하지 않는다.
    // Cafe24는 '무료배송쿠폰'도 coupon_discount_price(일반 쿠폰)에 넣는다 — 주문 쿠폰 조회(orders/coupons)의 쿠폰 이름으로
    // 배송비 쿠폰을 가려 배송비만큼 고객 배송비에서 뺀다. 쿠폰을 조회하지 못한 주문은 상품 할인으로 보고 따로 센다.
    var shipKnown=!!(a&&a.shipping_fee!=null),coupon=a?n(a.coupon_discount_price):0,couponKind='none',shipCoupon=0;
    if(coupon>0){
      if(!Array.isArray(order.coupons)||!order.coupons.length)couponKind='unknown';
      else{
        var kinds=order.coupons.map(function(c){return couponClass(c.coupon_name);});
        couponKind=kinds.indexOf('ambiguous')>=0?'ambiguous':kinds.indexOf('shipping')>=0?'shipping':'product';
      }
      // 배송비 쿠폰(이름 기준 추정)만 배송비 한도 안에서 고객 배송비에서 빼고, 나머지는 상품 할인으로 남긴다.
      if(couponKind==='shipping')shipCoupon=Math.min(coupon,Math.max(0,n(a.shipping_fee)-n(a.coupon_shipping_fee_amount)-n(a.shipping_fee_discount_amount)));
    }
    var shipPaid=shipKnown?Math.max(0,n(a.shipping_fee)-n(a.coupon_shipping_fee_amount)-n(a.shipping_fee_discount_amount)-shipCoupon):0;
    var cash=n(order.payment_amount)+n(order.naver_point),credits=a?n(a.credits_spent_amount):0,points=a?n(a.points_spent_amount):0,reason;
    var base={shipPaid:shipPaid,shipKnown:shipKnown,gross:gross,couponKind:couponKind,points:0,credits:0,pgShare:1};
    if(hasExcluded)reason='partialStatus';
    else if(!a)reason='noAmount';
    else{
      var disc=0;DISCOUNT_FIELDS.forEach(function(k){disc+=n(a[k]);});
      if(cash+credits>0&&Math.abs(cash-(n(a.order_price_amount)+n(a.shipping_fee)-disc))<1){
        var total=cash+credits+points;
        return Object.assign(base,{mode:'actual',productPaid:Math.max(0,total-shipPaid),points:points,credits:credits,
          pgShare:total>0?cash/total:1}); // PG 수수료는 카드 · 네이버페이 등 이번 결제분에만
      }
      reason=cash>0?'amountMismatch':'zeroPayment';
    }
    if(reason!=='partialStatus'&&lines.some(function(l){return l.savedPrice;}))reason='savedPrice';
    return Object.assign(base,{mode:'estimated',reason:reason,productPaid:gross});
  }

  // 연결 상품의 마진(한 주문). 상품 금액은 등록가 소계 비율로 나누고, 원가 · 수수료율은 연결한 계산의 입력값(계산기와 같은 식).
  function orderMargin(lines,costLink,amt){
    var out={revenue:0,customerShipping:amt.shipPaid,points:0,unitCost:0,fees:0,feeSales:0,feePg:0,feeShip:0,orderCosts:0,margin:0};
    var linkedGross=0;
    lines.forEach(function(l){
      if(!l.link)return;
      var input=l.link.input,share=amt.gross>0?l.gross/amt.gross:0,r=amt.productPaid*share,m=feeMult(input);
      var feeBase=input.feeBase==='before_discount'?l.gross:r;
      linkedGross+=share;
      out.revenue+=r;out.unitCost+=n(input.unitCost)*l.sold; // 실제 0원 판매(사은품)도 원가는 뺀다
      // 판매 수수료: 저장한 기준(할인 후/전 상품금액, 적립금 사용분 포함) × 판매 수수료율 · PG: 적립금 · 예치금을 뺀 결제분 × PG 수수료율
      out.feeSales+=Math.round(feeBase*n(input.feeRate)/100*m);out.feePg+=Math.round(r*amt.pgShare*n(input.pgRate)/100*m);
    });
    out.points=Math.round(amt.points*linkedGross); // 적립금은 상품 금액 비율로 연결 상품 몫만
    var L=costLink.input,mL=feeMult(L);
    out.feeShip=Math.round(amt.shipPaid*shipRate(L)/100*mL);out.feePg+=Math.round(amt.shipPaid*amt.pgShare*n(L.pgRate)/100*mL);
    out.fees=out.feeSales+out.feePg+out.feeShip;
    // 배송 · 포장 · 기타 비용 — 실제 택배 지출액을 알 수 없어 저장한 설정값으로 추정한다.
    // 추정 규칙: 주문 1건에 한 번, 담긴 상품 중 설정값이 가장 큰 상품 기준. Cafe24 배송코드(shipping_code)가 나뉘어도
    // 실제로 따로 발송했는지는 알 수 없어(운영 쇼핑몰의 나뉜 5건은 모두 함께 발송) 한 번만 뺀다.
    out.orderCosts=shipCost(L);
    out.margin=out.revenue+out.customerShipping-out.points-out.unitCost-out.fees-out.orderCosts;
    return out;
  }

  // 주문 단위 수수료(배송비 수수료 · PG) 기준 상품 — 저장한 배송·포장 비용이 가장 큰 상품.
  function linkCost(l){return l.input?shipCost(l.input):-Number(l.order_adjust)||0;}
  var SUMS=['revenue','customerShipping','points','unitCost','fees','feeSales','feePg','feeShip','orderCosts','total'];
  function summarize(orders,links){
    var s={orders:0,validOrders:0,soldQty:0,excluded:{},linkedQty:0,unlinkedQty:0,
      ordersWithLinked:0,ordersMixed:0,ordersMultiLinked:0,products:{},unknownCodes:{},
      margin:{actualOrders:0,estimatedOrders:0,savedOnlyOrders:0,estimated:{},estimatedTotal:0,
        revenue:0,customerShipping:0,unitCost:0,fees:0,orderCosts:0,total:0,points:0,feeSales:0,feePg:0,feeShip:0,ship:{charged:0,free:0,unknown:0},multiCodeOrders:0,coupon:{},pointsOrders:0,creditsOrders:0}};
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
        // product_price · option_price는 1개 기준(운영 쇼핑몰 31일 52건에서 Σ(상품가+옵션가)×수량 = 주문 상품금액 일치).
        // 판매가 0원(사은품 등)은 실제 0원 판매로 둔다. 판매가 값 자체가 없을 때만 저장한 판매가로 추정한다.
        var g=(n(item.product_price)+n(item.option_price))*c.sold,savedPrice=false;
        if(item.product_price==null&&link&&link.input&&n(link.input.price)>0){g=n(link.input.price)*c.sold;savedPrice=true;}
        lines.push({sold:c.sold,link:link||null,gross:g,savedPrice:savedPrice,shipping_code:item.shipping_code||''});
        if(link){
          s.linkedQty+=c.sold;
          distinct[(link.product_no)+'|'+(link.variant_code||'')]=true;
          // 주문당 비용은 주문에 한 번만 — 연결 상품이 여럿이면 비용이 가장 큰(조정액이 가장 작은) 상품 하나 기준.
          if(!costLink||linkCost(link)>linkCost(costLink))costLink=link;
        }else{s.unlinkedQty+=c.sold;hasUnlinked=true;}
      });
      if(!sold)return;
      s.validOrders++;s.soldQty+=sold;
      if(!costLink)return;
      s.ordersWithLinked++;
      if(hasUnlinked)s.ordersMixed++;
      if(Object.keys(distinct).length>1)s.ordersMultiLinked++;
      var m=s.margin,amt=orderAmounts(order,lines,hasExcluded);
      // 계산 입력값을 못 찾으면 저장한 1개당 마진 · 주문당 조정액으로만 계산한다.
      if(!costLink.input||lines.some(function(l){return l.link&&!l.link.input;})){
        m.savedOnlyOrders++;
        var saved=Number(costLink.order_adjust)||0;
        lines.forEach(function(l){if(l.link)saved+=Number(l.link.unit_margin)*l.sold;});
        m.total+=saved;return;
      }
      var r=orderMargin(lines,costLink,amt);
      if(!amt.shipKnown)m.ship.unknown++;else if(amt.shipPaid>0)m.ship.charged++;else m.ship.free++;
      if(new Set(lines.map(function(l){return l.shipping_code;})).size>1)m.multiCodeOrders++;
      m.coupon[amt.couponKind]=(m.coupon[amt.couponKind]||0)+1;
      if(amt.points)m.pointsOrders++;if(amt.credits)m.creditsOrders++;
      ['revenue','customerShipping','points','unitCost','fees','feeSales','feePg','feeShip','orderCosts'].forEach(function(k){m[k]+=r[k];});
      m.total+=r.margin;
      if(amt.mode==='actual')m.actualOrders++;
      else{m.estimatedOrders++;m.estimated[amt.reason]=(m.estimated[amt.reason]||0)+1;m.estimatedTotal+=r.margin;}
    });
    SUMS.forEach(function(k){s.margin[k]=Math.round(s.margin[k]);});
    s.margin.estimatedTotal=Math.round(s.margin.estimatedTotal);
    s.marginTotal=s.linkedQty?s.margin.total:null;
    s.partial=s.linkedQty>0&&s.unlinkedQty>0; // 하나도 연결되지 않았으면 부분 계산이 아니라 계산 없음
    s.products=Object.keys(s.products).map(function(k){return s.products[k];}).sort(function(a,b){return b.soldQty-a.soldQty;});
    // 상품 종류 기준(옵션은 같은 상품으로 묶음): 판매된 상품 종류 · 그중 마진이 빠진 옵션이 하나라도 있는 종류.
    var kinds={},open={};
    s.products.forEach(function(p){kinds[p.product_no]=true;if(!p.link)open[p.product_no]=true;});
    s.productKinds=Object.keys(kinds).length;s.unlinkedKinds=Object.keys(open).length;
    // 남은 상품 이름(판매 많은 순) — '남은 1종'이 무엇인지 보여주기 위해.
    var left={};
    s.products.forEach(function(p){if(p.link)return;var x=left[p.product_no]||(left[p.product_no]={product_no:p.product_no,product_name:p.product_name,soldQty:0});x.soldQty+=p.soldQty;});
    s.unlinkedList=Object.keys(left).map(function(k){return left[k];}).sort(function(a,b){return b.soldQty-a.soldQty;});
    return s;
  }

  // 상품 · 옵션별로 가장 최근 저장만 남긴다(created_at 내림차순 목록 기준). tool_records는 수정(UPDATE) 권한이 없어
  // 새로 저장한 뒤 이전 기록을 지우는데, 지우기가 실패해 중복이 남아도 최신 값만 쓰기 위함.
  function latestLinks(links){
    var seen={};
    return (links||[]).filter(function(l){var k=l.product_no+'|'+(l.variant_code||'');if(seen[k])return false;seen[k]=true;return true;});
  }

  // 광고비 원화 환산 — 원화 계정이면 그대로, 외화는 사용자가 저장한 환율이 있어야 한다(없으면 null).
  function adSpendKrw(spend,currency,fx){
    var amount=Number(spend);
    if(!Number.isFinite(amount))return null;
    if(String(currency||'').toUpperCase()==='KRW')return Math.round(amount);
    if(!fx||String(fx.currency).toUpperCase()!==String(currency).toUpperCase()||!(Number(fx.krw_per_unit)>0))return null;
    return Math.round(amount*Number(fx.krw_per_unit));
  }

  // 광고 세트 판단 — 연결한 상품 마진의 손익분기 ROAS(총 수입 ÷ 광고 전 잔액)와 Meta ROAS를 비교만 한다.
  // 근거가 부족하면 "판단 보류". 중단·증액 같은 권고는 하지 않는다.
  var MIN_PURCHASES=3;
  function adVerdict(link,metrics){
    var m=metrics||{},purchases=m.purchase&&m.purchase.observed?Number(m.purchase.value)||0:0,roas=m.roas==null?null:Number(m.roas);
    var hold=function(reason){return {label:'판단 보류',tone:'hold',reason:reason};};
    if(!link)return hold('상품 마진 미연결');
    var pre=Number(link.pre_ad),income=Number(link.total_income);
    if(!(pre>0)||!(income>0))return hold('연결한 마진이 0원 이하라 손익분기를 계산할 수 없음');
    if(!(Number(m.spend)>0)||roas==null)return hold('광고비 · ROAS 없음');
    if(purchases<MIN_PURCHASES)return hold('Meta 구매 '+purchases+'건 — '+MIN_PURCHASES+'건 미만');
    var breakeven=income/pre;
    return roas<breakeven
      ?{label:'손익분기 미달',tone:'below',reason:'',breakeven:breakeven}
      :{label:'손익분기 이상',tone:'above',reason:'',breakeven:breakeven};
  }

  return {classifyItem:classifyItem,splitMargin:splitMargin,findLink:findLink,summarize:summarize,adSpendKrw:adSpendKrw,adVerdict:adVerdict,MIN_PURCHASES:MIN_PURCHASES,latestLinks:latestLinks};
});
