import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../src/index.css";
import { AppProviders } from "./providers";

const LIGHT_BOOTSTRAP_BACKGROUND = "#f8f9fb";
const DARK_BOOTSTRAP_BACKGROUND = "#030915";
const DARK_BOOTSTRAP_BACKGROUND_IMAGE =
  "radial-gradient(120% 140% at 50% -20%, rgba(34, 211, 238, 0.2) 0%, rgba(34, 211, 238, 0) 58%), radial-gradient(120% 160% at 100% 0%, rgba(59, 130, 246, 0.16) 0%, rgba(59, 130, 246, 0) 62%), linear-gradient(180deg, #020612 0%, #030915 52%, #020814 100%), url('/appbg.png')";

const THEME_BOOTSTRAP_STYLES = `
  html {
    background-color: ${DARK_BOOTSTRAP_BACKGROUND};
    background-image: ${DARK_BOOTSTRAP_BACKGROUND_IMAGE};
    background-position: center top;
    background-repeat: no-repeat;
    background-size: cover;
    color-scheme: dark;
  }
  html.light {
    background-color: ${LIGHT_BOOTSTRAP_BACKGROUND};
    background-image: none;
    color-scheme: light;
  }
  html.dark {
    background-color: ${DARK_BOOTSTRAP_BACKGROUND};
    background-image: ${DARK_BOOTSTRAP_BACKGROUND_IMAGE};
    background-position: center top;
    background-repeat: no-repeat;
    background-size: cover;
    color-scheme: dark;
  }
  @media (prefers-color-scheme: dark) {
    html:not(.light) {
      background-color: ${DARK_BOOTSTRAP_BACKGROUND};
      background-image: ${DARK_BOOTSTRAP_BACKGROUND_IMAGE};
      background-position: center top;
      background-repeat: no-repeat;
      background-size: cover;
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
      const LIGHT_BACKGROUND_COLOR = ${JSON.stringify(
        LIGHT_BOOTSTRAP_BACKGROUND,
      )};
      const DARK_BACKGROUND_COLOR = ${JSON.stringify(
        DARK_BOOTSTRAP_BACKGROUND,
      )};
      const DARK_BACKGROUND_IMAGE = ${JSON.stringify(
        DARK_BOOTSTRAP_BACKGROUND_IMAGE,
      )};
      const storageKey = "codex-lb-theme";
      const stored = window.localStorage.getItem(storageKey);
      const preference =
        stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
      const prefersDark =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDark = preference === "dark" || (preference === "auto" && prefersDark);
      const backgroundColor = isDark ? DARK_BACKGROUND_COLOR : LIGHT_BACKGROUND_COLOR;

      const root = document.documentElement;
      root.classList.toggle("dark", isDark);
      root.classList.toggle("light", !isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
      root.style.backgroundColor = backgroundColor;
      root.style.backgroundImage = isDark ? DARK_BACKGROUND_IMAGE : "none";
      root.style.backgroundPosition = isDark ? "center top" : "";
      root.style.backgroundRepeat = isDark ? "no-repeat" : "";
      root.style.backgroundSize = isDark ? "cover" : "";
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
