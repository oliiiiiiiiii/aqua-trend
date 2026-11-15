import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBanner } from "@/components/explore/DemoBanner";
import ExploreApp from "@/components/explore/ExploreApp";

export const metadata: Metadata = {
  title: "GLDAS demo",
  description: "The earlier GLDAS demo: choose a region and up to three water targets and replay the monthly history. Its leads are synthetic examples and its trends use its own method and period.",
};

export default function ExplorePage() {
  return (
    <>
    <DemoBanner />
    <Suspense
      fallback={
        <div className="on-stage stage-sky min-h-[70dvh]">
          <p role="status" className="mx-auto max-w-[90rem] px-4 py-8 text-on-stage-2 sm:px-6 lg:px-8">
            Loading the workspace…
          </p>
        </div>
      }
    >
      <ExploreApp />
    </Suspense>
    </>
  );
}
