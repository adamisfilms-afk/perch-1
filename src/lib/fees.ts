// Service fee maths (v1.1). All amounts in cents to avoid floating-point drift.

export interface FeeInput {
  /** Amount the fee is charged on, in cents (ex GST): payments received or sessions delivered. */
  feeBaseCents: number;
  rate: number; // 0.20
  gstRate: number; // 0.10
}

export interface FeeResult {
  feeExGstCents: number;
  gstCents: number;
  feeIncGstCents: number;
}

export function calculateServiceFee({ feeBaseCents, rate, gstRate }: FeeInput): FeeResult {
  if (feeBaseCents < 0) throw new Error("Fee base can't be negative");
  const feeExGstCents = Math.round(feeBaseCents * rate);
  const gstCents = Math.round(feeExGstCents * gstRate);
  return { feeExGstCents, gstCents, feeIncGstCents: feeExGstCents + gstCents };
}

export function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}
