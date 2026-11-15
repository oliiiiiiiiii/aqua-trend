"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { StartProgress } from "@/components/detective/StartProgress";
import type { ProgressContext } from "@/components/detective/progressTimeline";

export function CaseLink({ href, context, className, children }: {
  href: string;
  context: ProgressContext;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  return (
    <>
      <Link href={href} className={className} onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        setRunning(true);
      }}>{children}</Link>
      {running && <StartProgress context={context} onCancel={() => setRunning(false)} onDone={() => {
        setRunning(false);
        router.push(href);
      }} />}
    </>
  );
}
