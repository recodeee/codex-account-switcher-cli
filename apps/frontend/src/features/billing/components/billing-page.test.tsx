import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { BillingPage } from "./billing-page";

describe("BillingPage", () => {
  it("shows business-account details directly on the /billing page", () => {
    renderWithProviders(<BillingPage />);

    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Current cycle: Mar 23 - Apr 23")).toBeInTheDocument();

    expect(screen.getByText("edixai.com")).toBeInTheDocument();
    expect(screen.getByText("kozpontihusbolt.hu")).toBeInTheDocument();
    expect(screen.getByText("Total business plan monthly cost: €260/month · Renews on Apr 23")).toBeInTheDocument();
  });

  it("opens business plan details dialog when clicking the details button", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Business plan details" }));

    const detailsDialog = await screen.findByRole("dialog", { name: "Business plan details" });
    expect(within(detailsDialog).getByText("edixai.com")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("kozpontihusbolt.hu")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Total business plan monthly cost: €260/month")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Renews on Apr 23")).toBeInTheDocument();
  });

  it("opens account list dialog from watch button", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Watch edixai.com accounts list" }));

    const accountListDialog = await screen.findByRole("dialog", {
      name: "edixai.com · Accounts list",
    });

    expect(within(accountListDialog).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(accountListDialog).getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(within(accountListDialog).getByRole("columnheader", { name: "Seat type" })).toBeInTheDocument();
    expect(within(accountListDialog).getByRole("columnheader", { name: "Date added" })).toBeInTheDocument();
    expect(within(accountListDialog).getByText("Bianka Belovics")).toBeInTheDocument();
    expect(within(accountListDialog).getByText("bia@edixai.com")).toBeInTheDocument();
  });

  it("lets me change seat type from dropdown and remove member accounts from the row action button", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Watch kozpontihusbolt.hu accounts list" }));

    const accountListDialog = await screen.findByRole("dialog", {
      name: "kozpontihusbolt.hu · Accounts list",
    });

    await user.click(
      within(accountListDialog).getByRole("combobox", { name: "Seat type for Automation 1" }),
    );
    await user.click(screen.getByRole("option", { name: "ChatGPT" }));

    const automationOneRow = screen.getByText("Automation 1").closest("tr");
    expect(automationOneRow).not.toBeNull();
    expect(within(automationOneRow as HTMLTableRowElement).getByText("ChatGPT")).toBeInTheDocument();

    await user.click(within(accountListDialog).getByRole("button", { name: "Open actions for Automation 2" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove account" }));

    expect(within(accountListDialog).queryByText("Automation 2")).not.toBeInTheDocument();

    const businessAccountRow = screen.getByText("kozpontihusbolt.hu").closest("tr");
    expect(businessAccountRow).not.toBeNull();
    expect(within(businessAccountRow as HTMLTableRowElement).getByText("6 seats in use")).toBeInTheDocument();
    expect(within(businessAccountRow as HTMLTableRowElement).getByText("3 seats in use")).toBeInTheDocument();

    expect(
      screen.getByText("Total business plan monthly cost: €286/month · Renews on Apr 23"),
    ).toBeInTheDocument();
  });
});
