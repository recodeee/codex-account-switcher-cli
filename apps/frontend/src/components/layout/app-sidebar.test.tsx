import { screen, waitFor, within } from "@testing-library/react";
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

  it("shows manager links with the requested ordering", () => {
    renderWithProviders(<AppSidebar />);

    expect(screen.getByText("Manager")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Sidebar" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim() ?? "");

    const agentsIndex = labels.findIndex((label) => label === "Agents");
    const skillsIndex = labels.findIndex((label) => label === "Skills");
    const storageIndex = labels.findIndex((label) => label.startsWith("Storage"));
    const accountsIndex = labels.findIndex((label) => label === "Accounts");
    const sessionsIndex = labels.findIndex((label) => label === "Sessions");
    const referralsIndex = labels.findIndex((label) => label === "Referrals");

    expect(agentsIndex).toBeGreaterThanOrEqual(0);
    expect(skillsIndex).toBeGreaterThan(agentsIndex);
    expect(storageIndex).toBeGreaterThanOrEqual(0);
    expect(storageIndex).toBeGreaterThan(skillsIndex);
    expect(accountsIndex).toBeGreaterThan(storageIndex);
    expect(sessionsIndex).toBeGreaterThan(accountsIndex);
    expect(referralsIndex).toBeGreaterThan(sessionsIndex);
  });

  it("creates and selects switchboard workspaces", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AppSidebar />);

    await user.click(screen.getByLabelText("Toggle switchboards panel"));
    await user.click(screen.getByRole("button", { name: "Create workspace onboarding" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create a new workspace" })).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Workspace Name");
    await user.type(input, "My Team");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Connect a Runtime" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create Your First Agent" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Active workspace name")).toHaveTextContent("My Team");
      expect(screen.getByLabelText("Select workspace My Team")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("Select workspace recodee.com"));

    await waitFor(() => {
      expect(screen.getByLabelText("Active workspace name")).toHaveTextContent("recodee.com");
    });

    await user.click(screen.getByLabelText("Delete workspace My Team"));
    await waitFor(() => {
      expect(screen.queryByLabelText("Select workspace My Team")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Delete workspace My Team")).not.toBeInTheDocument();
    });
  });
});
