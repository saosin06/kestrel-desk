import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";
import { Providers } from "./providers";

// Designed light; ask browsers not to auto-darken it.
export const viewport: Viewport = { colorScheme: "only light" };

export const metadata: Metadata = {
  title: { default: "Kestrel Desk", template: "%s · Kestrel Desk" },
  description: "Disbursements desk for Kestrel Aerial (simulated company)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
