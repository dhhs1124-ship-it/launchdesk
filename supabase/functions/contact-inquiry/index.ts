import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// 회원 전용 문의. 실제 메일 전송 전에 로그인 토큰, 입력값 및 DB의 원자적
// 일일 발송 제한을 모두 확인한다.
//
// 회원 확인: Authorization 헤더의 access token을 Supabase Auth에 직접 물어
// (supabaseAdmin.auth.getUser) 실제 로그인 사용자인지 확인한다. 게이트웨이의
// verify_jwt는 anon 키(역시 JWT 형식)도 통과시키므로 그것만으로는 비회원을
// 거를 수 없다. 클라이언트가 보낸 이메일은 회원 판단에 쓰지 않는다 — 발송
// 횟수 제한도 로그인 계정 기준이다. CORS(Origin 허용 목록)를 이 함수가 직접
// 처리하므로 withSupabase는 auth: "none"으로 두고 여기서 검증한다.
//
// [2026-09-23] 개발용 Origin을 소스에 하드코딩하지 않는다 — CONTACT_ALLOWED_ORIGINS
// 환경변수로만 확장하고(로컬 개발 시 supabase secrets/로컬 .env에 설정),
// 설정하지 않으면 운영 도메인만 허용한다. Origin 헤더는 브라우저가 아닌
// 클라이언트가 자유롭게 위조할 수 있어 이 검사 자체가 남용 방지 수단은 아니다
// (실질적 방어선은 회원 확인과 계정별·카테고리별 발송 제한) — 다른 사이트가
// 방문자의 브라우저를 통해 이 함수를 호출하는 것만 막는다.
const DEFAULT_ALLOWED_ORIGINS = "https://launchdesk.co.kr,https://www.launchdesk.co.kr";
const allowedOrigins = new Set(
  (Deno.env.get("CONTACT_ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS)
    .split(",").map((origin) => origin.trim()).filter(Boolean),
);
const types = {
  beginner: "쇼핑몰 시작 질문",
  service: "사이트 이용·오류",
  partner: "택배·도매 제휴",
};
const addressRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, origin: string){
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256Hex(text: string){
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    const origin = req.headers.get("Origin") || "";
    if(!allowedOrigins.has(origin)) return Response.json({ error: "ORIGIN_DENIED" }, { status: 403 });
    if(req.method === "OPTIONS"){
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
          "Vary": "Origin",
        },
      });
    }
    if(req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
    if(!req.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")){
      return json({ error: "INVALID_CONTENT_TYPE" }, 415, origin);
    }
    if(Number(req.headers.get("Content-Length") || "0") > 16000){
      return json({ error: "INVALID_INPUT" }, 400, origin);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if(!accessToken) return json({ error: "LOGIN_REQUIRED" }, 401, origin);
    let member;
    try {
      const { data: authData, error: authError } = await ctx.supabaseAdmin.auth.getUser(accessToken);
      member = authError ? null : authData?.user;
    } catch(_error){
      member = null;
    }
    if(!member || member.is_anonymous) return json({ error: "LOGIN_REQUIRED" }, 401, origin);
    const accountEmail = typeof member.email === "string" ? member.email.trim().toLowerCase() : "";

    let input: Record<string, unknown>;
    try {
      const text = await req.text();
      if(text.length > 12000) return json({ error: "INVALID_INPUT" }, 400, origin);
      input = JSON.parse(text);
    } catch(_error){
      return json({ error: "INVALID_INPUT" }, 400, origin);
    }
    if(!input || typeof input !== "object" || Array.isArray(input)){
      return json({ error: "INVALID_INPUT" }, 400, origin);
    }
    const category = input.category;
    const email = typeof input.email === "string" ? input.email.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const message = typeof input.message === "string" ? input.message.trim() : "";
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim().toLowerCase() : "";
    if(
      typeof category !== "string" || !Object.prototype.hasOwnProperty.call(types, category) ||
      email.length > 254 || !addressRe.test(email) ||
      phone.length > 30 || (phone && !/^[\d+().\s-]+$/.test(phone)) ||
      subject.length < 4 || subject.length > 100 || /[\x00-\x1f\x7f]/.test(subject) ||
      message.length < 20 || message.length > 3000 || /\x00/.test(message) ||
      input.consent !== true || !uuidRe.test(idempotencyKey)
    ) return json({ error: "INVALID_INPUT" }, 400, origin);

    // 함정 필드에 내용이 있다면 자동 제출로 보고 실제 메일은 보내지 않는다.
    if(input.website) return json({ ok: true }, 200, origin);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const sender = Deno.env.get("CONTACT_FROM_EMAIL");
    const pepper = Deno.env.get("CONTACT_RATE_PEPPER");
    if(!resendKey || !sender || !pepper){
      console.error("Contact configuration missing");
      return json({ error: "TEMPORARILY_UNAVAILABLE" }, 503, origin);
    }

    // 문의 내용(카테고리·이메일·연락처·제목·본문)의 해시 — 같은 idempotencyKey를
    // 재사용해도 사용자가 입력을 고쳐 다시 제출했다면 다른 값이 된다. 이
    // 해시를 (1) 우리 쪽 "이미 처리됨" 판별, (2) Resend에 보낼 Idempotency-Key
    // 두 곳 모두에 반영해, 같은 key라도 내용이 바뀌면 예전 캐시된 응답이나
    // Resend의 중복 판정을 재사용하지 않고 항상 새 메일로 처리되게 한다.
    const contentHash = await sha256Hex(pepper + ":content:" + category + "\u0000" + email.toLowerCase() + "\u0000" + phone + "\u0000" + subject + "\u0000" + message);
    // 발송 횟수 제한 키 — 폼에 적은 답장 이메일이 아니라 로그인 계정 기준이라,
    // 답장 주소를 바꿔 가며 보내도 계정당 상한을 피할 수 없다. 이메일이 없는
    // 계정(예외적인 소셜 로그인)은 사용자 ID로 대신한다.
    const emailHash = await sha256Hex(pepper + ":" + (accountEmail || "user:" + member.id));

    // Resend에 실제로 전달할 Idempotency-Key. idempotencyKey(재시도 판별)와
    // contentHash(내용 판별)를 함께 묶어, Resend 자체의 멱등성 처리가 우리
    // DB 사전 조회의 경쟁 상태(아래 참고)와 무관하게 최종 방어선이 되게 한다.
    const resendIdempotencyKey = await sha256Hex("resend:" + idempotencyKey + ":" + contentHash);

    let reservationClaimed = false;
    try {
      // 재시도(같은 idempotencyKey + 같은 내용) — 응답이 끊겨 클라이언트가
      // 발송 여부를 모르는 상태에서 다시 보낸 요청일 수 있다. 이미 성공
      // 처리된 조합이라면 발송 횟수 확인 없이 그대로 성공을
      // 돌려준다. 단, 이 사전 조회는 "조회 후 반영까지의 시간차" 때문에
      // 동시에 도착한 두 재시도까지 막지는 못한다 — 그 경우의 최종 방어선은
      // 아래 Resend 호출의 Idempotency-Key다(Resend가 실제로 한 통만 보낸다).
      const { data: alreadyDelivered, error: alreadyError } = await ctx.supabaseAdmin.rpc(
        "contact_inquiry_already_delivered",
        { p_idempotency_key: idempotencyKey, p_content_hash: contentHash },
      );
      if(alreadyError) throw new Error("IDEMPOTENCY_CHECK_FAILED");
      if(alreadyDelivered === true) return json({ ok: true }, 200, origin);

      // "시도"(넉넉한 상한, 실패해도 유지)와 "성공 예약"(진짜 상한, Resend
      // 호출 *전에* 원자적으로 확인+증가)을 함께 처리한다 — 성공 예약을
      // 발송 전에 원자적으로 확정하므로, 상한 근처에서 동시에 들어온
      // 요청끼리 "둘 다 여유 있음"을 보고 동시에 통과하는 경쟁 상태가
      // 없다(claim_contact_inquiry_attempt 주석 참고). 이후 Resend가
      // 실패하면 이 예약을 release_contact_inquiry_reservation으로
      // 되돌린다.
      const { error: attemptError } = await ctx.supabaseAdmin.rpc("claim_contact_inquiry_attempt", {
        p_category: category,
        p_email_hash: emailHash,
      });
      if(attemptError){
        if(attemptError.message?.includes("CONTACT_QUOTA_REACHED")) return json({ error: "QUOTA_REACHED" }, 429, origin);
        if(attemptError.message?.includes("CONTACT_ATTEMPT_LIMIT")) return json({ error: "ATTEMPT_LIMIT" }, 429, origin);
        throw new Error("RATE_CHECK_FAILED");
      }
      reservationClaimed = true;

      const delivery = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          // Resend 쪽에서도 같은 (key+내용)에 대해 실제로 한 통만 보내도록
          // 막는다 — 우리 DB 사전 조회가 동시 재시도를 놓쳐도 여기서 최종
          // 방어된다(Resend가 같은 Idempotency-Key로 온 요청에 대해 캐시된
          // 원래 응답을 돌려주고 실제로는 재발송하지 않음).
          "Idempotency-Key": resendIdempotencyKey,
        },
        body: JSON.stringify({
          from: sender,
          to: ["dhhs1124@gmail.com"],
          reply_to: email,
          subject: `[LaunchDesk] [${types[category as keyof typeof types]}] ${subject}`,
          text: `문의 유형: ${types[category as keyof typeof types]}\n제목: ${subject}\n답변 이메일: ${email}\n회원 계정: ${accountEmail || "(이메일 없는 계정)"}\n연락처: ${phone || "미입력"}\n\n문의 내용:\n${message}`,
        }),
      });
      if(!delivery.ok){
        console.error("Contact delivery failed with status", delivery.status);
        return json({ error: "SEND_FAILED" }, 502, origin);
      }

      // Resend가 성공을 확인해줬다 — 성공 카운터는 이미 예약 시점에
      // 늘렸으므로 더 이상 되돌릴 대상이 아니다(release 대상에서 제외).
      reservationClaimed = false;

      // 기록(중복 발송 판별용 idempotency)이 실패해도 메일은 이미 전달됐다 —
      // 사용자에게는 그대로 성공으로 응답하고, 기록 실패는 로그로만 남긴다
      // (실패로 알리면 재시도로 인한 중복 발송 위험이 생긴다 — Resend의
      // Idempotency-Key가 있어도, 내용을 조금 바꿔 재시도하면 다른 key가 돼
      // 실제로 중복 발송될 수 있다).
      const { error: recordError } = await ctx.supabaseAdmin.rpc("record_contact_inquiry_delivery", {
        p_idempotency_key: idempotencyKey,
        p_content_hash: contentHash,
      });
      if(recordError) console.error("Contact delivery recording failed (mail already sent)", recordError.message);

      return json({ ok: true }, 200, origin);
    } catch(error){
      // 요청 본문·이메일·토큰·메일 API 오류 본문은 로그에 남기지 않는다.
      console.error("Contact handling failed", error instanceof Error ? error.message : "UNKNOWN");
      return json({ error: "SEND_FAILED" }, 502, origin);
    } finally {
      // 예약을 확정만 하고(Resend 성공) 끝내지 못한 모든 경로(Resend 실패,
      // 그 사이의 예외)에서 공통으로 되돌린다 — 실패 판단마다 개별적으로
      // release를 호출하는 대신 한 곳에 모아 빠뜨리는 경로가 없게 한다.
      if(reservationClaimed){
        const { error: releaseError } = await ctx.supabaseAdmin.rpc("release_contact_inquiry_reservation", {
          p_category: category,
          p_email_hash: emailHash,
        });
        if(releaseError) console.error("Failed to release contact reservation", releaseError.message);
      }
    }
  }),
};
