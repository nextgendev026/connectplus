"use client";

import { createContext, useContext, useCallback } from "react";

interface ThemeContextType {
  theme: "dark" | "light";
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined
);

const noop = () => {};

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    return { theme: "dark", toggleTheme: noop };
  }
  return context;
}
