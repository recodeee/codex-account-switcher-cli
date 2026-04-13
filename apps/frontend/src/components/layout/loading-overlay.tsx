import { cn } from "@/lib/utils";
import { isNavigationLoaderSuppressed } from "@/lib/navigation-loader";

import { Spinner } from "@/components/ui/spinner";

export type LoadingOverlayProps = {
  visible: boolean;
  label?: string;
  className?: string;
};

export function LoadingOverlay({
  visible,
  label = "Loading...",
  className,
}: LoadingOverlayProps) {
  if (!visible || isNavigationLoaderSuppressed()) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-[#020308]/85 backdrop-blur-sm",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#020308] px-5 py-3.5 text-sm text-slate-100 shadow-lg">
        <Spinner size="sm" />
        <span className="font-medium">{label}</span>
      </div>
    </div>
  );
}
