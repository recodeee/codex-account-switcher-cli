import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ComingSoonPage } from "@/features/coming-soon/components/coming-soon-page";

describe("ComingSoonPage", () => {
  it("renders full-width layout with left preview and right content", () => {
    render(<ComingSoonPage />);

    expect(screen.getByText("recodee.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coming Soon" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What the dashboard currently does" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Agent waiting for email address").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Team · demo@demo.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit account tutorial" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit account tutorial" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Open accounts" })).toHaveAttribute(
      "href",
      "/accounts",
    );
    expect(screen.getByText("Fun Fact")).toBeInTheDocument();
    expect(
      screen.getByText("recodee.com was built with recodee.com too."),
    ).toBeInTheDocument();
    expect(screen.getByText("tokens spent: 3000M")).toBeInTheDocument();
    expect(screen.getByAltText("Dashboard preview")).toBeInTheDocument();
  });

  it("keeps only the in-card agent email field", () => {
    render(<ComingSoonPage />);
    expect(screen.getByLabelText("Agent email address")).toBeInTheDocument();
    expect(screen.queryByText(/Thanks! We will keep/i)).not.toBeInTheDocument();
  });

  it("enables account activation controls once agent email is entered", async () => {
    const user = userEvent.setup();
    render(<ComingSoonPage />);

    await user.type(screen.getByLabelText("Agent email address"), "demo@demo.com");

    expect(
      screen.getByRole("button", { name: "Submit account tutorial" }),
    ).toBeEnabled();
  });
});
