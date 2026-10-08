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

test('AI 실행 전 확인 신호는 실제 측정값과 조건으로만, 최대 2개',()=>{
  const m={spend:50000,impressions:10000,link_clicks:60,link_ctr:0.6,frequency:3.4,purchase:{observed:true,value:5},funnel_status:{usable:true}};
  assert.deepEqual(I.ruleSignals(m,false,null),['클릭률 0.6% · 참고 기준 1% 미만(노출 10,000회)','빈도 3.4회 · 참고 기준 3회 이상']);
  assert.deepEqual(I.ruleSignals({spend:10,impressions:300,link_ctr:0.2,link_clicks:4,purchase:{observed:false}},false,null),[],'노출 · 클릭이 적으면 신호 없음(구매 기록 없음을 픽셀 문제로 단정하지 않음)');
  assert.deepEqual(I.ruleSignals({spend:90,impressions:9000,link_ctr:1.5,link_clicks:135,purchase:{observed:false}},false,null),['링크 클릭 135회 · 구매 기록 없음(참고 기준 클릭 100회)']);
  assert.deepEqual(I.ruleSignals({spend:10,impressions:5000,link_ctr:2.5,purchase:{observed:true,value:8},funnel_status:{usable:true}},false,null),[]);
  assert.match(I.ruleSignals({roas:3.2,purchase:{observed:true,value:9}},true,{tone:'below',breakeven:4.1})[0],/ROAS 320% · 일부 상품 기준 손익분기 참고값 410%보다 낮음/);
});

test('제목이 비었다는 이유만의 제목 제안은 제목이 보이는 게재 위치로 확인됐을 때만 보여 준다',()=>{
  const an={recommendation:{current:'제목이 없습니다',proposed:'제목만 추가한 새 광고',example:'제목: 아기 얼굴로 만드는 우리 가족 커스텀 티셔츠'}};
  assert.equal(I.recUsable({creative:{title:null}},an),false,'저장된 결과처럼 게재 위치 정보가 없으면 숨김');
  assert.equal(I.recUsable({creative:{title:null,headline:'partial'}},an),true);
  assert.equal(I.recUsable({creative:{title:null,headline:'none'}},an),false);
  assert.equal(I.recUsable({creative:{}},{recommendation:{current:'본문 첫 줄',proposed:'첫 줄에 혜택',example:'오늘만 무료배송'}}),true,'제목과 무관한 제안은 그대로');
  assert.equal(I.recUsable({creative:{}},{recommendation:null}),false);
});

test('신호 문구는 픽셀 오류 · 광고 실패로 단정하지 않는다',()=>{
  const all=[I.ruleSignals({spend:90,impressions:9000,link_ctr:0.5,link_clicks:300,frequency:4,purchase:{observed:false}},false,null),I.ruleSignals({purchase:{observed:false},link_clicks:500},false,null)].flat().join(' ');
  assert.doesNotMatch(all,/픽셀|오류|실패|문제/);
});

test('AI가 꺼져 있으면 주간 AI 점검 칸 전체를 숨긴다 — 켜짐(ready) · 점검 중일 때만 보이고, 처음(상태 확인 전)부터 숨김', () => {
  assert.equal(I.weeklyVisible('ready', false), true);
  assert.equal(I.weeklyVisible('idle', true), true, '점검 중');
  for (const s of ['off', 'idle', 'error', 'unavailable']) assert.equal(I.weeklyVisible(s, false), false, s);
  const fs = require('node:fs');
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8'), src = fs.readFileSync(__dirname + '/insights.js', 'utf8'), tour = fs.readFileSync(__dirname + '/tour.js', 'utf8');
  assert.match(html, /<section id="insights" class="weekly-panel" aria-label="주간 AI 점검" hidden>/, '상태 확인 전에 AI 칸이 잠깐 보이지 않게');
  assert.match(src, /sec\.hidden=!I\.weeklyVisible\(wk\.state,wk\.busy\)/);
  assert.match(tour, /\]\.filter\(shown\)/, '숨겨진 칸은 사용법 안내에서도 뺀다');
});

test('사업 정보 입력: 광고 목표는 필수, 목표 ROAS · 월 예산 상한은 선택이고 범위를 벗어나면 저장하지 않는다',()=>{
  assert.deepEqual(I.profileInput({objective:'판매',target_roas_pct:'300',monthly_budget_cap_krw:'1,500,000',cannot_change:['예산 늘리기','없는 항목','예산 늘리기']}),
    {ok:true,data:{objective:'판매',target_roas_pct:300,monthly_budget_cap_krw:1500000,cannot_change:['예산 늘리기']}});
  assert.deepEqual(I.profileInput({objective:'',target_roas_pct:'',monthly_budget_cap_krw:'',cannot_change:[]}).errors,['광고 목표를 골라 주세요.']);
  assert.deepEqual(I.profileInput({objective:'판매',target_roas_pct:'20',monthly_budget_cap_krw:'5000'}).errors,['목표 ROAS는 50~5000% 사이로 입력해 주세요.','월 광고 예산 상한은 10,000원 이상으로 입력해 주세요.']);
  assert.deepEqual(I.profileInput({objective:'재구매',target_roas_pct:'',monthly_budget_cap_krw:''}).data,{objective:'재구매',target_roas_pct:null,monthly_budget_cap_krw:null,cannot_change:[]});
});

test('사업 정보 선택지는 서버(ai-consult-core.mjs)와 같고, 화면이 저장한 형식을 서버가 그대로 읽는다',async()=>{
  const S=await import('../supabase/functions/_shared/ai-consult-core.mjs');
  assert.deepEqual(I.OBJECTIVES,S.OBJECTIVES);
  assert.deepEqual(I.CANNOT_CHANGE,S.CANNOT_CHANGE);
  const saved=I.profileInput({objective:'판매',target_roas_pct:'300',monthly_budget_cap_krw:'',cannot_change:['할인 · 가격']}).data;
  const row={tool_type:'business_profile',data:Object.assign({store_id:'4',saved_at:'2026-10-08T00:00:00.000Z'},saved)};
  assert.deepEqual(S.businessProfileOf([row],4),Object.assign({saved_at:'2026-10-08T00:00:00.000Z'},saved));
});

test('이 쇼핑몰의 최신 사업 정보와 정리할 예전 기록(수정 권한이 없어 새로 저장 후 지운다)',()=>{
  const rows=[{id:9,data:{store_id:'5',objective:'판매'}},{id:8,data:{store_id:'4',objective:'재구매'}},{id:7,data:{store_id:'4',objective:'판매'}}];
  assert.deepEqual(I.latestProfile(rows,4),{id:8,data:{store_id:'4',objective:'재구매'},stale:[7]});
  assert.deepEqual(I.latestProfile([],4),{id:null,data:null,stale:[]});
});

test('진행 중인 실행 기록 때문에 변경안을 뺀 광고는 권장 행동에 결과 확인을 그대로 보여 준다',()=>{
  assert.equal(I.actionLine({verdict:'판단 보류',next_action:'진행 중인 ‘문구’ 변경의 결과를 먼저 확인',hold_scope:['진행 중인 실행 기록']}),'진행 중인 ‘문구’ 변경의 결과를 먼저 확인');
  assert.equal(I.actionLine({verdict:'판단 보류',next_action:'x',hold_scope:[]}),'데이터를 더 쌓은 뒤 판단');
});
