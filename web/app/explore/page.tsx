import type { Metadata } from "next";
import { Suspense } from "react";
import ResearchWorkspace from "@/components/research/ResearchWorkspace";

export const metadata: Metadata = {
  title: "Earth System Trend Detective",
  description: "Investigate an Earth-system phenomenon with regional time series, fixed historical references and adjusted trend evidence.",
};

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="on-stage stage-sky min-h-[70dvh]">
          <p role="status" className="mx-auto max-w-[90rem] px-4 py-8 text-on-stage-2 sm:px-6 lg:px-8">
            Loading the workspace…
          </p>
        </div>
      }
    >
      <ResearchWorkspace />
    </Suspense>
  );
}
