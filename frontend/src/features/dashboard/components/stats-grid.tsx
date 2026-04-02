import { SparklineChart } from "@/components/sparkline-chart";
import type { DashboardStat } from "@/features/dashboard/utils";

export type StatsGridProps = {
  stats: DashboardStat[];
};

export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat, index) => {
        return (
          <div
            key={stat.label}
            className="animate-fade-in-up card-hover rounded-xl border bg-card p-4"
            style={{ animationDelay: `${index * 75}ms` }}
          >
            <div className="flex items-center">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</span>
            </div>
            <div className="mt-1">
              <p className="text-[1.625rem] font-semibold tracking-[-0.02em]">{stat.value}</p>
              {stat.meta ? (
                <p className="mt-1 text-xs text-muted-foreground">{stat.meta}</p>
              ) : null}
            </div>
            {stat.trend.length > 0 ? (
              <div className="mt-1">
                <SparklineChart data={stat.trend} color={stat.trendColor} index={index} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
