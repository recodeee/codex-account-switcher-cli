import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";

import "../src/index.css";
import { AppProviders } from "./providers";

const themeBootstrapScript = `
(() => {
  try {
    const key = "codex-lb-theme";
    const stored = window.localStorage.getItem(key);
    const preference = stored === "light" || stored === "dark" || stored === "auto"
      ? stored
      : "auto";
    const resolved = preference === "auto"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : preference;
    document.documentElement.classList.toggle("dark", resolved === "dark");
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
    ],
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
