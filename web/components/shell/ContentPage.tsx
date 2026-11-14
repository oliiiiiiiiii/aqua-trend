import type { ReactNode } from "react";

/** Shared frame for the text pages: a short stage band with the title, then paper. */
export function ContentPage({ title, lede, children }: { title: string; lede: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="on-stage stage-sky">
        <div className="mx-auto max-w-[90rem] px-4 pt-8 pb-12 sm:px-6 lg:px-8 lg:pt-12 lg:pb-16">
          <h1 className="text-[2.5rem] sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-[62ch] text-lg text-on-stage-2">{lede}</p>
        </div>
      </div>
      <div className="mx-auto max-w-[90rem] px-4 py-12 sm:px-6 lg:px-8">{children}</div>
    </>
  );
}

/** A section with a heading in the left margin on wide screens. */
export function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="grid scroll-mt-6 gap-x-12 gap-y-4 border-t border-line py-10 first:border-t-0 first:pt-0 lg:grid-cols-[16rem_minmax(0,1fr)]"
    >
      <h2 id={`${id}-h`} className="text-2xl lg:text-[1.625rem]">{title}</h2>
      <div className="min-w-0 space-y-4 text-ink-2 [&_p]:max-w-[68ch] [&_li]:max-w-[68ch]">{children}</div>
    </section>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-link underline underline-offset-2" rel="noreferrer">
      {children}
    </a>
  );
}
