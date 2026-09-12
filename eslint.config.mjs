import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Plugins are resolved per config object for files that the Next presets do
    // not cover (e.g. .mjs/.cjs tooling), so register react-hooks here too.
    plugins: { "react-hooks": reactHooks },
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
      // Underscore-prefixed parameters (e.g. `_request` in route handlers) are
      // intentionally unused per TS convention.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Ad-hoc node tooling under scripts/ runs through node/ts-node directly and
    // leans on CommonJS `require`, which the app-facing TS rule set forbids.
    files: ["scripts/**/*.{js,cjs,mjs,ts}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
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