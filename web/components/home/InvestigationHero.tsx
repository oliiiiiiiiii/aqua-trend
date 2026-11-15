"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSharedStage } from "@/components/shell/HeroGlobe";
import { COPY } from "@/components/detective/copy/input";
import { encodeState } from "@/lib/detective/url";

/**
 * Home: centred copy and event question, the whole planet below, the solved
 * cases (`children`) right under them. The layout-owned planet and the headline are painted by the shared stage; the
 * anchors here are empty. Submitting the question hands the planet over to /detective?e=<text>.
 */
export function InvestigationHero({ children }: { children?: ReactNode }) {
  return (
    <>
      <div
        data-stage-pass
        className="mx-auto flex max-w-[90rem] flex-col items-center gap-4 px-4 pt-8 sm:px-6 lg:px-8"
      >
        <div data-stage-pass className="w-full max-w-[42rem] min-w-0 text-center">
          <div data-stage-copy data-stage-pass className="h-16 sm:h-20" />
          <EventForm />
        </div>
        <div
          data-stage-pass
          className="mx-auto w-full max-w-[min(100%,26rem)]"
        >
          <div data-stage-globe data-stage-pass className="aspect-square w-full" />
        </div>
      </div>
      {children}
    </>
  );
}

function EventForm() {
  const { start, entering } = useSharedStage();
  const id = useId();
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const empty = !text.trim();
  useEffect(() => {
    // a keyboard-and-mouse visitor can type at once; a phone would raise its keyboard over the planet
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) area.current?.focus({ preventScroll: true });
  }, []);
  const submit = () => {
    const event = text.trim();
    if (!event || entering) return;
    start(`/detective?${encodeState({ query: { event } })}`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line; Enter that confirms an IME composition (Chinese input) is left alone
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };
  return (
    <form
      className="pointer-events-auto mt-4"
      aria-label={COPY.formLabel}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <label htmlFor={`${id}-e`} className="block font-display text-xl leading-snug text-on-stage sm:text-2xl">{COPY.what.label}</label>
      <textarea
        id={`${id}-e`}
        ref={area}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={300}
        autoComplete="off"
        placeholder={COPY.what.placeholder}
        className="mt-3 min-h-28 w-full resize-y rounded-ctl border border-stage-line bg-on-stage/5 px-4 py-4 font-display text-2xl leading-snug text-on-stage placeholder:text-on-stage-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <div className="mt-3 flex justify-center">
        <button
          type="submit"
          disabled={empty || entering}
          className="inline-flex min-h-11 items-center gap-4 rounded-ctl bg-action px-5 py-2 font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
        >
          Investigate<span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  );
}
