export function buildReferralLink(accountId: string): string {
  const baseUrl = typeof window === "undefined" ? "https://recodee.com/" : window.location.origin;
  const url = new URL("/", baseUrl);
  url.searchParams.set("ref", accountId);
  return url.toString();
}
