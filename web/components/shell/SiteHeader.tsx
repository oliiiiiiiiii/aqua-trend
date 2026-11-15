"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./Mark";
import { ThemeSwitcher } from "./ThemeSwitcher";

// Research is the primary entry (spec §9). /explore is the earlier GLDAS demo and says so in its label.
const NAV = [
  { href: "/research", label: "Research" },
  { href: "/explore", label: "GLDAS demo" },
  { href: "/data", label: "Data" },
  { href: "/methods", label: "Methods" },
];

export function SiteHeader() {
  const raw = usePathname() ?? "/";
  const path = raw.length > 1 ? raw.replace(/\/$/, "") : raw;
  return (
    <header className="on-stage bg-stage text-on-stage">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 rounded-ctl font-display text-xl" aria-label="Aqua Trend, home">
          <Mark className="h-8 w-8" />
          <span>Aqua Trend</span>
        </Link>
        <nav aria-label="Main" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex gap-1">
            {NAV.map((n) => {
              const current = path === n.href || path.startsWith(`${n.href}/`);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={current ? "page" : undefined}
                    className={`block rounded-ctl px-3 py-1.5 text-[0.9375rem] ${
                      current
                        ? "bg-stage-line font-semibold text-on-stage"
                        : "text-on-stage-2 hover:text-on-stage hover:underline"
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto">
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
