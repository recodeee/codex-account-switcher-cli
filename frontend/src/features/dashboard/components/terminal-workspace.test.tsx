import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TerminalWorkspaceProvider } from "@/features/dashboard/components/terminal-workspace";
import { useTerminalWorkspace } from "@/features/dashboard/components/terminal-workspace-context";

vi.mock("@/features/dashboard/components/account-terminal-surface", () => ({
  AccountTerminalSurface: ({ account }: { account: { accountId: string; email: string } }) => (
    <div data-testid={`terminal-surface-${account.accountId}`}>{account.email}</div>
  ),
}));

function Harness() {
  const { openTerminal } = useTerminalWorkspace();

  return (
    <div>
      <button
        type="button"
        onClick={() => openTerminal({ accountId: "acc-a", email: "a@edixai.com" })}
      >
        Open A
      </button>
      <button
        type="button"
        onClick={() => openTerminal({ accountId: "acc-a", email: "a@edixai.com" })}
      >
        Open A Again
      </button>
      <button
        type="button"
        onClick={() => openTerminal({ accountId: "acc-b", email: "b@edixai.com" })}
      >
        Open B
      </button>
    </div>
  );
}

describe("TerminalWorkspaceProvider", () => {
  it("opens, minimizes, restores, and reuses terminal windows by account", async () => {
    const user = userEvent.setup();

    render(
      <TerminalWorkspaceProvider>
        <Harness />
      </TerminalWorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open A" }));

    const windowA = screen.getByTestId("terminal-window-acc-a");
    expect(windowA).toBeInTheDocument();
    expect(screen.getByTestId("terminal-dock-item-acc-a")).toBeInTheDocument();

    await user.click(screen.getByTestId("terminal-minimize-acc-a"));
    expect(windowA).toHaveClass("hidden");

    await user.click(screen.getByTestId("terminal-dock-item-acc-a"));
    expect(screen.getByTestId("terminal-window-acc-a")).not.toHaveClass("hidden");

    await user.click(screen.getByRole("button", { name: "Open A Again" }));
    expect(screen.getAllByTestId("terminal-window-acc-a")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Open B" }));
    expect(screen.getByTestId("terminal-window-acc-b")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-dock-item-acc-b")).toBeInTheDocument();
  });

  it("pops out terminal windows and removes in-app session", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

    render(
      <TerminalWorkspaceProvider>
        <Harness />
      </TerminalWorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open A" }));
    await user.click(screen.getByTestId("terminal-popout-acc-a"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("terminal-window-acc-a")).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-dock-item-acc-a")).not.toBeInTheDocument();

    openSpy.mockRestore();
  });
});
