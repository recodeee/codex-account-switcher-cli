import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardLiveSocket } from "@/features/dashboard/hooks/use-dashboard-live-socket";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }

  close() {
    this.emitClose();
  }

  send() {
    // noop
  }
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useDashboardLiveSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("invalidates dashboard overview when invalidate messages arrive", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDashboardLiveSocket(), {
      wrapper: createWrapper(queryClient),
    });

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(socket?.url).toContain("/api/dashboard/overview/ws");

    act(() => {
      socket?.emitOpen();
    });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      socket?.emitMessage(JSON.stringify({ type: "dashboard.overview.invalidate" }));
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "overview"] });
    });
  });

  it("reconnects after websocket close with backoff", async () => {
    vi.useFakeTimers();

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useDashboardLiveSocket(), {
      wrapper: createWrapper(queryClient),
    });

    const firstSocket = MockWebSocket.instances[0];
    expect(firstSocket).toBeDefined();

    act(() => {
      firstSocket?.emitOpen();
    });
    expect(result.current).toBe(true);

    act(() => {
      firstSocket?.emitClose();
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(MockWebSocket.instances.length).toBe(2);
  });
});
