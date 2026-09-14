export const TRUST_WEIGHTS = Object.freeze({ reliability: 0.4, freshness: 0.2, verification: 0.2, consistency: 0.2 });

export function calculateTrustScore({ reliability, freshness, verification, consistency }) {
  const normalized =
    TRUST_WEIGHTS.reliability * reliability +
    TRUST_WEIGHTS.freshness * freshness +
    TRUST_WEIGHTS.verification * verification +
    TRUST_WEIGHTS.consistency * consistency;
  return Math.round(normalized * 10_000) / 100; // 0–100, two decimal places
}

export function scoreReason({ reliability, freshness, verification, consistency, score }) {
  return `Bootstrap source reliability: ${reliability.toFixed(2)}, freshness: ${freshness.toFixed(2)}, ` +
    `consensus confirmation (not external ground truth): ${verification.toFixed(2)}, ` +
    `consistency: ${consistency.toFixed(2)}. Final trust score: ${score.toFixed(2)}.`;
}
