import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="on-stage stage-sky">
      <div className="mx-auto max-w-[90rem] px-4 pt-12 pb-24 sm:px-6 lg:px-8">
        <h1 className="text-[2.5rem] sm:text-5xl">This page is not here</h1>
        <p className="mt-4 max-w-[56ch] text-lg text-on-stage-2">
          The address may be mistyped, or the page may have moved. Regions open inside the workspace, so a link to one
          looks like /explore?region=named-sahel.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href="/explore" className="rounded-ctl bg-action px-6 py-3 text-lg font-semibold text-on-action hover:bg-action-hover">
            Open the globe
          </Link>
          <Link href="/" className="text-on-stage underline underline-offset-4">Home</Link>
        </div>
      </div>
    </div>
  );
}
