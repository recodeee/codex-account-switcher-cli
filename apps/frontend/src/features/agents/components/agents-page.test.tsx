import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgents } from "@/features/agents/hooks/use-agents";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { renderWithProviders } from "@/test/utils";

import { AgentsPage } from "./agents-page";

vi.mock("@/features/dashboard/hooks/use-dashboard", () => ({
  useDashboard: vi.fn(),
}));

vi.mock("@/features/agents/hooks/use-agents", () => ({
  useAgents: vi.fn(),
}));

const NOW = "2026-04-13T20:00:00Z";

class FileReaderMock {
  result: string | ArrayBuffer | null = null;
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

  readAsDataURL(file: Blob) {
    void file;
    this.result = "data:image/png;base64,aGVsbG8=";
    if (this.onload) {
      this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
    }
  }
}

describe("AgentsPage", () => {
  const createMutateAsync = vi.fn();
  const updateMutateAsync = vi.fn();

  beforeEach(() => {
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false;
    }
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = () => {};
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = () => {};
    }

    vi.stubGlobal("FileReader", FileReaderMock);

    createMutateAsync.mockReset();
    updateMutateAsync.mockReset();

    createMutateAsync.mockResolvedValue({
      id: "agent-created",
      name: "Deep Research Agent",
      status: "idle",
      description: "Investigates and synthesizes docs",
      visibility: "private",
      runtime: "Openclaw (openclaw-main)",
      instructions: "",
      maxConcurrentTasks: 6,
      avatarDataUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    updateMutateAsync.mockImplementation(async ({ payload }: { payload: Record<string, unknown> }) => ({
      id: "agent-master",
      name: payload.name ?? "Master Agent",
      status: payload.status ?? "idle",
      description: payload.description ?? "",
      visibility: payload.visibility ?? "workspace",
      runtime: payload.runtime ?? "Codex (recodee)",
      instructions: payload.instructions ?? "",
      maxConcurrentTasks: payload.maxConcurrentTasks ?? 6,
      avatarDataUrl: payload.avatarDataUrl ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    }));

    vi.mocked(useDashboard).mockReturnValue({
      data: {
        accounts: [
          {
            accountId: "acc-codex",
            email: "recodee@workspace.local",
            displayName: "Recodee",
            planType: "pro",
            status: "active",
            codexAuth: {
              hasSnapshot: true,
              snapshotName: "recodee",
            },
            codexLiveSessionCount: 1,
            codexTrackedSessionCount: 1,
            codexSessionCount: 1,
          },
          {
            accountId: "acc-openclaw",
            email: "openclaw@workspace.local",
            displayName: "Openclaw",
            planType: "pro",
            status: "active",
            codexAuth: {
              hasSnapshot: true,
              snapshotName: "openclaw-main",
            },
          },
        ],
      },
    } as ReturnType<typeof useDashboard>);

    vi.mocked(useAgents).mockReturnValue({
      agentsQuery: {
        isLoading: false,
        data: {
          entries: [
            {
              id: "agent-master",
              name: "Master Agent",
              status: "idle",
              description: "",
              visibility: "workspace",
              runtime: "Codex (recodee)",
              instructions: "",
              maxConcurrentTasks: 6,
              avatarDataUrl: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        },
      },
      createMutation: {
        mutateAsync: createMutateAsync,
        isPending: false,
      },
      updateMutation: {
        mutateAsync: updateMutateAsync,
        isPending: false,
      },
      deleteMutation: {
        mutate: vi.fn(),
        isPending: false,
      },
    } as unknown as ReturnType<typeof useAgents>);
  });

  it("renders default agent with tabs", () => {
    renderWithProviders(<AgentsPage />);

    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Master Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Instructions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("No instructions set")).toBeInTheDocument();
  });

  it("matches empty-state tabs and settings fields", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByText("No skills assigned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Skill" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.getByText("Task Queue")).toBeInTheDocument();
    expect(screen.getByText("No tasks in queue")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByText("Click to upload avatar")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Master Agent")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What does this agent do?")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(6);
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("creates a new agent from popup", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("button", { name: "Create agent" }));

    expect(screen.getByRole("dialog", { name: "Create Agent" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("e.g. Deep Research Agent"), "Deep Research Agent");
    await user.type(screen.getByPlaceholderText("What does this agent do?"), "Investigates and synthesizes docs");
    await user.click(screen.getByRole("combobox"));
    expect(screen.getAllByText("Codex (recodee)").length).toBeGreaterThan(0);
    expect(screen.getByText("Openclaw (openclaw-main)")).toBeInTheDocument();
    await user.click(screen.getByText("Openclaw (openclaw-main)"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Deep Research Agent",
          runtime: "Openclaw (openclaw-main)",
        }),
      );
    });
  });

  it("uploads avatar and persists it in save payload", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("tab", { name: "Settings" }));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(["hello"], "avatar.png", { type: "image/png" });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            avatarDataUrl: "data:image/png;base64,aGVsbG8=",
          }),
        }),
      );
    });
  });
});
