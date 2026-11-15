import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper text-ink-3">
      <div className="mx-auto max-w-[90rem] space-y-1 px-4 py-6 text-sm sm:px-6 lg:px-8">
        <p>
          Monthly regional data from NASA and NOAA. Each analysis identifies its data product.{" "}
          <Link href="/data" className="text-link underline underline-offset-2">Sources and credits</Link>
        </p>
        <p>
          A NASA Space Apps Challenge 2026 demo, not a NASA product. Leads in the Explore demo are synthetic examples. The site was
          built with AI assistance, as the challenge rules ask us to disclose.
        </p>
      </div>
    </footer>
  );
}
