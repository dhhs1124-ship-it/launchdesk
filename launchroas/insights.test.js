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
  assert.equal(I.formatValue('creative.title',null),'광고 제목 없음');
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
  assert.deepEqual(I.verdictView('개선 필요'),{label:'우선 확인',tone:'check',rank:0});
});

test('목록 네 줄: 핵심 숫자 · 권장 행동 · 확인 사항 — 유지 · 판단 보류에는 수정안을 권하지 않는다',()=>{
  const a={current:{spend:136.92,purchases:7,roas:4.32,funnel_note:'LPV_EXCEEDS_LINK_CLICKS'},previous:{spend:96.2,purchases:2,roas:0.68}};
  assert.equal(I.keyLine(a,'USD'),'구매 2→7건 / 광고비 +42% / ROAS 432%');
  assert.equal(I.actionLine({verdict:'유지',next_action:'현재 광고는 그대로 두고, 제목만 추가한 새 광고로 비교합니다.'}),'현재 광고 유지');
  assert.equal(I.actionLine({verdict:'판단 보류'}),'데이터를 더 쌓은 뒤 판단');
  assert.equal(I.actionLine({verdict:'개선 필요',next_action:'썸네일만 바꾼 새 광고를 추가해요. 랜딩도 확인해요.'}),'썸네일만 바꾼 새 광고를 추가해요.');
  assert.equal(I.checkLine(a),'랜딩 조회 집계 기준 확인');
  assert.equal(I.checkLine({current:{purchases:1}}),'구매 3건 미만 · 표본 부족');
  assert.equal(I.keyLine({current:{spend:20,purchases:null,roas:null},previous:null},'USD'),'신규 광고 / 광고비 $20 / 구매 미측정 / ROAS 미측정');
});

test('title · null · spend ÷ purchases 같은 값은 한국어로(실제 저장 결과 문장)',()=>{
  assert.equal(I.koText('제목(title)이 null입니다.'),'제목이 없습니다.');
  assert.equal(I.koText('구매당 지출(spend ÷ purchases, 구매가 쌓인 뒤)'),'구매당 광고비(구매가 쌓인 뒤)');
  assert.equal(I.formatValue('creative.title',null),'광고 제목 없음');
});

test('근거 설명은 보이는 값을 다시 말하는 문장과 "단정하지 않음" 문장을 뺀다(실제 저장 결과)',()=>{
  const t=(n,s)=>I.trimNote(I.koText(n),s);
  assert.equal(t('LPV_EXCEEDS_LINK_CLICKS: 랜딩페이지뷰가 링크 클릭보다 많습니다. 랜딩 단계 수치는 신뢰하지 않았습니다.','랜딩 페이지 조회가 링크 클릭보다 많음'),'랜딩 단계 수치는 신뢰하지 않았습니다.');
  assert.equal(t('클릭 7일 외에 조회 1일, 영상 참여 1일 귀속이 포함되어 있습니다. 구매가 모두 링크 클릭에서 나왔다고 볼 수 없습니다.','클릭 후 7일, 조회 후 1일, 영상 참여 후 1일'),'구매가 모두 링크 클릭에서 나왔다고 볼 수 없습니다.');
  assert.ok(!/단정/.test(t('2.62%로 전주(2.64%)와 거의 같습니다. 이 수치만으로 좋고 나쁨을 단정하지는 않습니다.','2.62%')),'전주 비교 문장은 남기고 상투 문장만 뺀다');
});
