import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RequestLogUsageDonuts } from "@/features/dashboard/components/request-log-usage-donuts";
import { mergeRequestLogUsageSummaryWithLiveFallback } from "@/features/dashboard/request-log-usage-fallback";
import { createAccountSummary } from "@/test/mocks/factories";

describe("RequestLogUsageDonuts", () => {
  it("renders 5h and weekly consumed donut charts with per-account values", () => {
    render(
      <RequestLogUsageDonuts
        accounts={[
          createAccountSummary({ accountId: "acc-1", email: "alpha@example.com", displayName: "alpha@example.com" }),
          createAccountSummary({ accountId: "acc-2", email: "beta@example.com", displayName: "beta@example.com" }),
        ]}
        usageSummary={{
          last5h: {
            totalTokens: 300,
            totalCostUsd: 0.42,
            totalCostEur: 0.39,
            accounts: [
              { accountId: "acc-1", tokens: 200, costUsd: 0.28, costEur: 0.26 },
              { accountId: "acc-2", tokens: 100, costUsd: 0.14, costEur: 0.13 },
            ],
          },
          last7d: {
            totalTokens: 1500,
            totalCostUsd: 2.42,
            totalCostEur: 2.23,
            accounts: [
              { accountId: "acc-1", tokens: 700, costUsd: 1.13, costEur: 1.04 },
              { accountId: "acc-2", tokens: 800, costUsd: 1.29, costEur: 1.19 },
            ],
          },
          fxRateUsdToEur: 0.92,
        }}
        fallback={{ last5h: false, last7d: false, active: false }}
      />,
    );

    expect(screen.getByText("5h Consumed")).toBeInTheDocument();
    expect(screen.getByText("Weekly Consumed")).toBeInTheDocument();
    expect(screen.getByText("5h Tokens")).toBeInTheDocument();
    expect(screen.getByText("7d Tokens")).toBeInTheDocument();
    expect(screen.getByText("5h EUR")).toBeInTheDocument();
    expect(screen.getByText("7d EUR")).toBeInTheDocument();
    expect(screen.getByText("Recent intensity")).toBeInTheDocument();
    expect(screen.getAllByText("300K").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.5M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("€0.39").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("€2.23").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Top: alpha@example.com · 67%")).toBeInTheDocument();
    expect(screen.getAllByText("alpha@example.com").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("beta@example.com").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Consumed").length).toBeGreaterThanOrEqual(2);
  });

  it("renders unassigned legend row when usage summary includes null account", () => {
    render(
      <RequestLogUsageDonuts
        accounts={[createAccountSummary({ accountId: "acc-1", email: "alpha@example.com", displayName: "alpha@example.com" })]}
        usageSummary={{
          last5h: {
            totalTokens: 100,
            totalCostUsd: 0.5,
            totalCostEur: 0.46,
            accounts: [{ accountId: null, tokens: 100, costUsd: 0.5, costEur: 0.46 }],
          },
          last7d: {
            totalTokens: 100,
            totalCostUsd: 0.5,
            totalCostEur: 0.46,
            accounts: [{ accountId: null, tokens: 100, costUsd: 0.5, costEur: 0.46 }],
          },
          fxRateUsdToEur: 0.92,
        }}
        fallback={{ last5h: false, last7d: false, active: false }}
      />,
    );

    expect(screen.getAllByText("Unassigned").length).toBeGreaterThanOrEqual(2);
  });

  it("renders fallback note when live-usage fallback is active", () => {
    render(
      <RequestLogUsageDonuts
        accounts={[
          createAccountSummary({ accountId: "acc-1", email: "alpha@example.com", displayName: "alpha@example.com" }),
        ]}
        usageSummary={{
          last5h: {
            totalTokens: 640,
            totalCostUsd: 1.4,
            totalCostEur: 1.29,
            accounts: [{ accountId: "acc-1", tokens: 640, costUsd: 1.4, costEur: 1.29 }],
          },
          last7d: {
            totalTokens: 1200,
            totalCostUsd: 2.3,
            totalCostEur: 2.12,
            accounts: [{ accountId: "acc-1", tokens: 1200, costUsd: 2.3, costEur: 2.12 }],
          },
          fxRateUsdToEur: 0.92,
        }}
        fallback={{ last5h: true, last7d: false, active: true }}
      />,
    );

    expect(
      screen.getByText("Using live usage fallback because recent request logs are empty."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("640K").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.2M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("€1.29").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Unavailable in live fallback")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Estimated from live fallback tokens with a minimum-rate guardrail").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders deterministic non-zero fallback EUR values for low-density fallback scenarios", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      {
        last5h: { totalTokens: 0, totalCostUsd: 0, totalCostEur: 0, accounts: [] },
        last7d: {
          totalTokens: 1_000_000,
          totalCostUsd: 1,
          totalCostEur: 0.92,
          accounts: [{ accountId: "acc-1", tokens: 1_000_000, costUsd: 1, costEur: 0.92 }],
        },
        fxRateUsdToEur: 0.92,
      },
      {
        primary: {
          windowKey: "primary",
          windowMinutes: 300,
          accounts: [
            {
              accountId: "acc-1",
              remainingPercentAvg: 50,
              capacityCredits: 5_000_100,
              remainingCredits: 100,
            },
          ],
        },
        secondary: {
          windowKey: "secondary",
          windowMinutes: 10_080,
          accounts: [
            {
              accountId: "acc-1",
              remainingPercentAvg: 50,
              capacityCredits: 1_000_250,
              remainingCredits: 250,
            },
          ],
        },
      },
      [createAccountSummary({ accountId: "acc-1", email: "alpha@example.com", displayName: "alpha@example.com" })],
    );

    render(
      <RequestLogUsageDonuts
        accounts={[createAccountSummary({ accountId: "acc-1", email: "alpha@example.com", displayName: "alpha@example.com" })]}
        usageSummary={merged.usageSummary}
        fallback={merged.fallback}
      />,
    );

    expect(merged.fallback).toEqual({ last5h: true, last7d: false, active: true });
    expect(merged.usageSummary.last5h.totalCostEur).toBeCloseTo(13.8, 6);
    expect(screen.getAllByText("€13.80").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Unavailable in live fallback")).not.toBeInTheDocument();
  });

  it("uses the configured primary window label in usage summary cards and donut title", () => {
    render(
      <RequestLogUsageDonuts
        accounts={[createAccountSummary({ accountId: "acc-1", email: "alpha@example.com", displayName: "alpha@example.com" })]}
        usageSummary={{
          last5h: {
            totalTokens: 100,
            totalCostUsd: 0.2,
            totalCostEur: 0.18,
            accounts: [{ accountId: "acc-1", tokens: 100, costUsd: 0.2, costEur: 0.18 }],
          },
          last7d: {
            totalTokens: 300,
            totalCostUsd: 0.7,
            totalCostEur: 0.64,
            accounts: [{ accountId: "acc-1", tokens: 300, costUsd: 0.7, costEur: 0.64 }],
          },
          fxRateUsdToEur: 0.92,
        }}
        fallback={{ last5h: false, last7d: false, active: false }}
        primaryWindowMinutes={480}
      />,
    );

    expect(screen.getByText("8h Tokens")).toBeInTheDocument();
    expect(screen.getByText("8h EUR")).toBeInTheDocument();
    expect(screen.getByText("8h Consumed")).toBeInTheDocument();
    expect(screen.queryByText("5h Tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("5h EUR")).not.toBeInTheDocument();
    expect(screen.queryByText("5h Consumed")).not.toBeInTheDocument();
  });
});
