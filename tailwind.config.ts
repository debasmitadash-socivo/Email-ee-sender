import type { Config } from "tailwindcss";
import { brand } from "./brand.config";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: brand.bg,
        surface: brand.surface,
        border: brand.border,
        ink: brand.text,
        muted: brand.muted,
        primary: brand.primary,
        secondary: brand.secondary,
        warn: brand.warn,
        success: brand.success,
        danger: brand.danger,
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
