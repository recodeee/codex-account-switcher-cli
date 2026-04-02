import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import App from "@/App";
import { renderWithProviders } from "@/test/utils";

describe("devices flow integration", () => {
  it("loads devices page and supports add/delete", async () => {
    const user = userEvent.setup({ delay: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    window.history.pushState({}, "", "/devices");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Devices" })).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Device name (e.g. ksskringdistance03)"),
      "ksskringdistance03",
    );
    await user.type(screen.getByPlaceholderText("IP address (e.g. 192.168.0.1)"), "192.168.0.1");

    await user.click(screen.getByRole("button", { name: "Add device" }));
    expect(await screen.findByText("ksskringdistance03")).toBeInTheDocument();
    expect(screen.getByText("192.168.0.1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide sensitive values" }));
    expect(screen.getByText("ksskringdistance03")).toHaveClass("privacy-blur");
    expect(screen.getByText("192.168.0.1")).toHaveClass("privacy-blur");

    await user.click(screen.getByRole("button", { name: "Copy ksskringdistance03 and 192.168.0.1" }));
    expect(writeText).toHaveBeenCalledWith("ksskringdistance03\t192.168.0.1");

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("ksskringdistance03")).not.toBeInTheDocument();
    });
  });
});
