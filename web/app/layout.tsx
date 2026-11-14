import type { Metadata, Viewport } from "next";
import { Figtree, Fredoka } from "next/font/google";
import { PlaneCursor } from "@/components/shell/PlaneCursor";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import "./globals.css";

const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { template: "%s | Aqua Trend", default: "Aqua Trend" },
  description:
    "Pick a region on a 3D planet, choose up to three water-cycle targets, and read real NASA GLDAS trend evidence beside a data-driven crystal ball. A NASA Space Apps 2026 demo.",
  icons: { icon: { url: `${BASE}/icon.svg`, type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Applied before first paint: the saved look, else the OS light/dark preference, so nothing flashes.
const THEME_SCRIPT = `(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem("aqua-trend-theme")}catch(e){}if(t!=="terrarium"&&t!=="night")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"night":"terrarium";d.setAttribute("data-theme",t)})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="terrarium"
      suppressHydrationWarning
      className={`${fredoka.variable} ${figtree.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-paper text-ink">
        <a
          href="#main"
          className="sr-only z-50 rounded-ctl bg-action px-4 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <SiteFooter />
        <PlaneCursor />
      </body>
    </html>
  );
}
