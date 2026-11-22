import { classifyAviatorCategory } from './aviatorResultProcessor';
import {
  AviatorCategory,
  AviatorCategoryRuleConfig,
  AviatorRoundRecord,
  AviatorStatisticsReport,
  DEFAULT_CATEGORY_CONFIG,
} from './types';

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeAviatorStatistics(
  rounds: AviatorRoundRecord[],
  cfg: AviatorCategoryRuleConfig = DEFAULT_CATEGORY_CONFIG
): AviatorStatisticsReport {
  const categoryCounts: Record<AviatorCategory, number> = {
    under_1_50: 0,
    '1_50_to_2_00': 0,
    '2_00_to_3_00': 0,
    '3_00_to_5_00': 0,
    '5_00_to_10_00': 0,
    over_10_00: 0,
  };

  const n = rounds.length;
  if (n === 0) {
    return {
      totalRounds: 0,
      overallAvgMultiplier: 0,
      overallMedianMultiplier: 0,
      overallMaxMultiplier: 0,
      recent20AvgMultiplier: 0,
      recent50AvgMultiplier: 0,
      above2xPct: 0,
      below150Pct: 0,
      above5xPct: 0,
      above10xPct: 0,
      categoryCounts,
      categoryPcts: { ...categoryCounts },
      evaluatedSuggestions: 0,
      suggestionHits: 0,
      suggestionMisses: 0,
      suggestionHitRatePct: 0,
    };
  }

  let sum = 0;
  let maxM = 0;
  let above2 = 0;
  let below150 = 0;
  let above5 = 0;
  let above10 = 0;
  let evaluatedSuggestions = 0;
  let suggestionHits = 0;
  let suggestionMisses = 0;

  const mults: number[] = [];
  for (const r of rounds) {
    mults.push(r.multiplier);
    sum += r.multiplier;
    if (r.multiplier > maxM) maxM = r.multiplier;
    if (r.multiplier >= 2.0) above2++;
    if (r.multiplier < cfg.lowCeiling) below150++;
    if (r.multiplier >= cfg.highCeiling) above5++;
    if (r.multiplier >= cfg.megaThreshold) above10++;
    const cat = classifyAviatorCategory(r.multiplier, cfg);
    categoryCounts[cat]++;

    if (
      r.predictionBefore &&
      r.predictionBefore.shouldEnter &&
      r.predictionBefore.targetMultiplier !== null
    ) {
      evaluatedSuggestions++;
      if (r.multiplier >= r.predictionBefore.targetMultiplier) {
        suggestionHits++;
      } else {
        suggestionMisses++;
      }
    }
  }

  const r20 = mults.slice(-20);
  const r50 = mults.slice(-50);

  return {
    totalRounds: n,
    overallAvgMultiplier: sum / n,
    overallMedianMultiplier: computeMedian(mults),
    overallMaxMultiplier: maxM,
    recent20AvgMultiplier: r20.reduce((a, b) => a + b, 0) / r20.length,
    recent50AvgMultiplier: r50.reduce((a, b) => a + b, 0) / r50.length,
    above2xPct: (above2 / n) * 100,
    below150Pct: (below150 / n) * 100,
    above5xPct: (above5 / n) * 100,
    above10xPct: (above10 / n) * 100,
    categoryCounts,
    categoryPcts: {
      under_1_50: (categoryCounts.under_1_50 / n) * 100,
      '1_50_to_2_00': (categoryCounts['1_50_to_2_00'] / n) * 100,
      '2_00_to_3_00': (categoryCounts['2_00_to_3_00'] / n) * 100,
      '3_00_to_5_00': (categoryCounts['3_00_to_5_00'] / n) * 100,
      '5_00_to_10_00': (categoryCounts['5_00_to_10_00'] / n) * 100,
      over_10_00: (categoryCounts.over_10_00 / n) * 100,
    },
    evaluatedSuggestions,
    suggestionHits,
    suggestionMisses,
    suggestionHitRatePct:
      evaluatedSuggestions > 0 ? (suggestionHits / evaluatedSuggestions) * 100 : 0,
  };
}
