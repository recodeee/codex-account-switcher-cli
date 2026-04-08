import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AlertMessage } from "@/components/alert-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

const verificationCodeSchema = z.object({
  code: z.string().trim().length(6, "Enter the 6-digit authenticator code."),
});

type MedusaAdminSecondFactorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MedusaAdminSecondFactorDialog({
  open,
  onOpenChange,
}: MedusaAdminSecondFactorDialogProps) {
  const user = useMedusaAdminAuthStore((state) => state.user);
  const secondFactorStatus = useMedusaAdminAuthStore((state) => state.secondFactorStatus);
  const setupSecret = useMedusaAdminAuthStore((state) => state.setupSecret);
  const setupQrDataUri = useMedusaAdminAuthStore((state) => state.setupQrDataUri);
  const loading = useMedusaAdminAuthStore((state) => state.loading);
  const error = useMedusaAdminAuthStore((state) => state.error);
  const clearError = useMedusaAdminAuthStore((state) => state.clearError);
  const refreshSecondFactorStatus = useMedusaAdminAuthStore((state) => state.refreshSecondFactorStatus);
  const beginSecondFactorSetup = useMedusaAdminAuthStore((state) => state.beginSecondFactorSetup);
  const confirmSecondFactorSetup = useMedusaAdminAuthStore((state) => state.confirmSecondFactorSetup);
  const disableSecondFactor = useMedusaAdminAuthStore((state) => state.disableSecondFactor);

  const form = useForm({
    resolver: zodResolver(verificationCodeSchema),
    defaultValues: {
      code: "",
    },
  });

  useEffect(() => {
    if (open && user && !setupQrDataUri) {
      void refreshSecondFactorStatus().catch(() => undefined);
    }
  }, [open, refreshSecondFactorStatus, setupQrDataUri, user]);

  const handleSubmit = async (values: { code: string }) => {
    clearError();
    if (setupSecret) {
      await confirmSecondFactorSetup(values.code);
    } else if (secondFactorStatus?.totpEnabled) {
      await disableSecondFactor(values.code);
    }
    form.reset();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      clearError();
      form.reset();
    }
    onOpenChange(nextOpen);
  };

  const title = setupSecret
    ? "Set up Medusa admin second factor"
    : secondFactorStatus?.totpEnabled
      ? "Disable Medusa admin second factor"
      : "Medusa admin second factor";

  const description = setupSecret
    ? "Scan the QR code with your authenticator app, then confirm with a 6-digit code."
    : secondFactorStatus?.totpEnabled
      ? "Re-enter a current 6-digit authenticator code to disable second factor."
      : "Protect this Medusa admin account with an authenticator app challenge.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {setupSecret || secondFactorStatus?.totpEnabled ? (
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!user ? (
          <AlertMessage variant="error">Sign in to a Medusa admin account first.</AlertMessage>
        ) : setupQrDataUri ? (
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
              <div className="space-y-2">
                <img
                  src={setupQrDataUri}
                  alt="Medusa admin TOTP QR code"
                  className="mx-auto h-48 w-48 rounded-md border border-border bg-white p-3"
                />
                <p className="text-xs text-muted-foreground">
                  Secret: <span className="font-mono text-foreground">{setupSecret}</span>
                </p>
              </div>

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        maxLength={6}
                        disabled={loading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error ? <AlertMessage variant="error">{error}</AlertMessage> : null}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Spinner size="sm" className="mr-2" /> : null}
                Confirm setup
              </Button>
            </form>
          </Form>
        ) : secondFactorStatus?.totpEnabled ? (
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        maxLength={6}
                        disabled={loading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error ? <AlertMessage variant="error">{error}</AlertMessage> : null}

              <Button type="submit" className="w-full" variant="destructive" disabled={loading}>
                {loading ? <Spinner size="sm" className="mr-2" /> : null}
                Disable second factor
              </Button>
            </form>
          </Form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              No authenticator app is configured for {user.email} yet.
            </p>
            {error ? <AlertMessage variant="error">{error}</AlertMessage> : null}
            <Button type="button" className="w-full" onClick={() => void beginSecondFactorSetup()} disabled={loading}>
              {loading ? <Spinner size="sm" className="mr-2" /> : null}
              Set up authenticator app
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
