"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A thin progress bar at the top of the page, and a dimmed state on the link that was clicked, so a click always
 * answers straight away while the next page loads. It finishes when the address changes (or after a safety timeout).
 */
export function NavProgress() {
  const path = usePathname();
  const query = useSearchParams().toString();
  const here = `${path}?${query}`;
  // Busy while the address is still the one the click started from; arriving anywhere else ends it.
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const busy = startedAt === here;

  useEffect(() => {
    document.querySelectorAll("[data-pending]").forEach((el) => el.removeAttribute("data-pending"));
  }, [path, query]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest?.("a");
      if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or only a #anchor
      a.setAttribute("data-pending", "");
      setStartedAt(`${location.pathname}?${new URLSearchParams(location.search).toString()}`);
      clearTimeout(timer);
      timer = setTimeout(() => setStartedAt(null), 15000);
    };
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); clearTimeout(timer); };
  }, []);

  return <div className="navbar" data-busy={busy} role="progressbar" aria-hidden={!busy} />;
}
