"use client";

import { useEffect } from "react";

/**
 * Sections are collapsed until needed. When a link points at one (or at something inside one), open it and scroll
 * there, so "Add the passport" really lands on the upload form.
 */
export function OpenOnHash() {
  useEffect(() => {
    const reveal = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (!el) return;
      for (let n: Element | null = el; n; n = n.parentElement) if (n instanceof HTMLDetailsElement) n.open = true;
      el.scrollIntoView({ block: "start" });
    };
    const later = () => setTimeout(reveal, 50); // after the router has updated the address
    reveal();
    window.addEventListener("hashchange", reveal);
    document.addEventListener("click", later);
    return () => { window.removeEventListener("hashchange", reveal); document.removeEventListener("click", later); };
  }, []);
  return null;
}
