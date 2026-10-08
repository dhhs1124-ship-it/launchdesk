// docs/ai 문서(정책 · 사례집 · 설계)와 서버 코드의 버전 · 적용 상태 기록이 어긋나지 않게 — 실행: node --test tests/ai-docs-sync.test.mjs
// 문서가 저장소에 있는 것과 모델이 쓰는 것은 다르다: 모델에는 ai-policy.mjs의 압축본 · 사례만, 시크릿이 맞을 때만 간다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { POLICY_VERSION, PLAYBOOK_VERSION, CASES } from "../supabase/functions/_shared/ai-policy.mjs";
import { CONSULT_VERSION } from "../supabase/functions/_shared/ai-consult-core.mjs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("정책 · 사례집 문서는 코드와 같은 버전이고, 문서가 아니라 압축본이 시크릿 조건으로 쓰인다는 적용 상태를 적는다", () => {
  const policy = read("docs/ai/ad-review-policy.md"), playbook = read("docs/ai/apparel-ad-playbook.md");
  assert.ok(policy.includes(`문서 버전: \`${POLICY_VERSION}\``));
  assert.ok(playbook.includes(`문서 버전: \`${PLAYBOOK_VERSION}\``));
  for (const doc of [policy, playbook]) assert.match(doc, /적용 상태[^\n]*모델에 보내지 않는다[^\n]*AI_POLICY_VERSION/);
});

test("관찰 사례는 모두 사례집의 광고 ID로 거슬러 갈 수 있다", () => {
  const playbook = read("docs/ai/apparel-ad-playbook.md");
  const observed = CASES.filter((c) => c.kind === "observed");
  assert.ok(observed.length > 0);
  for (const c of observed) assert.ok(playbook.includes(c.id.replace(/^[A-Z]-/, "")), c.id);
});

test("설계 문서에 이번 구현 상태(사업 정보 · 지난 실행)와 버전을 적는다", () => {
  assert.match(read("docs/ai/ad-improvement-loop-design.md"), new RegExp(`구현 상태[^\\n]*${CONSULT_VERSION}`));
});
