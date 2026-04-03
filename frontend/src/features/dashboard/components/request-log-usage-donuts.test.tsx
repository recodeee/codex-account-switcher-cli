import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RequestLogUsageDonuts } from "@/features/dashboard/components/request-log-usage-donuts";
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
            accounts: [
              { accountId: "acc-1", tokens: 200 },
              { accountId: "acc-2", tokens: 100 },
            ],
          },
          last7d: {
            totalTokens: 1500,
            accounts: [
              { accountId: "acc-1", tokens: 700 },
              { accountId: "acc-2", tokens: 800 },
            ],
          },
        }}
        fallback={{ last5h: false, last7d: false, active: false }}
      />,
    );

    expect(screen.getByText("5h Consumed")).toBeInTheDocument();
    expect(screen.getByText("Weekly Consumed")).toBeInTheDocument();
    expect(screen.getByText("5h Tokens")).toBeInTheDocument();
    expect(screen.getByText("7d Tokens")).toBeInTheDocument();
    expect(screen.getByText("Recent intensity")).toBeInTheDocument();
    expect(screen.getAllByText("300").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.5K").length).toBeGreaterThanOrEqual(1);
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
            accounts: [{ accountId: null, tokens: 100 }],
          },
          last7d: {
            totalTokens: 100,
            accounts: [{ accountId: null, tokens: 100 }],
          },
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
            accounts: [{ accountId: "acc-1", tokens: 640 }],
          },
          last7d: {
            totalTokens: 1200,
            accounts: [{ accountId: "acc-1", tokens: 1200 }],
          },
        }}
        fallback={{ last5h: true, last7d: false, active: true }}
      />,
    );

    expect(
      screen.getByText("Using live usage fallback because recent request logs are empty."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("640").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.2K").length).toBeGreaterThanOrEqual(1);
  });
});
