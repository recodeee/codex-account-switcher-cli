import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavLink, useNavigate, useSearchParams } from "@/lib/router-compat";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function NavigateProbe() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/sessions?selected=session_2")}>
      Go
    </button>
  );
}

function SearchParamsProbe() {
  const [searchParams, setSearchParams] = useSearchParams();
  return (
    <>
      <output data-testid="search-value">{searchParams.get("selected") ?? ""}</output>
      <button
        type="button"
        onClick={() => setSearchParams({ selected: "account_2", page: 1 })}
      >
        Set
      </button>
      <button type="button" onClick={() => setSearchParams({}, { replace: true })}>
        Clear
      </button>
    </>
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  (window as unknown as { __NEXT_DATA__?: unknown }).__NEXT_DATA__ = undefined;
  (window as unknown as { __next_f?: unknown }).__next_f = undefined;
});

describe("NavLink", () => {
  it("navigates with React Router without full-page navigation", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <NavLink to="/accounts">Accounts</NavLink>
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");

    await user.click(screen.getByRole("link", { name: "Accounts" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
  });

  it("supports query-string navigation", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/apis"]}>
        <NavLink to="/apis?selected=key_1">Key 1</NavLink>
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Key 1" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/apis?selected=key_1");
  });

  it("renders outside a Router context without throwing", async () => {
    act(() => {
      window.history.replaceState({}, "", "/dashboard");
    });

    render(
      <NavLink
        to="/dashboard"
        className={({ isActive }) => (isActive ? "active" : "inactive")}
      >
        {({ isActive }) => (isActive ? "Dashboard active" : "Dashboard")}
      </NavLink>,
    );

    const link = await screen.findByRole("link", { name: "Dashboard active" });
    expect(link).toHaveClass("active");
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("applies extended loader suppression window for direct nav-link transitions", async () => {
    const user = userEvent.setup();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <NavLink to="/accounts">Accounts</NavLink>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Accounts" }));

    const rawSuppressUntil = window.sessionStorage.getItem("recodee.navigation-loader.suppress-until");
    expect(rawSuppressUntil).toBe(String(1_008_000));

    nowSpy.mockRestore();
  });
});

describe("router-compat fallback hooks", () => {
  it("navigates without a Router context", async () => {
    const user = userEvent.setup();

    render(<NavigateProbe />);

    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(window.location.pathname).toBe("/sessions");
    expect(window.location.search).toBe("?selected=session_2");
  });

  it("navigates without a Router context when Next runtime is detected", async () => {
    const user = userEvent.setup();
    (window as unknown as { __next_f?: unknown }).__next_f = [];

    render(<NavigateProbe />);

    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(window.location.pathname).toBe("/sessions");
    expect(window.location.search).toBe("?selected=session_2");
  });

  it("reads and updates search params without a Router context", async () => {
    const user = userEvent.setup();

    act(() => {
      window.history.replaceState({}, "", "/accounts?selected=account_1");
    });

    render(<SearchParamsProbe />);

    expect(screen.getByTestId("search-value")).toHaveTextContent("account_1");

    await user.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.getByTestId("search-value")).toHaveTextContent("account_2");
    expect(window.location.search).toContain("selected=account_2");
    expect(window.location.search).toContain("page=1");

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("search-value")).toHaveTextContent("");
    expect(window.location.search).toBe("");
  });

  it("updates query params without leaving the page when Next runtime is detected", async () => {
    const user = userEvent.setup();
    (window as unknown as { __next_f?: unknown }).__next_f = [];

    act(() => {
      window.history.replaceState({}, "", "/accounts?selected=account_1");
    });

    render(<SearchParamsProbe />);

    await user.click(screen.getByRole("button", { name: "Set" }));
    expect(window.location.pathname).toBe("/accounts");
    expect(window.location.search).toContain("selected=account_2");
    expect(window.location.search).toContain("page=1");
  });
});
