import { Cable, RefreshCcw } from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMedusaConnection } from "@/features/settings/hooks/use-medusa-connection";
import { getMedusaRuntimeConfig } from "@/lib/medusa/config";
import { getErrorMessageOrNull } from "@/utils/errors";

export function MedusaConnectionSettings() {
  const medusaConnectionQuery = useMedusaConnection();
  const snapshot = medusaConnectionQuery.data;
  const runtime = getMedusaRuntimeConfig();
  const error = getErrorMessageOrNull(medusaConnectionQuery.error, "Failed to connect to Medusa backend.");

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Cable className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Medusa Backend</h3>
              <p className="text-xs text-muted-foreground">Verify storefront connectivity and publishable-key wiring.</p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={medusaConnectionQuery.isFetching}
            onClick={() => {
              void medusaConnectionQuery.refetch();
            }}
          >
            {medusaConnectionQuery.isFetching ? <Spinner size="sm" className="mr-1.5" /> : <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>

        {error ? <AlertMessage variant="error">{error}</AlertMessage> : null}
        {!error && snapshot ? (
          <AlertMessage variant="success">
            Connected to Medusa store API. {snapshot.regions.length} region{snapshot.regions.length === 1 ? "" : "s"} available.
          </AlertMessage>
        ) : null}

        <div className="divide-y rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="text-sm font-medium">Backend URL</p>
              <p className="text-xs text-muted-foreground">Store API base used by the frontend.</p>
            </div>
            <code className="rounded bg-muted px-2 py-1 text-xs">{snapshot?.backendUrl ?? runtime.backendUrl}</code>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="text-sm font-medium">Publishable Key</p>
              <p className="text-xs text-muted-foreground">Used as `x-publishable-api-key` for store requests.</p>
            </div>
            <Badge variant={snapshot?.publishableKeyConfigured ?? runtime.publishableKey ? "default" : "outline"}>
              {snapshot?.publishableKeyConfigured ?? runtime.publishableKey ? "Configured" : "Missing"}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="text-sm font-medium">Regions</p>
              <p className="text-xs text-muted-foreground">Regions returned from `/store/regions`.</p>
            </div>
            <Badge variant="outline">{snapshot?.regions.length ?? 0}</Badge>
          </div>

          {snapshot?.regions.length ? (
            <div className="space-y-2 p-3">
              {snapshot.regions.slice(0, 4).map((region) => (
                <div key={region.id} className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{region.name}</span>
                    <span className="text-muted-foreground">{region.currencyCode ?? "—"}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Countries: {region.countryCodes.length ? region.countryCodes.join(", ") : "—"}
                  </p>
                </div>
              ))}
              {snapshot.regions.length > 4 ? (
                <p className="text-[11px] text-muted-foreground">+{snapshot.regions.length - 4} more region(s)</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
