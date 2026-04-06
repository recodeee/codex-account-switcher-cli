import { useId } from "react";

import { cn } from "@/lib/utils";

export type CodexLogoProps = {
  className?: string;
  size?: number;
};

export function CodexLogo({ className, size = 32 }: CodexLogoProps) {
  const gradientId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Codexina logo"
    >
      <defs>
        <linearGradient id={gradientId} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C4ED8" />
          <stop offset="1" stopColor="#0A1F4A" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="9"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M13 10.25c-1.86-1.86-4.89-1.86-6.75 0-1.87 1.86-1.87 4.89 0 6.75 1.86 1.87 4.89 1.87 6.75 0"
        stroke="#fff"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 14.25c1.86 1.87 4.89 1.87 6.75 0 1.87-1.86 1.87-4.89 0-6.75-1.86-1.87-4.89-1.87-6.75 0"
        stroke="#fff"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m10 11.2 12 9.6"
        stroke="#fff"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="9"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
      />
    </svg>
  );
}
