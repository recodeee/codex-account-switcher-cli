import { describe, expect, it } from "vitest";

import {
  applySecondaryConstraint,
  buildDashboardView,
  buildDepletionView,
  buildRemainingItems,
} from "@/features/dashboard/utils";
import type { RemainingItem } from "@/features/dashboard/utils";
import type { AccountSummary, Depletion } from "@/features/dashboard/schemas";

function account(overrides: Partial<AccountSummary> & Pick<AccountSummary, "accountId" | "email">): AccountSummary {
  return {
    accountId: overrides.accountId,
    email: overrides.email,
    displayName: overrides.displayName ?? overrides.email,
    planType: overrides.planType ?? "plus",
    status: overrides.status ?? "active",
    codexSessionCount: overrides.codexSessionCount ?? 0,
    usage: overrides.usage ?? null,
    resetAtPrimary: overrides.resetAtPrimary ?? null,
    resetAtSecondary: overrides.resetAtSecondary ?? null,
    auth: overrides.auth ?? null,
    codexAuth: overrides.codexAuth ?? null,
    additionalQuotas: overrides.additionalQuotas ?? [],
  };
}

describe("buildDepletionView", () => {
  it("returns null for null depletion", () => {
    expect(buildDepletionView(null)).toBeNull();
  });

  it("returns null for undefined depletion", () => {
    expect(buildDepletionView(undefined)).toBeNull();
  });

  it("returns null for safe risk level", () => {
    const depletion: Depletion = {
      risk: 0.1,
      riskLevel: "safe",
      burnRate: 0.5,
      safeUsagePercent: 90,
    };
    expect(buildDepletionView(depletion)).toBeNull();
  });

  it("returns view for warning risk level", () => {
    const depletion: Depletion = {
      risk: 0.5,
      riskLevel: "warning",
      burnRate: 1.5,
      safeUsagePercent: 45,
    };
    const view = buildDepletionView(depletion);
    expect(view).toEqual({
      safePercent: 45,
      riskLevel: "warning",
    });
  });

  it("returns view for danger risk level", () => {
    const depletion: Depletion = {
      risk: 0.75,
      riskLevel: "danger",
      burnRate: 2.5,
      safeUsagePercent: 30,
    };
    const view = buildDepletionView(depletion);
    expect(view).toEqual({
      safePercent: 30,
      riskLevel: "danger",
    });
  });

  it("returns view for critical risk level", () => {
    const depletion: Depletion = {
      risk: 0.95,
      riskLevel: "critical",
      burnRate: 5.0,
      safeUsagePercent: 20,
    };
    const view = buildDepletionView(depletion);
    expect(view).toEqual({
      safePercent: 20,
      riskLevel: "critical",
    });
  });
});

function remainingItem(overrides: Partial<RemainingItem> & Pick<RemainingItem, "accountId">): RemainingItem {
  return {
    accountId: overrides.accountId,
    label: overrides.label ?? overrides.accountId,
    labelSuffix: overrides.labelSuffix ?? "",
    isEmail: overrides.isEmail ?? false,
    value: overrides.value ?? 100,
    remainingPercent: overrides.remainingPercent === undefined ? 80 : overrides.remainingPercent,
    color: overrides.color ?? "#aaa",
  };
}

describe("applySecondaryConstraint", () => {
  it("no-op when 7d remaining credits >= 5h remaining credits", () => {
    const primary = [remainingItem({ accountId: "acc-1", value: 180, remainingPercent: 80 })];
    const secondary = [remainingItem({ accountId: "acc-1", value: 6000, remainingPercent: 79 })];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(180);
    expect(result[0].remainingPercent).toBe(80);
  });

  it("caps 5h to 7d absolute credits when 7d remaining < 5h remaining", () => {
    const primary = [remainingItem({ accountId: "acc-1", value: 200, remainingPercent: 90 })];
    const secondary = [remainingItem({ accountId: "acc-1", value: 75, remainingPercent: 1 })];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(75);
    expect(result[0].remainingPercent).toBeCloseTo(90 * (75 / 200));
  });

  it("zeros 5h when 7d is fully depleted", () => {
    const primary = [remainingItem({ accountId: "acc-1", value: 200, remainingPercent: 90 })];
    const secondary = [remainingItem({ accountId: "acc-1", value: 0, remainingPercent: 0 })];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(0);
    expect(result[0].remainingPercent).toBe(0);
  });

  it("no-op when 7d has plenty even with low percent (different capacity scales)", () => {
    const primary = [remainingItem({ accountId: "acc-1", value: 200, remainingPercent: 90 })];
    const secondary = [remainingItem({ accountId: "acc-1", value: 3780, remainingPercent: 50 })];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(200);
    expect(result[0].remainingPercent).toBe(90);
  });

  it("preserves null remainingPercent on capped items", () => {
    const primary = [remainingItem({ accountId: "acc-1", value: 200, remainingPercent: null })];
    const secondary = [remainingItem({ accountId: "acc-1", value: 50 })];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(50);
    expect(result[0].remainingPercent).toBeNull();
  });

  it("returns primary unchanged when no matching secondary account exists", () => {
    const primary = [remainingItem({ accountId: "acc-1", value: 200, remainingPercent: 90 })];
    const secondary = [remainingItem({ accountId: "acc-2", value: 0, remainingPercent: 0 })];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(200);
    expect(result[0].remainingPercent).toBe(90);
  });

  it("handles multiple accounts independently", () => {
    const primary = [
      remainingItem({ accountId: "acc-1", value: 200, remainingPercent: 90 }),
      remainingItem({ accountId: "acc-2", value: 150, remainingPercent: 60 }),
    ];
    const secondary = [
      remainingItem({ accountId: "acc-1", value: 75, remainingPercent: 1 }),
      remainingItem({ accountId: "acc-2", value: 5000, remainingPercent: 70 }),
    ];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(75);
    expect(result[0].remainingPercent).toBeCloseTo(90 * (75 / 200));
    expect(result[1].value).toBe(150);
    expect(result[1].remainingPercent).toBe(60);
  });

  it("returns empty array when primary is empty", () => {
    const result = applySecondaryConstraint([], [remainingItem({ accountId: "acc-1" })]);
    expect(result).toEqual([]);
  });

  it("does not mutate original primary items", () => {
    const primary = [remainingItem({ accountId: "acc-1", value: 200, remainingPercent: 90 })];
    const secondary = [remainingItem({ accountId: "acc-1", value: 0, remainingPercent: 0 })];

    applySecondaryConstraint(primary, secondary);

    expect(primary[0].value).toBe(200);
    expect(primary[0].remainingPercent).toBe(90);
  });

  it("caps to zero when secondary items are all zero-valued", () => {
    const primary = [
      remainingItem({ accountId: "acc-1", value: 200, remainingPercent: 90 }),
      remainingItem({ accountId: "acc-2", value: 150, remainingPercent: 60 }),
    ];
    const secondary = [
      remainingItem({ accountId: "acc-1", value: 0, remainingPercent: 0 }),
      remainingItem({ accountId: "acc-2", value: 0, remainingPercent: 0 }),
    ];

    const result = applySecondaryConstraint(primary, secondary);

    expect(result[0].value).toBe(0);
    expect(result[1].value).toBe(0);
  });
});

describe("buildRemainingItems", () => {
  it("skips disconnected accounts from donut legend data", () => {
    const items = buildRemainingItems(
      [
        account({ accountId: "acc-1", email: "active@example.com", status: "active" }),
        account({ accountId: "acc-2", email: "offline@example.com", status: "deactivated" }),
      ],
      {
        windowKey: "primary",
        windowMinutes: 300,
        accounts: [
          { accountId: "acc-1", remainingPercentAvg: 80, capacityCredits: 100, remainingCredits: 80 },
          { accountId: "acc-2", remainingPercentAvg: 50, capacityCredits: 100, remainingCredits: 50 },
        ],
      },
      "primary",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.accountId).toBe("acc-1");
  });

  it("keeps deactivated accounts in donut legend data when they are active snapshots", () => {
    const items = buildRemainingItems(
      [
        account({
          accountId: "acc-1",
          email: "active@example.com",
          status: "deactivated",
          codexAuth: { hasSnapshot: true, isActiveSnapshot: true },
        }),
      ],
      {
        windowKey: "primary",
        windowMinutes: 300,
        accounts: [{ accountId: "acc-1", remainingPercentAvg: 80, capacityCredits: 100, remainingCredits: 80 }],
      },
      "primary",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.accountId).toBe("acc-1");
  });

  it("keeps default labels for non-duplicate accounts", () => {
    const items = buildRemainingItems(
      [
        account({ accountId: "acc-1", email: "one@example.com" }),
        account({ accountId: "acc-2", email: "two@example.com" }),
      ],
      null,
      "primary",
    );

    expect(items[0].label).toBe("one@example.com");
    expect(items[1].label).toBe("two@example.com");
  });

  it("groups duplicate emails into a single legend item", () => {
    const duplicateA = "d48f0bfc-8ea6-48a7-8d76-d0e5ef1816c5_6f12b5d5";
    const duplicateB = "7f9de2ad-7621-4a6f-88bc-ec7f3d914701_91a95cee";
    const items = buildRemainingItems(
      [
        account({ accountId: duplicateA, email: "dup@example.com" }),
        account({ accountId: duplicateB, email: "dup@example.com" }),
        account({ accountId: "acc-3", email: "unique@example.com" }),
      ],
      null,
      "primary",
    );

    expect(items).toHaveLength(2);
    expect(items[0].label).toBe("dup@example.com");
    expect(items[0].labelSuffix).toBe(" (×2)");
    expect(items[0].isEmail).toBe(true);
    expect(items[1].label).toBe("unique@example.com");
    expect(items[1].labelSuffix).toBe("");
    expect(items[1].isEmail).toBe(true);
  });

  it("uses the lowest remaining quota when duplicate identities are grouped", () => {
    const items = buildRemainingItems(
      [
        account({
          accountId: "acc-1",
          email: "dup@example.com",
          usage: { primaryRemainingPercent: 60, secondaryRemainingPercent: 80 },
        }),
        account({
          accountId: "acc-2",
          email: "dup@example.com",
          usage: { primaryRemainingPercent: 20, secondaryRemainingPercent: 50 },
        }),
      ],
      {
        windowKey: "primary",
        windowMinutes: 300,
        accounts: [
          {
            accountId: "acc-1",
            remainingPercentAvg: 60,
            capacityCredits: 100,
            remainingCredits: 60,
          },
          {
            accountId: "acc-2",
            remainingPercentAvg: 20,
            capacityCredits: 100,
            remainingCredits: 20,
          },
        ],
      },
      "primary",
    );

    expect(items).toHaveLength(1);
    expect(items[0].accountId).toBe("acc-2");
    expect(items[0].value).toBe(20);
    expect(items[0].remainingPercent).toBe(20);
  });
});

describe("buildDashboardView", () => {
  it("orders donut accounts by 5h remaining, then weekly remaining", () => {
    const overview = {
      lastSyncAt: null,
      accounts: [
        account({
          accountId: "acc-medium",
          email: "medium@example.com",
          usage: { primaryRemainingPercent: 65, secondaryRemainingPercent: 95 },
        }),
        account({
          accountId: "acc-high-weekly",
          email: "high-weekly@example.com",
          usage: { primaryRemainingPercent: 80, secondaryRemainingPercent: 70 },
        }),
        account({
          accountId: "acc-high-primary",
          email: "high-primary@example.com",
          usage: { primaryRemainingPercent: 80, secondaryRemainingPercent: 55 },
        }),
      ],
      summary: {
        primaryWindow: {
          remainingPercent: 70,
          capacityCredits: 300,
          remainingCredits: 225,
          resetAt: null,
          windowMinutes: 300,
        },
        secondaryWindow: {
          remainingPercent: 70,
          capacityCredits: 3000,
          remainingCredits: 2100,
          resetAt: null,
          windowMinutes: 10080,
        },
        cost: { currency: "USD", totalUsd7d: 0 },
        metrics: {
          requests7d: 0,
          tokensSecondaryWindow: 0,
          cachedTokensSecondaryWindow: 0,
          errorRate7d: 0,
          topError: null,
        },
      },
      windows: {
        primary: {
          windowKey: "primary",
          windowMinutes: 300,
          accounts: [
            {
              accountId: "acc-medium",
              remainingPercentAvg: 65,
              capacityCredits: 100,
              remainingCredits: 65,
            },
            {
              accountId: "acc-high-weekly",
              remainingPercentAvg: 80,
              capacityCredits: 100,
              remainingCredits: 80,
            },
            {
              accountId: "acc-high-primary",
              remainingPercentAvg: 80,
              capacityCredits: 100,
              remainingCredits: 80,
            },
          ],
        },
        secondary: {
          windowKey: "secondary",
          windowMinutes: 10080,
          accounts: [
            {
              accountId: "acc-medium",
              remainingPercentAvg: 95,
              capacityCredits: 1000,
              remainingCredits: 950,
            },
            {
              accountId: "acc-high-weekly",
              remainingPercentAvg: 70,
              capacityCredits: 1000,
              remainingCredits: 700,
            },
            {
              accountId: "acc-high-primary",
              remainingPercentAvg: 55,
              capacityCredits: 1000,
              remainingCredits: 550,
            },
          ],
        },
      },
      trends: { requests: [], tokens: [], cost: [], errorRate: [] },
      additionalQuotas: [],
      depletionPrimary: null,
      depletionSecondary: null,
    };

    const view = buildDashboardView(overview, [], false);

    expect(view.primaryUsageItems.map((item) => item.accountId)).toEqual([
      "acc-high-weekly",
      "acc-high-primary",
      "acc-medium",
    ]);
    expect(view.secondaryUsageItems.map((item) => item.accountId)).toEqual([
      "acc-high-weekly",
      "acc-high-primary",
      "acc-medium",
    ]);
  });
});
