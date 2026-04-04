import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";

import { buildDonutPalette } from "@/utils/colors";
import { formatCompactNumber } from "@/utils/formatters";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { useThemeStore } from "@/hooks/use-theme";

export type DonutChartItem = {
  /** Stable unique key for React reconciliation. Falls back to label if not provided. */
  id?: string;
  label: string;
  /** Suffix appended after the label (not blurred in privacy mode). */
  labelSuffix?: string;
  /** When true the label text gets CSS-blurred in privacy mode. */
  isEmail?: boolean;
  value: number;
  costEur?: number;
  color?: string;
};

export type DonutChartProps = {
  items: DonutChartItem[];
  total: number;
  title: string;
  subtitle?: string;
  centerLabel?: string;
  centerValue?: string;
  centerSubvalue?: string | null;
  legendValueFormatter?: (item: DonutChartItem) => string;
  legendSecondaryFormatter?: (item: DonutChartItem) => string | null;
  safeLine?: { safePercent: number; riskLevel: "safe" | "warning" | "danger" | "critical" } | null;
  legendCollapsible?: boolean;
  legendDefaultCollapsed?: boolean;
};

function SafeLineTick({
  cx,
  cy,
  safePercent,
  riskLevel,
  innerRadius,
  outerRadius,
  isDark,
}: {
  cx: number;
  cy: number;
  safePercent: number;
  riskLevel: "safe" | "warning" | "danger" | "critical";
  innerRadius: number;
  outerRadius: number;
  isDark: boolean;
}) {
  if (riskLevel === "safe") return null;

  const remainingBudget = 100 - safePercent;
  const angleDeg = 90 - (remainingBudget / 100) * 360;
  const angleRad = -(angleDeg * Math.PI) / 180;

  const x1 = cx + innerRadius * Math.cos(angleRad);
  const y1 = cy + innerRadius * Math.sin(angleRad);
  const x2 = cx + outerRadius * Math.cos(angleRad);
  const y2 = cy + outerRadius * Math.sin(angleRad);

  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={isDark ? "#ffffff" : "#000000"}
      strokeWidth={2}
      strokeLinecap="round"
      data-testid="safe-line-tick"
    />
  );
}

const CHART_SIZE = 144;
const CHART_MARGIN = 1;
const PIE_CX = 71;
const PIE_CY = 71;
const INNER_R = 53;
const OUTER_R = 71;
const COLLAPSED_LEGEND_PREVIEW_COUNT = 4;

export function DonutChart({
  items,
  total,
  title,
  subtitle,
  centerLabel = "Remaining",
  centerValue,
  centerSubvalue,
  legendValueFormatter,
  legendSecondaryFormatter,
  safeLine,
  legendCollapsible = false,
  legendDefaultCollapsed = false,
}: DonutChartProps) {
  const isDark = useThemeStore((s) => s.theme === "dark");
  const blurred = usePrivacyStore((s) => s.blurred);
  const reducedMotion = useReducedMotion();
  const consumedColor = isDark ? "#404040" : "#d3d3d3";
  const palette = buildDonutPalette(items.length, isDark);
  const normalizedItems = items.map((item, index) => ({
    ...item,
    color: item.color ?? palette[index % palette.length],
  }));

  const usedSum = normalizedItems.reduce((acc, item) => acc + Math.max(0, item.value), 0);
  const consumed = Math.max(0, total - usedSum);
  const safeTotal = Math.max(0, total);
  const centerPrimaryValue = centerValue ?? formatCompactNumber(safeTotal);

  const chartData = [
    ...normalizedItems.map((item) => ({
      name: item.label,
      value: Math.max(0, item.value),
      fill: item.color,
    })),
    ...(consumed > 0
      ? [{ name: "__consumed__", value: consumed, fill: consumedColor }]
      : []),
  ];

  const hasData = chartData.some((d) => d.value > 0);
  const [legendCollapsed, setLegendCollapsed] = useState(
    legendCollapsible ? legendDefaultCollapsed : false,
  );
  const collapsedLegendItems = normalizedItems.slice(0, COLLAPSED_LEGEND_PREVIEW_COUNT);
  const visibleLegendItems =
    legendCollapsible && legendCollapsed ? collapsedLegendItems : normalizedItems;
  const hasCollapsedLegendOverflow =
    legendCollapsible && normalizedItems.length > COLLAPSED_LEGEND_PREVIEW_COUNT;

  if (!hasData) {
    chartData.length = 0;
    chartData.push({ name: "__empty__", value: 1, fill: consumedColor });
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>

      <div className="flex items-center gap-6">
        <div className="relative h-36 w-36 shrink-0 overflow-visible">
            <PieChart width={CHART_SIZE} height={CHART_SIZE} margin={{ top: CHART_MARGIN, right: CHART_MARGIN, bottom: CHART_MARGIN, left: CHART_MARGIN }}>
            <Pie
              data={chartData}
              cx={PIE_CX}
              cy={PIE_CY}
              innerRadius={INNER_R}
              outerRadius={OUTER_R}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
              isAnimationActive={!reducedMotion}
              animationDuration={600}
              animationEasing="ease-out"
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
          {safeLine && safeLine.riskLevel !== "safe" ? (
            <svg className="pointer-events-none absolute inset-0" width={CHART_SIZE} height={CHART_SIZE} viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`}>
              <SafeLineTick
                cx={PIE_CX + CHART_MARGIN}
                cy={PIE_CY + CHART_MARGIN}
                safePercent={safeLine.safePercent}
                riskLevel={safeLine.riskLevel}
                innerRadius={INNER_R}
                outerRadius={OUTER_R}
                isDark={isDark}
              />
            </svg>
          ) : null}
          <div className="absolute inset-[18px] flex items-center justify-center rounded-full text-center pointer-events-none">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{centerLabel}</p>
              <p className="text-base font-semibold tabular-nums">{centerPrimaryValue}</p>
              {centerSubvalue ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{centerSubvalue}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {hasCollapsedLegendOverflow ? (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-border/60 bg-background/30 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:bg-background/50"
              aria-expanded={!legendCollapsed}
              aria-label={`${title} accounts`}
              onClick={() => setLegendCollapsed((value) => !value)}
            >
              <span>Accounts ({normalizedItems.length})</span>
              {legendCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : null}

          <div className={legendCollapsible ? "mt-2 space-y-2" : "space-y-2"}>
              {visibleLegendItems.map((item, i) => {
                const secondaryValue = legendSecondaryFormatter
                  ? legendSecondaryFormatter(item)
                  : null;

                return (
                  <div
                    key={item.id ?? item.label}
                    className="animate-fade-in-up flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/35 px-2.5 py-1.5 text-xs"
                    style={{ animationDelay: `${i * 75}ms` }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="truncate font-medium">
                        {item.isEmail && blurred
                          ? <><span className="privacy-blur">{item.label}</span>{item.labelSuffix}</>
                          : <>{item.label}{item.labelSuffix}</>}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 tabular-nums">
                      <span className="font-semibold text-foreground/90">
                        {legendValueFormatter ? legendValueFormatter(item) : formatCompactNumber(item.value)}
                      </span>
                      {secondaryValue ? (
                        <span className="text-[10px] text-muted-foreground/85">
                          {secondaryValue}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {hasCollapsedLegendOverflow && legendCollapsed ? (
                <div className="px-1 text-[11px] text-muted-foreground">
                  +{normalizedItems.length - COLLAPSED_LEGEND_PREVIEW_COUNT} more
                </div>
              ) : null}
            </div>
        </div>
      </div>
    </div>
  );
}
