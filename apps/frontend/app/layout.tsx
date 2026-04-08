import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../src/index.css";
import { AppProviders } from "./providers";

const THEME_BOOTSTRAP_STYLES = `
  html {
    background-color: #f8f9fb;
    color-scheme: light;
  }
  html.dark {
    background-color: #0f1118;
    color-scheme: dark;
  }
  @media (prefers-color-scheme: dark) {
    html {
      background-color: #0f1118;
      color-scheme: dark;
    }
  }
  body {
    background-color: transparent;
  }
`;

const THEME_BOOTSTRAP_SCRIPT = `
  (() => {
    try {
      const storageKey = "codex-lb-theme";
      const stored = window.localStorage.getItem(storageKey);
      const preference =
        stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
      const prefersDark =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDark = preference === "dark" || (preference === "auto" && prefersDark);
      const backgroundColor = isDark ? "#0f1118" : "#f8f9fb";

      const root = document.documentElement;
      root.classList.toggle("dark", isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
      root.style.backgroundColor = backgroundColor;

    } catch {}
  })();
`;

export const metadata: Metadata = {
  title: "recodee.com",
  description: "Live account switchboard",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/app.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/app.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style
          id="theme-bootstrap-styles"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_STYLES }}
        />
        <script
          id="theme-bootstrap-script"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
