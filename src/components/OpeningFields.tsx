import { DOC_TYPES } from "@/lib/stages";

type V = {
  title?: string; country?: string; quantity?: number; salary?: string; category?: string;
  required_doc_types?: string[]; min_age?: number | null; max_age?: number | null; gender?: string; min_experience_years?: number | null; other_requirements?: string[];
};

const ASKED = DOC_TYPES.filter((t) => !["Contract", "Visa", "Other"].includes(t));

/** The fields of an opening: what the company needs, and what a recruit must meet to be put forward. */
export function OpeningFields({ v = {}, newOne = false }: { v?: V; newOne?: boolean }) {
  const docs = v.required_doc_types ?? (newOne ? ["Passport", "Police clearance", "Medical report"] : []);
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="title">Role</label><input id="title" name="title" required defaultValue={v.title ?? ""} className="input" placeholder="Registered nurse" /></div>
        <div><label className="label" htmlFor="country">Country</label><input id="country" name="country" required defaultValue={v.country ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="quantity">How many workers</label><input id="quantity" name="quantity" type="number" min={1} defaultValue={v.quantity ?? 1} required className="input" /></div>
        <div><label className="label" htmlFor="salary">Salary (optional)</label><input id="salary" name="salary" defaultValue={v.salary ?? ""} placeholder="AED 1,300 / month" className="input" /></div>
      </div>

      <fieldset className="grid gap-3 mt-1 pt-3 border-t border-[var(--line)]">
        <legend className="h2">What a recruit must meet</legend>
        <div>
          <div className="label">Documents they must have, checked</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {ASKED.map((t) => (
              <label key={t} className="flex items-center gap-2"><input type="checkbox" name="req_docs" value={t} defaultChecked={docs.includes(t)} />{t}</label>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <div><label className="label" htmlFor="min_age">Youngest age</label><input id="min_age" name="min_age" type="number" min={0} max={80} defaultValue={v.min_age ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="max_age">Oldest age</label><input id="max_age" name="max_age" type="number" min={0} max={80} defaultValue={v.max_age ?? ""} className="input" /></div>
          <div>
            <label className="label" htmlFor="gender">Gender</label>
            <select id="gender" name="gender" defaultValue={v.gender ?? ""} className="select"><option value="">Anyone</option><option>Female</option><option>Male</option></select>
          </div>
          <div><label className="label" htmlFor="min_experience_years">Years of experience</label><input id="min_experience_years" name="min_experience_years" type="number" min={0} max={60} defaultValue={v.min_experience_years ?? ""} className="input" /></div>
        </div>
        <div>
          <label className="label" htmlFor="other_requirements">Anything else, one per line</label>
          <textarea id="other_requirements" name="other_requirements" rows={3} defaultValue={(v.other_requirements ?? []).join("\n")} className="textarea" placeholder={"Nursing licence\nCan lift 20 kg\nSpeaks basic English"} />
          <p className="muted text-xs mt-1">You tick these by hand on each recruit&apos;s page once you have checked them.</p>
        </div>
      </fieldset>
    </>
  );
}
