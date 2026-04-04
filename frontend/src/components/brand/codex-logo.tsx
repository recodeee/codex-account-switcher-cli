import { cn } from "@/lib/utils";

export type CodexLogoProps = {
  className?: string;
  size?: number;
};

export function CodexLogo({ className, size = 32 }: CodexLogoProps) {
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
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="9"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <path
        stroke="currentColor"
        strokeWidth="2"
        d="M12.4 11.8H10a1 1 0 0 0-.92.61L7.7 15.7a1 1 0 0 0-.07.37v1.43a2 2 0 0 0 2 2h2.07a2 2 0 0 0 2-2v-2.77a2.92 2.92 0 0 0-1.3-2.43Zm9.6 0h-2.4a1 1 0 0 0-.92.61l-1.38 3.3a1 1 0 0 0-.08.37v1.43a2 2 0 0 0 2 2h2.08a2 2 0 0 0 2-2v-2.77a2.92 2.92 0 0 0-1.3-2.43Z"
      />
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="9"
        stroke="currentColor"
        strokeOpacity="0.24"
        strokeWidth="1.5"
      />
    </svg>
  );
}
