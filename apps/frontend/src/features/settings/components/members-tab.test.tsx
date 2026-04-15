import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembersTab } from "@/features/settings/components/members-tab";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";
import type { WorkspaceEntry } from "@/features/workspaces/schemas";
import { renderWithProviders } from "@/test/utils";

vi.mock("@/features/workspaces/hooks/use-workspaces", () => ({
  useWorkspaces: vi.fn(),
}));

function createWorkspaceEntry(id: string): WorkspaceEntry {
  return {
    id,
    name: `Workspace ${id}`,
    slug: `workspace-${id}`,
    label: "Team",
    isActive: true,
    createdAt: "2026-04-14T11:00:00.000Z",
    updatedAt: "2026-04-14T11:00:00.000Z",
  };
}

function mockWorkspaces(entries: WorkspaceEntry[]) {
  vi.mocked(useWorkspaces).mockReturnValue({
    workspacesQuery: { data: { entries } },
    createMutation: { isPending: false, mutateAsync: vi.fn() },
    selectMutation: { isPending: false, mutate: vi.fn() },
    deleteMutation: { isPending: false, mutate: vi.fn() },
  } as unknown as ReturnType<typeof useWorkspaces>);
}

describe("MembersTab", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMedusaAdminAuthStore.setState({
      token: null,
      user: {
        id: "user-owner",
        email: "owner@recodee.com",
        first_name: "Owner",
        last_name: "User",
        avatar_url: null,
      },
      lastAuthenticatedEmail: "owner@recodee.com",
      loading: false,
      error: null,
      login: async () => undefined,
      logout: () => undefined,
      clearError: () => undefined,
    });
  });

  it("rehydrates default owner member when workspace data appears after first render", async () => {
    mockWorkspaces([]);
    const view = renderWithProviders(<MembersTab />);

    expect(screen.getByText("Members (0)")).toBeInTheDocument();

    mockWorkspaces([createWorkspaceEntry("workspace-1")]);
    view.rerender(<MembersTab />);

    await waitFor(() => {
      expect(screen.getByText("Members (1)")).toBeInTheDocument();
      expect(screen.getByText("owner@recodee.com")).toBeInTheDocument();
      expect(screen.getByText("Owner User")).toBeInTheDocument();
    });
  });
});
