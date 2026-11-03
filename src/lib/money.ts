/** "$145.49" from 14549 cents. */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}
