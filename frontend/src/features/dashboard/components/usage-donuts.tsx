import { useMemo } from "react";

import { DonutChart } from "@/components/donut-chart";
import type { RemainingItem, SafeLineView } from "@/features/dashboard/utils";
import { formatCompactNumber, formatWindowLabel } from "@/utils/formatters";

export type UsageDonutsProps = {
	primaryItems: RemainingItem[];
	secondaryItems: RemainingItem[];
	primaryTotal: number;
	secondaryTotal: number;
	primaryWindowMinutes?: number | null;
	safeLinePrimary?: SafeLineView | null;
	safeLineSecondary?: SafeLineView | null;
};

function formatTokensFromCredits(value: number): string {
	if (!Number.isFinite(value)) {
		return "--";
	}
	return formatCompactNumber(Math.max(0, value) * 1000);
}

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
	const primaryRemainingTotal = useMemo(
		() => primaryItems.reduce((total, item) => total + Math.max(0, item.value), 0),
		[primaryItems],
	);
	const secondaryRemainingTotal = useMemo(
		() => secondaryItems.reduce((total, item) => total + Math.max(0, item.value), 0),
		[secondaryItems],
	);

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<DonutChart
				title={primaryTitle}
				items={primaryChartItems}
				total={primaryTotal}
				centerValue={formatTokensFromCredits(primaryRemainingTotal)}
				legendValueFormatter={(item) => formatTokensFromCredits(item.value)}
				safeLine={safeLinePrimary}
				legendCollapsible
				legendDefaultCollapsed
			/>
			<DonutChart
				title="Weekly Remaining"
				items={secondaryChartItems}
				total={secondaryTotal}
				centerValue={formatTokensFromCredits(secondaryRemainingTotal)}
				legendValueFormatter={(item) => formatTokensFromCredits(item.value)}
				safeLine={safeLineSecondary}
				legendCollapsible
				legendDefaultCollapsed
			/>
		</div>
	);
}
