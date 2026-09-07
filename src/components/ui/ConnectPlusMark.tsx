"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * connectPlus mark — modern geometric "network plus".
 *
 * A vibrant amber→rose gradient squircle with a bold rounded "+" whose four
 * arms terminate in connection nodes and a spark — connecting East African
 * stories, one node at a time. Rendered inline (vector) for crisp scaling in
 * the navbar, footer, auth screens, and PWA assets (matches
 * /public/logo_connected_branches.svg).
 */
export default function ConnectPlusMark({
  className,
  plate = true,
}: {
  className?: string;
  /** Wrap the mark in the gradient plate (app-icon look). Default true. */
  plate?: boolean;
}) {
  const rawId = useId();
  const uid = `cp-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const grad = `${uid}-g`;

  const mark = (
    <>
      {/* Rounded plus arms */}
      <rect x="52" y="30" width="16" height="60" rx="8" fill={plate ? "#ffffff" : `url(#${grad})`} />
      <rect x="30" y="52" width="60" height="16" rx="8" fill={plate ? "#ffffff" : `url(#${grad})`} />
      {/* Arm terminal nodes */}
      <circle cx="60" cy="24" r="4.2" fill={plate ? "#ffffff" : `url(#${grad})`} />
      <circle cx="60" cy="96" r="4.2" fill={plate ? "#ffffff" : `url(#${grad})`} />
      <circle cx="24" cy="60" r="4.2" fill={plate ? "#ffffff" : `url(#${grad})`} />
      <circle cx="96" cy="60" r="4.2" fill={plate ? "#ffffff" : `url(#${grad})`} />
      {/* Spark accent */}
      <path
        d="M88 28 l2.3 5.4 5.4 2.3 -5.4 2.3 -2.3 5.4 -2.3 -5.4 -5.4 -2.3 5.4 -2.3 Z"
        fill={plate ? "#ffffff" : `url(#${grad})`}
        opacity="0.92"
      />
    </>
  );

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
          <stop offset="35%" stopColor="#FBBF24" />
          <stop offset="70%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#F43F5E" />
        </linearGradient>
      </defs>

      {plate && (
        <>
          {/* Gradient plate */}
          <rect x="4" y="4" width="112" height="112" rx="30" fill={`url(#${grad})`} />
          {/* Soft top-left sheen for depth */}
          <circle cx="38" cy="32" r="46" fill="#ffffff" opacity="0.12" />
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

      {mark}
    </svg>
  );
}