"use client";

import type { Step } from "./next-steps";

// Forms announce "here is what to suggest next" on this tiny bus. A host in the page layout listens and shows
// the dialog, so the dialog survives even when the form that triggered it is replaced as the page refreshes.
type Listener = (s: Step) => void;
const listeners = new Set<Listener>();

export const emitNext = (s: Step) => listeners.forEach((l) => l(s));
export function onNext(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
