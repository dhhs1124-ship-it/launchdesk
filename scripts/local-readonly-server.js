// 로컬 검증용 정적 서버 — 같은 출처(127.0.0.1:8765)에서
//   /            → LaunchROAS 미리보기(launchroas/)
//   /__main/     → 운영 메인 호환 브랜치 작업 폴더
// 를 함께 제공해 Supabase 로그인 세션(localStorage)을 공유한다.
// 모든 HTML에 쓰기 차단 스크립트를 끼워 넣어 DB 쓰기 · 쓰기 함수 호출을 막고 시도를 기록한다(읽기 전용 확인용).
const http = require('http'), fs = require('fs'), path = require('path');
const [PREVIEW, MAIN] = process.argv.slice(2).map((p) => path.resolve(p));
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const GUARD = `<script>
(function(){
  // 읽기 전용 가드 — 로컬 검증 전용(배포 코드 아님)
  window.__blockedWrites = [];
  var READ_FUNCTIONS = ['meta-insights', 'meta-adset-insights', 'cafe24-order-items', 'ai-weekly-review-status'];
  function blocked(kind, detail){
    window.__blockedWrites.push({ kind: kind, detail: detail, at: new Date().toISOString() });
    console.warn('[읽기 전용 가드] 차단:', kind, detail);
    var res = { data: null, error: { code: 'READ_ONLY_GUARD', message: '로컬 읽기 전용 확인 중이라 쓰기를 막았어요' } };
    var p = Promise.resolve(res);
    var chain = new Proxy(function(){}, { get: function(_, k){ if(k === 'then') return p.then.bind(p); if(k === 'catch') return p.catch.bind(p); return function(){ return chain; }; }, apply: function(){ return chain; } });
    return chain;
  }
  function wrapClient(c){
    var from = c.from.bind(c);
    c.from = function(table){
      var b = from(table);
      ['insert', 'upsert', 'update', 'delete'].forEach(function(m){ b[m] = function(){ return blocked('db.' + m, table); }; });
      return b;
    };
    if(c.rpc){ c.rpc = function(name){ return blocked('rpc', name); }; }
    var inv = c.functions.invoke.bind(c.functions);
    c.functions.invoke = function(name, opts){
      var body = opts && opts.body || {};
      if(name === 'ai-weekly-review' && body.action === 'status') return inv(name, opts);
      if(READ_FUNCTIONS.indexOf(name) >= 0) return inv(name, opts);
      return blocked('function', name + (body.action ? ':' + body.action : ''));
    };
    return c;
  }
  function hook(){
    if(!window.supabase || window.supabase.__guarded) return;
    var create = window.supabase.createClient.bind(window.supabase);
    window.supabase.createClient = function(){ return wrapClient(create.apply(null, arguments)); };
    window.supabase.__guarded = true;
  }
  hook();
  window.__readOnlyGuard = { hook: hook };
})();
</script>`;
http.createServer((q, r) => {
  let u = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  let root = PREVIEW;
  if (u.startsWith('/__main/')) { root = MAIN; u = u.slice('/__main'.length); }
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(root, u);
  if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); return r.end(); }
    const ext = path.extname(f);
    if (ext === '.html') {
      // supabase-js 스크립트 바로 다음에 가드를 넣는다(앱이 createClient를 부르기 전)
      d = Buffer.from(String(d).replace(/(<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"><\/script>)/, '$1\n' + GUARD));
    }
    r.writeHead(200, { 'Content-Type': T[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(d);
  });
}).listen(8765, '127.0.0.1');
