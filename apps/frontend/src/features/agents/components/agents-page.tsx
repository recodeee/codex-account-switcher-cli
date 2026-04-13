"use client";

import { Bot, Circle, Globe, Lock, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AgentTab = "instructions" | "skills" | "tasks" | "settings";
type AgentVisibility = "workspace" | "private";

type AgentRecord = {
  id: string;
  name: string;
  status: "idle" | "active";
  description: string;
  visibility: AgentVisibility;
  runtime: string;
  instructions: string;
  skillsNotes: string;
  tasksNotes: string;
  settingsNotes: string;
};

type CreateAgentDraft = {
  name: string;
  description: string;
  visibility: AgentVisibility;
  runtime: string;
};

const AGENTS_STORAGE_KEY = "recodee.agents.v1";
const DEFAULT_RUNTIME = "Codex (recodee)";
const RUNTIME_OPTIONS = [DEFAULT_RUNTIME];

const DEFAULT_MASTER_AGENT_INSTRUCTIONS =
  "You are a Master Agent for this workspace. Your role is to manage and coordinate tasks, triage incoming issues, and ensure work is distributed effectively across the team.";

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `agent-${Math.random().toString(36).slice(2, 11)}`;
}

function buildDefaultAgents(): AgentRecord[] {
  return [
    {
      id: generateId(),
      name: "Master Agent",
      status: "idle",
      description: "",
      visibility: "workspace",
      runtime: DEFAULT_RUNTIME,
      instructions: DEFAULT_MASTER_AGENT_INSTRUCTIONS,
      skillsNotes: "",
      tasksNotes: "",
      settingsNotes: "",
    },
  ];
}

function normalizeAgents(value: unknown): AgentRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const agent = item as Partial<AgentRecord>;
      const name = typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : null;
      if (!name) {
        return null;
      }

      return {
        id: typeof agent.id === "string" && agent.id.trim() ? agent.id : generateId(),
        name,
        status: agent.status === "active" ? "active" : "idle",
        description: typeof agent.description === "string" ? agent.description : "",
        visibility: agent.visibility === "private" ? "private" : "workspace",
        runtime: typeof agent.runtime === "string" && agent.runtime.trim() ? agent.runtime : DEFAULT_RUNTIME,
        instructions:
          typeof agent.instructions === "string" ? agent.instructions : DEFAULT_MASTER_AGENT_INSTRUCTIONS,
        skillsNotes: typeof agent.skillsNotes === "string" ? agent.skillsNotes : "",
        tasksNotes: typeof agent.tasksNotes === "string" ? agent.tasksNotes : "",
        settingsNotes: typeof agent.settingsNotes === "string" ? agent.settingsNotes : "",
      } satisfies AgentRecord;
    })
    .filter((agent): agent is AgentRecord => Boolean(agent));
}

function readStoredAgents(): AgentRecord[] {
  if (typeof window === "undefined") {
    return buildDefaultAgents();
  }

  try {
    const raw = window.localStorage.getItem(AGENTS_STORAGE_KEY);
    if (!raw) {
      return buildDefaultAgents();
    }
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeAgents(parsed);
    return normalized.length > 0 ? normalized : buildDefaultAgents();
  } catch {
    return buildDefaultAgents();
  }
}

function writeStoredAgents(agents: AgentRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agents));
}

function buildCreateDraft(): CreateAgentDraft {
  return {
    name: "",
    description: "",
    visibility: "workspace",
    runtime: DEFAULT_RUNTIME,
  };
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentRecord[]>(() => readStoredAgents());
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [activeTab, setActiveTab] = useState<AgentTab>("instructions");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateAgentDraft>(() => buildCreateDraft());

  const panelSurfaceClass =
    "overflow-hidden border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)] py-0 text-slate-100";

  useEffect(() => {
    writeStoredAgents(agents);
  }, [agents]);

  const effectiveSelectedAgentId =
    selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)
      ? selectedAgentId
      : agents[0]?.id ?? "";

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === effectiveSelectedAgentId) ?? null,
    [agents, effectiveSelectedAgentId],
  );

  const updateSelectedAgent = (updater: (agent: AgentRecord) => AgentRecord) => {
    if (!selectedAgent) {
      return;
    }
    setAgents((current) =>
      current.map((agent) => (agent.id === selectedAgent.id ? updater(agent) : agent)),
    );
  };

  const createAgent = () => {
    const name = createDraft.name.trim();
    if (!name) {
      return;
    }

    const nextAgent: AgentRecord = {
      id: generateId(),
      name,
      status: "idle",
      description: createDraft.description.trim(),
      visibility: createDraft.visibility,
      runtime: createDraft.runtime,
      instructions:
        createDraft.description.trim().length > 0
          ? `You are ${name} for this workspace. ${createDraft.description.trim()}`
          : `You are ${name} for this workspace. Keep work organized, clear, and reliable.`,
      skillsNotes: "",
      tasksNotes: "",
      settingsNotes: "",
    };

    setAgents((current) => [nextAgent, ...current]);
    setSelectedAgentId(nextAgent.id);
    setActiveTab("instructions");
    setCreateOpen(false);
    setCreateDraft(buildCreateDraft());
  };

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
              {agents.map((agent) => {
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
                    <span className="mt-0.5 rounded-md border border-white/[0.08] bg-white/[0.03] p-1.5">
                      <Bot className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
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
              })}
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
                      {selectedAgent.runtime}
                    </span>
                  </div>

                  <Tabs value={activeTab} onValueChange={(value) => setActiveTab((value as AgentTab) ?? "instructions")}>
                    <TabsList className="mt-3 h-9 bg-transparent p-0" variant="line">
                      <TabsTrigger className="px-2.5 text-xs" value="instructions">
                        Instructions
                      </TabsTrigger>
                      <TabsTrigger className="px-2.5 text-xs" value="skills">
                        Skills
                      </TabsTrigger>
                      <TabsTrigger className="px-2.5 text-xs" value="tasks">
                        Tasks
                      </TabsTrigger>
                      <TabsTrigger className="px-2.5 text-xs" value="settings">
                        Settings
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {activeTab === "instructions" ? (
                    <div className="space-y-3">
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
                        className="min-h-[230px] border-white/[0.1] bg-[#070b12] font-mono text-sm text-slate-200"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500">{selectedAgent.instructions.length} characters</p>
                        <Button type="button" size="sm" className="h-7 px-3 text-xs">
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === "skills" ? (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-100">Skills</p>
                      <p className="text-xs text-slate-500">Define skill preferences or activation notes for this agent.</p>
                      <Textarea
                        value={selectedAgent.skillsNotes}
                        onChange={(event) => {
                          updateSelectedAgent((agent) => ({
                            ...agent,
                            skillsNotes: event.target.value,
                          }));
                        }}
                        className="min-h-[230px] border-white/[0.1] bg-[#070b12] font-mono text-sm text-slate-200"
                        placeholder="No skills configured yet"
                      />
                    </div>
                  ) : null}

                  {activeTab === "tasks" ? (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-100">Tasks</p>
                      <p className="text-xs text-slate-500">Define task templates and assignment defaults for this agent.</p>
                      <Textarea
                        value={selectedAgent.tasksNotes}
                        onChange={(event) => {
                          updateSelectedAgent((agent) => ({
                            ...agent,
                            tasksNotes: event.target.value,
                          }));
                        }}
                        className="min-h-[230px] border-white/[0.1] bg-[#070b12] font-mono text-sm text-slate-200"
                        placeholder="No task templates configured yet"
                      />
                    </div>
                  ) : null}

                  {activeTab === "settings" ? (
                    <div className="space-y-4">
                      <p className="text-sm font-semibold text-slate-100">Settings</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-400">Visibility</Label>
                          <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.1] bg-white/[0.02] p-1">
                            <button
                              type="button"
                              onClick={() => {
                                updateSelectedAgent((agent) => ({ ...agent, visibility: "workspace" }));
                              }}
                              className={cn(
                                "rounded-md border px-2 py-1.5 text-xs transition-colors",
                                selectedAgent.visibility === "workspace"
                                  ? "border-white/[0.2] bg-white/[0.08] text-slate-100"
                                  : "border-transparent text-slate-400 hover:bg-white/[0.04]",
                              )}
                            >
                              Workspace
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                updateSelectedAgent((agent) => ({ ...agent, visibility: "private" }));
                              }}
                              className={cn(
                                "rounded-md border px-2 py-1.5 text-xs transition-colors",
                                selectedAgent.visibility === "private"
                                  ? "border-white/[0.2] bg-white/[0.08] text-slate-100"
                                  : "border-transparent text-slate-400 hover:bg-white/[0.04]",
                              )}
                            >
                              Private
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-400">Runtime</Label>
                          <Select
                            value={selectedAgent.runtime}
                            onValueChange={(value) => {
                              updateSelectedAgent((agent) => ({ ...agent, runtime: value }));
                            }}
                          >
                            <SelectTrigger className="h-10 w-full border-white/[0.1] bg-white/[0.02] text-slate-200">
                              <SelectValue placeholder="Select runtime" />
                            </SelectTrigger>
                            <SelectContent>
                              {RUNTIME_OPTIONS.map((runtime) => (
                                <SelectItem key={runtime} value={runtime}>
                                  {runtime}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-400">Notes</Label>
                        <Textarea
                          value={selectedAgent.settingsNotes}
                          onChange={(event) => {
                            updateSelectedAgent((agent) => ({
                              ...agent,
                              settingsNotes: event.target.value,
                            }));
                          }}
                          className="min-h-[160px] border-white/[0.1] bg-[#070b12] text-sm text-slate-200"
                          placeholder="No settings notes"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateDraft(buildCreateDraft());
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
                  <SelectValue placeholder="Select runtime" />
                </SelectTrigger>
                <SelectContent>
                  {RUNTIME_OPTIONS.map((runtime) => (
                    <SelectItem key={runtime} value={runtime}>
                      {runtime}
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
            <Button type="button" onClick={createAgent} disabled={createDraft.name.trim().length === 0}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
