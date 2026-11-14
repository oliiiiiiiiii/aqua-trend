"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorDetail, researchApi, type Job, type ResearchError, type ResearchRequest } from "@/lib/research";

const terminal = new Set(["complete", "completed", "partial", "failed", "cancelled"]);
export type Operation = { request: ResearchRequest } | { id: string };

export function useResearchJob() {
  const active = useRef<AbortController | null>(null);
  const liveJob = useRef<{ id: string; owned: boolean } | null>(null);
  const operation = useRef<Operation | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResearchError | null>(null);

  const stopTracking = useCallback((cancelOwned: boolean) => {
    active.current?.abort();
    active.current = null;
    const live = liveJob.current;
    liveJob.current = null;
    if (cancelOwned && live?.owned) {
      void researchApi("/api/research/" + encodeURIComponent(live.id), { method: "DELETE" }).catch(() => {});
    }
  }, []);

  const discard = useCallback(() => {
    stopTracking(true);
    operation.current = null;
    setBusy(false);
    setJob(null);
    setError(null);
  }, [stopTracking]);

  const start = useCallback(
    async (next: Operation) => {
      stopTracking(true);
      const controller = new AbortController();
      active.current = controller;
      const { signal } = controller;
      operation.current = next;
      setJob(null);
      setError(null);
      setBusy(true);
      try {
        let knownId: string;
        if ("request" in next) {
          // Let creation return its ID even if the form changes, so the obsolete job can be cancelled.
          const created = await researchApi<Job>("/api/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next.request),
          });
          knownId = created.id;
          if (signal.aborted) {
            if (knownId)
              void researchApi("/api/research/" + encodeURIComponent(knownId), { method: "DELETE" }).catch(
                () => {},
              );
            return;
          }
          if (!knownId) throw new Error("The research service did not return a study ID.");
          setJob(created);
        } else {
          knownId = next.id;
        }
        liveJob.current = { id: knownId, owned: "request" in next };
        const path = "/api/research/" + encodeURIComponent(knownId);
        while (!signal.aborted) {
          const row = await researchApi<Job>(path, { signal });
          if (signal.aborted) return;
          if (row.id !== knownId) throw new Error("The response belongs to a different study.");
          setJob(row);
          if (terminal.has(row.status)) {
            if (row.error) {
              setError(row.error);
              if (row.request) operation.current = { request: row.request };
            }
            liveJob.current = null;
            break;
          }
          await new Promise<void>((resolve) => {
            function wake() {
              clearTimeout(timer);
              signal.removeEventListener("abort", wake);
              resolve();
            }
            const timer = window.setTimeout(wake, 600);
            signal.addEventListener("abort", wake, { once: true });
          });
        }
      } catch (cause) {
        if (!signal.aborted) setError(errorDetail(cause));
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    },
    [stopTracking],
  );

  const cancel = useCallback(async () => {
    const live = liveJob.current;
    if (!live) {
      discard();
      setJob({ id: "", status: "cancelled", stage: "cancelled" });
      return;
    }
    stopTracking(false);
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const response = await researchApi<Job>("/api/research/" + encodeURIComponent(live.id), {
        method: "DELETE",
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setJob(response);
        setError(response.error ?? null);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorDetail(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [discard, stopTracking]);

  const retry = () => {
    if (liveJob.current && error) {
      const id = liveJob.current.id;
      stopTracking(false);
      void start({ id });
    } else if (operation.current) void start(operation.current);
  };
  useEffect(() => () => stopTracking(false), [stopTracking]);
  return { job, busy, error, start, retry, discard, cancel };
}
