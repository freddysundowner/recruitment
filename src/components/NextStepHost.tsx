"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveNext } from "@/app/actions/next";
import type { Step } from "@/lib/next-steps";
import { onNext } from "@/lib/next-bus";
import { NextStepDialog } from "./NextStepDialog";

/**
 * Shows the "what next?" dialog after an action that redirected to a new page, which carries
 * ?next=<kind>&ref=<id> in its address. The address is cleaned up afterwards so a refresh does not repeat it.
 */
export function NextStepHost({ slug }: { slug?: string }) {
  const params = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const key = params.get("next");
  const ref = params.get("ref");
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    resolveNext(key, ref, slug).then((s) => { if (live) setStep(s); });
    return () => { live = false; };
  }, [key, ref, slug]);

  useEffect(() => onNext(setStep), []);

  if (!step) return null;
  return <NextStepDialog step={step} onClose={() => { setStep(null); if (key) router.replace(path); }} />;
}
