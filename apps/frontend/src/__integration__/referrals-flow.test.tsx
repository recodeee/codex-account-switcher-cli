import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { renderWithProviders } from "@/test/utils";

describe("referrals page integration", () => {
  it("renders one invite link for the active account and lists referred account emails", async () => {
    window.history.pushState({}, "", "/referrals");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Referrals" })).toBeInTheDocument();
    expect((await screen.findAllByText("primary@example.com")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("secondary@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByText("Referred users")).toBeInTheDocument();

    const referralLinks = screen.getAllByRole("link");
    expect(
      referralLinks.some((link) => link.getAttribute("href")?.includes("ref=acc_primary")),
    ).toBe(true);
    expect(
      referralLinks.some((link) => link.getAttribute("href")?.includes("ref=acc_secondary")),
    ).toBe(false);
    expect(screen.getAllByRole("button", { name: "Copy link" })).toHaveLength(1);
  });
});
