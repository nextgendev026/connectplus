"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * connectPlus emblem — the acacia network + elephant + sunrise roundel from the
 * official "CONNECT PLUS!" logo. Rendered inline (vector) for crisp scaling in
 * the navbar, footer, and auth screens.
 */
export default function ConnectPlusMark({
  className,
  plate = true,
}: {
  className?: string;
  /** Wrap the emblem in a rounded plate (app-icon look). Default true. */
  plate?: boolean;
}) {
  const rawId = useId();
  const uid = `cp-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const skyG = `${uid}-sky`;
  const elephG = `${uid}-eleph`;
  const earG = `${uid}-ear`;
  const sunG = `${uid}-sun`;
  const hillFar = `${uid}-hf`;
  const hillNear = `${uid}-hn`;
  const nodeG = `${uid}-nd`;
  const clip = `${uid}-clip`;

  const emblem = (
    <>
      {/* Sky */}
      <circle cx="360" cy="215" r="175" fill={`url(#${skyG})`} />
      {/* Sun */}
      <circle cx="335" cy="300" r="26" fill={`url(#${sunG})`} />
      {/* Far hills */}
      <path
        d="M185 312 Q220 282 265 296 Q305 278 345 290 Q385 275 420 286 Q455 272 490 285 Q525 275 535 312 L535 390 L185 390 Z"
        fill={`url(#${hillFar})`}
        opacity="0.7"
      />
      {/* Near hills */}
      <path
        d="M185 330 Q220 305 268 318 Q310 302 350 313 Q385 300 418 310 Q450 298 485 308 Q515 300 535 330 L535 390 L185 390 Z"
        fill={`url(#${hillNear})`}
      />
      <rect x="185" y="360" width="350" height="35" fill="#2E140A" />

      {/* Acacia network tree */}
      <g>
        {/* Trunk */}
        <path d="M235 365 Q233 340 230 310 Q228 290 232 270 Q234 255 238 245" stroke="#1E0E06" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M235 365 Q237 340 240 310 Q242 290 240 270 Q238 255 236 245" stroke="#1E0E06" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.3" />
        {/* Left branches */}
        <path d="M238 248 Q220 230 195 215 Q170 200 140 195" stroke="#1E0E06" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M225 275 Q210 260 190 252 Q168 245 148 248" stroke="#1E0E06" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M222 295 Q205 285 188 280 Q170 277 155 280" stroke="#1E0E06" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* Right branches */}
        <path d="M236 252 Q255 235 278 222 Q300 212 325 208" stroke="#1E0E06" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M238 268 Q260 255 282 248 Q305 240 322 242" stroke="#1E0E06" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Canopy connectors */}
        <path d="M195 215 Q230 200 278 222" stroke="#1E0E06" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M170 210 Q210 195 255 200 Q285 205 310 215" stroke="#1E0E06" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
        {/* Network web */}
        <path d="M148 200 Q160 185 180 178 Q200 172 218 180 Q235 186 248 200" stroke="#3D2210" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M180 178 Q195 168 215 165 Q235 162 255 168 Q270 175 280 185" stroke="#3D2210" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.8" />
        <path d="M215 165 Q235 158 258 160 Q278 164 300 175" stroke="#3D2210" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M155 255 Q175 245 200 242 Q225 240 250 248" stroke="#3D2210" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7" />
        <path d="M148 248 Q168 238 192 235 Q218 232 248 238 Q270 245 288 255" stroke="#3D2210" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M190 252 Q210 242 235 240 Q260 238 282 248" stroke="#3D2210" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.5" />
        {/* Diagonal dashed connectors */}
        <path d="M160 195 Q175 230 188 280" stroke="#3D2210" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.35" strokeDasharray="4,3" />
        <path d="M250 205 Q265 230 275 255" stroke="#3D2210" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.35" strokeDasharray="4,3" />
        <path d="M218 180 Q225 215 232 270" stroke="#3D2210" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.3" strokeDasharray="4,3" />
        <path d="M195 215 Q210 235 222 295" stroke="#3D2210" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.3" strokeDasharray="4,3" />
        {/* Nodes */}
        <g fill={`url(#${nodeG})`}>
          <circle cx="238" cy="248" r="4.6" />
          <circle cx="195" cy="215" r="4" />
          <circle cx="278" cy="222" r="4" />
          <circle cx="148" cy="200" r="3.4" />
          <circle cx="325" cy="210" r="3.4" />
          <circle cx="140" cy="195" r="2.8" />
          <circle cx="148" cy="248" r="2.8" />
          <circle cx="155" cy="280" r="2.2" />
          <circle cx="322" cy="242" r="2.8" />
          <circle cx="180" cy="178" r="2.2" />
          <circle cx="218" cy="180" r="2.2" />
          <circle cx="255" cy="168" r="2.2" />
          <circle cx="215" cy="165" r="2" />
          <circle cx="300" cy="175" r="2" />
          <circle cx="170" cy="210" r="2.2" />
          <circle cx="248" cy="200" r="2.2" />
        </g>
        {/* Canopy caps */}
        <ellipse cx="168" cy="195" rx="45" ry="14" fill="#1E0E06" />
        <ellipse cx="150" cy="200" rx="25" ry="10" fill="#1E0E06" />
        <ellipse cx="190" cy="198" rx="22" ry="9" fill="#1E0E06" />
        <ellipse cx="305" cy="205" rx="35" ry="12" fill="#1E0E06" />
        <ellipse cx="325" cy="210" rx="20" ry="9" fill="#1E0E06" />
        <ellipse cx="285" cy="208" rx="18" ry="8" fill="#1E0E06" />
        <ellipse cx="215" cy="168" rx="30" ry="8" fill="#1E0E06" opacity="0.7" />
      </g>

      {/* Elephant head */}
      <g transform="translate(410, 135)">
        <path
          d="M-5 -5 Q-15 -30 -5 -52 Q12 -72 38 -68 Q60 -62 68 -42 Q76 -22 68 -5 Q60 8 48 12 Q38 16 30 10 Q22 5 18 -2 Q12 -12 14 -22 Q16 -32 24 -38 Q32 -42 38 -36 Q42 -30 40 -20 Q38 -14 34 -10 Q28 -6 22 -10 Q18 -14 20 -20 Q22 -26 28 -24"
          fill={`url(#${earG})`}
          stroke="#3D2210"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <g transform="translate(28, -34)">
          <rect x="-4.5" y="-15" width="9" height="30" rx="2" fill="#FFFFFF" />
          <rect x="-15" y="-4.5" width="30" height="9" rx="2" fill="#FFFFFF" />
        </g>
        <path
          d="M48 12 Q60 18 70 8 Q82 -5 85 -22 Q88 -42 78 -55 Q68 -66 52 -68 Q38 -66 30 -55 Q22 -44 20 -28 Q18 -14 22 -2 Q26 8 34 14 Q42 18 48 12 Z"
          fill={`url(#${elephG})`}
          stroke="#3D2210"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M48 12 Q55 22 60 35 Q66 48 68 62" stroke="#3D2210" strokeWidth="2" fill="none" />
        <path d="M60 35 Q68 50 72 68 Q74 82 68 92 Q62 100 54 96 Q48 90 50 80 Q52 70 56 60 Q60 50 60 35 Z" fill={`url(#${elephG})`} stroke="#3D2210" strokeWidth="2" strokeLinejoin="round" />
        <path d="M58 30 Q68 40 66 55 Q64 60 60 54 Q56 46 58 30 Z" fill="#F5F0E6" stroke="#3D2210" strokeWidth="1.2" strokeLinejoin="round" />
        <ellipse cx="58" cy="-16" rx="5" ry="6.5" fill="#140A04" />
        <ellipse cx="59.5" cy="-17.5" rx="2" ry="3" fill="#FFFFFF" opacity="0.75" />
      </g>
    </>
  );

  return (
    <svg
      viewBox="0 0 350 350"
      className={cn("block", className)}
      role="img"
      aria-label="connectPlus emblem"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={skyG} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9D4E2F" />
          <stop offset="35%" stopColor="#C87040" />
          <stop offset="65%" stopColor="#E89B53" />
          <stop offset="100%" stopColor="#FCD88C" />
        </linearGradient>
        <linearGradient id={elephG} x1="0.4" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#C47A48" />
          <stop offset="50%" stopColor="#B75D35" />
          <stop offset="100%" stopColor="#9D4E2F" />
        </linearGradient>
        <radialGradient id={earG} cx="0.55" cy="0.45" r="0.55">
          <stop offset="0%" stopColor="#D09050" />
          <stop offset="100%" stopColor="#B06038" />
        </radialGradient>
        <radialGradient id={sunG} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFFDE8" />
          <stop offset="70%" stopColor="#FFF5CC" />
          <stop offset="100%" stopColor="#FCD88C" />
        </radialGradient>
        <linearGradient id={hillFar} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7A4020" />
          <stop offset="100%" stopColor="#5C2E14" />
        </linearGradient>
        <linearGradient id={hillNear} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4C2815" />
          <stop offset="100%" stopColor="#3A1A0A" />
        </linearGradient>
        <radialGradient id={nodeG} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#E8A558" />
          <stop offset="100%" stopColor="#C87040" />
        </radialGradient>
        <clipPath id={clip}>
          <circle cx="175" cy="175" r="175" />
        </clipPath>
      </defs>

      {/* Optional plate around the roundel */}
      {plate && <rect x="3" y="3" width="344" height="344" rx="72" fill="#F5F0E6" />}

      <g clipPath={`url(#${clip})`} transform="translate(-185 -40)">
        {emblem}
      </g>
      <circle cx="175" cy="175" r="172" fill="none" stroke="#3D5266" strokeWidth="6" />
    </svg>
  );
}
