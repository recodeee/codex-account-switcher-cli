import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TerminalPopoutPage } from "@/features/dashboard/components/terminal-popout-page";

vi.mock("@/features/dashboard/components/account-terminal-surface", () => ({
  AccountTerminalSurface: ({ account }: { account: { accountId: string; email: string } }) => (
    <div data-testid="detached-terminal-surface">{account.accountId}:{account.email}</div>
  ),
}));

describe("TerminalPopoutPage", () => {
  it("renders detached terminal surface from query params", () => {
    render(
      <MemoryRouter initialEntries={["/terminal-popout?accountId=acc-a&email=a@edixai.com"]}>
        <Routes>
          <Route path="/terminal-popout" element={<TerminalPopoutPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Codex Terminal (Detached)")).toBeInTheDocument();
    expect(screen.getByTestId("detached-terminal-surface")).toHaveTextContent(
      "acc-a:a@edixai.com",
    );
  });

  it("shows fallback copy when account id is missing", () => {
    render(
      <MemoryRouter initialEntries={["/terminal-popout"]}>
        <Routes>
          <Route path="/terminal-popout" element={<TerminalPopoutPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Terminal account is missing")).toBeInTheDocument();
  });
});
