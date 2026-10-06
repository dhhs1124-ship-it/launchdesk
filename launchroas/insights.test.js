const test=require('node:test');
const assert=require('node:assert/strict');
const I=require('./insights.js');

test('근거 경로는 한국어 지표명으로 바뀐다',()=>{
  assert.equal(I.metricName('metrics_current.link_ctr_pct'),'지난주 클릭률');
  assert.equal(I.metricName('metrics_previous.purchases'),'그 전주 구매');
  assert.equal(I.metricName('change.link_cpc.pct'),'클릭당 비용 전주 대비 변화율');
  assert.equal(I.metricName('attribution'),'귀속 기준');
  assert.equal(I.metricName('creative.title'),'광고 제목');
  assert.equal(I.metricName('peers.note'),'비교 광고');
});

test('AI 문장 속 내부 필드명 · 코드는 사용자 문구로 바뀐다(실제 2026-10-06 출력 문장)',()=>{
  const raw='funnel_ratio_usable=false이고 funnel_note가 LPV_EXCEEDS_LINK_CLICKS입니다. change.link_cpc.pct 상승, link_domain도 비어 있어요. attribution이 CLICK_THROUGH 7일, VIEW_THROUGH 1일, CTA는 SHOP_NOW';
  const out=I.koText(raw);
  assert.ok(!/[a-z]+_[a-z_]+|[A-Z]{2,}_[A-Z_]+/.test(out),out);
  assert.match(out,/전환 단계 비율 계산 불가/);assert.match(out,/랜딩 페이지 조회가 링크 클릭보다 많음/);
  assert.match(out,/클릭 후 7일/);assert.match(out,/지금 구매하기/);assert.match(out,/귀속 기준/);
  assert.equal(I.koText('ROAS 4.32 · USD'),'ROAS 4.32 · USD','일반 약어는 그대로');
});

test('값 표시: 비율 · ROAS · 금액 · 빈 값 · 코드',()=>{
  assert.equal(I.formatValue('metrics_current.link_ctr_pct',2.62,'USD'),'2.62%');
  assert.equal(I.formatValue('metrics_current.roas',4.32,'USD'),'432%');
  assert.equal(I.formatValue('metrics_current.spend',136.92,'USD'),'$136.92');
  assert.equal(I.formatValue('metrics_current.spend',185000,'KRW'),'185,000원');
  assert.equal(I.formatValue('change.link_cpc.pct',7.1),'+7.1%');
  assert.equal(I.formatValue('creative.title',null),'없음');
  assert.equal(I.formatValue('metrics_current.funnel_note','LPV_EXCEEDS_LINK_CLICKS'),'랜딩 페이지 조회가 링크 클릭보다 많음');
});

test('핵심 변화 한 줄 · 짧은 숫자 — 미측정은 0으로 보이지 않는다',()=>{
  const a={current:{spend:136.92,purchases:7,roas:4.32},previous:{spend:96.2,purchases:2,roas:0.68}};
  assert.equal(I.changeLine(a,'USD'),'구매 2→7건 · ROAS 68%→432%');
  assert.equal(I.changeLine({current:{spend:10},previous:null}),'신규 광고 · 비교할 전주 없음');
  assert.equal(I.changeLine({current:{spend:120,purchases:null,roas:null},previous:{spend:100,purchases:null,roas:null}}),'광고비 +20%');
  assert.equal(I.numbersLine(a,'USD'),'$137 · 구매 7건 · ROAS 432%');
  assert.equal(I.numbersLine({current:{spend:185000,purchases:null,roas:null}},'KRW'),'18.5만원 · 구매 미측정 · ROAS 미측정');
});

test('먼저 확인할 순서: 점검 → 판단 보류 → 유지, 같은 판정은 우선순위 · 광고비 순',()=>{
  const ads=[
    {ad_id:'keep',analysis:{verdict:'유지'},current:{spend:900}},
    {ad_id:'hold',analysis:{verdict:'판단 보류'},current:{spend:50}},
    {ad_id:'check2',analysis:{verdict:'개선 필요',priority:2},current:{spend:500}},
    {ad_id:'check1',analysis:{verdict:'개선 필요',priority:1},current:{spend:100}},
    {ad_id:'none',analysis:null,current:{spend:1000}}];
  assert.deepEqual(I.orderAds(ads).map(a=>a.ad_id),['check1','check2','hold','keep','none']);
  assert.deepEqual(I.verdictView('개선 필요'),{label:'점검',tone:'check',rank:0});
});
