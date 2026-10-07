# 광고 변경 기록 추가 — 검증용 자료 (2026-10-07)

모두 **검증용 모의 화면**이다. 가짜 앱 · 가짜 DB(메모리) · 가짜 광고 목록으로 실제 `launchroas/index.html` 마크업과 `adlog.js`를 그렸다. 실제 DB 저장 · Meta 조회 · 광고 변경 없음. 운영 결과물에 포함되지 않는다(`docs/`는 배포 대상 밖).

| 파일 | 내용 |
|---|---|
| `mock-direct.html` | 모의 화면(`#direct` 직접 입력 · `#ai` AI 개선안 경로). 미리보기 작업 폴더를 로컬 정적 서버로 열어 확인 |
| `01-MOCK-direct-entry-confirm-required.jpg` | 직접 입력: 광고 선택 → '직접 입력' 표시 · 실제 변경 확인란 없이 저장하면 막힘 · 안내 문구 |
| `02-MOCK-ai-suggestion-entry.jpg` | AI 개선안 경로: 광고 선택칸 없음 · 제안 주차 · 제안 내용 · 확인란 꺼짐 |
