export function resolveCodexSessionCount(
  codexSessionCount: number | null | undefined,
  isActiveSnapshot: boolean,
): number {
  return Math.max(codexSessionCount ?? 0, isActiveSnapshot ? 1 : 0);
}
