import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 10_000;

type DashboardLiveSocketMessage = {
  type?: string;
};

const DASHBOARD_LIVE_INVALIDATION_QUERY_KEYS = [
  ["dashboard", "overview"],
  ["sticky-sessions", "runtime-list"],
  ["workspaces", "list"],
] as const;

function buildDashboardOverviewWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/dashboard/overview/ws`;
}

export function useDashboardLiveSocket(options: { enabled?: boolean } = {}): boolean {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isStoppedRef = useRef(false);

  useEffect(() => {
    if (
      typeof window === "undefined"
      || typeof WebSocket === "undefined"
      || !enabled
    ) {
      return;
    }

    isStoppedRef.current = false;

    const clearReconnectTimeout = () => {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      clearReconnectTimeout();
      const attempt = reconnectAttemptRef.current;
      reconnectAttemptRef.current += 1;
      const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** attempt, WS_RECONNECT_MAX_MS);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (isStoppedRef.current) {
        return;
      }
      const socket = new WebSocket(buildDashboardOverviewWebSocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setIsConnected(true);
      };

      socket.onmessage = (event) => {
        let payload: DashboardLiveSocketMessage;
        try {
          payload = JSON.parse(String(event.data)) as DashboardLiveSocketMessage;
        } catch {
          return;
        }
        if (payload.type === "dashboard.overview.invalidate") {
          for (const queryKey of DASHBOARD_LIVE_INVALIDATION_QUERY_KEYS) {
            void queryClient.invalidateQueries({ queryKey });
          }
        }
      };

      socket.onerror = () => {
        try {
          socket.close();
        } catch {
          // noop
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (isStoppedRef.current) {
          return;
        }
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      isStoppedRef.current = true;
      setIsConnected(false);
      clearReconnectTimeout();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close();
        } catch {
          // noop
        }
      }
    };
  }, [enabled, queryClient]);

  return isConnected;
}
