import type { Metadata } from "next";
import { Suspense } from "react";
import ResearchApp from "@/components/research/ResearchApp";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Describe an Earth-system phenomenon, choose one region and an optional period, and read trend rates, uncertainty, corrected significance and standard indicators computed from prepared data.",
};

// A static page: everything dynamic happens in the client component, which talks to the analysis backend.
export default function ResearchPage() {
  return (
    <Suspense
      fallback={
        <div className="on-stage stage-sky min-h-[70dvh]">
          <p role="status" className="mx-auto max-w-[90rem] px-4 py-8 text-on-stage-2 sm:px-6 lg:px-8">Loading the research page…</p>
        </div>
      }
    >
      <ResearchApp />
    </Suspense>
  );
}
