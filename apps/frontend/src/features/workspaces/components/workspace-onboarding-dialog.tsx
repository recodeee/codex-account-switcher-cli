import {
  Check,
  Code2,
  Copy,
  Crown,
  Loader2,
  Terminal,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountSummary } from "@/features/accounts/schemas";
import type { WorkspaceEntry } from "@/features/workspaces/schemas";
import { cn } from "@/lib/utils";
import { hasActiveCliSessionSignal } from "@/utils/account-working";

const STEPS = ["Workspace", "Runtime", "Agent", "Get Started"] as const;

type ConnectedRuntime = {
  id: string;
  name: string;
  subtitle: string;
  provider: "codex" | "openclaw";
};

type AgentTemplate = {
  id: "master" | "coding";
  label: string;
  description: string;
  icon: typeof Crown;
};

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "master",
    label: "Master Agent",
    description: "Manages workspace, assigns tasks, and coordinates work",
    icon: Crown,
  },
  {
    id: "coding",
    label: "Coding Agent",
    description: "Checks out code, implements features, and submits PRs",
    icon: Code2,
  },
];

const SETUP_STEPS = [
  {
    label: "Install the Recodee CLI",
    command:
      "curl -fsSL https://raw.githubusercontent.com/NagyVikt/recodee/main/scripts/install.sh | bash",
  },
  {
    label: "Set up and start the daemon",
    command: "recodee setup",
  },
] as const;

type WorkspaceOnboardingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createWorkspace: (name: string) => Promise<WorkspaceEntry>;
  isCreatingWorkspace: boolean;
  accounts: AccountSummary[];
};

function resolveHostPrefix() {
  if (typeof window === "undefined") {
    return "recodee.com";
  }
  const hostname = window.location.hostname?.trim();
  if (!hostname) {
    return "recodee.com";
  }
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "localhost";
  }
  return hostname;
}

function nameToSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "workspace";
}

function resolveRuntimeProvider(...values: Array<string | null | undefined>): "codex" | "openclaw" {
  const candidate = values.join(" ").toLowerCase();
  return /\bopenclaw\b|\bopencl\b|\boclaw\b/.test(candidate) ? "openclaw" : "codex";
}

function buildConnectedRuntimes(accounts: AccountSummary[]): ConnectedRuntime[] {
  const nowMs = Date.now();
  const items = accounts
    .filter((account) => {
      const hasSessions =
        Math.max(
          account.codexLiveSessionCount ?? 0,
          account.codexTrackedSessionCount ?? 0,
          account.codexSessionCount ?? 0,
        ) > 0;
      return hasSessions || hasActiveCliSessionSignal(account, nowMs);
    })
    .map((account) => {
      const snapshotName =
        account.codexAuth?.snapshotName ??
        account.codexAuth?.expectedSnapshotName ??
        account.codexAuth?.activeSnapshotName ??
        account.email;
      const provider = resolveRuntimeProvider(snapshotName, account.email, account.displayName);
      const providerName = provider === "openclaw" ? "Openclaw" : "Codex";
      return {
        id: account.accountId,
        name: `${providerName} (${snapshotName})`,
        subtitle: `${provider} · ${snapshotName} · cli`,
        provider,
      } satisfies ConnectedRuntime;
    });

  return items.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
      aria-label="Copy command"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function WorkspaceOnboardingDialog({
  open,
  onOpenChange,
  createWorkspace,
  isCreatingWorkspace,
  accounts,
}: WorkspaceOnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");

  const hostPrefix = useMemo(() => resolveHostPrefix(), []);
  const slugPreview = useMemo(() => nameToSlug(workspaceName.trim()), [workspaceName]);
  const canCreate = workspaceName.trim().length > 0;
  const connectedRuntimes = useMemo(() => buildConnectedRuntimes(accounts), [accounts]);

  const handleCreateWorkspace = async () => {
    if (!canCreate || isCreatingWorkspace) {
      return;
    }

    try {
      await createWorkspace(workspaceName.trim());
      setStep(1);
    } catch {
      // error toast handled in mutation hook
    }
  };

  const handleRuntimeNext = () => {
    setStep(2);
  };

  const finishOnboarding = (template?: AgentTemplate) => {
    if (template) {
      toast.success(`${template.label} template selected`);
    }
    setStep(0);
    setWorkspaceName("");
    onOpenChange(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep(0);
      setWorkspaceName("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        showCloseButton
        className="top-0 left-0 h-screen max-h-screen w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-[linear-gradient(180deg,rgba(3,6,16,0.98)_0%,rgba(2,4,12,1)_100%)] p-6 text-slate-100 sm:p-10"
      >
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
          <div className="flex items-center justify-center gap-2 pb-6 sm:pb-10">
            {STEPS.map((label, index) => {
              const completed = index < step;
              const active = index === step;
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                        completed || active
                          ? "border-white/25 bg-white text-slate-900"
                          : "border-white/12 bg-white/[0.05] text-slate-400",
                      )}
                    >
                      {completed ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span
                      className={cn(
                        "hidden text-sm sm:inline",
                        completed || active ? "text-slate-100" : "text-slate-500",
                      )}
                    >
                      {label}
                    </span>
                  </div>
                  {index < STEPS.length - 1 ? (
                    <span className={cn("h-px w-8 sm:w-10", index < step ? "bg-white/60" : "bg-white/14")} />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex flex-1 items-center justify-center">
            {step === 0 ? (
              <div className="w-full max-w-md space-y-7">
                <div className="space-y-2 text-center">
                  <h2 className="text-4xl font-semibold tracking-tight">Create a new workspace</h2>
                  <p className="text-sm text-slate-400">
                    Workspaces are shared environments where teams can work on projects and issues.
                  </p>
                </div>

                <Card className="border-white/[0.1] bg-white/[0.03] shadow-[0_20px_40px_rgba(0,0,0,0.28)]">
                  <CardContent className="space-y-4 pt-6">
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-onboarding-name" className="text-xs text-slate-300">
                        Workspace Name
                      </Label>
                      <Input
                        id="workspace-onboarding-name"
                        autoFocus
                        value={workspaceName}
                        onChange={(event) => setWorkspaceName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void handleCreateWorkspace();
                          }
                        }}
                        placeholder="My Team"
                        className="h-10 border-white/[0.18] bg-white/[0.04] text-base text-white placeholder:text-slate-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-400">Workspace URL</Label>
                      <div className="flex h-10 items-center gap-2 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 text-sm text-slate-300">
                        <span className="text-slate-500">{hostPrefix}/</span>
                        <span className="font-medium text-slate-200">{slugPreview}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Button
                  type="button"
                  size="lg"
                  onClick={() => {
                    void handleCreateWorkspace();
                  }}
                  disabled={!canCreate || isCreatingWorkspace}
                  className="h-11 w-full"
                >
                  {isCreatingWorkspace ? "Creating..." : "Create workspace"}
                </Button>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="w-full max-w-xl space-y-7">
                <div className="space-y-2 text-center">
                  <h2 className="text-4xl font-semibold tracking-tight">Connect a Runtime</h2>
                  <p className="text-sm text-slate-400">
                    Install the CLI and run <code className="rounded bg-white/[0.08] px-1.5 py-0.5">recodee setup</code>{" "}
                    to connect your machine.
                  </p>
                </div>

                <Card className="border-white/[0.1] bg-white/[0.03]">
                  <CardContent className="space-y-3 pt-6">
                    {SETUP_STEPS.map((entry, index) => (
                      <div key={entry.label} className="space-y-1.5">
                        <p className="text-xs text-slate-400">
                          {index + 1}. {entry.label}
                        </p>
                        <div className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-slate-200">
                          <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <code className="min-w-0 flex-1 break-all">{entry.command}</code>
                          <CopyButton value={entry.command} />
                        </div>
                      </div>
                    ))}
                    <p className="pt-1 text-xs text-slate-500">
                      Setup handles authentication, configuration, and daemon startup.
                    </p>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    {connectedRuntimes.length > 0 ? (
                      <>
                        <span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden="true" />
                        <span className="font-medium text-slate-200">
                          {connectedRuntimes.length} runtime{connectedRuntimes.length === 1 ? "" : "s"} connected
                        </span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden="true" />
                        <span className="text-slate-400">Waiting for connection...</span>
                      </>
                    )}
                  </div>

                  {connectedRuntimes.length > 0 ? (
                    <Card className="border-white/[0.1] bg-white/[0.03]">
                      <CardContent className="divide-y divide-white/[0.07] pt-0">
                        {connectedRuntimes.map((runtime) => (
                          <div key={runtime.id} className="flex items-center gap-3 py-3 first:pt-4 last:pb-4">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-300" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-100">{runtime.name}</p>
                              <p className="truncate text-xs text-slate-500">{runtime.subtitle}</p>
                            </div>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]",
                                runtime.provider === "openclaw"
                                  ? "border-rose-300/35 bg-rose-300/10 text-rose-200"
                                  : "border-emerald-300/35 bg-emerald-300/10 text-emerald-200",
                              )}
                            >
                              {runtime.provider}
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>

                <Button type="button" size="lg" className="h-11 w-full" onClick={handleRuntimeNext}>
                  {connectedRuntimes.length > 0 ? "Continue" : "Skip for now"}
                </Button>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="w-full max-w-xl space-y-7">
                <div className="space-y-2 text-center">
                  <h2 className="text-4xl font-semibold tracking-tight">Create Your First Agent</h2>
                  <p className="text-sm text-slate-400">
                    Choose a template to get started, then customize your agent.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {AGENT_TEMPLATES.map((template) => {
                    const Icon = template.icon;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => finishOnboarding(template)}
                        className="rounded-2xl border border-white/[0.12] bg-white/[0.03] px-4 py-4 text-left transition-colors hover:border-white/[0.22] hover:bg-white/[0.07]"
                      >
                        <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-slate-400">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <p className="text-base font-semibold text-slate-100">{template.label}</p>
                        <p className="mt-1 text-sm text-slate-400">{template.description}</p>
                      </button>
                    );
                  })}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full text-slate-300 hover:bg-white/[0.05] hover:text-white"
                  onClick={() => finishOnboarding()}
                >
                  Skip for now
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
