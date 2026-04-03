import { useMemo, useState } from "react";
import { Pin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { EmptyState } from "@/components/empty-state";
import { SpinnerBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationControls } from "@/features/dashboard/components/filters/pagination-controls";
import { getDashboardOverview } from "@/features/dashboard/api";
import { listStickySessions } from "@/features/sticky-sessions/api";
import { Badge } from "@/components/ui/badge";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { resolveCodexSessionCount } from "@/utils/codex-sessions";
import { formatTimeLong } from "@/utils/formatters";

const DEFAULT_LIMIT = 25;

type AccountSessionGroup = {
  accountId: string;
  displayName: string;
  entries: Array<{
    key: string;
    taskPreview: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

export function SessionsPage() {
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [searchParams] = useSearchParams();
  const blurred = usePrivacyStore((s) => s.blurred);
  const selectedAccountId = searchParams.get("accountId");

  const sessionsQuery = useQuery({
    queryKey: ["sticky-sessions", "codex-sessions", { offset, limit, activeOnly: true }],
    queryFn: () =>
      listStickySessions({
        kind: "codex_session",
        staleOnly: false,
        activeOnly: true,
        offset,
        limit,
      }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const overviewQuery = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: getDashboardOverview,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const entries = sessionsQuery.data?.entries;
  const hasMore = sessionsQuery.data?.hasMore ?? false;

  const groups = useMemo<AccountSessionGroup[]>(() => {
    const grouped = new Map<string, AccountSessionGroup>();
    for (const entry of entries ?? []) {
      const existing = grouped.get(entry.accountId);
      if (existing) {
        existing.entries.push({
          key: entry.key,
          taskPreview: entry.taskPreview,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        });
        continue;
      }

      grouped.set(entry.accountId, {
        accountId: entry.accountId,
        displayName: entry.displayName,
        entries: [
          {
            key: entry.key,
            taskPreview: entry.taskPreview,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          },
        ],
      });
    }
    return Array.from(grouped.values());
  }, [entries]);

  const filteredGroups = useMemo(
    () => (selectedAccountId ? groups.filter((group) => group.accountId === selectedAccountId) : groups),
    [groups, selectedAccountId],
  );
  const fallbackSessionRows = useMemo(() => {
    const rows = (overviewQuery.data?.accounts ?? [])
      .map((account) => ({
        accountId: account.accountId,
        displayName: account.displayName,
        codexSessionCount: resolveCodexSessionCount(
          account.codexSessionCount,
          (account.codexAuth?.hasLiveSession ?? false) || (account.codexAuth?.isActiveSnapshot ?? false),
        ),
      }))
      .filter((row) => row.codexSessionCount > 0);

    if (selectedAccountId) {
      return rows.filter((row) => row.accountId === selectedAccountId);
    }
    return rows;
  }, [overviewQuery.data?.accounts, selectedAccountId]);
  const shouldUseFallbackOverview = filteredGroups.length === 0 && fallbackSessionRows.length > 0;

  const total = shouldUseFallbackOverview
    ? fallbackSessionRows.reduce((sum, row) => sum + row.codexSessionCount, 0)
    : filteredGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const accountCount = shouldUseFallbackOverview ? fallbackSessionRows.length : filteredGroups.length;
  const hasSessionRows = total > 0;
  const waitingForOverviewFallback = (sessionsQuery.data?.total ?? 0) === 0 && overviewQuery.isLoading && !overviewQuery.data;
  const isLoading = (sessionsQuery.isLoading && !sessionsQuery.data) || waitingForOverviewFallback;
  const emptyDescription = selectedAccountId
    ? "No Codex sessions were found for the selected account."
    : "Codex sessions will appear here once routed requests create sticky session mappings.";

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only Codex sessions grouped by account.
        </p>
      </div>

      {isLoading ? (
        <div className="py-8">
          <SpinnerBlock />
        </div>
      ) : !hasSessionRows ? (
        <EmptyState
          icon={Pin}
          title="No Codex sessions"
          description={emptyDescription}
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-card px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Codex sessions</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{total}</p>
            </div>
            <div className="rounded-xl border bg-card px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Accounts with sessions</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{accountCount}</p>
            </div>
          </section>

          <section className="space-y-4">
            {shouldUseFallbackOverview ? (
              <div className="rounded-xl border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Live Codex session counters</p>
                    <p className="text-xs text-muted-foreground">
                      Sticky session mappings are empty, so this view shows account-level session counters.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Account</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Account ID</TableHead>
                        <TableHead className="text-right text-[11px] uppercase tracking-wider text-muted-foreground/80">Codex sessions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fallbackSessionRows.map((row) => (
                        <TableRow key={row.accountId}>
                          <TableCell className="text-sm font-medium">
                            {blurred ? <span className="privacy-blur">{row.displayName}</span> : row.displayName}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{row.accountId}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums">{row.codexSessionCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <>
                {filteredGroups.map((group) => (
                  <div key={group.accountId} className="rounded-xl border bg-card">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {blurred ? <span className="privacy-blur">{group.displayName}</span> : group.displayName}
                        </p>
                        <p className="text-xs text-muted-foreground">Account ID: {group.accountId}</p>
                      </div>
                      <Badge variant="outline" className="tabular-nums">
                        {group.entries.length}
                      </Badge>
                    </div>

                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Session key</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Current task</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Updated</TableHead>
                            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Created</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.entries.map((entry) => {
                            const updated = formatTimeLong(entry.updatedAt);
                            const created = formatTimeLong(entry.createdAt);

                            return (
                              <TableRow key={entry.key}>
                                <TableCell className="max-w-[26rem] truncate font-mono text-xs" title={entry.key}>
                                  {entry.key}
                                </TableCell>
                                <TableCell
                                  className="max-w-[30rem] truncate text-xs text-muted-foreground"
                                  title={entry.taskPreview ?? undefined}
                                >
                                  {entry.taskPreview ?? "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {updated.date} {updated.time}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {created.date} {created.time}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end pt-1">
                  <PaginationControls
                    total={sessionsQuery.data?.total ?? 0}
                    limit={limit}
                    offset={offset}
                    hasMore={hasMore}
                    onLimitChange={(nextLimit) => {
                      setLimit(nextLimit);
                      setOffset(0);
                    }}
                    onOffsetChange={setOffset}
                  />
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
