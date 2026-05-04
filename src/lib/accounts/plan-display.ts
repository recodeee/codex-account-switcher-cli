const CHATGPT_PLAN_LABELS: Record<string, string> = {
  plus: "Plus",
  business: "Business",
  team: "Business",
  pro: "Pro",
  max: "Max",
  enterprise: "Enterprise",
  free: "Free",
};

const USAGE_BASED_PLAN_KEYS = new Set([
  "api",
  "codex_usage_based",
  "codexusagebased",
  "metered",
  "pay_as_you_go",
  "payasyougo",
  "usage",
  "usage_based",
  "usagebased",
]);

function normalizePlanKey(planType: string): string {
  return planType.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function titleCasePlanType(planType: string): string {
  return planType
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export function formatAccountType(planType: string | undefined): string {
  if (!planType?.trim()) {
    return "-";
  }

  const normalized = normalizePlanKey(planType);
  const withoutChatGptPrefix = normalized.replace(/^chatgpt_/, "");
  if (USAGE_BASED_PLAN_KEYS.has(normalized) || USAGE_BASED_PLAN_KEYS.has(withoutChatGptPrefix)) {
    return "Usage based (Codex)";
  }

  const chatGptPlanLabel = CHATGPT_PLAN_LABELS[withoutChatGptPrefix] ?? titleCasePlanType(planType);
  return `ChatGPT seat (${chatGptPlanLabel})`;
}
