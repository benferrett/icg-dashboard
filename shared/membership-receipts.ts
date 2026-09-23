/** Compare currency values in cents, never with a loose dollar tolerance. */
export function matchesOutstandingAmount(amount: number, outstanding: number): boolean {
  return Number.isFinite(amount) && Number.isFinite(outstanding) &&
    Math.round(outstanding * 100) > 0 &&
    Math.round(amount * 100) === Math.round(outstanding * 100);
}
