import { flushSync } from "react-dom";

interface VT {
  ready?: Promise<void>;
  finished: Promise<void>;
}
type VTDocument = Document & { startViewTransition?: (cb: () => void) => VT };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The browser may skip a transition (window resized, tab hidden, scrollbar appeared). The page update still runs,
 * but `ready` and `finished` then reject, which would surface as an uncaught error. Skipping an animation is
 * harmless, so those two are handled; an error inside the update itself is not swallowed.
 */
function harmless(t: VT): VT {
  t.ready?.catch(() => undefined);
  t.finished.catch(() => undefined);
  return t;
}

/** Run a DOM-changing update inside a View Transition when the browser supports it. */
export function transition(update: () => void) {
  const d = document as VTDocument;
  if (!d.startViewTransition || reduced()) {
    update();
    return;
  }
  harmless(d.startViewTransition(() => flushSync(update)));
}

/** Morph an element (e.g. a gallery tile's illustration) into the word card. */
export function morphFrom(el: HTMLElement | null | undefined, update: () => void) {
  const d = document as VTDocument;
  if (!el || !d.startViewTransition || reduced()) {
    update();
    return;
  }
  el.style.viewTransitionName = "word-art";
  const t = harmless(
    d.startViewTransition(() => {
      el.style.viewTransitionName = "";
      flushSync(update);
    }),
  );
  const clear = () => {
    el.style.viewTransitionName = "";
  };
  t.finished.then(clear, clear);
}
