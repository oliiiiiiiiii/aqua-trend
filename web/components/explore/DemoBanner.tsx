import Link from "next/link";

/**
 * Labels /explore as the earlier GLDAS demo (spec §11): its leads are synthetic examples, and its trend numbers
 * use its own method, period and (absent) correction, so they must not be read as results of the Research page.
 */
export function DemoBanner() {
  return (
    <aside aria-label="About this page" className="border-b border-line bg-synthetic-bg text-synthetic">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-6 lg:px-8">
        <p className="font-semibold">Earlier GLDAS demo, kept for reference.</p>
        <p className="min-w-0 flex-1 basis-[28rem]">
          The leads on this page are synthetic examples, not research results or recorded events. Its trend numbers come from
          this demo’s own method (annual means, 2000 to 2025, one GLDAS product, no multiple-comparison correction) and do not
          carry over to a research query.
        </p>
        <Link href="/research" className="font-semibold underline underline-offset-2">Go to Research</Link>
      </div>
    </aside>
  );
}
