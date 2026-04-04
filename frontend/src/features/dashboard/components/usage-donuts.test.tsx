import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { UsageDonuts } from "@/features/dashboard/components/usage-donuts";

/** Helper to build a minimal RemainingItem for tests. */
function item(overrides: { accountId: string; label: string; value: number; remainingPercent: number; color: string }) {
  return { ...overrides, labelSuffix: "", isEmail: true };
}

describe("UsageDonuts", () => {
  it("renders primary and secondary donut panels with collapsed legends showing account previews", () => {
    render(
      <UsageDonuts
        primaryItems={[item({ accountId: "acc-1", label: "primary@example.com", value: 120, remainingPercent: 60, color: "#7bb661" })]}
        secondaryItems={[item({ accountId: "acc-2", label: "secondary@example.com", value: 80, remainingPercent: 40, color: "#d9a441" })]}
        primaryTotal={200}
        secondaryTotal={200}
      />,
    );

    expect(screen.getByText("5h Remaining")).toBeInTheDocument();
    expect(screen.getByText("Weekly Remaining")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "5h Remaining accounts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Weekly Remaining accounts" })).not.toBeInTheDocument();
    expect(screen.getByText("primary@example.com")).toBeInTheDocument();
    expect(screen.getByText("secondary@example.com")).toBeInTheDocument();
  });

  it("expands account legends when accounts toggle is clicked", async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <UsageDonuts
        primaryItems={[
          item({ accountId: "acc-1", label: "p1@example.com", value: 120, remainingPercent: 60, color: "#7bb661" }),
          item({ accountId: "acc-2", label: "p2@example.com", value: 110, remainingPercent: 55, color: "#d9a441" }),
          item({ accountId: "acc-3", label: "p3@example.com", value: 100, remainingPercent: 50, color: "#4c8df5" }),
          item({ accountId: "acc-4", label: "p4@example.com", value: 90, remainingPercent: 45, color: "#9b5de5" }),
          item({ accountId: "acc-5", label: "p5@example.com", value: 80, remainingPercent: 40, color: "#00a896" }),
        ]}
        secondaryItems={[
          item({ accountId: "acc-6", label: "s1@example.com", value: 120, remainingPercent: 60, color: "#7bb661" }),
          item({ accountId: "acc-7", label: "s2@example.com", value: 110, remainingPercent: 55, color: "#d9a441" }),
          item({ accountId: "acc-8", label: "s3@example.com", value: 100, remainingPercent: 50, color: "#4c8df5" }),
          item({ accountId: "acc-9", label: "s4@example.com", value: 90, remainingPercent: 45, color: "#9b5de5" }),
          item({ accountId: "acc-10", label: "s5@example.com", value: 80, remainingPercent: 40, color: "#00a896" }),
        ]}
        primaryTotal={200}
        secondaryTotal={200}
      />,
    );

    await user.click(screen.getByRole("button", { name: "5h Remaining accounts" }));
    await user.click(screen.getByRole("button", { name: "Weekly Remaining accounts" }));

    expect(screen.getByText("p5@example.com")).toBeInTheDocument();
    expect(screen.getByText("s5@example.com")).toBeInTheDocument();
  });

  it("shows 4 account previews when collapsed and reveals all on expand", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <UsageDonuts
        primaryItems={[
          item({ accountId: "acc-1", label: "a1@example.com", value: 120, remainingPercent: 60, color: "#7bb661" }),
          item({ accountId: "acc-2", label: "a2@example.com", value: 90, remainingPercent: 45, color: "#d9a441" }),
          item({ accountId: "acc-3", label: "a3@example.com", value: 80, remainingPercent: 40, color: "#4c8df5" }),
          item({ accountId: "acc-4", label: "a4@example.com", value: 70, remainingPercent: 35, color: "#9b5de5" }),
          item({ accountId: "acc-5", label: "a5@example.com", value: 60, remainingPercent: 30, color: "#00a896" }),
        ]}
        secondaryItems={[]}
        primaryTotal={500}
        secondaryTotal={0}
      />,
    );

    expect(screen.getByRole("button", { name: "5h Remaining accounts" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("a1@example.com")).toBeInTheDocument();
    expect(screen.getByText("a2@example.com")).toBeInTheDocument();
    expect(screen.getByText("a3@example.com")).toBeInTheDocument();
    expect(screen.getByText("a4@example.com")).toBeInTheDocument();
    expect(screen.queryByText("a5@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "5h Remaining accounts" }));
    expect(screen.getByRole("button", { name: "5h Remaining accounts" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("a5@example.com")).toBeInTheDocument();
  });

  it("shows donut center values as remaining credits, not total capacity", async () => {
    render(
      <UsageDonuts
        primaryItems={[]}
        secondaryItems={[item({ accountId: "acc-2", label: "secondary@example.com", value: 1890, remainingPercent: 40, color: "#d9a441" })]}
        primaryTotal={0}
        secondaryTotal={143_640}
      />,
    );

    expect(screen.queryByText("143.64M")).not.toBeInTheDocument();
    expect(screen.getAllByText("1.89M").length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty data gracefully", () => {
    render(
      <UsageDonuts
        primaryItems={[]}
        secondaryItems={[]}
        primaryTotal={0}
        secondaryTotal={0}
      />,
    );

    expect(screen.getByText("5h Remaining")).toBeInTheDocument();
    expect(screen.getByText("Weekly Remaining")).toBeInTheDocument();
    expect(screen.getAllByText("Remaining").length).toBeGreaterThanOrEqual(2);
  });

  it("uses the configured primary window duration in the donut title", () => {
    render(
      <UsageDonuts
        primaryItems={[]}
        secondaryItems={[]}
        primaryTotal={0}
        secondaryTotal={0}
        primaryWindowMinutes={480}
      />,
    );

    expect(screen.getByText("8h Remaining")).toBeInTheDocument();
    expect(screen.queryByText("5h Remaining")).not.toBeInTheDocument();
  });

  it("renders safe line only for the primary donut", () => {
    render(
      <UsageDonuts
        primaryItems={[item({ accountId: "acc-1", label: "primary@example.com", value: 120, remainingPercent: 60, color: "#7bb661" })]}
        secondaryItems={[item({ accountId: "acc-2", label: "secondary@example.com", value: 80, remainingPercent: 40, color: "#d9a441" })]}
        primaryTotal={200}
        secondaryTotal={200}
        safeLinePrimary={{ safePercent: 60, riskLevel: "warning" }}
      />,
    );

    expect(screen.getAllByTestId("safe-line-tick")).toHaveLength(1);
  });

  it("renders safe line on both donuts when both have depletion", () => {
    render(
      <UsageDonuts
        primaryItems={[item({ accountId: "acc-1", label: "primary@example.com", value: 120, remainingPercent: 60, color: "#7bb661" })]}
        secondaryItems={[item({ accountId: "acc-2", label: "secondary@example.com", value: 80, remainingPercent: 40, color: "#d9a441" })]}
        primaryTotal={200}
        secondaryTotal={200}
        safeLinePrimary={{ safePercent: 60, riskLevel: "warning" }}
        safeLineSecondary={{ safePercent: 40, riskLevel: "danger" }}
      />,
    );

    expect(screen.getAllByTestId("safe-line-tick")).toHaveLength(2);
  });

  it("renders safe line only on secondary donut for weekly-only plans", () => {
    render(
      <UsageDonuts
        primaryItems={[]}
        secondaryItems={[item({ accountId: "acc-1", label: "weekly@example.com", value: 80, remainingPercent: 40, color: "#d9a441" })]}
        primaryTotal={0}
        secondaryTotal={200}
        safeLineSecondary={{ safePercent: 60, riskLevel: "warning" }}
      />,
    );

    expect(screen.getAllByTestId("safe-line-tick")).toHaveLength(1);
  });
});
