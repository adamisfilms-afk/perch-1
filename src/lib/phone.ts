// Australian phone numbers. Stored in E.164 (+614xxxxxxxx) so SMS providers accept them.

/**
 * Normalise an Australian mobile number to E.164, or return null if it isn't one.
 * Accepts "0412 345 678", "+61 412 345 678", "61412345678", "(04) 1234 5678".
 */
export function normaliseAuMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  let national: string;
  if (/^\+614\d{8}$/.test(digits)) national = digits.slice(3);
  else if (/^614\d{8}$/.test(digits)) national = digits.slice(2);
  else if (/^04\d{8}$/.test(digits)) national = digits.slice(1);
  else return null;
  return `+61${national}`;
}

/** +61412345678 → 0412 345 678 */
export function formatAuMobile(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+61(4\d{2})(\d{3})(\d{3})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}
