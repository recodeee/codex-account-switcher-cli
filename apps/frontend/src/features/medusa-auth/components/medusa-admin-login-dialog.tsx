import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import { useForm } from "react-hook-form";

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
import { MedusaAdminLoginRequestSchema } from "@/features/medusa-auth/schemas";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

type MedusaAdminLoginDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MedusaAdminLoginDialog({
  open,
  onOpenChange,
}: MedusaAdminLoginDialogProps) {
  const login = useMedusaAdminAuthStore((state) => state.login);
  const loading = useMedusaAdminAuthStore((state) => state.loading);
  const error = useMedusaAdminAuthStore((state) => state.error);
  const clearError = useMedusaAdminAuthStore((state) => state.clearError);

  const form = useForm({
    resolver: zodResolver(MedusaAdminLoginRequestSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: { email: string; password: string }) => {
    clearError();
    await login(values.email, values.password);
    onOpenChange(false);
    form.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          clearError();
          form.reset();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
            Medusa Admin Sign In
          </DialogTitle>
          <DialogDescription>
            Authenticate against your Medusa backend admin user credentials.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
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
              control={form.control}
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
      </DialogContent>
    </Dialog>
  );
}
