import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { markNavigationLoaderSuppressed } from "@/lib/navigation-loader";
import { SpinnerBlock } from "@/components/ui/spinner";

describe("SpinnerBlock", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("renders loading status by default", () => {
    render(<SpinnerBlock />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("does not render while navigation loader suppression is active", () => {
    markNavigationLoaderSuppressed(5_000);
    render(<SpinnerBlock />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
