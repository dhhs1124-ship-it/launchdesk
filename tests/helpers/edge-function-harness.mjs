// 실제 supabase/functions/<이름>/index.ts를 Node에서 그대로 실행하기 위한 최소 도구.
// - Deno 전용 import(jsr:@supabase/...)만 가짜 모듈로 바꾼다. 함수 본문 · _shared 모듈은 실제 코드다.
// - withSupabase는 요청마다 globalThis.__edgeCtx(테스트가 넣는 가짜 ctx)를 넘긴다.
// - 가짜 Supabase 클라이언트는 테이블별 처리 함수(handlers[table])가 쿼리 내용을 보고 결과를 정한다.
// 라이브 Supabase · Meta · Cafe24에는 접속하지 않는다(fetch는 각 테스트가 가짜로 바꾼다).
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const STUBS = {
  'jsr:@supabase/functions-js/edge-runtime.d.ts': 'export {};',
  'jsr:@supabase/server@^1':
    'export function withSupabase(_opts, handler){ return (req) => handler(req, globalThis.__edgeCtx); }',
};

registerHooks({
  resolve(specifier, context, next) {
    if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const FUNCTIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'functions');

export function setEnv(values) {
  globalThis.Deno = { env: { get: (k) => (values && Object.prototype.hasOwnProperty.call(values, k) ? values[k] : undefined) } };
}
setEnv({});

// tag: 같은 함수를 다른 환경 변수로 한 번 더 불러올 때(모듈 최상위에서 읽는 값 — 예: AI_POLICY_VERSION). 같은 tag는 캐시된다.
export async function loadFunction(name, tag = '') {
  const mod = await import(pathToFileURL(path.join(FUNCTIONS_DIR, name, 'index.ts')).href + (tag ? '?' + encodeURIComponent(tag) : ''));
  return mod.default.fetch;
}

export function jsonRequest(body, url = 'https://fn.local/') {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

// 가짜 Supabase 클라이언트. 모든 쿼리는 log에 남고, handlers[table](q)가 { data, error }를 돌려준다.
// q: { table, op: 'select'|'insert'|'update'|'upsert'|'delete', values, options, filters: [[kind, col, val]], mode, columns }
export function fakeSupabase(handlers, log) {
  const calls = log || [];
  return {
    calls,
    // RPC는 handlers['rpc:<이름>'](args)가 { data, error }를 돌려준다.
    async rpc(name, args) {
      calls.push({ table: 'rpc:' + name, op: 'rpc', values: args });
      const h = handlers['rpc:' + name];
      const r = h ? await h(args) : { data: null, error: { message: 'no fake handler for rpc ' + name } };
      return { data: r && r.data !== undefined ? r.data : null, error: (r && r.error) || null };
    },
    from(table) {
      const q = { table, op: 'select', values: null, options: null, filters: [], mode: 'many', columns: null };
      const run = async () => {
        calls.push(JSON.parse(JSON.stringify(q)));
        const h = handlers[table];
        const r = h ? await h(q) : { data: null, error: { message: 'no fake handler for ' + table } };
        return { data: r && r.data !== undefined ? r.data : null, error: (r && r.error) || null };
      };
      const filter = (kind) => (col, val) => { q.filters.push([kind, col, val]); return b; };
      const b = {
        select(cols) { if (q.op === 'select') q.columns = cols; else q.returning = cols; return b; },
        insert(v, o) { q.op = 'insert'; q.values = v; q.options = o || null; return b; },
        update(v, o) { q.op = 'update'; q.values = v; q.options = o || null; return b; },
        upsert(v, o) { q.op = 'upsert'; q.values = v; q.options = o || null; return b; },
        delete() { q.op = 'delete'; return b; },
        eq: filter('eq'), neq: filter('neq'), is: filter('is'), gt: filter('gt'), gte: filter('gte'),
        lt: filter('lt'), lte: filter('lte'), in: filter('in'),
        order() { return b; }, limit() { return b; }, range() { return b; }, returns() { return b; },
        single() { q.mode = 'single'; return run(); },
        maybeSingle() { q.mode = 'maybeSingle'; return run(); },
        then(ok, fail) { return run().then(ok, fail); },
      };
      return b;
    },
  };
}

// 요청마다 쓰는 ctx(사용자 RLS 클라이언트 · service role 클라이언트 · 로그인 사용자)
export function setCtx({ supabase, supabaseAdmin, userId = 'user-1' }) {
  globalThis.__edgeCtx = { supabase, supabaseAdmin, userClaims: userId ? { id: userId } : null };
}

// fetch 가짜: route(url, init) → Response | Promise<Response>. 호출 기록을 남긴다.
export function fakeFetch(route) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    return route(url, init || {});
  };
  return calls;
}

// signal이 끊길 때까지 응답하지 않는 요청(시간 초과 재현). signal이 없으면 끝나지 않는다.
export function hangUntilAborted(init) {
  return new Promise((_resolve, reject) => {
    const signal = init && init.signal;
    if (!signal) return;
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

// AbortSignal.timeout을 짧게 바꿔 실제 시간 초과 경로를 빠르게 실행한다. 요청된 ms는 기록한다.
export function shortenTimeouts(ms = 20) {
  const original = AbortSignal.timeout;
  const requested = [];
  AbortSignal.timeout = (wanted) => { requested.push(wanted); return original.call(AbortSignal, ms); };
  return { requested, restore() { AbortSignal.timeout = original; } };
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
