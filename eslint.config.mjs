import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The React-19 compiler-era rules flag patterns that are standard in this
      // codebase: the ThemeProvider hydration mount gate, and data-fetch-on-mount
      // effects. Keep them as warnings so they surface without blocking CI here;
      // prefer careful writes during event handlers / derived render where possible.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      // The Neural Mind synthesizer intentionally routes heterogeneous payloads
      // through `data: any`. Prefer explicit types in new code.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "prisma/**",
    "public/**",
  ]),
]);