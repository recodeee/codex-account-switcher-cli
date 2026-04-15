import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ComingSoonPage } from "@/features/coming-soon/components/coming-soon-page";

describe("ComingSoonPage", () => {
  it("renders full-width layout with left preview and right content", () => {
    render(<ComingSoonPage />);

    expect(
      screen.getByRole("heading", { name: "recodee.com", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => {
        return (
          element?.tagName === "P" &&
          Boolean(
            element.textContent?.includes(
              "recodee.com keeps Codex account and session signals in one place, so you can move faster when quotas get weird and sessions get noisy.",
            ),
          )
        );
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Coming Soon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "What the dashboard currently does",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Code with multiple agents at the same time",
        level: 3,
      }),
    ).toBeInTheDocument();
    const agentPanel = screen.getByTestId("agent-tools-panel");
    expect(within(agentPanel).getByText("Claude Code")).toBeInTheDocument();
    expect(within(agentPanel).getByText("OpenClaw")).toBeInTheDocument();
    expect(within(agentPanel).getByText("Claw Code")).toBeInTheDocument();
    expect(within(agentPanel).getByText("OpenRouter")).toBeInTheDocument();
    expect(within(agentPanel).getAllByText("Coming soon")).toHaveLength(6);
    expect(within(agentPanel).getByAltText("Codex logo")).toBeInTheDocument();
    expect(within(agentPanel).getByAltText("OpenAI logo")).toBeInTheDocument();
    expect(
      within(agentPanel).getByAltText("Claude Code logo"),
    ).toBeInTheDocument();
    expect(within(agentPanel).getByAltText("OpenClaw logo")).toHaveAttribute(
      "src",
      "/agent-logos/red-crab.svg",
    );
    expect(within(agentPanel).getByAltText("Claw Code logo")).toHaveAttribute(
      "src",
      "/agent-logos/red-crab.svg",
    );
    expect(within(agentPanel).queryByText("Cursor")).not.toBeInTheDocument();
    expect(within(agentPanel).queryByText("Aider")).not.toBeInTheDocument();
    expect(within(agentPanel).queryByText("Ollama")).not.toBeInTheDocument();
    expect(
      screen.getByText("Stay in flow instead of babysitting status checks."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Please enter your email address").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Waiting for email address")).not.toBeInTheDocument();
    expect(screen.queryByText("working...")).not.toBeInTheDocument();
    expect(screen.getByText("Team · demo@demo.com")).toBeInTheDocument();
    const submitTutorialButton = screen.getByRole("button", {
      name: "Submit account tutorial",
    });
    expect(submitTutorialButton).toBeDisabled();
    expect(submitTutorialButton).toHaveTextContent("Submit");
    expect(submitTutorialButton).not.toHaveTextContent("Currently used");
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit account tutorial" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Open accounts" })).toHaveAttribute(
      "href",
      "/accounts",
    );
    expect(screen.getAllByText("TECH STACK").length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("link", { name: "Onlook" })
        .some(
          (link) =>
            link.getAttribute("href") === "https://github.com/onlook-dev/onlook",
        ),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: "OpenRouter" })
        .some((link) => link.getAttribute("href") === "https://openrouter.ai"),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: "Probot" })
        .some(
          (link) => link.getAttribute("href") === "https://github.com/probot/probot",
        ),
    ).toBe(true);
    expect(screen.getByText("Fun Fact")).toBeInTheDocument();
    expect(
      screen.getByText("We built recodee with recodee. We call that confidence."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Very on-brand. Also genuinely useful."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No trial. No credit card required. Just your GitHub account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("codex tokens used: 3B")).toBeInTheDocument();
    expect(screen.getByText("money saved: $10k+")).toBeInTheDocument();
    expect(screen.getByAltText("Codex app screenshot")).toBeInTheDocument();
  });

  it("keeps only the in-card agent email field", () => {
    render(<ComingSoonPage />);
    expect(screen.getByLabelText("Agent email address")).toBeInTheDocument();
    expect(screen.queryByText(/Thanks! We will keep/i)).not.toBeInTheDocument();
  });

  it("enables account activation controls once agent email is entered", async () => {
    const user = userEvent.setup();
    render(<ComingSoonPage />);

    await user.type(
      screen.getByLabelText("Agent email address"),
      "demo@demo.com",
    );

    const submitTutorialButton = screen.getByRole("button", {
      name: "Submit account tutorial",
    });
    expect(submitTutorialButton).toBeEnabled();
    expect(submitTutorialButton).toHaveTextContent("Submit");
    expect(submitTutorialButton).not.toHaveTextContent("Currently used");
    expect(screen.queryByText("thinking")).not.toBeInTheDocument();
  });

  it("opens screenshot in fullscreen dialog and closes it", async () => {
    const user = userEvent.setup();
    render(<ComingSoonPage />);

    await user.click(
      screen.getByRole("button", {
        name: "Open Codex app screenshot fullscreen",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Close fullscreen preview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText("Codex app screenshot fullscreen"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close fullscreen preview" }),
    );

    expect(
      screen.queryByAltText("Codex app screenshot fullscreen"),
    ).not.toBeInTheDocument();
  });
});
