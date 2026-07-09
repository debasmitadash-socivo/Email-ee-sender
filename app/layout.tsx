import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Socivo Outreach Engine",
  description: "Internal cold-email platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
