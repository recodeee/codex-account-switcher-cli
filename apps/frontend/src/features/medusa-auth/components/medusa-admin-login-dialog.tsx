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
import { MedusaAdminLoginRequestSchema } from "@/features/medusa-auth/schemas";

const secondFactorCodeSchema = z.object({
  code: z.string().trim().length(6, "Enter the 6-digit authenticator code."),
});

type MedusaAdminLoginDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MedusaAdminLoginDialog({
  open,
  onOpenChange,
}: MedusaAdminLoginDialogProps) {
  const login = useMedusaAdminAuthStore((state) => state.login);
  const verifySecondFactor = useMedusaAdminAuthStore((state) => state.verifySecondFactor);
  const pendingUser = useMedusaAdminAuthStore((state) => state.pendingUser);
  const challengeRequired = useMedusaAdminAuthStore((state) => state.challengeRequired);
  const loading = useMedusaAdminAuthStore((state) => state.loading);
  const error = useMedusaAdminAuthStore((state) => state.error);
  const clearError = useMedusaAdminAuthStore((state) => state.clearError);
  const logout = useMedusaAdminAuthStore((state) => state.logout);

  const loginForm = useForm({
    resolver: zodResolver(MedusaAdminLoginRequestSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const challengeForm = useForm({
    resolver: zodResolver(secondFactorCodeSchema),
    defaultValues: {
      code: "",
    },
  });

  const resetForms = () => {
    loginForm.reset();
    challengeForm.reset();
  };

  const handleLoginSubmit = async (values: { email: string; password: string }) => {
    clearError();
    await login(values.email, values.password);

    if (!useMedusaAdminAuthStore.getState().challengeRequired) {
      onOpenChange(false);
      resetForms();
    }
  };

  const handleChallengeSubmit = async (values: { code: string }) => {
    clearError();
    await verifySecondFactor(values.code);
    onOpenChange(false);
    resetForms();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      const nextState = useMedusaAdminAuthStore.getState();
      clearError();
      resetForms();
      if (nextState.challengeRequired || nextState.pendingToken) {
        logout();
      }
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {challengeRequired ? (
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
            {challengeRequired ? "Medusa Admin Second Factor" : "Medusa Admin Sign In"}
          </DialogTitle>
          <DialogDescription>
            {challengeRequired
              ? `Enter the 6-digit code for ${pendingUser?.email ?? "your Medusa admin account"}.`
              : "Authenticate against your Medusa backend admin user credentials."}
          </DialogDescription>
        </DialogHeader>

        {challengeRequired ? (
          <Form {...challengeForm}>
            <form className="space-y-4" onSubmit={challengeForm.handleSubmit(handleChallengeSubmit)}>
              <FormField
                control={challengeForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TOTP code</FormLabel>
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
                Verify code
              </Button>
            </form>
          </Form>
        ) : (
          <Form {...loginForm}>
            <form className="space-y-4" onSubmit={loginForm.handleSubmit(handleLoginSubmit)}>
              <FormField
                control={loginForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="admin@example.com"
                        autoComplete="email"
                        disabled={loading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={loginForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="current-password"
                        placeholder="Enter password"
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
                Sign in
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
