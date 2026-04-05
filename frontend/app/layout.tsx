import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../src/index.css";
import { AppProviders } from "./providers";

export const metadata: Metadata = {
  title: "Codexina",
  description: "Live account switchboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
