import Link from "next/link";

export const metadata = { title: "UI directions" };

// Index of alternative UI-style directions. Each concept is a self-contained route that re-skins the same
// real data and components (useExploreState, CrystalBall, GlobeCanvas, TrendPanel, LeadsPanel).
const CONCEPTS = [
  { href: "/explore", name: "Terrarium (current)", note: "Calm sky stage, the glass ball as centrepiece, quiet research furniture around it." },
  { href: "/concepts/journal", name: "Field journal", note: "An illustrated science notebook: the ball as a figure, numbers as annotated margin notes, reading flow." },
];

export default function ConceptsPage() {
  return (
    <main id="main" className="stage-sky min-h-[calc(100dvh-3.75rem)] px-4 py-12 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl">UI directions</h1>
        <p className="mt-3 max-w-prose text-on-stage-2">
          Four directions for the whole interface, each built on the same real GLDAS data and the same crystal ball.
          Open one, then pick a region inside it.
        </p>
        <ul className="mt-8 grid gap-3">
          {CONCEPTS.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="block rounded-card bg-paper p-5 text-ink shadow-card hover:bg-well">
                <span className="font-display text-xl">{c.name}</span>
                <span className="mt-1 block text-ink-2">{c.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
