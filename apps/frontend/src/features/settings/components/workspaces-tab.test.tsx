import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspacesTab } from "@/features/settings/components/workspaces-tab";
import { readWorkspaceLocalProfile } from "@/features/settings/components/workspace-settings-local";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";
import type { WorkspaceEntry } from "@/features/workspaces/schemas";
import { renderWithProviders } from "@/test/utils";

vi.mock("@/features/workspaces/hooks/use-workspaces", () => ({
  useWorkspaces: vi.fn(),
}));

function createWorkspaceEntry(overrides: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: overrides.id ?? "ws-default",
    name: overrides.name ?? "Workspace",
    slug: overrides.slug ?? "workspace",
    label: overrides.label ?? "Team",
    isActive: overrides.isActive ?? false,
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00.000Z",
  };
}

describe("WorkspacesTab", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders every workspace and lets users switch inactive workspaces", async () => {
    const user = userEvent.setup();
    const selectMutate = vi.fn();

    vi.mocked(useWorkspaces).mockReturnValue({
      workspacesQuery: {
        data: {
          entries: [
            createWorkspaceEntry({ id: "ws-active", name: "DPQ", slug: "dpq", isActive: true }),
            createWorkspaceEntry({ id: "ws-two", name: "recodee.com", slug: "recodee-com", isActive: false }),
          ],
        },
      },
      createMutation: { isPending: false, mutateAsync: vi.fn() },
      selectMutation: { isPending: false, mutate: selectMutate },
      deleteMutation: { isPending: false, mutateAsync: vi.fn() },
    } as ReturnType<typeof useWorkspaces>);

    renderWithProviders(<WorkspacesTab />);

    expect(screen.getByText("DPQ")).toBeInTheDocument();
    expect(screen.getByText("recodee.com")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use workspace" }));
    expect(selectMutate).toHaveBeenCalledWith("ws-two");
  });

  it("persists edited workspace profile fields locally", async () => {
    const user = userEvent.setup();

    vi.mocked(useWorkspaces).mockReturnValue({
      workspacesQuery: {
        data: {
          entries: [createWorkspaceEntry({ id: "ws-profile", name: "DPQ", slug: "dpq", label: "Team", isActive: true })],
        },
      },
      createMutation: { isPending: false, mutateAsync: vi.fn() },
      selectMutation: { isPending: false, mutate: vi.fn() },
      deleteMutation: { isPending: false, mutateAsync: vi.fn() },
    } as ReturnType<typeof useWorkspaces>);

    renderWithProviders(<WorkspacesTab />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "DPQ Labs" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Workspace" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Core workspace for platform operations." } });
    fireEvent.change(screen.getByLabelText("Context"), { target: { value: "Used by admins and coding agents." } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const saved = readWorkspaceLocalProfile("ws-profile");
    expect(saved.displayName).toBe("DPQ Labs");
    expect(saved.label).toBe("Workspace");
    expect(saved.description).toBe("Core workspace for platform operations.");
    expect(saved.context).toBe("Used by admins and coding agents.");
  });
});
