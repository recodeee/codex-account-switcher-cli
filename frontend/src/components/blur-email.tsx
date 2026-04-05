/**
 * True when `label` matches `email` exactly — the label was derived from an email address.
 * Avoids false positives from display names that happen to contain "@".
 */
export function isEmailLabel(label: string | null | undefined, email: string | null | undefined): boolean {
  return !!label && !!email && label === email;
}

/**
 * Lightweight "looks like an email" detector for values not tied to a specific account email
 * (for example snapshot names). Keeps privacy blur behavior scoped to true email-like strings.
 */
export function isLikelyEmailValue(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}
