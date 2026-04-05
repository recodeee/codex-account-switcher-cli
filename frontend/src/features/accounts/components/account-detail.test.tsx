import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountDetail } from "@/features/accounts/components/account-detail";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { createAccountSummary } from "@/test/mocks/factories";

vi.mock("@/features/accounts/hooks/use-accounts", () => ({
  useAccountTrends: () => ({ data: null }),
}));

const baseProps = {
  showAccountId: false,
  busy: false,
  useLocalBusy: false,
  repairSnapshotBusy: false,
  onPause: vi.fn(),
  onResume: vi.fn(),
  onDelete: vi.fn(),
  onUseLocal: vi.fn(),
  onRepairSnapshot: vi.fn(),
  onReauth: vi.fn(),
};

afterEach(() => {
  act(() => {
    usePrivacyStore.setState({ blurred: false });
  });
});

describe("AccountDetail", () => {
  it("shows snapshot label next to account title when snapshot is available", () => {
    const account = createAccountSummary({
      email: "csoves.com@gmail.com",
      displayName: "csoves.com@gmail.com",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "csoves.com",
        activeSnapshotName: "csoves.com",
        isActiveSnapshot: true,
      },
    });

    render(<AccountDetail {...baseProps} account={account} />);

    expect(screen.getByText("SNAPSHOT:csoves.com")).toBeInTheDocument();
  });

  it("hides snapshot label when snapshot name is missing", () => {
    const account = createAccountSummary({
      email: "nosnap@example.com",
      displayName: "nosnap@example.com",
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
    });

    render(<AccountDetail {...baseProps} account={account} />);

    expect(screen.queryByText(/^SNAPSHOT:/)).not.toBeInTheDocument();
  });

  it("blurs snapshot label value when snapshot name is an email and privacy mode is enabled", () => {
    act(() => {
      usePrivacyStore.setState({ blurred: true });
    });
    const account = createAccountSummary({
      email: "account@example.com",
      displayName: "account@example.com",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "snapshot@example.com",
        activeSnapshotName: "snapshot@example.com",
        isActiveSnapshot: true,
      },
    });

    render(<AccountDetail {...baseProps} account={account} />);

    const snapshotValue = screen.getByText("snapshot@example.com");
    expect(snapshotValue.closest(".privacy-blur")).not.toBeNull();
  });
});
