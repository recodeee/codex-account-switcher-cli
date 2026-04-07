import { get } from "@/lib/api-client";

import { SessionEventsResponseSchema } from "@/features/sessions/schemas";

const STICKY_SESSIONS_PATH = "/api/sticky-sessions";

export function getSessionEvents(params: {
  accountId: string;
  sessionKey: string;
  limit?: number;
}) {
  const query = new URLSearchParams();
  query.set("accountId", params.accountId);
  query.set("sessionKey", params.sessionKey);
  if (typeof params.limit === "number") {
    query.set("limit", String(params.limit));
  }
  return get(`${STICKY_SESSIONS_PATH}/session-events?${query.toString()}`, SessionEventsResponseSchema);
}
