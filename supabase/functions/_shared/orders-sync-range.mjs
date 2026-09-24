// Cafe24 주문 동기화 범위 기록 — 순수 함수(Deno · Node 공용 표준 ESM).
//
// connected_accounts.orders_synced_from은 "이 날짜(KST 00:00)부터
// last_synced_at까지 주문이 빠짐없이 동기화됐다"는 기록이다. 추정하지 않고
// cafe24-orders-sync가 한 범위를 끝까지 가져온 뒤에만 갱신한다.
//
// 새 동기화 범위 [startDate, 지금]이 이전 기록 [prevFrom, prevLastSyncedAt]과
// 이어질 때(새 시작일이 이전 마지막 동기화 날짜 이하)만 두 범위를 합친다.
// 이어지지 않으면(사이에 빈 날짜가 있으면) 새 시작일부터만 기록한다. 이전
// 기록이 없으면(마이그레이션 전 연결 · 최초 동기화) 새 시작일부터만 기록한다 —
// last_synced_at만으로 더 과거가 채워졌다고 보지 않는다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDateString(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function isDateString(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function nextOrdersSyncedFrom(prevFrom, prevLastSyncedAt, startDate) {
  if (!isDateString(prevFrom) || !prevLastSyncedAt) return startDate;
  const prevLast = new Date(prevLastSyncedAt);
  if (Number.isNaN(prevLast.getTime())) return startDate;
  if (startDate > kstDateString(prevLast)) return startDate; // 빈 구간 — 이어지지 않음
  return prevFrom < startDate ? prevFrom : startDate;
}
