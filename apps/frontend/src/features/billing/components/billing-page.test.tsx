import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { BillingPage } from "./billing-page";

describe("BillingPage", () => {
  it("shows current cycle and initial monthly total", () => {
    renderWithProviders(<BillingPage />);

    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Current cycle: Mar 23 - Apr 23")).toBeInTheDocument();
    expect(screen.getByText("Total ChatGPT monthly cost: €130/month")).toBeInTheDocument();
    expect(screen.getByText("Renews on Apr 23")).toBeInTheDocument();
  });

  it("adds a new ChatGPT seat and updates total monthly cost", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Invite member" }));

    const dialog = await screen.findByRole("dialog", { name: "Invite member" });
    await user.type(within(dialog).getByLabelText("Name"), "New Member");
    await user.type(within(dialog).getByLabelText("Email"), "new.member@edixai.com");

    await user.click(within(dialog).getByRole("button", { name: "Add seat" }));

    expect(screen.getByText("Total ChatGPT monthly cost: €156/month")).toBeInTheDocument();
    expect(screen.getByText("New Member")).toBeInTheDocument();
    expect(screen.getByText("new.member@edixai.com")).toBeInTheDocument();
  });
});
