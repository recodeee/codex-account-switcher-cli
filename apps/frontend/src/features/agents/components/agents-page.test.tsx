import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgents } from "@/features/agents/hooks/use-agents";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { listStickySessions } from "@/features/sticky-sessions/api";
import { renderWithProviders } from "@/test/utils";

import { AgentsPage } from "./agents-page";

vi.mock("@/features/dashboard/hooks/use-dashboard", () => ({
  useDashboard: vi.fn(),
}));

vi.mock("@/features/agents/hooks/use-agents", () => ({
  useAgents: vi.fn(),
}));

vi.mock("@/features/sticky-sessions/api", () => ({
  listStickySessions: vi.fn(),
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
  const deleteMutate = vi.fn();

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
    deleteMutate.mockReset();

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
    vi.mocked(listStickySessions).mockResolvedValue({
      entries: [],
      unmappedCliSessions: [],
      stalePromptCacheCount: 0,
      total: 0,
      hasMore: false,
    });

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
        mutate: deleteMutate,
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
    expect(screen.getAllByRole("button", { name: "Add Skill" }).length).toBeGreaterThan(0);

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

  it("opens Add Skill dialog and creates a skill assignment from create tab", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await user.click(screen.getAllByRole("button", { name: "Add Skill" })[0]);

    const dialog = screen.getByRole("dialog", { name: "Add Skill" });
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Bug Triage");
    await user.type(screen.getByLabelText("Description"), "Prioritizes production incidents");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Bug Triage")).toBeInTheDocument();
      expect(screen.getByText("Prioritizes production incidents")).toBeInTheDocument();
    });
  });

  it("creates a new agent from popup", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("button", { name: "Create agent" }));

    const dialog = screen.getByRole("dialog", { name: "Create Agent" });
    expect(dialog).toBeInTheDocument();

    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, new File(["hello"], "new-avatar.png", { type: "image/png" }));

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
          avatarDataUrl: "data:image/png;base64,aGVsbG8=",
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

  it("shows archive action in three-dot menu and archives selected agent", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("button", { name: "Agent actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive Agent" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive agent?" });
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(deleteMutate).toHaveBeenCalledWith({
      agentId: "agent-master",
      agentName: "Master Agent",
    });
  });

  it("includes unmapped Openclaw runtime in Create Agent runtime list", async () => {
    const user = userEvent.setup({ delay: null });
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
        ],
      },
    } as ReturnType<typeof useDashboard>);
    vi.mocked(listStickySessions).mockResolvedValue({
      entries: [],
      unmappedCliSessions: [
        {
          snapshotName: "openclaw-recodee",
          processSessionCount: 1,
          runtimeSessionCount: 0,
          totalSessionCount: 1,
          reason: "No account matched this snapshot.",
        },
      ],
      stalePromptCacheCount: 0,
      total: 1,
      hasMore: false,
    });

    renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByText("Openclaw (openclaw-recodee)")).toBeInTheDocument();
  });
});
