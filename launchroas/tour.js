/* 처음 사용 가이드 — 실제 화면 위에 반투명 배경을 깔고 안내 대상만 밝게 비춘다.
   완료 여부는 운영 현황의 실제 저장 상태(launchroas:sales-state의 steps)로만 표시한다(가이드를 넘겼다고 완료 아님).
   배경은 클릭을 막지 않는다(pointer-events: none) — 가이드를 보면서도 화면을 그대로 조작할 수 있다. */
(function(){
  'use strict';
  var app=window.LaunchRoasApp,M=window.LaunchRoasMotion;if(!app)return;
  var SEEN='launchroas.tourSeen.v1',steps=null,idx=-1,layer,spot,card,target=null,raf=0,lastSales=null;
  function byId(id){return document.getElementById(id);}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function visible(sel){
    var list=sel.split(',');
    for(var i=0;i<list.length;i++){var n=document.querySelector(list[i].trim());if(n&&n.offsetParent!==null&&n.getClientRects().length)return n;}
    return null;
  }
  function seen(){try{return localStorage.getItem(SEEN)==='1';}catch(e){return true;}}
  function markSeen(){try{localStorage.setItem(SEEN,'1');}catch(e){}}
  function openProducts(){app.showView('calculator');window.dispatchEvent(new CustomEvent('launchroas:open-product-picker'));}

  // 단계 정의. state는 실제 저장 상태(없으면 확인 중).
  function build(){
    var st=(lastSales&&lastSales.steps)||[];
    function status(i){var x=st[i];return x?(x.done?'완료됨 · ':'')+x.text:'설정 상태 확인 중';}
    return [
      {target:'#connectionPills, .sidebar [data-view="connections"], .mobile-nav [data-view="connections"]',title:'1. 쇼핑몰 · 광고 계정 연결',
       text:'Cafe24 주문과 Meta 광고비를 가져오려면 두 계정을 연결해요.',state:status(0),done:st[0]&&st[0].done,
       action:{label:'연결 관리 열기',run:function(){app.showView('connections');}}},
      {target:'.sidebar [data-view="calculator"], .mobile-nav [data-view="calculator"]',title:'2. 상품 선택 · 비용 저장',
       text:'상품을 고르고 원가 · 수수료 · 배송비를 저장하면 계산에 들어가요.',state:status(1),done:st[1]&&st[1].done,
       action:{label:'상품 비용 입력하기',run:openProducts}},
      {target:'.key-profit',view:'overview',title:'3. 광고비 차감 후 예상 이익',
       text:'판매 마진에서 실제 광고비를 뺀 금액이에요. 일부 상품만 저장했으면 \'일부 상품 기준\'으로 표시돼요.',state:status(2),done:st[2]&&st[2].done},
      {target:'#insights',view:'overview',title:'4. 주간 AI 점검',
       text:'주간 AI 점검(주 1회)을 누르면 지난주 광고 지표와 소재를 함께 보고 우선 점검할 광고와 변경안을 알려줘요. 판단 이유 · 지금 할 일 · 변경 예시는 광고를 눌러 펼쳐 봐요.',state:'',done:false}
    ];
  }

  function ensure(){
    if(layer)return;
    layer=el('div','tour-layer');layer.hidden=true;
    spot=el('div','tour-spot');card=el('section','tour-card');card.setAttribute('role','dialog');card.setAttribute('aria-modal','false');card.setAttribute('aria-labelledby','tourTitle');
    layer.append(spot,card);document.body.appendChild(layer);
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
    document.addEventListener('keydown',function(e){if(layer.hidden)return;if(e.key==='Escape')close();if(e.key==='ArrowRight')go(idx+1);if(e.key==='ArrowLeft')go(idx-1);});
  }
  function schedule(){if(!layer||layer.hidden)return;cancelAnimationFrame(raf);raf=requestAnimationFrame(place);}
  // 강조 영역과 설명 카드 위치. 카드는 화면 아래(로어 서드)에 두고, 대상이 아래쪽이면 위로 옮겨 서로 가리지 않게.
  function place(){
    if(!target)return;
    var r=target.getBoundingClientRect(),pad=6,vh=window.innerHeight;
    spot.style.transform='translate('+(r.left-pad)+'px,'+(r.top-pad)+'px)';
    spot.style.width=(r.width+pad*2)+'px';spot.style.height=(r.height+pad*2)+'px';
    var ch=card.offsetHeight||180;
    card.classList.toggle('top',r.bottom+ch+24>vh&&r.top>ch+24);
  }
  function scrollTo(node){
    var r=node.getBoundingClientRect(),ch=card.offsetHeight||200,vh=window.innerHeight;
    // 대상이 카드에 가리지 않도록 위쪽 1/5 지점으로(이미 보이면 그대로)
    if(!(r.top<72||r.bottom>vh-ch-24))return;
    var top=window.scrollY+r.top-Math.min(96,vh*0.18);
    window.scrollTo({top:top,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    // 부드러운 스크롤이 실행되지 않는 환경(백그라운드 탭 등)에서는 바로 이동해 강조 영역이 화면 밖에 남지 않게
    setTimeout(function(){if(target===node&&Math.abs(window.scrollY-top)>40){window.scrollTo(0,top);place();}},800);
  }
  function render(){
    var s=steps[idx];card.replaceChildren();
    var head=el('div','tour-head');head.append(el('span','tour-count',(idx+1)+' / '+steps.length));
    var skip=el('button','tour-skip','건너뛰기');skip.type='button';skip.addEventListener('click',close);head.appendChild(skip);
    var title=el('h2','tour-title');title.id='tourTitle';
    // 키네틱 타이포: 단어 단위로 짧게 등장(움직임 줄이기 설정이면 CSS가 끈다)
    s.title.split(' ').forEach(function(w,i){if(i)title.appendChild(document.createTextNode(' '));var sp=el('span','tour-word',w);sp.style.setProperty('--w',i);title.appendChild(sp);});
    card.append(head,title,el('p','tour-text',s.text));
    if(s.state)card.appendChild(el('p','tour-state'+(s.done?' done':''),(s.done?'✓ ':'')+s.state));
    var nav=el('div','tour-nav');
    var prev=el('button','secondary','이전');prev.type='button';prev.disabled=idx===0;prev.addEventListener('click',function(){go(idx-1);});
    nav.appendChild(prev);
    if(s.action&&!s.done){var act=el('button','secondary tour-act',s.action.label);act.type='button';act.addEventListener('click',function(){close();s.action.run();});nav.appendChild(act);}
    var next=el('button','primary',idx===steps.length-1?'마치기':'다음');next.type='button';next.addEventListener('click',function(){go(idx+1);});
    nav.appendChild(next);card.appendChild(nav);
  }
  function go(i){
    if(i<0)return;if(i>=steps.length){close();return;}
    var first=idx<0;idx=i;var s=steps[idx];
    if(s.view)app.showView(s.view);
    if(target)target.classList.remove('tour-target');
    target=visible(s.target)||visible('.key-profit');
    render();
    if(M)M.play(card,first?'fx-whip':'fx-swap'); // 첫 장면만 휩팬, 이후는 짧은 전환
    if(target){target.classList.add('tour-target');if(M)M.play(target,'fx-punch');scrollTo(target);}
    place();setTimeout(place,260);setTimeout(place,750); // 부드러운 스크롤이 끝난 뒤 위치를 한 번 더 맞춘다
    card.querySelector('.primary').focus({preventScroll:true});
  }
  function open(){
    ensure();steps=build();idx=-1;layer.hidden=false;document.body.classList.add('tour-open');
    app.showView('overview');go(0);markSeen();
  }
  function close(){
    if(!layer)return;layer.hidden=true;document.body.classList.remove('tour-open');
    if(target)target.classList.remove('tour-target');target=null;idx=-1;
  }
  document.addEventListener('click',function(e){var b=e.target.closest('[data-tour-open]');if(b){e.preventDefault();open();}});
  // 실제 상태가 바뀌면 열린 단계의 완료 표시도 갱신. 첫 방문(로그인 · 연결 상태 확인 후)에는 한 번 자동으로 연다.
  window.addEventListener('launchroas:sales-state',function(e){
    lastSales=e.detail;
    if(layer&&!layer.hidden&&idx>=0){steps=build();render();place();}
    else if(e.detail.ready&&!seen()&&!document.querySelector('#overviewView[hidden]'))setTimeout(function(){if(!seen())open();},600);
  });
  window.LaunchRoasTour={open:open,close:close};
})();
