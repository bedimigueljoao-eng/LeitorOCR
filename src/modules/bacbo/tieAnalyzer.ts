import { BacBoRoundRecord, TieAlert, TieAnalysisReport, TieTotalStat } from './types';

// Distribuição exata de 2d6 vs 2d6 (1296 combinações equiprováveis)
const DICE_SUM_WAYS: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

export const THEORETICAL_TOTAL_OUTCOMES = 1296;
export const THEORETICAL_TIE_WAYS = 146; // sum(ways[s]^2 for s=2..12)
export const THEORETICAL_TIE_RATE_PCT = (THEORETICAL_TIE_WAYS / THEORETICAL_TOTAL_OUTCOMES) * 100; // 11.2654%
export const THEORETICAL_PLAYER_RATE_PCT = (575 / THEORETICAL_TOTAL_OUTCOMES) * 100; // 44.3673%
export const THEORETICAL_BANKER_RATE_PCT = (575 / THEORETICAL_TOTAL_OUTCOMES) * 100; // 44.3673%

export function analyzeTies(rounds: BacBoRoundRecord[]): TieAnalysisReport {
  const totalRounds = rounds.length;
  const tieIndices: number[] = [];
  const totalCounts = new Map<number, number>();
  for (let t = 2; t <= 12; t++) totalCounts.set(t, 0);

  let totalTies = 0;
  for (let i = 0; i < totalRounds; i++) {
    const r = rounds[i];
    if (r.outcome === 'T') {
      totalTies++;
      tieIndices.push(i);
      const tSum =
        r.winningTotal ??
        (r.playerTotal !== null && r.playerTotal === r.bankerTotal ? r.playerTotal : null);
      if (tSum !== null && tSum >= 2 && tSum <= 12) {
        totalCounts.set(tSum, (totalCounts.get(tSum) ?? 0) + 1);
      }
    }
  }

  const roundsSinceLastTie =
    tieIndices.length === 0 ? totalRounds : totalRounds - 1 - tieIndices[tieIndices.length - 1];

  const intervals: number[] = [];
  for (let k = 1; k < tieIndices.length; k++) {
    intervals.push(tieIndices[k] - tieIndices[k - 1] - 1);
  }

  const meanInterval =
    intervals.length > 0
      ? intervals.reduce((acc, v) => acc + v, 0) / intervals.length
      : null;

  let maxInterval = intervals.length > 0 ? Math.max(...intervals) : 0;
  if (tieIndices.length > 0) {
    maxInterval = Math.max(maxInterval, tieIndices[0], roundsSinceLastTie);
  } else {
    maxInterval = totalRounds;
  }

  const calcWindowPct = (w: number): number => {
    if (totalRounds === 0) return 0;
    const slice = rounds.slice(Math.max(0, totalRounds - w));
    const count = slice.filter((r) => r.outcome === 'T').length;
    return (count / slice.length) * 100;
  };

  const observedTieRatePct = totalRounds > 0 ? (totalTies / totalRounds) * 100 : 0;

  const byTotal: TieTotalStat[] = [];
  for (let s = 2; s <= 12; s++) {
    const count = totalCounts.get(s) ?? 0;
    const ways = DICE_SUM_WAYS[s];
    const theoreticalPct = ((ways * ways) / THEORETICAL_TOTAL_OUTCOMES) * 100;
    byTotal.push({
      total: s,
      count,
      observedPct: totalRounds > 0 ? (count / totalRounds) * 100 : 0,
      theoreticalPct,
    });
  }

  const alerts: TieAlert[] = [];

  if (totalTies > 0 && roundsSinceLastTie <= 3) {
    alerts.push({
      code: 'RECENT_TIE',
      title: 'EMPATE RECENTE',
      description:
        roundsSinceLastTie === 0
          ? 'Ocorreu um empate na rodada atual.'
          : `Ocorreu um empate há ${roundsSinceLastTie} rodada(s).`,
    });
  }

  if (totalRounds > 20 && roundsSinceLastTie > 20) {
    alerts.push({
      code: 'DELAYED_20_PLUS',
      title: 'EMPATE ATRASADO: mais de 20 rodadas sem ocorrência',
      description: `${roundsSinceLastTie} rodadas consecutivas sem empate (referência teórica ≈ 1 em cada 8.9 rodadas).`,
    });
  } else if (meanInterval !== null && roundsSinceLastTie > meanInterval && totalRounds >= 15) {
    alerts.push({
      code: 'ABOVE_AVG_INTERVAL',
      title: 'EMPATE ACIMA DO INTERVALO MÉDIO',
      description: `Intervalo atual (${roundsSinceLastTie}) ultrapassou a média observada (${meanInterval.toFixed(1)} rodadas).`,
    });
  }

  // Deteta situações estatisticamente incomuns (empate raro 2/3/11/12 recente, empates consecutivos ou desvio acentuado)
  const lastRecord = totalRounds > 0 ? rounds[totalRounds - 1] : null;
  const rareTieTotalHit =
    lastRecord?.outcome === 'T' &&
    lastRecord.winningTotal !== null &&
    [2, 3, 11, 12].includes(lastRecord.winningTotal);
  const consecutiveTies =
    totalRounds >= 2 &&
    rounds[totalRounds - 1].outcome === 'T' &&
    rounds[totalRounds - 2].outcome === 'T';
  const strongDeviation =
    totalRounds >= 35 && Math.abs(observedTieRatePct - THEORETICAL_TIE_RATE_PCT) >= 7.5;

  if (rareTieTotalHit || consecutiveTies || strongDeviation) {
    const reasons: string[] = [];
    if (consecutiveTies) reasons.push('empates consecutivos (prob. ≈ 1.27%)');
    if (rareTieTotalHit && lastRecord?.winningTotal) {
      reasons.push(`empate raro com total ${lastRecord.winningTotal}`);
    }
    if (strongDeviation) {
      reasons.push(
        `frequência observada (${observedTieRatePct.toFixed(1)}%) distante da base (${THEORETICAL_TIE_RATE_PCT.toFixed(1)}%)`
      );
    }
    alerts.push({
      code: 'UNUSUAL_STAT',
      title: 'EMPATE ESTATISTICAMENTE INCOMUM',
      description: reasons.join(' · '),
    });
  }

  return {
    totalRounds,
    totalTies,
    roundsSinceLastTie,
    observedTieRatePct,
    theoreticalTieRatePct: THEORETICAL_TIE_RATE_PCT,
    meanInterval,
    maxInterval,
    last50TiePct: calcWindowPct(50),
    last100TiePct: calcWindowPct(100),
    last500TiePct: calcWindowPct(500),
    byTotal,
    alerts,
    independenceNote:
      'Nota estatística: um empate atrasado não aumenta a probabilidade do próximo lançamento. Cada rodada usa dados independentes (probabilidade teórica fixa de empate = 11.27%).',
  };
}
