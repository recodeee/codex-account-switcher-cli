import { useEffect, useId, useMemo, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ChevronDown,
  Cpu,
  HardDrive,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useSystemMonitor } from "@/features/dashboard/hooks/use-system-monitor";
import { cn } from "@/lib/utils";

type MetricHistory = {
  cpu: number[];
  gpu: number[];
  vram: number[];
  network: number[];
};

const MAX_POINTS = 20;
const EMPTY_HISTORY: MetricHistory = {
  cpu: [],
  gpu: [],
  vram: [],
  network: [],
};

function appendHistoryPoint(history: number[], value: number): number[] {
  return [...history, value].slice(-MAX_POINTS);
}

function getLastValue(values: number[]): number {
  return values.length > 0 ? values[values.length - 1] : 0;
}

function historyReducer(
  previous: MetricHistory,
  sample: {
    cpuPercent: number;
    gpuPercent: number | null;
    vramPercent: number | null;
    networkMbS: number;
  },
): MetricHistory {
  return {
    cpu: appendHistoryPoint(previous.cpu, sample.cpuPercent),
    gpu: appendHistoryPoint(previous.gpu, sample.gpuPercent ?? 0),
    vram: appendHistoryPoint(previous.vram, sample.vramPercent ?? 0),
    network: appendHistoryPoint(previous.network, sample.networkMbS),
  };
}

function isMetricSpike(
  key: "cpu" | "gpu" | "vram" | "network",
  value: number | null,
): boolean {
  if (value == null) {
    return false;
  }
  if (key === "network") {
    return value >= 25;
  }
  if (key === "vram") {
    return value >= 95;
  }
  return value >= 90;
}

function Sparkline({
  values,
  tone,
  width = 68,
  height = 20,
}: {
  values: number[];
  tone: {
    key: string;
    line: string;
    fill: string;
  };
  width?: number;
  height?: number;
}) {
  const gradientId = `${useId()}-${tone.key}`;
  const data =
    values.length >= 2 ? values : values.length === 1 ? [values[0], values[0]] : [0, 0];
  const domainMax = Math.max(1, ...data.map((value) => Math.abs(value)));

  const points = data.map((value, index) => {
    const x = data.length === 1 ? 0 : (index / (data.length - 1)) * width;
    const y = height - (Math.min(Math.abs(value), domainMax) / domainMax) * height;
    return { x, y };
  });

  const linePath = points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }
    return `${path} L ${point.x} ${point.y}`;
  }, "");
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={tone.fill} stopOpacity={0.35} />
          <stop offset="100%" stopColor={tone.fill} stopOpacity={0.05} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={tone.line}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  unit,
  history,
  tone,
  unavailable = false,
  spike = false,
  flat = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  unit: string;
  history: number[];
  tone: {
    key: string;
    line: string;
    fill: string;
  };
  unavailable?: boolean;
  spike?: boolean;
  flat?: boolean;
}) {
  const displayValue =
    value == null || unavailable ? "--" : `${value.toFixed(1)} ${unit}`;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5",
        flat ? "bg-transparent" : "border border-white/8 bg-black/25",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-zinc-300",
          flat ? "border border-white/[0.06] bg-transparent" : "border border-white/10 bg-zinc-900/80",
          spike && "border-red-400/50 bg-red-950/50 text-red-300",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex flex-1 items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        <div className="flex items-center gap-2">
          <Sparkline
            values={history}
            tone={tone}
            width={flat ? 74 : 68}
            height={flat ? 18 : 20}
          />
          <span
            className={cn(
              "text-xs font-mono text-zinc-100",
              spike && "text-red-300",
              unavailable && "text-zinc-400",
            )}
          >
            {displayValue}
          </span>
        </div>
      </div>
    </div>
  );
}

type SystemMonitorCardProps = {
  placement?: "floating" | "inline";
  className?: string;
  defaultCollapsed?: boolean;
};

export function SystemMonitorCard({
  placement = "floating",
  className,
  defaultCollapsed,
}: SystemMonitorCardProps = {}) {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => defaultCollapsed ?? (placement === "inline"),
  );
  const query = useSystemMonitor();
  const sample = query.data;
  const [history, pushSampleIntoHistory] = useReducer(historyReducer, EMPTY_HISTORY);

  useEffect(() => {
    if (!sample) {
      return;
    }
    pushSampleIntoHistory(sample);
  }, [sample]);

  const current = useMemo(
    () => ({
      cpu: sample?.cpuPercent ?? getLastValue(history.cpu),
      gpu: sample?.gpuPercent ?? null,
      vram: sample?.vramPercent ?? null,
      network: sample?.networkMbS ?? getLastValue(history.network),
    }),
    [history.cpu, history.network, sample],
  );

  const hasSpike =
    Boolean(sample?.spike) ||
    isMetricSpike("cpu", current.cpu) ||
    isMetricSpike("gpu", current.gpu) ||
    isMetricSpike("vram", current.vram) ||
    isMetricSpike("network", current.network);

  const card = (
    <Card
      className={cn(
        "text-zinc-100 transition-all duration-200",
        placement === "inline"
          ? "border-0 bg-transparent shadow-none"
          : "border border-white/12 bg-[#070d18]/95 shadow-[0_12px_34px_rgba(2,6,23,0.7)]",
        collapsed
          ? "w-auto min-w-[13.5rem] max-w-[calc(100vw-1.5rem)]"
          : "w-[24rem] max-w-[calc(100vw-1.5rem)]",
        placement === "inline" ? "w-full max-w-none" : undefined,
        className,
      )}
    >
      <button
        type="button"
        className={cn(
          "w-full text-left transition-colors",
          placement === "inline" ? "hover:bg-transparent" : "hover:bg-white/5",
          collapsed ? "px-3 py-2" : "px-3 py-2.5",
        )}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Activity
              className={cn(
                "h-4 w-4 shrink-0",
                hasSpike ? "text-red-400" : "text-zinc-300",
              )}
            />
            <span className="truncate text-sm font-semibold text-zinc-100">
              System Monitor
            </span>
            {hasSpike && !collapsed ? (
              <Badge
                variant="outline"
                className="border-red-400/40 bg-red-500/20 px-1.5 py-0 text-[10px] font-semibold text-red-50"
              >
                Spike
              </Badge>
            ) : null}
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-zinc-400 transition-transform duration-200",
              collapsed ? "rotate-180" : "rotate-0",
            )}
          />
        </div>
      </button>

      {!collapsed ? (
        <div
          className={cn(
            "grid gap-2 px-3 pb-3",
            placement === "inline" ? "grid-cols-1 gap-1.5" : "grid-cols-2",
          )}
        >
          <MetricTile
            icon={Cpu}
            label="CPU"
            value={current.cpu}
            unit="%"
            history={history.cpu}
            tone={{ key: "cpu", line: "#2d8cff", fill: "#2d8cff" }}
            spike={isMetricSpike("cpu", current.cpu)}
            flat={placement === "inline"}
          />
          <MetricTile
            icon={Zap}
            label="GPU"
            value={current.gpu}
            unit="%"
            history={history.gpu}
            tone={{ key: "gpu", line: "#14d493", fill: "#14d493" }}
            unavailable={current.gpu == null}
            spike={isMetricSpike("gpu", current.gpu)}
            flat={placement === "inline"}
          />
          <MetricTile
            icon={HardDrive}
            label="VRAM"
            value={current.vram}
            unit="%"
            history={history.vram}
            tone={{ key: "vram", line: "#f59e0b", fill: "#f59e0b" }}
            unavailable={current.vram == null}
            spike={isMetricSpike("vram", current.vram)}
            flat={placement === "inline"}
          />
          <MetricTile
            icon={Wifi}
            label="Network"
            value={current.network}
            unit="MB/s"
            history={history.network}
            tone={{ key: "network", line: "#8b5cf6", fill: "#8b5cf6" }}
            spike={isMetricSpike("network", current.network)}
            flat={placement === "inline"}
          />
        </div>
      ) : null}
    </Card>
  );

  if (placement === "inline") {
    return card;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed left-1/2 z-50 -translate-x-1/2"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 2.9rem)" }}
    >
      <div className="pointer-events-auto">{card}</div>
    </div>,
    document.body,
  );
}
