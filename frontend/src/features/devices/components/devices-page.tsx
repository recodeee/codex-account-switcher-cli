import { useMemo, useState } from "react";
import { Copy, HardDrive } from "lucide-react";
import { toast } from "sonner";

import { AlertMessage } from "@/components/alert-message";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpinnerBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDevices } from "@/features/devices/hooks/use-devices";
import { useDialogState } from "@/hooks/use-dialog-state";
import { getErrorMessageOrNull } from "@/utils/errors";
import { formatTimeLong } from "@/utils/formatters";

export function DevicesPage() {
  const [deviceName, setDeviceName] = useState("");
  const [deviceIpAddress, setDeviceIpAddress] = useState("");
  const { devicesQuery, createMutation, deleteMutation } = useDevices();
  const deleteDialog = useDialogState<{ id: string; name: string }>();

  const mutationError = useMemo(
    () =>
      getErrorMessageOrNull(devicesQuery.error) ||
      getErrorMessageOrNull(createMutation.error) ||
      getErrorMessageOrNull(deleteMutation.error),
    [devicesQuery.error, createMutation.error, deleteMutation.error],
  );

  const entries = devicesQuery.data?.entries ?? [];
  const busy = createMutation.isPending || deleteMutation.isPending;

  const handleAdd = async () => {
    const name = deviceName.trim();
    const ipAddress = deviceIpAddress.trim();
    if (!name || !ipAddress) {
      return;
    }

    await createMutation.mutateAsync({
      name,
      ipAddress,
    });

    setDeviceName("");
    setDeviceIpAddress("");
  };

  const handleCopy = async (name: string, ipAddress: string) => {
    try {
      await navigator.clipboard.writeText(`${name}\t${ipAddress}`);
      toast.success("Device name and IP copied");
    } catch {
      toast.error("Failed to copy device details");
    }
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage saved devices and their IP addresses.
        </p>
      </div>

      {mutationError ? <AlertMessage variant="error">{mutationError}</AlertMessage> : null}

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <HardDrive className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Saved devices</h3>
            <p className="text-xs text-muted-foreground">Add multiple devices and keep their host/IP mapping.</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            placeholder="Device name (e.g. ksskringdistance03)"
            className="h-8 text-xs"
            disabled={busy}
          />
          <Input
            value={deviceIpAddress}
            onChange={(event) => setDeviceIpAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleAdd();
              }
            }}
            placeholder="IP address (e.g. 192.168.0.1)"
            className="h-8 text-xs"
            disabled={busy}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              void handleAdd();
            }}
            disabled={busy || !deviceName.trim() || !deviceIpAddress.trim()}
          >
            Add device
          </Button>
        </div>

        {devicesQuery.isLoading && !devicesQuery.data ? (
          <div className="py-8">
            <SpinnerBlock />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title="No saved devices"
            description="Add a device name and IP address to get started."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[140px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const created = formatTimeLong(entry.createdAt);
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{entry.name}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.ipAddress}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {created.date} {created.time}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label={`Copy ${entry.name} and ${entry.ipAddress}`}
                            title="Copy device name and IP"
                            disabled={busy}
                            onClick={() => {
                              void handleCopy(entry.name, entry.ipAddress);
                            }}
                          >
                            <Copy className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={busy}
                            onClick={() => deleteDialog.show({ id: entry.id, name: entry.name })}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete device"
        description={`Remove ${deleteDialog.data?.name ?? "this device"} from the saved device list.`}
        confirmLabel="Delete"
        onOpenChange={deleteDialog.onOpenChange}
        onConfirm={() => {
          if (!deleteDialog.data) {
            return;
          }
          void deleteMutation.mutateAsync(deleteDialog.data.id).finally(() => {
            deleteDialog.hide();
          });
        }}
      />
    </div>
  );
}
