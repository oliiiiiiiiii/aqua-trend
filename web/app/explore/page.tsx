import type { Metadata } from "next";
import { Suspense } from "react";
import ExploreApp from "@/components/explore/ExploreApp";

export const metadata: Metadata = {
  title: "Explore",
  description: "Choose a region and up to three water targets, replay the monthly history and read the trend evidence.",
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
      <ExploreApp />
    </Suspense>
  );
}
