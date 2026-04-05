import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavLink } from "@/lib/router-compat";

function clearNextRuntimeFlag() {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "__NEXT_DATA__");
}

function setNextRuntimeFlag() {
  Object.defineProperty(window, "__NEXT_DATA__", {
    configurable: true,
    writable: true,
    value: {
      props: {},
      page: "/",
      query: {},
      buildId: "test-build",
    },
  });
}

describe("NavLink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearNextRuntimeFlag();
  });

  it("uses history pushState for same-origin navigation in non-Next runtime", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/apis");
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    render(<NavLink to="/accounts">Accounts</NavLink>);
    await user.click(screen.getByRole("link", { name: "Accounts" }));

    expect(pushStateSpy).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/accounts");
  });

  it("prefers full navigation over pushState when running in Next runtime", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/apis");
    setNextRuntimeFlag();

    const pushStateSpy = vi.spyOn(window.history, "pushState");

    render(<NavLink to="/accounts">Accounts</NavLink>);
    await user.click(screen.getByRole("link", { name: "Accounts" }));

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/apis");
  });

  it("prefers full navigation for query links in Next runtime", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/apis");
    setNextRuntimeFlag();

    const pushStateSpy = vi.spyOn(window.history, "pushState");

    render(<NavLink to="/apis?selected=key_1">Key 1</NavLink>);
    await user.click(screen.getByRole("link", { name: "Key 1" }));

    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/apis");
    expect(window.location.search).toBe("");
  });
});
