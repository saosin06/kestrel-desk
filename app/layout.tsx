import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Shell } from "@/components/shell";
import "./globals.css";
import { Providers } from "./providers";

// Designed dark; native controls and scrollbars follow.
export const viewport: Viewport = { colorScheme: "dark", themeColor: "#141332" };

// General Sans (Indian Type Foundry, ITF Free Font License), self-hosted so the demo works offline.
const generalSans = localFont({ src: "./fonts/GeneralSans-Variable.woff2", weight: "200 700", variable: "--font-general-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Kestrel Desk", template: "%s · Kestrel Desk" },
  description: "Disbursements desk for Kestrel Aerial (simulated company)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={generalSans.variable}>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
