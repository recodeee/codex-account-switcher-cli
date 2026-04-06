"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { CodexLogo } from "@/components/brand/codex-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ComingSoonPage() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    if (!email) {
      return;
    }

    setSubmittedEmail(email);
    event.currentTarget.reset();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-xl rounded-2xl border border-border/70 bg-card p-8 shadow-sm sm:p-10">
        <div className="mb-8 flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="inline-flex items-center gap-3">
            <CodexLogo size={62} title="recodee.com logo" />
            <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              recodee.com
            </p>
          </div>

          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Coming Soon</h1>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
          We are preparing something new for recodee.com. If you are interested,
          enter your email address below and hit submit.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="Enter email address"
            aria-label="Email address"
            className="sm:flex-1"
          />
          <Button type="submit" className="sm:min-w-28">
            Submit
          </Button>
        </form>

        <div className="mt-6 overflow-hidden rounded-xl border border-border/60 bg-muted/20">
          <img
            src="/commingsoon.jpg"
            alt="Dashboard preview"
            className="h-auto w-full object-cover"
            loading="lazy"
          />
        </div>

        {submittedEmail ? (
          <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">
            Thanks! We will keep <span className="font-medium">{submittedEmail}</span>{" "}
            posted.
          </p>
        ) : null}
      </section>
    </main>
  );
}
