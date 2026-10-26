/** Normalises Kenyan numbers to international format. Other countries must already include their code. */
export function normalizePhone(input: string, defaultCountry = "254"): string | null {
  let s = input.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) {
    return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
  }
  if (s.startsWith("0")) s = defaultCountry + s.slice(1);
  else if (/^[17]\d{8}$/.test(s) && defaultCountry === "254") s = defaultCountry + s;
  s = "+" + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
