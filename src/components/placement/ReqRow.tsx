import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { GateItem } from "@/lib/pipeline";
import { ActionForm } from "@/components/ActionForm";
import { setRequirement } from "@/app/actions/placements";

/** One line of a checklist: ticked or not, what is wrong, and where to fix it (or a button to tick it by hand). */
export function ReqRow({ item: i, placementId, canEdit }: { item: GateItem; placementId: string; canEdit: boolean }) {
  return (
    <li className={`req ${i.done ? "done" : ""}`}>
      <span className="tick"><Check size={13} strokeWidth={3} /></span>
      <div className="flex-1 min-w-0">
        <div className="lbl font-semibold">{i.label}</div>
        {i.detail && <div className="muted text-xs">{i.detail}</div>}
      </div>
      {i.manual && canEdit && (
        <ActionForm action={setRequirement.bind(null, placementId, i.manual.text, !i.done)} submit={i.done ? "Undo" : "Mark as met"} buttonClass="btn btn-sm" className="inline"><></></ActionForm>
      )}
      {!i.done && !i.manual && (i.href || i.anchor) && (
        <Link className="btn btn-sm" href={i.href ?? i.anchor!}>Do this <ArrowRight size={14} /></Link>
      )}
    </li>
  );
}
