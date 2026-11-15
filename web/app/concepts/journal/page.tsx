import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { Suspense } from "react";
import JournalApp from "@/components/concepts/journal/JournalApp";
import "./concept.css";

const display = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], style: ["normal", "italic"], variable: "--font-j-display", display: "swap" });
const text = Source_Sans_3({ subsets: ["latin"], variable: "--font-j-text", display: "swap" });

export const metadata: Metadata = {
  title: "Field journal",
  description: "A UI direction: the crystal ball as a figure in a naturalist's notebook, with the numbers as margin notes.",
};

export default function JournalPage() {
  return (
    <div className={`journal ${display.variable} ${text.variable}`} data-concept="journal">
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
