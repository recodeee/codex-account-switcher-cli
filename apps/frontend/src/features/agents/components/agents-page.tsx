"use client";

import {
  BookOpenText,
  Bot,
  Camera,
  Circle,
  FileText,
  Globe,
  ListTodo,
  Lock,
  Plus,
  Save,
  Settings,
  Sparkle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAgents } from "@/features/agents/hooks/use-agents";
import type { AgentEntry } from "@/features/agents/schemas";
import type { AccountSummary } from "@/features/accounts/schemas";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { cn } from "@/lib/utils";
import { hasActiveCliSessionSignal } from "@/utils/account-working";

type AgentTab = "instructions" | "skills" | "tasks" | "settings";
type AgentVisibility = "workspace" | "private";

type CreateAgentDraft = {
  name: string;
  description: string;
  visibility: AgentVisibility;
  runtime: string;
};

type RuntimeOption = {
  value: string;
  label: string;
  subtitle: string;
  provider: "codex" | "openclaw";
  online: boolean;
};

const DEFAULT_RUNTIME = "Codex (recodee)";
const OPENCLAW_PROVIDER_MATCHER = /\bopenclaw\b|\bopencl\b|\boclaw\b/i;
const DEFAULT_MAX_CONCURRENT_TASKS = 6;
const MAX_AVATAR_BYTES = 1_000_000;
const AGENT_INSTRUCTIONS_PLACEHOLDER = `Define this agent's role, expertise, and working style.

Example:
You are a frontend engineer specializing in React and TypeScript.

## Working Style
- Write small, focused PRs — one commit per logical change
- Prefer composition over inheritance
- Always add unit tests for new components

## Constraints
- Do not modify shared/ types without explicit approval
- Follow the existing component patterns in features/`;

function buildCreateDraft(runtime: string = DEFAULT_RUNTIME): CreateAgentDraft {
  return {
    name: "",
    description: "",
    visibility: "workspace",
    runtime,
  };
}

function resolveRuntimeProvider(...values: Array<string | null | undefined>): "codex" | "openclaw" {
  return values.some((value) => value && OPENCLAW_PROVIDER_MATCHER.test(value)) ? "openclaw" : "codex";
}

function buildRuntimeOptions(accounts: AccountSummary[] | undefined): RuntimeOption[] {
  const nowMs = Date.now();
  const options = (accounts ?? [])
    .filter((account) => account.codexAuth?.hasSnapshot ?? false)
    .map((account) => {
      const snapshotName =
        account.codexAuth?.snapshotName ??
        account.codexAuth?.expectedSnapshotName ??
        account.codexAuth?.activeSnapshotName ??
        account.email;
      const provider = resolveRuntimeProvider(snapshotName, account.email, account.displayName);
      const providerName = provider === "openclaw" ? "Openclaw" : "Codex";
      const online =
        Math.max(
          account.codexLiveSessionCount ?? 0,
          account.codexTrackedSessionCount ?? 0,
          account.codexSessionCount ?? 0,
        ) > 0 || hasActiveCliSessionSignal(account, nowMs);

      return {
        value: `${providerName} (${snapshotName})`,
        label: `${providerName} (${snapshotName})`,
        subtitle: `${account.email} · cli`,
        provider,
        online,
      } satisfies RuntimeOption;
    })
    .sort((left, right) => {
      if (left.online !== right.online) {
        return left.online ? -1 : 1;
      }
      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    });

  if (options.length > 0) {
    return options;
  }

  return [
    {
      value: DEFAULT_RUNTIME,
      label: DEFAULT_RUNTIME,
      subtitle: "default · codex-cli",
      provider: "codex",
      online: false,
    },
  ];
}

function resolveRuntimeOption(runtime: string, options: RuntimeOption[]): RuntimeOption {
  const matched = options.find((option) => option.value === runtime);
  if (matched) {
    return matched;
  }
  return {
    value: runtime,
    label: runtime,
    subtitle: "saved runtime",
    provider: resolveRuntimeProvider(runtime),
    online: false,
  };
}

function sanitizeAgent(agent: AgentEntry): AgentEntry {
  return {
    ...agent,
    description: agent.description ?? "",
    instructions: agent.instructions ?? "",
    maxConcurrentTasks:
      Number.isFinite(agent.maxConcurrentTasks) && agent.maxConcurrentTasks > 0
        ? Math.min(50, Math.max(1, Math.round(agent.maxConcurrentTasks)))
        : DEFAULT_MAX_CONCURRENT_TASKS,
    avatarDataUrl: agent.avatarDataUrl ?? null,
  };
}

export function AgentsPage() {
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [activeTab, setActiveTab] = useState<AgentTab>("instructions");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateAgentDraft>(() => buildCreateDraft());
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentEntry>>({});

  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const { agentsQuery, createMutation, updateMutation } = useAgents();
  const dashboardQuery = useDashboard();

  const runtimeOptions = useMemo(
    () => buildRuntimeOptions(dashboardQuery.data?.accounts),
    [dashboardQuery.data?.accounts],
  );
  const createRuntimeOption = resolveRuntimeOption(createDraft.runtime, runtimeOptions);
  const defaultRuntime = runtimeOptions[0]?.value ?? DEFAULT_RUNTIME;

  const baseAgents = useMemo(
    () => (agentsQuery.data?.entries ?? []).map((entry) => sanitizeAgent(entry)),
    [agentsQuery.data?.entries],
  );
  const agents = useMemo(
    () =>
      baseAgents.map((agent) => {
        const draft = agentDrafts[agent.id];
        return draft ? sanitizeAgent({ ...agent, ...draft }) : agent;
      }),
    [agentDrafts, baseAgents],
  );

  const panelSurfaceClass =
    "overflow-hidden border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)] py-0 text-slate-100";

  const effectiveSelectedAgentId =
    selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)
      ? selectedAgentId
      : agents[0]?.id ?? "";

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === effectiveSelectedAgentId) ?? null,
    [agents, effectiveSelectedAgentId],
  );
  const selectedAgentRuntimeOption = selectedAgent
    ? resolveRuntimeOption(selectedAgent.runtime, runtimeOptions)
    : null;

  const updateSelectedAgent = (updater: (agent: AgentEntry) => AgentEntry) => {
    if (!selectedAgent) {
      return;
    }
    setAgentDrafts((current) => ({
      ...current,
      [selectedAgent.id]: sanitizeAgent(updater(selectedAgent)),
    }));
  };

  const persistAgent = async (agent: AgentEntry) => {
    const updated = await updateMutation.mutateAsync({
      agentId: agent.id,
      payload: {
        name: agent.name,
        status: agent.status,
        description: agent.description,
        visibility: agent.visibility,
        runtime: agent.runtime,
        instructions: agent.instructions,
        maxConcurrentTasks: agent.maxConcurrentTasks,
        avatarDataUrl: agent.avatarDataUrl,
      },
    });
    setAgentDrafts((current) => {
      if (!current[updated.id]) {
        return current;
      }
      const next = { ...current };
      delete next[updated.id];
      return next;
    });
    return updated;
  };

  const handleCreateAgent = async () => {
    const name = createDraft.name.trim();
    if (!name) {
      return;
    }

    const created = await createMutation.mutateAsync({
      name,
      description: createDraft.description.trim() || null,
      visibility: createDraft.visibility,
      runtime: createDraft.runtime,
      instructions: "",
      maxConcurrentTasks: DEFAULT_MAX_CONCURRENT_TASKS,
      avatarDataUrl: null,
    });

    setSelectedAgentId(created.id);
    setActiveTab("instructions");
    setCreateOpen(false);
    setCreateDraft(buildCreateDraft(defaultRuntime));
  };

  const handleAvatarSelection = async (file: File | null) => {
    if (!selectedAgent || !file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Avatar must be an image file");
      return;
    }

    if (file.size <= 0) {
      toast.error("Avatar image is empty");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Avatar image must be 1MB or smaller");
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read avatar image"));
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : null;
        if (!result) {
          reject(new Error("Failed to read avatar image"));
          return;
        }
        resolve(result);
      };
      reader.readAsDataURL(file);
    });

    updateSelectedAgent((agent) => ({ ...agent, avatarDataUrl: dataUrl }));
  };

  const isBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="animate-fade-in-up h-full w-full overflow-hidden bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)]">
      <h1 className="sr-only">Agents</h1>
      <div className="grid h-[calc(100vh-98px)] gap-px bg-white/[0.06] xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0 xl:border-r xl:border-white/[0.08]")}>
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-3">
              <p className="text-sm font-semibold text-slate-100">Agents</p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
                aria-label="Create agent"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {agentsQuery.isLoading ? (
                <p className="px-3 py-2 text-xs text-slate-500">Loading agents...</p>
              ) : agents.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-500">No agents found.</p>
              ) : (
                agents.map((agent) => {
                  const selected = selectedAgent?.id === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={cn(
                        "mb-1.5 flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "border-white/[0.14] bg-white/[0.08]"
                          : "border-transparent bg-transparent hover:border-white/[0.08] hover:bg-white/[0.04]",
                      )}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.03]">
                        {agent.avatarDataUrl ? (
                          <img src={agent.avatarDataUrl} alt={`${agent.name} avatar`} className="h-full w-full object-cover" />
                        ) : (
                          <Bot className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-100">{agent.name}</span>
                        <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
                          <Circle
                            className={cn(
                              "h-2.5 w-2.5",
                              agent.status === "idle" ? "fill-slate-500 text-slate-500" : "fill-emerald-400 text-emerald-400",
                            )}
                            aria-hidden="true"
                          />
                          {agent.status}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0")}>
          <CardContent className="flex h-full flex-col p-0">
            {selectedAgent ? (
              <>
                <div className="border-b border-white/[0.08] px-4 pt-3 pb-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                    <p className="text-base font-semibold text-slate-100">{selectedAgent.name}</p>
                    <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-xs">
                      <Circle
                        className={cn(
                          "h-2.5 w-2.5",
                          selectedAgent.status === "idle"
                            ? "fill-slate-500 text-slate-500"
                            : "fill-emerald-400 text-emerald-400",
                        )}
                        aria-hidden="true"
                      />
                      {selectedAgent.status}
                    </span>
                    <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-xs text-slate-400">
                      {selectedAgentRuntimeOption?.label ?? selectedAgent.runtime}
                    </span>
                  </div>

                  <Tabs value={activeTab} onValueChange={(value) => setActiveTab((value as AgentTab) ?? "instructions")}>
                    <TabsList className="mt-3 h-9 bg-transparent p-0" variant="line">
                      <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="instructions">
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        Instructions
                      </TabsTrigger>
                      <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="skills">
                        <BookOpenText className="h-3.5 w-3.5" aria-hidden="true" />
                        Skills
                      </TabsTrigger>
                      <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="tasks">
                        <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
                        Tasks
                      </TabsTrigger>
                      <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="settings">
                        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                        Settings
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {activeTab === "instructions" ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">Agent Instructions</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Define this agent&apos;s identity and working style. These instructions are injected into the
                          agent&apos;s context for every task.
                        </p>
                      </div>
                      <Textarea
                        value={selectedAgent.instructions}
                        onChange={(event) => {
                          updateSelectedAgent((agent) => ({
                            ...agent,
                            instructions: event.target.value,
                          }));
                        }}
                        placeholder={AGENT_INSTRUCTIONS_PLACEHOLDER}
                        className="min-h-[300px] resize-y border-white/[0.1] bg-[#070b12] font-mono text-sm text-slate-200 placeholder:text-slate-500/70"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500">
                          {selectedAgent.instructions.length > 0
                            ? `${selectedAgent.instructions.length} characters`
                            : "No instructions set"}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 gap-1.5 px-3 text-xs"
                          disabled={isBusy}
                          onClick={async () => {
                            await persistAgent(selectedAgent);
                            toast.success("Agent instructions saved");
                          }}
                        >
                          <Save className="h-3 w-3" aria-hidden="true" />
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === "skills" ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">Skills</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Reusable skills assigned to this agent. Manage skills on the Skills page.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 border-white/[0.12] bg-transparent px-3 text-xs"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          Add Skill
                        </Button>
                      </div>

                      <div className="flex min-h-[190px] flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-white/[0.01] px-6 py-10 text-center">
                        <FileText className="h-8 w-8 text-slate-500/70" aria-hidden="true" />
                        <p className="mt-3 text-sm text-slate-300">No skills assigned</p>
                        <p className="mt-1 text-xs text-slate-500">Add skills from the workspace to this agent.</p>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === "tasks" ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">Task Queue</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Issues assigned to this agent and their execution status.
                        </p>
                      </div>

                      <div className="flex min-h-[190px] flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-white/[0.01] px-6 py-10 text-center">
                        <ListTodo className="h-8 w-8 text-slate-500/70" aria-hidden="true" />
                        <p className="mt-3 text-sm text-slate-300">No tasks in queue</p>
                        <p className="mt-1 text-xs text-slate-500">Assign an issue to this agent to get started.</p>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === "settings" ? (
                    <div className="max-w-xl space-y-6">
                      <div>
                        <Label className="text-xs text-slate-400">Avatar</Label>
                        <div className="mt-1.5 flex items-center gap-4">
                          <button
                            type="button"
                            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.12] bg-white/[0.03] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
                            onClick={() => {
                              avatarInputRef.current?.click();
                            }}
                          >
                            {selectedAgent.avatarDataUrl ? (
                              <img
                                src={selectedAgent.avatarDataUrl}
                                alt={`${selectedAgent.name} avatar`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Bot className="h-8 w-8" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                            onClick={() => {
                              avatarInputRef.current?.click();
                            }}
                          >
                            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                            Click to upload avatar
                          </button>
                          <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                            className="hidden"
                            onChange={(event) => {
                              const input = event.currentTarget;
                              const file = input.files?.[0] ?? null;
                              void handleAvatarSelection(file)
                                .catch(() => {
                                  toast.error("Failed to read avatar image");
                                })
                                .finally(() => {
                                  input.value = "";
                                });
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-slate-400">Name</Label>
                        <Input
                          value={selectedAgent.name}
                          onChange={(event) => {
                            updateSelectedAgent((agent) => ({ ...agent, name: event.target.value }));
                          }}
                          className="mt-1 border-white/[0.12] bg-white/[0.03] text-slate-100"
                        />
                      </div>

                      <div>
                        <Label className="text-xs text-slate-400">Description</Label>
                        <Input
                          value={selectedAgent.description ?? ""}
                          onChange={(event) => {
                            updateSelectedAgent((agent) => ({ ...agent, description: event.target.value }));
                          }}
                          placeholder="What does this agent do?"
                          className="mt-1 border-white/[0.12] bg-white/[0.03] text-slate-100"
                        />
                      </div>

                      <div>
                        <Label className="text-xs text-slate-400">Visibility</Label>
                        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => {
                              updateSelectedAgent((agent) => ({ ...agent, visibility: "workspace" }));
                            }}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                              selectedAgent.visibility === "workspace"
                                ? "border-white/[0.2] bg-white/[0.08]"
                                : "border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.04]",
                            )}
                          >
                            <Globe className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span>
                              <span className="block font-medium text-slate-100">Workspace</span>
                              <span className="block text-xs text-slate-400">All members can assign</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              updateSelectedAgent((agent) => ({ ...agent, visibility: "private" }));
                            }}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                              selectedAgent.visibility === "private"
                                ? "border-white/[0.2] bg-white/[0.08]"
                                : "border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.04]",
                            )}
                          >
                            <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span>
                              <span className="block font-medium text-slate-100">Private</span>
                              <span className="block text-xs text-slate-400">Only you can assign</span>
                            </span>
                          </button>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-slate-400">Max Concurrent Tasks</Label>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          value={selectedAgent.maxConcurrentTasks}
                          onChange={(event) => {
                            const parsed = Number(event.target.value);
                            updateSelectedAgent((agent) => ({
                              ...agent,
                              maxConcurrentTasks:
                                Number.isFinite(parsed) && parsed > 0
                                  ? Math.min(50, Math.round(parsed))
                                  : DEFAULT_MAX_CONCURRENT_TASKS,
                            }));
                          }}
                          className="mt-1 w-24 border-white/[0.12] bg-white/[0.03] text-slate-100"
                        />
                      </div>

                      <div>
                        <Label className="text-xs text-slate-400">Runtime</Label>
                        <Select
                          value={selectedAgent.runtime}
                          onValueChange={(value) => {
                            updateSelectedAgent((agent) => ({ ...agent, runtime: value }));
                          }}
                        >
                          <SelectTrigger className="mt-1.5 h-10 w-full border-white/[0.12] bg-white/[0.03] text-slate-200">
                            <div className="flex min-w-0 items-center gap-2 pr-2 text-left">
                              {selectedAgentRuntimeOption?.provider === "openclaw" ? (
                                <Sparkle className="h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                              ) : (
                                <Bot className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-slate-100">
                                  {selectedAgentRuntimeOption?.label ?? "Select runtime"}
                                </p>
                                <p className="truncate text-[11px] text-slate-500">
                                  {selectedAgentRuntimeOption?.subtitle ?? "No runtime selected"}
                                </p>
                              </div>
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {runtimeOptions.map((runtime) => (
                              <SelectItem key={runtime.value} value={runtime.value} className="py-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  {runtime.provider === "openclaw" ? (
                                    <Sparkle className="h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                                  ) : (
                                    <Bot className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium text-slate-100">{runtime.label}</p>
                                    <div className="flex items-center gap-1.5">
                                      <Circle
                                        className={cn(
                                          "h-2.5 w-2.5",
                                          runtime.online
                                            ? "fill-emerald-400 text-emerald-400"
                                            : "fill-slate-500 text-slate-500",
                                        )}
                                        aria-hidden="true"
                                      />
                                      <p className="truncate text-[11px] text-slate-500">{runtime.subtitle}</p>
                                    </div>
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 px-3 text-xs"
                        disabled={isBusy}
                        onClick={async () => {
                          await persistAgent(selectedAgent);
                          toast.success("Agent settings saved");
                        }}
                      >
                        <Save className="h-3.5 w-3.5" aria-hidden="true" />
                        Save Changes
                      </Button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">No agent selected</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateDraft(buildCreateDraft(defaultRuntime));
          } else {
            setCreateDraft((current) => ({
              ...current,
              runtime: runtimeOptions.some((option) => option.value === current.runtime)
                ? current.runtime
                : defaultRuntime,
            }));
          }
        }}
      >
        <DialogContent className="max-w-md border border-white/[0.12] bg-[#0b1018] text-slate-100">
          <DialogHeader>
            <DialogTitle>Create Agent</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a new AI agent for your workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Name</Label>
              <Input
                value={createDraft.name}
                onChange={(event) => {
                  setCreateDraft((current) => ({ ...current, name: event.target.value }));
                }}
                placeholder="e.g. Deep Research Agent"
                className="border-white/[0.12] bg-white/[0.03]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Description</Label>
              <Input
                value={createDraft.description}
                onChange={(event) => {
                  setCreateDraft((current) => ({ ...current, description: event.target.value }));
                }}
                placeholder="What does this agent do?"
                className="border-white/[0.12] bg-white/[0.03]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Visibility</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreateDraft((current) => ({ ...current, visibility: "workspace" }));
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                    createDraft.visibility === "workspace"
                      ? "border-white/[0.2] bg-white/[0.08]"
                      : "border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.04]",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium text-slate-100">
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" /> Workspace
                  </span>
                  <span className="mt-1 block text-slate-400">All members can assign</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateDraft((current) => ({ ...current, visibility: "private" }));
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                    createDraft.visibility === "private"
                      ? "border-white/[0.2] bg-white/[0.08]"
                      : "border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.04]",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium text-slate-100">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Private
                  </span>
                  <span className="mt-1 block text-slate-400">Only you can assign</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Runtime</Label>
              <Select
                value={createDraft.runtime}
                onValueChange={(value) => {
                  setCreateDraft((current) => ({ ...current, runtime: value }));
                }}
              >
                <SelectTrigger className="h-10 w-full border-white/[0.12] bg-white/[0.03]">
                  <div className="flex min-w-0 items-center gap-2 pr-2 text-left">
                    {createRuntimeOption.provider === "openclaw" ? (
                      <Sparkle className="h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-100">{createRuntimeOption.label}</p>
                      <p className="truncate text-[11px] text-slate-500">{createRuntimeOption.subtitle}</p>
                    </div>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {runtimeOptions.map((runtime) => (
                    <SelectItem key={runtime.value} value={runtime.value} className="py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {runtime.provider === "openclaw" ? (
                          <Sparkle className="h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />
                        ) : (
                          <Bot className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-100">{runtime.label}</p>
                          <div className="flex items-center gap-1.5">
                            <Circle
                              className={cn(
                                "h-2.5 w-2.5",
                                runtime.online ? "fill-emerald-400 text-emerald-400" : "fill-slate-500 text-slate-500",
                              )}
                              aria-hidden="true"
                            />
                            <p className="truncate text-[11px] text-slate-500">{runtime.subtitle}</p>
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleCreateAgent()} disabled={createDraft.name.trim().length === 0 || isBusy}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
