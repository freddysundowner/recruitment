import type { Sql } from "./db";
import type { GateItem } from "./pipeline";

export type OpeningReqs = {
  required_doc_types: string[]; min_age: number | null; max_age: number | null; gender: string; min_experience_years: number | null; other_requirements: string[];
};
export type RecruitFacts = { dob: Date | string | null; gender: string | null; experience_years: number | null };

export function ageOn(dob: Date | string, today = new Date()): number {
  const d = new Date(dob);
  let age = today.getFullYear() - d.getFullYear();
  if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) age -= 1;
  return age;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What an opening asks that can be judged from the recruit's record, plus the free-text items that are ticked by hand. */
export function fitItems(job: OpeningReqs, c: RecruitFacts, ticks: string[], today = new Date()): GateItem[] {
  const items: GateItem[] = [];
  const { min_age: lo, max_age: hi } = job;
  if (lo !== null || hi !== null) {
    const label = lo !== null && hi !== null ? `Age ${lo} to ${hi}` : lo !== null ? `Age ${lo} or over` : `Age ${hi} or under`;
    const age = c.dob ? ageOn(c.dob, today) : null;
    const done = age !== null && (lo === null || age >= lo) && (hi === null || age <= hi);
    items.push({ key: "age", label, done, anchor: "#profile", detail: done ? undefined : age === null ? "add their date of birth" : `they are ${age}` });
  }
  if (job.gender) {
    const done = (c.gender ?? "").toLowerCase() === job.gender.toLowerCase();
    items.push({ key: "gender", label: `${job.gender} only`, done, anchor: "#profile", detail: done ? undefined : c.gender ? `they are ${c.gender.toLowerCase()}` : "add their gender" });
  }
  if (job.min_experience_years !== null) {
    const x = c.experience_years;
    const done = x !== null && x >= job.min_experience_years;
    items.push({ key: "experience", label: `At least ${plural(job.min_experience_years, "year")} of experience`, done, anchor: "#profile", detail: done ? undefined : x === null ? "add their years of experience" : `they have ${x}` });
  }
  job.other_requirements.forEach((text, i) => {
    items.push({ key: `other:${i}`, label: text, done: ticks.includes(text), manual: { text } });
  });
  return items;
}

export const hasFitRequirements = (job: OpeningReqs) =>
  job.min_age !== null || job.max_age !== null || Boolean(job.gender) || job.min_experience_years !== null || job.other_requirements.length > 0;

/** The documents a placement needs: the opening's own list, else the destination country's checklist, else the stage default. */
export async function requiredDocs(tx: Sql, placementId: string, stageDefault: string[]): Promise<string[]> {
  const [p] = await tx`
    SELECT j.country, j.category, j.required_doc_types FROM placements p JOIN job_orders j ON j.id = p.job_order_id WHERE p.id = ${placementId}`;
  if (!p) return stageDefault;
  if ((p.required_doc_types as string[]).length > 0) return p.required_doc_types as string[];
  const [c] = await tx`
    SELECT required_doc_types FROM country_checklists
    WHERE lower(country) = lower(${p.country}) AND (lower(job_category) = lower(${p.category}) OR job_category = '')
    ORDER BY (job_category <> '') DESC LIMIT 1`;
  return c ? (c.required_doc_types as string[]) : stageDefault;
}

/** The recruit measured against the opening they are assigned to (age, gender, experience and the hand-ticked items). */
export async function placementFit(tx: Sql, placementId: string): Promise<GateItem[]> {
  const [r] = await tx`
    SELECT c.dob, c.gender, c.experience_years, p.requirement_ticks,
           j.required_doc_types, j.min_age, j.max_age, j.gender AS job_gender, j.min_experience_years, j.other_requirements
    FROM placements p JOIN candidates c ON c.id = p.candidate_id JOIN job_orders j ON j.id = p.job_order_id WHERE p.id = ${placementId}`;
  if (!r) return [];
  const job: OpeningReqs = {
    required_doc_types: r.required_doc_types, min_age: r.min_age, max_age: r.max_age, gender: r.job_gender,
    min_experience_years: r.min_experience_years, other_requirements: r.other_requirements,
  };
  return fitItems(job, { dob: r.dob, gender: r.gender, experience_years: r.experience_years }, r.requirement_ticks);
}

/** The opening's documents against what the recruit has uploaded and had verified. */
export async function placementDocItems(tx: Sql, placementId: string): Promise<GateItem[]> {
  const [p] = await tx`SELECT candidate_id FROM placements WHERE id = ${placementId}`;
  if (!p) return [];
  const required = await requiredDocs(tx, placementId, []);
  if (required.length === 0) return [];
  const docs = await tx`
    SELECT doc_type, status, (status = 'verified' AND (expiry_date IS NULL OR expiry_date >= current_date)) AS valid
    FROM documents WHERE candidate_id = ${p.candidate_id} AND doc_type = ANY(${required})`;
  return required.map((r) => {
    const mine = docs.filter((d) => d.doc_type === r);
    const done = mine.some((d) => d.valid);
    return {
      key: `doc:${r}`, label: `${r} verified`, done, anchor: "#documents",
      detail: done ? undefined : mine.some((d) => d.status === "pending") ? "uploaded, waiting to be checked" : mine.some((d) => d.status === "verified") ? "expired" : "not uploaded yet",
    };
  });
}
