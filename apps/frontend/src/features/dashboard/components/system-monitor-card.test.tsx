import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SystemMonitorCard } from "@/features/dashboard/components/system-monitor-card";

const sampleData = {
  sampledAt: "2026-04-08T20:00:00.000Z",
  cpuPercent: 39.8,
  gpuPercent: 33.5,
  vramPercent: 57.5,
  networkMbS: 5.3,
  memoryPercent: 61.2,
  spike: true,
};

vi.mock("@/features/dashboard/hooks/use-system-monitor", () => ({
  useSystemMonitor: () => ({
    data: sampleData,
  }),
}));

describe("SystemMonitorCard", () => {
  it("renders monitor metrics and spike badge", () => {
    render(<SystemMonitorCard />);

    expect(screen.getByText("System Monitor")).toBeInTheDocument();
    expect(screen.getByText("Spike")).toBeInTheDocument();
    expect(screen.getByText("39.8 %")).toBeInTheDocument();
    expect(screen.getByText("33.5 %")).toBeInTheDocument();
    expect(screen.getByText("57.5 %")).toBeInTheDocument();
    expect(screen.getByText("5.3 MB/s")).toBeInTheDocument();
  });

  it("collapses metric tiles when toggled", async () => {
    const user = userEvent.setup();
    render(<SystemMonitorCard />);

    const toggle = screen.getByRole("button", { name: /system monitor/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CPU")).toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
  });
});
