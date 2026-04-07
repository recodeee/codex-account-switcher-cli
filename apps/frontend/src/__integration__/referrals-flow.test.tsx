import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { renderWithProviders } from "@/test/utils";

describe("referrals page integration", () => {
  it("renders auto-generated referral links for each user account", async () => {
    window.history.pushState({}, "", "/referrals");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Referrals" })).toBeInTheDocument();
    expect((await screen.findAllByText("primary@example.com")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("secondary@example.com")).length).toBeGreaterThan(0);

    expect(
      screen.getByText((content) => content.includes("ref=acc_primary")),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("ref=acc_secondary")),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy link" })).toHaveLength(2);
  });
});
