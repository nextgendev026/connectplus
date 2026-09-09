"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * connectPlus mark — "Signal over the Savanna".
 *
 * A flat-topped acacia silhouetted in cream against a savanna-sunset
 * gradient plate, crowned by a rising sun. The canopy carries a bold "+"
 * signal node — every story a new branch, every reader a new connection.
 * Rendered inline (vector) for crisp scaling in the navbar, footer, auth
 * screens, and PWA assets.
 */
export default function ConnectPlusMark({
  className,
  plate = true,
}: {
  className?: string;
  /** Wrap the mark in the sunset plate (app-icon look). Default true. */
  plate?: boolean;
}) {
  const rawId = useId();
  const uid = `cp-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const grad = `${uid}-g`;
  const fg = plate ? "#FFF7EA" : `url(#${grad})`;
  const node = plate ? "#7C2D12" : `url(#${grad})`;

  return (
    <svg
      viewBox="0 0 120 120"
      className={cn("block", className)}
      role="img"
      aria-label="connectPlus mark"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD75E" />
          <stop offset="38%" stopColor="#F59E0B" />
          <stop offset="72%" stopColor="#C2410C" />
          <stop offset="100%" stopColor="#7C2D12" />
        </linearGradient>
      </defs>

      {plate && (
        <>
          {/* Sunset plate */}
          <rect x="4" y="4" width="112" height="112" rx="30" fill={`url(#${grad})`} />
          {/* Warm horizon sheen */}
          <circle cx="40" cy="30" r="46" fill="#ffffff" opacity="0.12" />
          {/* Subtle inner ring */}
          <rect
            x="9"
            y="9"
            width="102"
            height="102"
            rx="26"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.18"
            strokeWidth="1.5"
          />
        </>
      )}

      {/* Rising sun */}
      <circle cx="84" cy="30" r="11" fill={fg} opacity="0.95" />

      {/* Acacia canopy — flat-top, layered */}
      <path
        d="M18 62 Q34 50 60 50 Q86 50 102 62 Q90 66 78 64 Q68 62.5 60 63.5 Q50 65 38 64 Q26 63 18 62 Z"
        fill={fg}
      />
      <path
        d="M30 68 Q44 61 60 61 Q76 61 90 68 Q80 70.5 70 69.5 Q60 68.8 50 69.5 Q40 70.5 30 68 Z"
        fill={fg}
        opacity="0.85"
      />

      {/* Trunk with branch split */}
      <path
        d="M57.5 69 L62.5 69 L61 92 Q60 94.5 58.6 94.5 L57.4 94.5 Q56 94.5 56.2 92 Z"
        fill={fg}
      />
      <path
        d="M60 70 L52 63 M60 70 L68 63"
        stroke={fg}
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Ground */}
      <path
        d="M40 96 Q60 93 80 96"
        stroke={fg}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />

      {/* Signal-plus node in the canopy */}
      <rect x="56.5" y="46" width="7" height="18" rx="3.5" fill={node} />
      <rect x="51" y="51.5" width="18" height="7" rx="3.5" fill={node} />
      {/* Connection nodes at the plus tips */}
      <circle cx="60" cy="43.5" r="2.2" fill={node} />
      <circle cx="60" cy="66.5" r="2.2" fill={node} />
      <circle cx="48.5" cy="55" r="2.2" fill={node} />
      <circle cx="71.5" cy="55" r="2.2" fill={node} />
    </svg>
  );
}
