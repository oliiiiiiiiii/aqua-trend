"use client";
// Job progress and end states (spec §10; acceptance §8): eight named stages, completed / total, cancel, and
// readable partial / failed / cancelled / unreachable states with a retry that keeps every field.
import { API_BASE, type ResearchApiError } from "@/lib/research/api";
import { JOB_STATUS_LABEL, STAGE_LABEL } from "@/lib/research/format";
import { STAGES, type ResearchJob } from "@/lib/research/types";
import type { RunPhase } from "./useResearch";
import { btnPrimary, btnQuiet, Card, Notice } from "./ui";

const ERROR_TITLE: Record<string, string> = {
  backend_unreachable: "The analysis service cannot be reached",
  selector_unavailable: "The variable selector is not available",
  selector_invalid_output: "The variable selector returned an unusable answer",
  invalid_period: "The period is not valid",
  unknown_region: "That region is not in the catalogue",
  invalid_context: "The link to an earlier result or preset does not fit these conditions",
  empty_query: "The phenomenon text is empty",
  invalid_request: "The request was not accepted",
  not_found: "That research is no longer stored",
  data_release_invalid: "The data release on the server is not valid",
  internal_error: "The analysis service hit an error",
};

const ERROR_HELP: Record<string, string> = {
  backend_unreachable: `Check that the backend is running at ${API_BASE}. No example numbers are shown in its place.`,
  selector_unavailable: "No language model is configured or reachable, and there is no saved plan for this text. Nothing was substituted for it.",
  selector_invalid_output: "The answer named variables or recipes that are not in the catalogue, so it was rejected and nothing was analysed.",
  not_found: "Results are kept by the running service. Start the research again to recompute it.",
  invalid_context: "A user-chosen field is never overwritten by a preset. You can start again without the link.",
};

export function ProgressPanel({
  phase,
  job,
  error,
  cancelling,
  onCancel,
  onRetry,
  onRetryWithoutContext,
}: {
  phase: RunPhase;
  job: ResearchJob | null;
  error: ResearchApiError | null;
  cancelling: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onRetryWithoutContext: () => void;
}) {
  if (phase === "idle") return null;

  if (phase === "error" && error) {
    return (
      <Card aria-labelledby="progress-h" data-testid="run-error" data-code={error.code}>
        <div role="alert">
          <h2 id="progress-h" className="text-2xl">{ERROR_TITLE[error.code] ?? "The research could not be completed"}</h2>
          <p className="mt-2 max-w-[72ch] text-ink-2">{error.message}</p>
          {ERROR_HELP[error.code] && <p className="mt-1 max-w-[72ch] text-ink-2">{ERROR_HELP[error.code]}</p>}
          <p className="mt-1 text-sm text-ink-3">
            Your phenomenon text, region and period are still in the form. Error code <code>{error.code}</code>
            {error.status ? `, HTTP ${error.status}` : ""}.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {(error.retryable || error.code === "not_found") && (
            <button type="button" className={btnPrimary} onClick={onRetry} data-testid="retry">
              {error.code === "not_found" ? "Run it again" : "Try again"}
            </button>
          )}
          {error.code === "invalid_context" && (
            <button type="button" className={btnPrimary} onClick={onRetryWithoutContext}>Start again without the link</button>
          )}
          {!error.retryable && error.code !== "not_found" && error.code !== "invalid_context" && (
            <p className="text-sm text-ink-2">Change the marked field above and press “Start exploring”.</p>
          )}
        </div>
      </Card>
    );
  }

  const status = job?.status ?? "queued";
  const stageIndex = job ? STAGES.indexOf(job.stage) : -1;
  const running = phase === "submitting" || phase === "running";
  const finished = status === "complete" || status === "partial";
  const total = job?.progress?.total ?? 0;
  const completed = job?.progress?.completed ?? 0;

  return (
    <Card aria-labelledby="progress-h" data-testid="progress" data-status={status} data-stage={job?.stage ?? ""}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="progress-h" className="text-2xl">
            {phase === "submitting" ? "Sending the request" : running ? "Analysis in progress" : `Analysis: ${JOB_STATUS_LABEL[status].toLowerCase()}`}
          </h2>
          <p className="mt-1 text-ink-2" role="status" aria-live="polite">
            {phase === "submitting"
              ? "Waiting for the analysis service to accept the request."
              : running
                ? <>Stage {Math.max(1, stageIndex + 1)} of {STAGES.length}: {job ? STAGE_LABEL[job.stage] : "queued"}{total > 0 ? <span className="tnum">, {completed} of {total} done</span> : null}{job?.stage_detail ? `. ${job.stage_detail}` : ""}</>
                : status === "complete"
                  ? "All stages finished."
                  : status === "partial"
                    ? "Finished with gaps: some items could not be analysed. They are listed below with the reason; the other results are valid."
                    : status === "cancelled"
                      ? "Cancelled. No final corrected result was published for it. Your inputs are unchanged."
                      : "The analysis stopped with an error."}
          </p>
        </div>
        {running && (
          <button type="button" className={btnQuiet} onClick={onCancel} disabled={cancelling} data-testid="cancel">
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      {running && total > 0 && (
        <progress className="mt-3 h-2 w-full max-w-md" value={completed} max={total} aria-label={`${STAGE_LABEL[job!.stage]}: ${completed} of ${total}`} />
      )}

      {(running || status === "failed" || status === "cancelled") && (
        <ol className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Stages">
          {STAGES.map((s, i) => {
            const state = finished || i < stageIndex ? "done" : i === stageIndex ? (running ? "now" : "stopped") : "todo";
            return (
              <li key={s} data-state={state} className={`flex items-baseline gap-2 ${state === "todo" ? "text-ink-3" : "text-ink"}`}>
                <span aria-hidden="true" className="w-4 shrink-0 text-center">{state === "done" ? "✓" : state === "now" ? "▶" : state === "stopped" ? "■" : "○"}</span>
                <span>
                  <span className={state === "now" ? "font-semibold" : ""}>{i + 1}. {STAGE_LABEL[s]}</span>
                  <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (in progress)" : state === "stopped" ? " (stopped here)" : " (not started)"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {status === "failed" && (
        <div className="mt-4">
          <Notice tone="error" role="alert">
            <span className="font-semibold text-ink">{job?.error ? ERROR_TITLE[job.error.code] ?? "The analysis failed" : "The analysis failed"}.</span>{" "}
            {job?.error?.message ?? "The service gave no message."}
            {job?.error && ERROR_HELP[job.error.code] ? ` ${ERROR_HELP[job.error.code]}` : ""}
            {job?.error ? <> Error code <code>{job.error.code}</code>.</> : null}
          </Notice>
          <p className="mt-2 text-sm text-ink-3">Your phenomenon text, region and period are still in the form.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={btnPrimary} onClick={onRetry} data-testid="retry">
              {job?.error?.retryable ? "Try again" : "Run again with these inputs"}
            </button>
            {job?.error?.code === "invalid_context" && (
              <button type="button" className={btnQuiet} onClick={onRetryWithoutContext}>Start again without the link</button>
            )}
          </div>
        </div>
      )}
      {status === "cancelled" && (
        <div className="mt-4">
          <button type="button" className={btnPrimary} onClick={onRetry} data-testid="retry">Start it again</button>
        </div>
      )}
    </Card>
  );
}
