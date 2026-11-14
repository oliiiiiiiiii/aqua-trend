import type { Metadata } from "next";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/source-sans-3";
import { Suspense } from "react";
import JournalApp from "@/components/concepts/journal/JournalApp";
import "./concept.css";

export const metadata: Metadata = {
  title: "Field journal",
  description: "A UI direction: the crystal ball as a figure in a naturalist's notebook, with the numbers as margin notes.",
};

export default function JournalPage() {
  return (
    <div className="journal" data-concept="journal">
      <Suspense
        fallback={
          <p role="status" className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6 lg:px-8">
            Opening the journal…
          </p>
        }
      >
        <JournalApp />
      </Suspense>
    </div>
  );
}
