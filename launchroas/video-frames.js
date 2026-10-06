/* [준비 · 화면 미연결] 광고 영상에서 지정한 시각의 프레임을 브라우저 안에서 뽑는다 — 서버 · Storage에 영상을 저장하지 않는다.
   입력: 사용자가 고른 파일(File) 또는 재생 주소(URL, CORS 허용 시). 화면에 보이는 탭에서 <video> 탐색(seek) + canvas로 추출한다.
   (자동화 브라우저처럼 숨김 탭에서는 <video>가 영상을 불러오지 않을 수 있다 — docs/ai/research/2026-10-06-competitor-video-notes.md)
   결과 프레임은 메모리에만 있고, 분석 요청에 담아 보낸 뒤 버린다. */
(function(root){
  'use strict';
  function once(el, ok, bad){ return new Promise(function(res, rej){ function a(){ cl(); res(); } function b(){ cl(); rej(new Error(bad)); } function cl(){ el.removeEventListener(ok, a); el.removeEventListener('error', b); } el.addEventListener(ok, a); el.addEventListener('error', b); }); }
  async function extractFrames(input, times, opts){
    var o = opts || {}, maxW = o.maxWidth || 512, url = typeof input === 'string' ? input : URL.createObjectURL(input);
    var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; if(typeof input === 'string') v.crossOrigin = 'anonymous';
    v.src = url;
    try{
      await once(v, 'loadedmetadata', '영상을 열지 못했어요');
      var w = Math.min(maxW, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
      var out = [];
      for(var i = 0; i < times.length; i++){
        var t = Math.min(times[i], Math.max(0, v.duration - 0.05));
        v.currentTime = t; await once(v, 'seeked', '해당 시각으로 이동하지 못했어요');
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        var data = c.toDataURL('image/jpeg', 0.8); // CORS가 막힌 주소면 여기서 SecurityError — 파일 업로드로 대체
        out.push({ t: Math.round(times[i] * 10) / 10, mediaType: 'image/jpeg', base64: data.slice(data.indexOf(',') + 1) });
      }
      return { duration: v.duration, width: w, height: h, frames: out };
    } finally { if(typeof input !== 'string') URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
  }
  root.LaunchRoasVideoFrames = { extractFrames: extractFrames };
})(typeof window !== 'undefined' ? window : globalThis);
