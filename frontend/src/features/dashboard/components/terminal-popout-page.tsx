import { ExternalLink, X } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { AccountTerminalSurface } from "@/features/dashboard/components/account-terminal-surface";

export function TerminalPopoutPage() {
  const [searchParams] = useSearchParams();

  const account = useMemo(() => {
    const accountId = searchParams.get("accountId")?.trim() ?? "";
    const email = searchParams.get("email")?.trim() ?? "";
    if (!accountId) {
      return null;
    }

    return {
      accountId,
      email: email || accountId,
    };
  }, [searchParams]);

  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050b14] px-6 text-center text-slate-200">
        <div className="space-y-3 rounded-xl border border-slate-700/80 bg-[#0a0f1d] px-6 py-5">
          <p className="text-base font-semibold">Terminal account is missing</p>
          <p className="text-sm text-slate-400">
            Re-open the terminal from the dashboard and try pop-out again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050b14] p-3">
      <section className="overflow-hidden rounded-xl border border-slate-700/80 bg-[#0a0f1d] text-slate-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700/80 bg-[#141922] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex items-center gap-1.5 pr-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
            </div>
            <p className="truncate text-sm font-medium text-slate-100">Codex Terminal (Detached)</p>
            <span className="truncate text-xs text-slate-400">{account.email}</span>
          </div>
          <div className="flex items-center gap-1">
            <a
              href="/dashboard"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-700/70 hover:text-slate-100"
              title="Back to dashboard"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only">Back to dashboard</span>
            </a>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-200"
              title="Close window"
              onClick={() => window.close()}
            >
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">Close window</span>
            </button>
          </div>
        </header>

        <AccountTerminalSurface
          account={account}
          active
          hostClassName="h-[calc(100vh-5.25rem)] min-h-[420px]"
        />
      </section>
    </div>
  );
}
