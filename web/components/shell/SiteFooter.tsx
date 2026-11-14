import Link from "next/link";
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper text-ink-2">
      <div className="mx-auto max-w-[90rem] space-y-1 px-4 py-6 text-sm sm:px-6 lg:px-8">
        <p>
          Aqua Trend · Earth System Trend Detective.{" "}
          <Link href="/data" className="text-link underline underline-offset-2">
            Data, sources and credits
          </Link>
        </p>
        <p>A NASA Space Apps Challenge project built with AI assistance.</p>
      </div>
    </footer>
  );
}
