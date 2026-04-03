import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountTerminalSurface } from "@/features/dashboard/components/account-terminal-surface";
import type { AccountSummary } from "@/features/dashboard/schemas";

type TerminalDialogProps = {
  open: boolean;
  account: AccountSummary | null;
  onOpenChange: (open: boolean) => void;
};

export function AccountTerminalDialog({ open, account, onOpenChange }: TerminalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] overflow-hidden border border-slate-700/80 bg-[#0a0f1d] p-0 text-slate-100 shadow-2xl sm:max-w-6xl">
        <DialogHeader className="gap-1 border-b border-slate-700/80 bg-[#141922] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 pr-2" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
            </div>
            <DialogTitle className="text-base font-semibold tracking-tight text-slate-100">
              Codex Terminal
            </DialogTitle>
          </div>
          <DialogDescription className="truncate text-xs text-slate-400">
            {account ? `Account: ${account.email}` : "No account selected"}
          </DialogDescription>
        </DialogHeader>
        {account ? (
          <AccountTerminalSurface
            account={{ accountId: account.accountId, email: account.email }}
            hostClassName="h-[68vh]"
          />
        ) : (
          <div className="px-4 py-3 text-sm text-slate-400">No account selected</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
