/* [준비 · 화면 미연결] 광고 영상에서 지정한 시각의 프레임을 브라우저 안에서 뽑는다 — 서버 · Storage에 영상을 저장하지 않는다.
   입력: 사용자가 고른 파일(File/Blob) 또는 재생 주소(URL, CORS 허용 시).
   1차: <video> 탐색(seek) + canvas. 2차(대체): <video>가 열리지 않으면(예: 숨김 탭) MP4는 WebCodecs로 직접 디코딩한다.
   결과 프레임은 메모리에만 있고, 분석 요청에 담아 보낸 뒤 버린다.
   planFrameTimes는 서버(supabase/functions/_shared/ai-video-core.mjs)와 같은 규칙이다(tests/ai-video-core.test.mjs에서 일치 확인). */
(function(root){
  'use strict';
  // 0~3초 0.5초 간격 + 이후 간격을 넓혀 최대 maxFrames장 + 마지막 프레임
  function planFrameTimes(duration, opts){
    var o = opts || {}, step = o.step || 2, maxFrames = o.maxFrames || 24, t = [];
    if(!(duration > 0)) return [];
    for(var x = 0; x <= Math.min(3, duration - 0.05); x += 0.5) t.push(Math.round(x * 10) / 10);
    var s = step;
    while(t.length + Math.ceil(Math.max(0, duration - 4) / s) + 1 > maxFrames) s += 0.5;
    for(var y = 4; y < duration - 0.3; y += s) t.push(Math.round(y * 10) / 10);
    var last = Math.max(0, Math.floor((duration - 0.2) * 10) / 10);
    if(t[t.length - 1] < last) t.push(last);
    return t;
  }
  function once(el, ok, bad, ms){ return new Promise(function(res, rej){ var to = ms ? setTimeout(function(){ cl(); rej(new Error('timeout')); }, ms) : null; function a(){ cl(); res(); } function b(){ cl(); rej(new Error(bad)); } function cl(){ if(to) clearTimeout(to); el.removeEventListener(ok, a); el.removeEventListener('error', b); } el.addEventListener(ok, a); el.addEventListener('error', b); }); }
  function toFrame(canvas, t){ var d = canvas.toDataURL('image/jpeg', 0.8); return { t: Math.round(t * 10) / 10, mediaType: 'image/jpeg', base64: d.slice(d.indexOf(',') + 1) }; }

  async function viaVideo(input, times, maxW){
    var url = typeof input === 'string' ? input : URL.createObjectURL(input);
    var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; if(typeof input === 'string') v.crossOrigin = 'anonymous';
    v.src = url;
    try{
      await once(v, 'loadedmetadata', '영상을 열지 못했어요', 5000);
      if(!isFinite(v.duration)){ v.currentTime = 1e101; await once(v, 'durationchange', '영상 길이를 알 수 없어요', 5000); v.currentTime = 0; await once(v, 'seeked', '처음으로 이동하지 못했어요', 5000); }
      var w = Math.min(maxW, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
      var ts = typeof times === 'function' ? times(v.duration) : times, out = [];
      for(var i = 0; i < ts.length; i++){
        v.currentTime = Math.min(ts[i], Math.max(0, v.duration - 0.05)); await once(v, 'seeked', '해당 시각으로 이동하지 못했어요', 5000);
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        out.push(toFrame(c, ts[i])); // CORS가 막힌 주소면 SecurityError — 파일 업로드로 대체
      }
      return { method: 'video', duration: v.duration, width: w, height: h, frames: out };
    } finally { if(typeof input !== 'string') URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
  }

  // ---- MP4(비조각) 직접 디코딩 — 숨김 탭에서도 동작. 조각 MP4 · WebM은 지원하지 않는다 ----
  function mp4Tracks(buf){
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    function boxes(s, e){ var o = [], p = s; while(p + 8 <= e){ var size = dv.getUint32(p), type = String.fromCharCode(u8[p+4], u8[p+5], u8[p+6], u8[p+7]), h = 8; if(size === 1){ size = Number(dv.getBigUint64(p + 8)); h = 16; } else if(size === 0) size = e - p; o.push({ type: type, h: p + h, e: p + size }); p += size; } return o; }
    function find(s, e, t){ return boxes(s, e).filter(function(b){ return b.type === t; })[0]; }
    var moov = find(0, buf.byteLength, 'moov'); if(!moov) throw new Error('MP4 moov 없음(조각 MP4는 지원하지 않음)');
    var tracks = [];
    boxes(moov.h, moov.e).filter(function(b){ return b.type === 'trak'; }).forEach(function(trak){
      var mdia = find(trak.h, trak.e, 'mdia'), hdlr = find(mdia.h, mdia.e, 'hdlr'), handler = String.fromCharCode.apply(null, u8.slice(hdlr.h + 8, hdlr.h + 12));
      var mdhd = find(mdia.h, mdia.e, 'mdhd'), v = u8[mdhd.h], ts = v ? dv.getUint32(mdhd.h + 20) : dv.getUint32(mdhd.h + 12), dur = v ? Number(dv.getBigUint64(mdhd.h + 24)) : dv.getUint32(mdhd.h + 16);
      var minf = find(mdia.h, mdia.e, 'minf'), stbl = find(minf.h, minf.e, 'stbl'), g = function(t){ return find(stbl.h, stbl.e, t); };
      var stsd = g('stsd'), entry = boxes(stsd.h + 8, stsd.e)[0], desc = null, codec = null, w = 0, hh = 0;
      if(handler === 'vide'){ w = dv.getUint16(entry.h + 24); hh = dv.getUint16(entry.h + 26); var cfg = boxes(entry.h + 78, entry.e).filter(function(b){ return b.type === 'avcC'; })[0]; if(cfg){ desc = u8.slice(cfg.h, cfg.e); codec = 'avc1.' + [desc[1], desc[2], desc[3]].map(function(x){ return x.toString(16).padStart(2, '0'); }).join(''); } }
      var rd = function(b, f){ var n = dv.getUint32(b.h + 4), a = []; for(var i = 0; i < n; i++) a.push(f(b.h + 8, i)); return a; };
      var stts = rd(g('stts'), function(o, i){ return [dv.getUint32(o + i * 8), dv.getUint32(o + i * 8 + 4)]; }), ctB = g('ctts'), ctts = ctB ? rd(ctB, function(o, i){ return [dv.getUint32(o + i * 8), dv.getInt32(o + i * 8 + 4)]; }) : null;
      var sz = g('stsz'), uni = dv.getUint32(sz.h + 4), cnt = dv.getUint32(sz.h + 8), sizes = []; for(var i = 0; i < cnt; i++) sizes.push(uni || dv.getUint32(sz.h + 12 + i * 4));
      var stsc = rd(g('stsc'), function(o, i){ return [dv.getUint32(o + i * 12), dv.getUint32(o + i * 12 + 4)]; }), co = g('stco') || g('co64');
      var offs = rd(co, function(o, i){ return co.type === 'stco' ? dv.getUint32(o + i * 4) : Number(dv.getBigUint64(o + i * 8)); }), ssB = g('stss'), sync = ssB ? new Set(rd(ssB, function(o, i){ return dv.getUint32(o + i * 4) - 1; })) : null;
      var samples = [], si = 0;
      for(var c = 0; c < offs.length; c++){ var spc = 0; for(var k = stsc.length - 1; k >= 0; k--) if(c + 1 >= stsc[k][0]){ spc = stsc[k][1]; break; } var off = offs[c]; for(var j = 0; j < spc && si < cnt; j++){ samples.push({ off: off, size: sizes[si] }); off += sizes[si]; si++; } }
      var dts = 0, q = 0; stts.forEach(function(x){ for(var i = 0; i < x[0]; i++){ if(samples[q]) samples[q].dts = dts; dts += x[1]; q++; } });
      if(ctts){ q = 0; ctts.forEach(function(x){ for(var i = 0; i < x[0]; i++){ if(samples[q]) samples[q].cto = x[1]; q++; } }); }
      samples.forEach(function(s, i){ s.cts = s.dts + (s.cto || 0); s.key = sync ? sync.has(i) : true; });
      tracks.push({ handler: handler, ts: ts, dur: dur / ts, codec: codec, desc: desc, w: w, h: hh, samples: samples });
    });
    return tracks;
  }
  async function viaWebCodecs(input, times, maxW){
    if(typeof VideoDecoder === 'undefined') throw new Error('이 브라우저는 WebCodecs를 지원하지 않아요');
    var buf = typeof input === 'string' ? await (await fetch(input)).arrayBuffer() : await input.arrayBuffer();
    var tr = mp4Tracks(buf).filter(function(t){ return t.handler === 'vide'; })[0];
    if(!tr || !tr.codec || tr.codec.indexOf('avc1') !== 0) throw new Error('H.264 MP4만 직접 디코딩할 수 있어요');
    var ts = (typeof times === 'function' ? times(tr.dur) : times).slice().sort(function(a, b){ return a - b; }), want = ts.slice();
    var w = Math.min(maxW, tr.w), h = Math.round(w * tr.h / tr.w), out = [];
    await new Promise(function(res){
      var dec = new VideoDecoder({ output: function(f){ var t = f.timestamp / 1e6; while(want.length && t >= want[0] - 0.02){ var tt = want.shift(), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(f, 0, 0, w, h); out.push(toFrame(c, tt)); } f.close(); }, error: function(){ res(); } });
      dec.configure({ codec: tr.codec, description: tr.desc, codedWidth: tr.w, codedHeight: tr.h });
      var u8 = new Uint8Array(buf);
      tr.samples.forEach(function(s){ dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.cts / tr.ts * 1e6), data: u8.subarray(s.off, s.off + s.size) })); });
      dec.flush().then(res, res);
    });
    return { method: 'webcodecs', duration: tr.dur, width: w, height: h, frames: out };
  }

  // times: 시각 배열 또는 (duration) => 시각 배열(기본 planFrameTimes)
  async function extractFrames(input, times, opts){
    var o = opts || {}, maxW = o.maxWidth || 512, plan = times || planFrameTimes;
    try { return await viaVideo(input, plan, maxW); }
    catch(e){ if(o.noFallback) throw e; return await viaWebCodecs(input, plan, maxW); }
  }
  root.LaunchRoasVideoFrames = { extractFrames: extractFrames, planFrameTimes: planFrameTimes, mp4Tracks: mp4Tracks };
})(typeof window !== 'undefined' ? window : globalThis);
