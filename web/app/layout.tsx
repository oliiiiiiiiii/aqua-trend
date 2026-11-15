import type { Metadata, Viewport } from "next";
import {
  Archivo,
  Barlow,
  Barlow_Condensed,
  Figtree,
  Fredoka,
  Inter,
  Literata,
  Public_Sans,
} from "next/font/google";
import { PlaneCursor } from "@/components/shell/PlaneCursor";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import "./globals.css";
import "./looks.css";

const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

// Fonts for the looks (see looks.css). Atlas is the default look, so its faces (Literata, Public Sans) are preloaded;
// the others use preload:false and are only downloaded once a look that uses them is active.
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], display: "swap", preload: false, weight: "600", variable: "--font-barlow-condensed" });
const barlow = Barlow({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "600"], variable: "--font-barlow" });
const archivo = Archivo({ subsets: ["latin"], display: "swap", preload: false, axes: ["wdth"], variable: "--font-archivo" });
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const literata = Literata({ subsets: ["latin"], display: "swap", variable: "--font-literata" });
const publicSans = Public_Sans({ subsets: ["latin"], display: "swap", variable: "--font-public-sans" });
const FONT_VARS = [barlowCondensed, barlow, archivo, inter, literata, publicSans].map((f) => f.variable).join(" ");

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { template: "%s | Aqua Trend", default: "Aqua Trend" },
  description:
    "Name a known extreme event and a river basin; Aqua Trend removes the seasonal cycle and trend from NASA and NOAA monthly records and shows which variables were unusual before, during and after it. A NASA Space Apps 2026 entry.",
  icons: { icon: { url: `${BASE}/icon.svg`, type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Applied before first paint, so nothing flashes: the saved theme (else the OS light/dark preference), and the visual
// look (?look=<id> wins and is saved, else the saved one, else atlas).
const THEME_SCRIPT = `(function(){var d=document.documentElement,t=null,l=null,L=["terrarium","strip","console","atlas"];try{t=localStorage.getItem("aqua-trend-theme")}catch(e){}if(t!=="terrarium"&&t!=="night")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"night":"terrarium";d.setAttribute("data-theme",t);try{var q=new URLSearchParams(location.search).get("look");if(L.indexOf(q)>=0){l=q;try{localStorage.setItem("aqua-trend-look",q)}catch(e){}}else{l=localStorage.getItem("aqua-trend-look")}}catch(e){}if(L.indexOf(l)<0)l="atlas";d.setAttribute("data-look",l);try{if(localStorage.getItem("aqua-trend-a11y")==="on")d.dataset.a11y="on"}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="terrarium"
      data-look="atlas"
      suppressHydrationWarning
      className={`${fredoka.variable} ${figtree.variable} ${FONT_VARS}`}
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
