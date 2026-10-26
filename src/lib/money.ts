/** Money is stored as integer minor units (cents). These helpers never use floats for storage. */

export function toMinor(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return neg ? -minor : minor;
}

export function formatMoney(minor: number | string | bigint, currency = "KES"): string {
  const n = Number(minor) / 100;
  return `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const CURRENCIES = ["KES", "USD", "AED", "SAR", "QAR", "GBP", "EUR"] as const;
