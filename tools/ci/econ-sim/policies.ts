/**
 * Spending policies of the economy harness (M04d): how much of the balance a simulated player puts into the section's sink table
 * each game week. Integer cents only.
 */
export type PolicyId = 'saver' | 'spender' | 'median';

export const POLICIES: readonly PolicyId[] = ['saver', 'spender', 'median'];

/** Percent of the balance each policy offers to the sinks every week. */
export const SPEND_PERCENT: Readonly<Record<PolicyId, number>> = { saver: 10, median: 45, spender: 90 };

/** Cents the policy spends this week: floor(balance x percent / 100). */
export function weeklySpend(policy: PolicyId, balanceCents: number): number {
  return Math.floor((balanceCents * SPEND_PERCENT[policy]) / 100);
}
