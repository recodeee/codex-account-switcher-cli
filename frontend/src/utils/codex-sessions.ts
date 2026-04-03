export function resolveCodexSessionCount(
  codexSessionCount: number | null | undefined,
  hasLiveSession: boolean,
): number {
  return Math.max(codexSessionCount ?? 0, hasLiveSession ? 1 : 0);
}
