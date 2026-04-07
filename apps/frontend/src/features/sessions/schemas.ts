import { z } from "zod";

export const SessionEventSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  kind: z.enum(["prompt", "answer", "thinking", "tool", "status", "event"]),
  title: z.string().min(1),
  text: z.string().min(1),
  role: z.string().nullable().optional().default(null),
  rawType: z.string().nullable().optional().default(null),
});

export const SessionEventsResponseSchema = z.object({
  sessionKey: z.string().min(1),
  resolvedSessionId: z.string().nullable().optional().default(null),
  sourceFile: z.string().nullable().optional().default(null),
  events: z.array(SessionEventSchema).default([]),
  truncated: z.boolean().default(false),
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type SessionEventsResponse = z.infer<typeof SessionEventsResponseSchema>;
