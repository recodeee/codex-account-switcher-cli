import { cn } from "@/lib/utils";
import { useThemeStore, type ThemePreference } from "@/hooks/use-theme";

const LIGHT_COLORS = {
  titleBar: "#e8e8e8",
  content: "#ffffff",
  sidebar: "#f4f4f5",
  bar: "#e4e4e7",
  barMuted: "#d4d4d8",
};

const DARK_COLORS = {
  titleBar: "#333338",
  content: "#27272a",
  sidebar: "#1e1e21",
  bar: "#3f3f46",
  barMuted: "#52525b",
};

function WindowMockup({
  variant,
  className,
}: {
  variant: "light" | "dark";
  className?: string;
}) {
  const colors = variant === "light" ? LIGHT_COLORS : DARK_COLORS;

  return (
    <div className={cn("flex h-full w-full flex-col", className)}>
      <div className="flex items-center gap-[3px] px-2 py-1.5" style={{ backgroundColor: colors.titleBar }}>
        <span className="size-[6px] rounded-full bg-[#ff5f57]" />
        <span className="size-[6px] rounded-full bg-[#febc2e]" />
        <span className="size-[6px] rounded-full bg-[#28c840]" />
      </div>
      <div className="flex flex-1" style={{ backgroundColor: colors.content }}>
        <div className="w-[30%] space-y-1 p-2" style={{ backgroundColor: colors.sidebar }}>
          <div className="h-1 w-3/4 rounded-full" style={{ backgroundColor: colors.bar }} />
          <div className="h-1 w-1/2 rounded-full" style={{ backgroundColor: colors.bar }} />
        </div>
        <div className="flex-1 space-y-1.5 p-2">
          <div className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: colors.bar }} />
          <div className="h-1 w-full rounded-full" style={{ backgroundColor: colors.barMuted }} />
          <div className="h-1 w-3/5 rounded-full" style={{ backgroundColor: colors.barMuted }} />
        </div>
      </div>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "System" },
];

export function AppearanceTab() {
  const preference = useThemeStore((state) => state.preference);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Theme</h2>

        <div className="flex flex-wrap gap-6" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((option) => {
            const active = preference === option.value;
            return (
              <button
                key={option.value}
                role="radio"
                type="button"
                aria-checked={active}
                aria-label={`Select ${option.label} theme`}
                onClick={() => setTheme(option.value)}
                className="group flex flex-col items-center gap-2"
              >
                <div
                  className={cn(
                    "aspect-[4/3] w-36 overflow-hidden rounded-lg ring-1 transition-all",
                    active ? "ring-2 ring-primary" : "ring-border hover:ring-2 hover:ring-border",
                  )}
                >
                  {option.value === "auto" ? (
                    <div className="relative h-full w-full">
                      <WindowMockup variant="light" className="absolute inset-0" />
                      <WindowMockup variant="dark" className="absolute inset-0 [clip-path:inset(0_0_0_50%)]" />
                    </div>
                  ) : (
                    <WindowMockup variant={option.value} />
                  )}
                </div>
                <span
                  className={cn("text-sm transition-colors", active ? "font-medium text-foreground" : "text-muted-foreground")}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
