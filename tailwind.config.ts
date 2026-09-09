import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          // Bright orange #FF6B00 — the single accent colour, used exclusively
          // for high-priority actions (CTA buttons), notifications and active
          // states. Never paints large surfaces in light mode.
        50: "#fff6ef",
        100: "#ffead9",
        200: "#ffd1ab",
        300: "#ffb273",
        400: "#ff8f3a",
        500: "#ff6b00",
        600: "#e05f00",
        700: "#b84e00",
        800: "#8f3d00",
        900: "#6e2f00",
        950: "#3d1a00",
        },
        surface: {
          50: "rgb(var(--surface-50) / <alpha-value>)",
          100: "rgb(var(--surface-100) / <alpha-value>)",
          200: "rgb(var(--surface-200) / <alpha-value>)",
          300: "rgb(var(--surface-300) / <alpha-value>)",
          400: "rgb(var(--surface-400) / <alpha-value>)",
          500: "rgb(var(--surface-500) / <alpha-value>)",
          600: "rgb(var(--surface-600) / <alpha-value>)",
          700: "rgb(var(--surface-700) / <alpha-value>)",
          800: "rgb(var(--surface-800) / <alpha-value>)",
          850: "rgb(var(--surface-850) / <alpha-value>)",
          900: "rgb(var(--surface-900) / <alpha-value>)",
          950: "rgb(var(--surface-950) / <alpha-value>)",
        },
        accent: {
          coral: "#ff6b6b",
          amber: "#ffb36b",
          cyan: "#22d3ee",
          violet: "#a78bfa",
        },
        savanna: {
          // Silicon Savanna identity — sunset, clay, acacia, paper, night.
          sun: "#FFD75E",
          marigold: "#F59E0B",
          ember: "#C2410C",
          clay: "#9A3412",
          bark: "#3E2E20",
          acacia: "#4D7C0F",
          paper: "#F6EFE2",
          cream: "#FFFBF2",
          night: "#14100D",
        },
        amber: {
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
        },
        emerald: {
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
        },
        cyan: {
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
        },
        red: {
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          800: "#991b1b",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        // Editorial display voice — a warm local serif for headlines (system
        // stack, zero downloads), Inter for UI/body. BuzzFeed warmth meets
        // broadsheet craft.
        display: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Georgia", "serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "mesh-gradient":
          "radial-gradient(at 40% 20%, rgba(255,107,0,0.07) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(255,138,51,0.05) 0px, transparent 50%), radial-gradient(at 0% 50%, rgba(255,107,0,0.04) 0px, transparent 50%), radial-gradient(at 60% 80%, rgba(176,66,0,0.04) 0px, transparent 55%)",
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-in-out",
        "slide-up": "slideUp 0.5s ease-out",
        "slide-down": "slideDown 0.3s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        equalizer: "equalizer 0.8s ease-in-out infinite alternate",
        marquee: "marquee 12s linear infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(20px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideDown: { "0%": { opacity: "0", transform: "translateY(-10px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        scaleIn: { "0%": { opacity: "0", transform: "scale(0.95)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        pulseGlow: { "0%, 100%": { boxShadow: "0 0 5px rgba(255,107,0,0.2)" }, "50%": { boxShadow: "0 0 20px rgba(255,107,0,0.4)" } },
        float: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        equalizer: { "0%": { height: "4px" }, "100%": { height: "16px" } },
        marquee: { "0%": { transform: "translateX(100%)" }, "100%": { transform: "translateX(-100%)" } },
      },
      boxShadow: {
        glow: "0 0 15px rgba(255,107,0,0.15)",
        "glow-lg": "0 0 30px rgba(255,107,0,0.2)",
        card: "0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.2)",
        "card-hover": "0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -4px rgba(0,0,0,0.3)",
      },
    },
  },
  plugins: [],
};
export default config;

