import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { BillingPage } from "./billing-page";

describe("BillingPage", () => {
  it("shows business-account details directly on the /billing page", () => {
    renderWithProviders(<BillingPage />);

    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Current cycles vary by business account")).toBeInTheDocument();

    expect(screen.getByText("edixai.com")).toBeInTheDocument();
    expect(screen.getByText("kozpontihusbolt.hu")).toBeInTheDocument();
    expect(screen.getByText("kronakert.hu")).toBeInTheDocument();
    expect(
      screen.getByText("Total business plan monthly cost: €338/month · Renewals vary by account"),
    ).toBeInTheDocument();
  });

  it("opens business plan details dialog when clicking the details button", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Business plan details" }));

    const detailsDialog = await screen.findByRole("dialog", { name: "Business plan details" });
    expect(within(detailsDialog).getByText("edixai.com")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("kozpontihusbolt.hu")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("kronakert.hu")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Total business plan monthly cost: €338/month")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Renewals vary by account")).toBeInTheDocument();
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

    const biankaRow = within(accountListDialog).getByText("Bianka Belovics").closest("tr");
    expect(biankaRow).not.toBeNull();
    expect(within(biankaRow as HTMLTableRowElement).getByText("26 euro")).toBeInTheDocument();

    const csovesRow = within(accountListDialog).getByText("Csoves").closest("tr");
    expect(csovesRow).not.toBeNull();
    expect(within(csovesRow as HTMLTableRowElement).getByText("0 euro")).toBeInTheDocument();
  });

  it("lets me change seat type and remove member accounts from the row action button", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Watch kozpontihusbolt.hu accounts list" }));

    const accountListDialog = await screen.findByRole("dialog", {
      name: "kozpontihusbolt.hu · Accounts list",
    });

    await user.click(within(accountListDialog).getByRole("button", { name: "Open actions for Automation 1" }));
    await user.click(screen.getByRole("menuitem", { name: "Change seat type to ChatGPT" }));

    const automationOneRow = screen.getByText("Automation 1").closest("tr");
    expect(automationOneRow).not.toBeNull();
    expect(within(automationOneRow as HTMLTableRowElement).getByText("ChatGPT")).toBeInTheDocument();
    expect(within(automationOneRow as HTMLTableRowElement).getByText("26 euro")).toBeInTheDocument();

    await user.click(within(accountListDialog).getByRole("button", { name: "Open actions for Automation 2" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove account" }));

    expect(within(accountListDialog).queryByText("Automation 2")).not.toBeInTheDocument();

    const businessAccountRow = screen.getByText("kozpontihusbolt.hu").closest("tr");
    expect(businessAccountRow).not.toBeNull();
    const chatgptSeatControl = within(businessAccountRow as HTMLTableRowElement).getByLabelText(
      "ChatGPT seats for kozpontihusbolt.hu",
    );
    const codexSeatControl = within(businessAccountRow as HTMLTableRowElement).getByLabelText(
      "Codex seats for kozpontihusbolt.hu",
    );
    expect(within(chatgptSeatControl).getByText("6")).toBeInTheDocument();
    expect(within(codexSeatControl).getByText("3")).toBeInTheDocument();

    expect(
      screen.getByText("Total business plan monthly cost: €364/month · Renewals vary by account"),
    ).toBeInTheDocument();
  });

  it("lets me increase and decrease seats directly from the business account row", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    const increaseChatgptSeatsButton = screen.getByRole("button", {
      name: "Increase ChatGPT seats for edixai.com",
    });
    const decreaseCodexSeatsButton = screen.getByRole("button", {
      name: "Decrease Codex seats for edixai.com",
    });

    expect(increaseChatgptSeatsButton).toBeEnabled();
    expect(decreaseCodexSeatsButton).toBeEnabled();
    expect(increaseChatgptSeatsButton).toHaveClass("cursor-pointer");
    expect(decreaseCodexSeatsButton).toHaveClass("cursor-pointer");

    await user.click(increaseChatgptSeatsButton);
    await user.click(decreaseCodexSeatsButton);

    const businessAccountRow = screen.getByText("edixai.com").closest("tr");
    expect(businessAccountRow).not.toBeNull();
    const chatgptSeatControl = within(businessAccountRow as HTMLTableRowElement).getByLabelText(
      "ChatGPT seats for edixai.com",
    );
    const codexSeatControl = within(businessAccountRow as HTMLTableRowElement).getByLabelText(
      "Codex seats for edixai.com",
    );
    expect(within(chatgptSeatControl).getByText("6")).toBeInTheDocument();
    expect(within(codexSeatControl).getByText("4")).toBeInTheDocument();

    const chatgptMetricCard = screen.getByText("ChatGPT seats in use").closest("div");
    const codexMetricCard = screen.getByText("Codex seats in use").closest("div");
    expect(chatgptMetricCard).not.toBeNull();
    expect(codexMetricCard).not.toBeNull();
    expect(within(chatgptMetricCard as HTMLDivElement).getByText("14")).toBeInTheDocument();
    expect(within(codexMetricCard as HTMLDivElement).getByText("12")).toBeInTheDocument();
    expect(
      screen.getByText("Total business plan monthly cost: €364/month · Renewals vary by account"),
    ).toBeInTheDocument();
  });

  it("lets me edit billing cycle start and end dates from the business account row", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    const kronakertRow = screen.getByText("kronakert.hu").closest("tr");
    expect(kronakertRow).not.toBeNull();

    const startInput = within(kronakertRow as HTMLTableRowElement).getByRole("button", {
      name: "Billing cycle start for kronakert.hu",
    });

    await user.click(startInput);
    fireEvent.change(await screen.findByLabelText("Billing cycle start for kronakert.hu input"), {
      target: { value: "2026-04-05" },
    });

    await user.click(screen.getByRole("button", { name: "Business plan details" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Billing cycle end for kronakert.hu in details",
      }),
    );
    fireEvent.change(
      await screen.findByLabelText("Billing cycle end for kronakert.hu in details input"),
      {
      target: { value: "2026-05-08" },
      },
    );
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Watch kronakert.hu accounts list" }));

    const accountListDialog = await screen.findByRole("dialog", {
      name: "kronakert.hu · Accounts list",
    });
    expect(
      within(accountListDialog).getByText(
        "Check and edit seat assignments for members in this business account. Current cycle: Apr 5 - May 8",
      ),
    ).toBeInTheDocument();
  });
});
