import { useMemo } from "react";

import { DonutChart } from "@/components/donut-chart";
import type { RemainingItem, SafeLineView } from "@/features/dashboard/utils";
import { formatWindowLabel } from "@/utils/formatters";

export type UsageDonutsProps = {
	primaryItems: RemainingItem[];
	secondaryItems: RemainingItem[];
	primaryTotal: number;
	secondaryTotal: number;
	primaryWindowMinutes?: number | null;
	safeLinePrimary?: SafeLineView | null;
	safeLineSecondary?: SafeLineView | null;
};

export function UsageDonuts({
	primaryItems,
	secondaryItems,
	primaryTotal,
	secondaryTotal,
	primaryWindowMinutes = null,
	safeLinePrimary,
	safeLineSecondary,
}: UsageDonutsProps) {
	const primaryTitle = `${formatWindowLabel("primary", primaryWindowMinutes)} Remaining`;
	const primaryChartItems = useMemo(
		() =>
			primaryItems.map((item) => ({
				id: item.accountId,
				label: item.label,
				labelSuffix: item.labelSuffix,
				isEmail: item.isEmail,
				value: item.value,
				color: item.color,
			})),
		[primaryItems],
	);
	const secondaryChartItems = useMemo(
		() =>
			secondaryItems.map((item) => ({
				id: item.accountId,
				label: item.label,
				labelSuffix: item.labelSuffix,
				isEmail: item.isEmail,
				value: item.value,
				color: item.color,
			})),
		[secondaryItems],
	);

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<DonutChart
				title={primaryTitle}
				items={primaryChartItems}
				total={primaryTotal}
				safeLine={safeLinePrimary}
				legendCollapsible
				legendDefaultCollapsed
			/>
			<DonutChart
				title="Weekly Remaining"
				items={secondaryChartItems}
				total={secondaryTotal}
				safeLine={safeLineSecondary}
				legendCollapsible
				legendDefaultCollapsed
			/>
		</div>
	);
}
