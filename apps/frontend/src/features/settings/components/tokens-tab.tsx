import { useMemo, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiKeys } from "@/features/api-keys/hooks/use-api-keys";
import type { ApiKey } from "@/features/api-keys/schemas";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30" },
  { value: "90", label: "90" },
  { value: "365", label: "365" },
  { value: "never", label: "Never" },
] as const;

function expiryToDate(expiry: string): string | null | undefined {
  if (expiry === "never") {
    return null;
  }
  const days = Number(expiry);
  if (!Number.isFinite(days) || days <= 0) {
    return undefined;
  }
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Never";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleDateString();
}

function renderTokenMeta(token: ApiKey): string {
  const created = formatDate(token.createdAt);
  const lastUsed = token.lastUsedAt ? formatDate(token.lastUsedAt) : "Never used";
  const expires = formatDate(token.expiresAt);
  return `${token.keyPrefix}... · Created ${created} · Last used ${lastUsed} · Expires ${expires}`;
}

export function TokensTab() {
  const { apiKeysQuery, createMutation, deleteMutation } = useApiKeys();

  const [tokenName, setTokenName] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState<string>("90");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiKey | null>(null);

  const sortedKeys = useMemo(
    () => [...(apiKeysQuery.data ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [apiKeysQuery.data],
  );

  const handleCreate = async () => {
    const name = tokenName.trim();
    if (!name) {
      return;
    }
    const created = await createMutation.mutateAsync({
      name,
      expiresAt: expiryToDate(tokenExpiry),
    });
    setCreatedToken(created.key);
    setTokenName("");
    setTokenExpiry("90");
  };

  const handleDelete = async (keyId: string) => {
    await deleteMutation.mutateAsync(keyId);
    setPendingDelete(null);
  };

  const handleCopy = async () => {
    if (!createdToken) {
      return;
    }
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    toast.success("Token copied");
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">API Tokens</h2>
        </div>

        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">
              Personal access tokens allow the CLI and integrations to authenticate with your account.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_90px_auto]">
              <Input
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
                placeholder="Token name (e.g. My CLI)"
                className="bg-white/[0.03]"
              />
              <Select value={tokenExpiry} onValueChange={setTokenExpiry}>
                <SelectTrigger size="sm" className="bg-white/[0.03]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => void handleCreate()} disabled={createMutation.isPending || !tokenName.trim()}>
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {sortedKeys.map((token) => (
            <Card key={token.id} className="border-white/[0.08] bg-white/[0.03]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{token.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{renderTokenMeta(token)}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPendingDelete(token)}
                  disabled={deleteMutation.isPending}
                  aria-label={`Delete ${token.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API token</AlertDialogTitle>
            <AlertDialogDescription>
              This token will stop working immediately and cannot be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingDelete) {
                  return;
                }
                void handleDelete(pendingDelete.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(createdToken)} onOpenChange={(open) => !open && setCreatedToken(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Token created</AlertDialogTitle>
            <AlertDialogDescription>
              Copy your token now. You will not be able to see it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <code className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs break-all">
            {createdToken}
          </code>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => void handleCopy()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Copy
            </Button>
            <AlertDialogCancel>Done</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
