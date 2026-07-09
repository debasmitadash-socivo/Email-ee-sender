// Socivo design tokens — white-max is a hard rule.
// Page and card backgrounds are pure white; separation via 1px `border` and
// whitespace. Colour must cover well under 10% of any screen. `primary` is
// reserved for primary buttons, active nav and focus rings ONLY.
export const brand = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  border: "#ECECF1",
  text: "#07070D",
  muted: "#6B6B76",
  primary: "#B56FDC", // Socivo purple — primary buttons, active nav, focus rings ONLY
  secondary: "#224AA8", // deep blue — chart series 2, subtle links
  warn: "#F59E0B",
  success: "#22C55E",
  danger: "#EF4444",
} as const;

export type Brand = typeof brand;
