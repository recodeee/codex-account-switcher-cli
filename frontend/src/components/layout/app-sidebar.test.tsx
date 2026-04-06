import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { renderWithProviders } from "@/test/utils";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "recodee.com.sidebar.collapsed";

describe("AppSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders expanded by default", () => {
    renderWithProviders(<AppSidebar />);

    const sidebar = screen.getByLabelText("Primary sidebar");
    expect(sidebar).toHaveClass("w-72");
    expect(screen.getByRole("button", { name: "Collapse navigation menu" })).toBeInTheDocument();
  });

  it("collapses and persists the preference when toggled", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AppSidebar />);

    await user.click(screen.getByRole("button", { name: "Collapse navigation menu" }));

    const sidebar = screen.getByLabelText("Primary sidebar");
    expect(sidebar).toHaveClass("w-20");
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("1");
    expect(screen.getByRole("button", { name: "Expand navigation menu" })).toBeInTheDocument();
  });

  it("starts collapsed when the persisted preference exists", () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "1");

    renderWithProviders(<AppSidebar />);

    const sidebar = screen.getByLabelText("Primary sidebar");
    expect(sidebar).toHaveClass("w-20");
    expect(screen.getByRole("button", { name: "Expand navigation menu" })).toBeInTheDocument();
  });

  it("shows only account count summary in the sidebar header", async () => {
    renderWithProviders(<AppSidebar />);

    await waitFor(() => {
      expect(screen.getByText(/Accounts \(2\)/i)).toBeInTheDocument();
      expect(screen.queryByText(/5h Remaining/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Weekly Remaining/i)).not.toBeInTheDocument();
    });
  });
});
