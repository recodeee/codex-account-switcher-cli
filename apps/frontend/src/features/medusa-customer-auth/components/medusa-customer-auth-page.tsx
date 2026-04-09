import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Mail, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CodexLogo } from "@/components/brand/codex-logo";
import { AlertMessage } from "@/components/alert-message";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { MedusaCustomerLoginRequestSchema } from "@/features/medusa-customer-auth/schemas";

type MedusaCustomerAuthPageProps = {
  initialMode?: "login" | "register";
};

const RegisterFormSchema = MedusaCustomerLoginRequestSchema.extend({
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  confirmPassword: z.string().min(1, "Please confirm your password."),
}).superRefine((value, context) => {
  if (value.password !== value.confirmPassword) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Passwords do not match.",
      path: ["confirmPassword"],
    });
  }
});

export function MedusaCustomerAuthPage({
  initialMode = "login",
}: MedusaCustomerAuthPageProps) {
  const [activeTab, setActiveTab] = useState<"login" | "register">(initialMode);
  const login = useMedusaCustomerAuthStore((state) => state.login);
  const register = useMedusaCustomerAuthStore((state) => state.register);
  const loading = useMedusaCustomerAuthStore((state) => state.loading);
  const error = useMedusaCustomerAuthStore((state) => state.error);
  const clearError = useMedusaCustomerAuthStore((state) => state.clearError);

  const loginForm = useForm<z.infer<typeof MedusaCustomerLoginRequestSchema>>({
    resolver: zodResolver(MedusaCustomerLoginRequestSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<z.infer<typeof RegisterFormSchema>>({
    resolver: zodResolver(RegisterFormSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
    },
  });

  useEffect(() => {
    setActiveTab(initialMode);
  }, [initialMode]);

  const handleLogin = async (
    values: z.infer<typeof MedusaCustomerLoginRequestSchema>,
  ) => {
    clearError();
    try {
      await login(values.email, values.password);
    } catch {
      // Auth state already stores the user-facing error message.
    }
  };

  const handleRegister = async (values: z.infer<typeof RegisterFormSchema>) => {
    clearError();
    try {
      await register({
        email: values.email,
        password: values.password,
        firstName: values.firstName?.trim() || undefined,
        lastName: values.lastName?.trim() || undefined,
      });
    } catch {
      // Auth state already stores the user-facing error message.
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020308] px-6 py-10">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <div
            data-testid="medusa-auth-logo-shell"
            className="flex items-center justify-center"
          >
            <CodexLogo size={64} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              recodee.com
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Build and make your dreams come true.
            </p>
          </div>
        </div>

        <div data-testid="medusa-auth-surface" className="space-y-6">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              const next = value === "register" ? "register" : "login";
              setActiveTab(next);
              clearError();
            }}
          >
            <TabsList
              data-testid="medusa-auth-tabs"
              variant="line"
              className="grid w-full grid-cols-2 border-b border-border p-0"
            >
              <TabsTrigger
                value="login"
                className="rounded-none px-0 pb-3 text-base text-muted-foreground/85 after:bottom-[-1px] after:h-px after:bg-muted-foreground/45 data-[state=active]:after:bg-muted-foreground/75"
              >
                Login
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="rounded-none px-0 pb-3 text-base text-muted-foreground/85 after:bottom-[-1px] after:h-px after:bg-muted-foreground/45 data-[state=active]:after:bg-muted-foreground/75"
              >
                Register
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-0 pt-5">
              <Form {...loginForm}>
                <form
                  className="space-y-4"
                  onSubmit={loginForm.handleSubmit(handleLogin)}
                >
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              autoComplete="email"
                              placeholder="you@example.com"
                              disabled={loading}
                              className="pl-9"
                            />
                          </FormControl>
                        </div>
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
                        <div className="relative">
                          <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              autoComplete="current-password"
                              placeholder="Enter password"
                              disabled={loading}
                              className="pl-9"
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {error ? (
                    <AlertMessage variant="error">{error}</AlertMessage>
                  ) : null}

                  <Button
                    type="submit"
                    className="w-full border border-border bg-foreground text-background hover:bg-foreground/90 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/90"
                    disabled={loading}
                  >
                    {loading ? <Spinner size="sm" className="mr-2" /> : null}
                    Sign in
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="register" className="mt-0 pt-5">
              <Form {...registerForm}>
                <form
                  className="space-y-4"
                  onSubmit={registerForm.handleSubmit(handleRegister)}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField
                      control={registerForm.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              autoComplete="given-name"
                              placeholder="First"
                              disabled={loading}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={registerForm.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              autoComplete="family-name"
                              placeholder="Last"
                              disabled={loading}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={registerForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              autoComplete="email"
                              placeholder="you@example.com"
                              disabled={loading}
                              className="pl-9"
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={registerForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <div className="relative">
                          <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              autoComplete="new-password"
                              placeholder="Create password"
                              disabled={loading}
                              className="pl-9"
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={registerForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm password</FormLabel>
                        <div className="relative">
                          <UserRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              autoComplete="new-password"
                              placeholder="Confirm password"
                              disabled={loading}
                              className="pl-9"
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {error ? (
                    <AlertMessage variant="error">{error}</AlertMessage>
                  ) : null}

                  <Button
                    type="submit"
                    className="w-full border border-border bg-foreground text-background hover:bg-foreground/90 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/90"
                    disabled={loading}
                  >
                    {loading ? <Spinner size="sm" className="mr-2" /> : null}
                    Create account
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
