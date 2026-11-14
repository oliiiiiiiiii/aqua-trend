import type { KeyboardEvent } from "react";

/** Left/Right = one month, Shift+Left/Right = one year, Home/End = first/last month. Returns true when handled. */
export function scrubKey(e: KeyboardEvent, index: number, n: number, set: (i: number) => void): boolean {
  let next = index;
  if (e.key === "ArrowLeft") next = index - (e.shiftKey ? 12 : 1);
  else if (e.key === "ArrowRight") next = index + (e.shiftKey ? 12 : 1);
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = n - 1;
  else return false;
  e.preventDefault();
  set(Math.min(n - 1, Math.max(0, next)));
  return true;
}
