import type { Metadata } from "next";
import { Suspense } from "react";
import DetectiveApp from "@/components/detective/DetectiveApp";

export const metadata: Metadata = {
  title: "Trend Detective",
  description:
    "Describe an Earth event, pick when and where it happened, and see whether it stands out in NASA data once the seasonal cycle and the long-term trend are removed.",
};

export default function DetectivePage() {
  return (
    // DetectiveApp reads the URL (useSearchParams), so it renders on the client below this boundary
    <Suspense
      fallback={
        <div data-stage-through data-stage-pass className="on-stage stage-sky min-h-[70dvh]">
          <p role="status" className="mx-auto max-w-[90rem] px-4 py-8 text-on-stage-2 sm:px-6 lg:px-8">
            Loading the Trend Detective…
          </p>
        </div>
      }
    >
      <DetectiveApp />
    </Suspense>
  );
}
