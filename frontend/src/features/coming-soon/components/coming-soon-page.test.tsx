import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ComingSoonPage } from "@/features/coming-soon/components/coming-soon-page";

describe("ComingSoonPage", () => {
  it("renders recodee.com branding with signup form", () => {
    render(<ComingSoonPage />);

    expect(screen.getByText("recodee.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coming Soon" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.getByAltText("Dashboard preview")).toBeInTheDocument();
  });

  it("shows a confirmation message after submitting an email", async () => {
    const user = userEvent.setup();
    render(<ComingSoonPage />);

    await user.type(screen.getByLabelText("Email address"), "hello@recodee.com");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByText(/Thanks! We will keep/i)).toBeInTheDocument();
    expect(screen.getByText("hello@recodee.com")).toBeInTheDocument();
  });
});
