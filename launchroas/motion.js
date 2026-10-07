/* 화면 연출 공용 도구 — CSS 클래스를 붙였다 떼기만 한다. 움직임은 styles.css(.fx-*)에 있고,
   prefers-reduced-motion에서는 CSS가 이동 · 확대를 끈다. 어떤 효과도 클릭 · 입력을 막지 않는다. */
(function(){
  'use strict';
  function play(node,cls){
    if(!node)return;
    node.classList.remove(cls);void node.offsetWidth; // 같은 효과를 다시 재생하려면 한 번 빼고 다시 붙인다
    node.classList.add(cls);
    node.addEventListener('animationend',function done(e){if(e.target!==node)return;node.classList.remove(cls);node.removeEventListener('animationend',done);});
  }
  // 순서대로 짧은 간격(--fx-i)을 두고 등장 — 처음 결과가 보일 때만 부른다.
  function stagger(nodes){
    nodes.filter(Boolean).forEach(function(n,i){n.style.setProperty('--fx-i',i);play(n,'fx-rise');});
  }
  // 로어 서드 안내 — 저장 응답을 받은 뒤에만 부른다. 모바일에서는 키보드에 가리지 않게 위쪽(CSS).
  var timer=null;
  function toast(text){
    var box=document.getElementById('fxToast');
    if(!box){box=document.createElement('div');box.id='fxToast';box.className='fx-toast';box.setAttribute('role','status');document.body.appendChild(box);}
    box.textContent=text;box.hidden=false;play(box,'fx-toast-in');
    clearTimeout(timer);timer=setTimeout(function(){box.hidden=true;},2600);
  }
  window.LaunchRoasMotion={play:play,stagger:stagger,toast:toast};
})();
