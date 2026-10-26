import { field } from "./form";

export type OpeningInput = {
  title: string; country: string; quantity: number; salary: string; category: string;
  required_doc_types: string[]; min_age: number | null; max_age: number | null; gender: string; min_experience_years: number | null; other_requirements: string[];
};

/** Reads an opening's form (the same fields are used to create it and to change it). Returns an error message instead if something is off. */
export function readOpening(fd: FormData): OpeningInput | string {
  const title = field(fd, "title"), country = field(fd, "country");
  if (!title || !country) return "Give the role and the country.";
  const quantity = Number(field(fd, "quantity") ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) return "The number of workers must be at least 1.";
  const num = (name: string, label: string, max: number): number | null | string => {
    const v = field(fd, name);
    if (!v) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : `${label} must be a whole number.`;
  };
  const lo = num("min_age", "The youngest age", 80), hi = num("max_age", "The oldest age", 80), exp = num("min_experience_years", "Years of experience", 60);
  for (const v of [lo, hi, exp]) if (typeof v === "string") return v;
  if (typeof lo === "number" && typeof hi === "number" && lo > hi) return "The youngest age is above the oldest age.";
  const gender = field(fd, "gender") ?? "";
  if (gender && gender !== "Female" && gender !== "Male") return "Choose female, male or anyone.";
  return {
    title, country, quantity, salary: field(fd, "salary") ?? "", category: field(fd, "category") ?? "",
    required_doc_types: fd.getAll("req_docs").map(String).filter(Boolean),
    min_age: lo as number | null, max_age: hi as number | null, gender, min_experience_years: exp as number | null,
    other_requirements: (field(fd, "other_requirements") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
  };
}
