const MILLION = 1_000_000;

export type TokenUsage = {
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_cache_read: number | null;
  tokens_cache_creation: number | null;
};

export type CostEstimate = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  estimatedUsd: number;
};

const DEFAULT_PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,
};

export function estimateClaudeCost(rows: TokenUsage[]): CostEstimate {
  const totals = rows.reduce(
    (acc, row) => {
      acc.inputTokens += row.tokens_input || 0;
      acc.outputTokens += row.tokens_output || 0;
      acc.cacheReadTokens += row.tokens_cache_read || 0;
      acc.cacheCreationTokens += row.tokens_cache_creation || 0;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  );

  const billableInputTokens = Math.max(totals.inputTokens - totals.cacheReadTokens, 0);
  const estimatedUsd =
    (billableInputTokens * DEFAULT_PRICING.inputPerMillion +
      totals.cacheReadTokens * DEFAULT_PRICING.cacheReadPerMillion +
      totals.outputTokens * DEFAULT_PRICING.outputPerMillion) /
    MILLION;

  return {
    ...totals,
    totalTokens: totals.inputTokens + totals.outputTokens,
    estimatedUsd,
  };
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 10 ? 0 : 2,
    maximumFractionDigits: value >= 10 ? 0 : 2,
  }).format(value);
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
