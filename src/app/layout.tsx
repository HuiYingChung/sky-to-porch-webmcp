import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/ui/theme";
import { QueryProvider } from "@/components/query/query-provider";
import { ThemeProvider } from "@/components/theme/theme-selector";

export const metadata: Metadata = {
  title: "Sky to Porch",
  description:
    "Satellite-data interpretation for ordinary people — what space observations mean for you at home.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Anti-flash theme script: runs synchronously before React hydrates.
          Reads localStorage('oth-theme') and applies the correct dark/light class.
          Values: 'light' → .light, 'dark' → .dark, 'system' → follows OS,
          absent → dark (dark-first first-visit default).
          dangerouslySetInnerHTML is required for a synchronous inline script.
          Content is static authored code; no user input or secrets.
        */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </head>
      <body>
        {/* Skip link — keyboard users can bypass header to the single <main> */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider>
          <QueryProvider>
            {children}
          </QueryProvider>
        </ThemeProvider>
        {/*
          Vercel Web Analytics: cookieless page-view counts, no PII, no IP
          storage. Renders nothing in dev; only sends events on Vercel
          deployments where Analytics is enabled for the project.
        */}
        <Analytics />
      </body>
    </html>
  );
}
