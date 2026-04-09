import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRuntimeAppVersion } from "@/components/layout/app-version";
import { StatusBar } from "@/components/layout/status-bar";
import { getDashboardOverview } from "@/features/dashboard/api";
import { getSettings } from "@/features/settings/api";
import { renderWithProviders } from "@/test/utils";

vi.mock("@/features/dashboard/api", () => ({
  getDashboardOverview: vi.fn(),
}));

vi.mock("@/features/settings/api", () => ({
  getSettings: vi.fn(),
}));

vi.mock("@/components/layout/app-version", () => ({
  fetchRuntimeAppVersion: vi.fn(),
}));

describe("StatusBar", () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue({
      routingStrategy: "capacity_weighted",
      stickyThreadsEnabled: false,
      preferEarlierResetAccounts: false,
    } as Awaited<ReturnType<typeof getSettings>>);
    vi.mocked(fetchRuntimeAppVersion).mockResolvedValue("1.10.85");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not show a timeout warning when overview loads normally", async () => {
    vi.mocked(getDashboardOverview).mockResolvedValue({
      lastSyncAt: new Date().toISOString(),
    } as Awaited<ReturnType<typeof getDashboardOverview>>);

    renderWithProviders(<StatusBar />);

    await waitFor(() => {
      expect(screen.getByText(/last sync:/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("status-bar-last-sync-timeout-warning"),
    ).not.toBeInTheDocument();
  });

  it("shows and then clears the red timeout warning for slow overview requests", async () => {
    vi.mocked(getDashboardOverview).mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof getDashboardOverview>>>((resolve) => {
          window.setTimeout(() => {
            resolve({
              lastSyncAt: new Date().toISOString(),
            } as Awaited<ReturnType<typeof getDashboardOverview>>);
          }, 1_250);
        }),
    );

    renderWithProviders(<StatusBar />);

    await waitFor(() => {
      expect(
        screen.getByTestId("status-bar-last-sync-timeout-warning"),
      ).toBeInTheDocument();
    }, { timeout: 2_000 });

    await waitFor(() => {
      expect(
        screen.queryByTestId("status-bar-last-sync-timeout-warning"),
      ).not.toBeInTheDocument();
    }, { timeout: 3_000 });
  });
});
