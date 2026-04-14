type LocalWorkspaceRepository = {
  id: string;
  url: string;
  description: string;
};

type LocalWorkspaceMemberRole = "owner" | "admin" | "member";

type LocalWorkspaceMember = {
  id: string;
  name: string;
  email: string;
  role: LocalWorkspaceMemberRole;
};

type LocalWorkspaceProfile = {
  description: string;
  context: string;
  repositories: LocalWorkspaceRepository[];
  members: LocalWorkspaceMember[];
};

type LocalWorkspaceState = Record<string, LocalWorkspaceProfile>;

const STORAGE_KEY = "recodee.settings.workspace.local.v1";

function readState(): LocalWorkspaceState {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as LocalWorkspaceState;
  } catch {
    return {};
  }
}

function writeState(next: LocalWorkspaceState): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function defaultProfile(): LocalWorkspaceProfile {
  return {
    description: "",
    context: "",
    repositories: [],
    members: [],
  };
}

export function readWorkspaceLocalProfile(workspaceId: string | null | undefined): LocalWorkspaceProfile {
  if (!workspaceId) {
    return defaultProfile();
  }
  const state = readState();
  return state[workspaceId] ?? defaultProfile();
}

export function patchWorkspaceLocalProfile(
  workspaceId: string | null | undefined,
  patch: Partial<LocalWorkspaceProfile>,
): LocalWorkspaceProfile {
  if (!workspaceId) {
    return defaultProfile();
  }
  const state = readState();
  const current = state[workspaceId] ?? defaultProfile();
  const next: LocalWorkspaceProfile = {
    ...current,
    ...patch,
  };
  writeState({
    ...state,
    [workspaceId]: next,
  });
  return next;
}

export type { LocalWorkspaceMember, LocalWorkspaceMemberRole, LocalWorkspaceProfile, LocalWorkspaceRepository };
