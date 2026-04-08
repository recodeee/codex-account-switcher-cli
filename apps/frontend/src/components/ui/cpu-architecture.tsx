import React from "react";

import { cn } from "@/lib/utils";

export interface CpuArchitectureSvgProps {
  className?: string;
  width?: string;
  height?: string;
  text?: string;
  showCpuConnections?: boolean;
  lineMarkerSize?: number;
  animateText?: boolean;
  animateLines?: boolean;
  animateMarkers?: boolean;
}

export default function CpuArchitecture({
  className,
  width = "100%",
  height = "100%",
  text = "CPU",
  showCpuConnections = true,
  lineMarkerSize = 18,
  animateText = true,
  animateLines = true,
  animateMarkers = true,
}: CpuArchitectureSvgProps) {
  const markerRadius = Math.max(1.6, Math.min(4, lineMarkerSize / 10));

  return (
    <svg
      className={cn("text-slate-400", className)}
      width={width}
      height={height}
      viewBox="0 0 200 100"
      fill="none"
    >
      {/* Circuit traces */}
      <g stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round">
        {showCpuConnections ? (
          <>
            <path d="M 0 50 H 56" />
            <path d="M 200 50 H 144" />
            <path d="M 88 0 V 28" />
            <path d="M 112 0 V 28" />
            <path d="M 88 72 V 100" />
            <path d="M 112 72 V 100" />
            <path d="M 0 26 H 34 Q 42 26 42 34 V 38 H 56" />
            <path d="M 200 26 H 166 Q 158 26 158 34 V 38 H 144" />
            <path d="M 0 74 H 34 Q 42 74 42 66 V 62 H 56" />
            <path d="M 200 74 H 166 Q 158 74 158 66 V 62 H 144" />
          </>
        ) : null}
        {animateLines ? (
          <animate
            attributeName="stroke-dashoffset"
            from="20"
            to="0"
            dur="0.7s"
            fill="freeze"
          />
        ) : null}
      </g>

      {/* Optional node markers */}
      {animateMarkers ? (
        <g fill="#0f1115" stroke="#2b313c" strokeWidth="0.4">
          <circle cx="56" cy="50" r={markerRadius}>
            <animate attributeName="r" values={`${markerRadius * 0.6};${markerRadius};${markerRadius * 0.8}`} dur="0.8s" />
          </circle>
          <circle cx="144" cy="50" r={markerRadius}>
            <animate attributeName="r" values={`${markerRadius * 0.6};${markerRadius};${markerRadius * 0.8}`} dur="0.8s" />
          </circle>
        </g>
      ) : null}

      {/* CPU pins */}
      <g fill="url(#cpu-pin-grad)">
        <rect x="72" y="24" width="8" height="6" rx="1.5" />
        <rect x="94" y="24" width="8" height="6" rx="1.5" />
        <rect x="120" y="24" width="8" height="6" rx="1.5" />

        <rect x="72" y="70" width="8" height="6" rx="1.5" />
        <rect x="94" y="70" width="8" height="6" rx="1.5" />
        <rect x="120" y="70" width="8" height="6" rx="1.5" />

        <rect x="56" y="39" width="6" height="8" rx="1.5" />
        <rect x="56" y="53" width="6" height="8" rx="1.5" />

        <rect x="138" y="39" width="6" height="8" rx="1.5" />
        <rect x="138" y="53" width="6" height="8" rx="1.5" />
      </g>

      {/* Chip body */}
      <rect
        x="60"
        y="30"
        width="80"
        height="40"
        rx="6"
        fill="#111318"
        stroke="#202631"
        strokeWidth="0.8"
      />

      {/* Chip title */}
      <text
        x="100"
        y="54"
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        letterSpacing="0.12em"
        fill={animateText ? "url(#cpu-text-grad)" : "#d6dae2"}
      >
        {text}
      </text>

      <defs>
        <linearGradient id="cpu-pin-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b5f69" />
          <stop offset="100%" stopColor="#2b2f39" />
        </linearGradient>
        <linearGradient id="cpu-text-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f7f8fb">
            <animate
              attributeName="offset"
              values="-0.5;0;0.5"
              dur="4s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset="100%" stopColor="#9ea5b1" />
        </linearGradient>
      </defs>
    </svg>
  );
}
