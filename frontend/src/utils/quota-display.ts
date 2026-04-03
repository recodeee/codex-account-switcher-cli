import { parseDate } from "@/utils/formatters";

type QuotaDisplayInput = {
  windowKey: "primary" | "secondary";
  remainingPercent: number | null;
  resetAt: string | null | undefined;
  nowMs?: number;
};

export function normalizeRemainingPercentForDisplay({
  windowKey,
  remainingPercent,
  resetAt,
  nowMs = Date.now(),
}: QuotaDisplayInput): number | null {
  if (remainingPercent === null) {
    return null;
  }

  if (windowKey !== "primary") {
    return remainingPercent;
  }

  const resetDate = parseDate(resetAt);
  if (!resetDate || resetDate.getTime() <= 0) {
    return remainingPercent;
  }

  if (resetDate.getTime() <= nowMs) {
    return 100;
  }

  return remainingPercent;
}

