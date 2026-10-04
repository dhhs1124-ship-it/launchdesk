// LaunchROAS OAuth 복귀 주소 허용 목록 — 소유가 확인된 정확한 Origin만 허용한다.
// Vercel 이름 패턴은 다른 계정이 비슷한 주소를 만들 수 있어 쓰지 않는다.
// 새 미리보기·도메인은 이 목록에 추가하거나 LAUNCHROAS_RETURN_ORIGIN(정확히 일치)으로 지정한다.
export const ALLOWED_RETURN_ORIGINS = [
  "https://launchroas.vercel.app",
  "https://launchroas-git-preview-launchroas-apple-launchdesk.vercel.app",
  "https://launchroas-88oq4pa5f-launchdesk.vercel.app",
];

// 허용되면 그 Origin을, 아니면 null을 돌려준다. null이면 호출부는 런치데스크 기본 경로를 쓴다.
export function allowedReturnOrigin(value: unknown, configured?: string | null): string | null {
  if (typeof value !== "string") return null;
  return ALLOWED_RETURN_ORIGINS.includes(value) || (!!configured && value === configured) ? value : null;
}
