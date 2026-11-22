import { evaluateCurrentConsensus } from './strategyEngine';
import {
  THEORETICAL_BANKER_RATE_PCT,
  THEORETICAL_PLAYER_RATE_PCT,
  THEORETICAL_TIE_RATE_PCT,
} from './tieAnalyzer';
import {
  BacBoOutcome,
  BacBoRoundRecord,
  DynamicModelCandidate,
  LearningReport,
  PeriodPerformance,
  ProbabilityBreakdown,
  StrategyEngineReport,
} from './types';

function evaluateRange(rounds: BacBoRoundRecord[], startIdx: number, endIdx: number): {
  suggestionsCount: number;
  hits: number;
  misses: number;
  hitRatePct: number;
} {
  let hits = 0;
  let misses = 0;
  for (let i = Math.max(8, startIdx); i < endIdx; i++) {
    const r = rounds[i];
    const sug = r.predictionBefore
      ? r.predictionBefore.suggestion
      : evaluateCurrentConsensus(rounds.slice(0, i)).finalSuggestion;
    if (sug === 'NONE') continue;
    if (sug === r.outcome) hits++;
    else misses++;
  }
  const total = hits + misses;
  return {
    suggestionsCount: total,
    hits,
    misses,
    hitRatePct: total > 0 ? (hits / total) * 100 : 0,
  };
}

export function runLearningEngine(
  rounds: BacBoRoundRecord[],
  strategyReport: StrategyEngineReport
): LearningReport {
  const n = rounds.length;
  const fullEval = evaluateRange(rounds, 0, n);

  // Janela móvel das últimas 50 sugestões válidas
  const validResults: boolean[] = [];
  for (let i = 8; i < n; i++) {
    const r = rounds[i];
    const sug = r.predictionBefore
      ? r.predictionBefore.suggestion
      : evaluateCurrentConsensus(rounds.slice(0, i)).finalSuggestion;
    if (sug === 'NONE') continue;
    validResults.push(sug === r.outcome);
  }
  const last50 = validResults.slice(-50);
  const rolling50Hits = last50.filter(Boolean).length;
  const rolling50HitRatePct =
    last50.length > 0 ? (rolling50Hits / last50.length) * 100 : 0;

  // Comparação entre períodos: últimas 100, 500, 1000 e geral
  const periods: PeriodPerformance[] = [100, 500, 1000].map((w) => {
    const start = Math.max(0, n - w);
    const res = evaluateRange(rounds, start, n);
    return {
      label: `Últimas ${w} rodadas`,
      roundsCount: Math.min(n, w),
      ...res,
    };
  });

  // Validação fora da amostra (70% descoberta / 30% validação out-of-sample) para evitar sobreajuste
  const splitIdx = Math.floor(n * 0.7);
  const outOfSample = n >= 20 ? evaluateRange(rounds, splitIdx, n) : { suggestionsCount: 0, hits: 0, misses: 0, hitRatePct: 0 };

  const degradingStrategies = strategyReport.strategies
    .filter((s) => s.suggestionsCount >= 10 && s.last50Samples >= 6 && s.last50HitRatePct < s.hitRatePct - 8)
    .map((s) => s.name);

  const topValidatedStrategies = strategyReport.strategies
    .filter((s) => s.suggestionsCount >= 8 && s.hitRatePct >= 46)
    .sort((a, b) => b.hitRatePct - a.hitRatePct)
    .slice(0, 3)
    .map((s) => s.name);

  // Testa novos modelos dinâmicos (blocos de comprimento 2 e 3) comparando treino vs validação fora da amostra
  const dynamicModels: DynamicModelCandidate[] = [];
  if (n >= 24) {
    const trainRounds = rounds.slice(0, splitIdx);
    const valRounds = rounds.slice(splitIdx);
    const trainCounts = new Map<string, Record<BacBoOutcome, number>>();

    for (let i = 0; i <= trainRounds.length - 3; i++) {
      const key = `${trainRounds[i].outcome}-${trainRounds[i + 1].outcome}`;
      const next = trainRounds[i + 2].outcome;
      const entry = trainCounts.get(key) ?? { P: 0, B: 0, T: 0 };
      entry[next]++;
      trainCounts.set(key, entry);
    }

    for (const [pattern, counts] of trainCounts.entries()) {
      const totalTrain = counts.P + counts.B + counts.T;
      if (totalTrain < 4) continue;
      const bestNext: BacBoOutcome =
        counts.P >= counts.B && counts.P >= counts.T
          ? 'P'
          : counts.B >= counts.T
          ? 'B'
          : 'T';
      const trainRate = (counts[bestNext] / totalTrain) * 100;

      // Valida exclusivamente nos dados que NÃO foram usados na criação (valRounds)
      let valSupport = 0;
      let valHits = 0;
      for (let j = 0; j <= valRounds.length - 3; j++) {
        const key = `${valRounds[j].outcome}-${valRounds[j + 1].outcome}`;
        if (key === pattern) {
          valSupport++;
          if (valRounds[j + 2].outcome === bestNext) valHits++;
        }
      }
      const valRate = valSupport > 0 ? (valHits / valSupport) * 100 : 0;
      dynamicModels.push({
        id: `dyn_${pattern}_${bestNext}`,
        pattern,
        predictedNext: bestNext,
        trainSupport: totalTrain,
        trainHitRatePct: trainRate,
        validationSupport: valSupport,
        validationHitRatePct: valRate,
        beatsBaseline: valSupport >= 3 && valRate >= 48,
      });
    }
  }

  dynamicModels.sort(
    (a, b) => b.validationHitRatePct - a.validationHitRatePct || b.validationSupport - a.validationSupport
  );

  let overfitWarning: string | null = null;
  if (n < 20) {
    overfitWarning = 'Amostra abaixo de 20 rodadas: validação fora da amostra ainda em recolha.';
  } else if (
    outOfSample.suggestionsCount >= 5 &&
    fullEval.hitRatePct - outOfSample.hitRatePct > 12
  ) {
    overfitWarning =
      'Diferença elevada entre histórico de treino e validação recente; evitar sobreajuste a sequências curtas.';
  }

  return {
    rolling50HitRatePct,
    rolling50Samples: last50.length,
    overallHitRatePct: fullEval.hitRatePct,
    overallSamples: fullEval.suggestionsCount,
    periods,
    degradingStrategies,
    topValidatedStrategies,
    dynamicModels: dynamicModels.slice(0, 6),
    outOfSampleHitRatePct: outOfSample.hitRatePct,
    outOfSampleSamples: outOfSample.suggestionsCount,
    overfitWarning,
  };
}

/**
 * Calcula probabilidades calibradas (Referência Teórica + Frequência Observada + Estimativa do Modelo).
 * Usa suavização Bayesiana-Dirichlet e amortecimento suave (~2-3 p.p. em atualizações normais) sem distorcer picos reais.
 */
export function computeCalibratedProbabilities(
  rounds: BacBoRoundRecord[],
  strategyReport: StrategyEngineReport,
  previousProbs?: { player: number; tie: number; banker: number } | null
): ProbabilityBreakdown {
  const reference = {
    player: Number(THEORETICAL_PLAYER_RATE_PCT.toFixed(1)),
    tie: Number(THEORETICAL_TIE_RATE_PCT.toFixed(1)),
    banker: Number(THEORETICAL_BANKER_RATE_PCT.toFixed(1)),
  };

  const n = rounds.length;
  if (n === 0) {
    return {
      reference,
      observed: { player: 0, tie: 0, banker: 0 },
      modelEstimate: { ...reference },
      statisticalConfidence: 'DADOS INSUFICIENTES',
      sampleQualityNote: 'Sem rodadas registadas. A utilizar probabilidade teórica de referência (2d6 vs 2d6).',
    };
  }

  const pCount = rounds.filter((r) => r.outcome === 'P').length;
  const tCount = rounds.filter((r) => r.outcome === 'T').length;
  const bCount = rounds.filter((r) => r.outcome === 'B').length;

  const observed = {
    player: Number(((pCount / n) * 100).toFixed(1)),
    tie: Number(((tCount / n) * 100).toFixed(1)),
    banker: Number(((bCount / n) * 100).toFixed(1)),
  };

  // Recência ponderada (últimas 30 rodadas) + prior Dirichlet equivalente a 36 rodadas teóricas
  const recent = rounds.slice(-30);
  const rP = recent.filter((r) => r.outcome === 'P').length;
  const rT = recent.filter((r) => r.outcome === 'T').length;
  const rB = recent.filter((r) => r.outcome === 'B').length;

  const priorStrength = 36;
  const alphaP = (THEORETICAL_PLAYER_RATE_PCT / 100) * priorStrength;
  const alphaT = (THEORETICAL_TIE_RATE_PCT / 100) * priorStrength;
  const alphaB = (THEORETICAL_BANKER_RATE_PCT / 100) * priorStrength;

  let estP = ((alphaP + pCount * 0.4 + rP * 0.6) / (priorStrength + n * 0.4 + recent.length * 0.6)) * 100;
  let estT = ((alphaT + tCount * 0.4 + rT * 0.6) / (priorStrength + n * 0.4 + recent.length * 0.6)) * 100;
  let estB = ((alphaB + bCount * 0.4 + rB * 0.6) / (priorStrength + n * 0.4 + recent.length * 0.6)) * 100;

  // Ajuste moderado pelo consenso validado das estratégias (limitado a ~3 p.p.)
  if (n >= 12 && strategyReport.finalSuggestion !== 'NONE' && strategyReport.agreeingCount >= 2) {
    const boost = Math.min(3.5, strategyReport.agreeingCount * 0.9);
    if (strategyReport.finalSuggestion === 'P') {
      estP += boost;
      estB -= boost * 0.8;
      estT -= boost * 0.2;
    } else if (strategyReport.finalSuggestion === 'B') {
      estB += boost;
      estP -= boost * 0.8;
      estT -= boost * 0.2;
    } else {
      estT += boost;
      estP -= boost * 0.5;
      estB -= boost * 0.5;
    }
  }

  // Amortecimento exponencial natural (alpha=0.35) para evitar saltos bruscos em condições normais
  if (previousProbs && n >= 10) {
    const deltaMax = Math.max(
      Math.abs(estP - previousProbs.player),
      Math.abs(estB - previousProbs.banker),
      Math.abs(estT - previousProbs.tie)
    );
    if (deltaMax <= 6) {
      estP = previousProbs.player * 0.6 + estP * 0.4;
      estT = previousProbs.tie * 0.6 + estT * 0.4;
      estB = previousProbs.banker * 0.6 + estB * 0.4;
    }
  }

  // Normaliza para soma exata 100.0%
  const sum = estP + estT + estB;
  const pRound = Number(((estP / sum) * 100).toFixed(1));
  const tRound = Number(((estT / sum) * 100).toFixed(1));
  const bRound = Number((100 - pRound - tRound).toFixed(1));

  let statisticalConfidence: ProbabilityBreakdown['statisticalConfidence'] = 'DADOS INSUFICIENTES';
  let sampleQualityNote = `Amostra atual: ${n} rodadas (mínimo 12 para estimativa ativa).`;

  if (n >= 12 && n < 30) {
    statisticalConfidence = 'BAIXA';
    sampleQualityNote = `Amostra inicial (${n} rodadas): peso predominante da probabilidade de referência.`;
  } else if (n >= 30 && n < 80) {
    statisticalConfidence = 'MODERADA';
    sampleQualityNote = `Amostra moderada (${n} rodadas): modelo combina frequência observada e consenso validado.`;
  } else if (n >= 80) {
    statisticalConfidence = 'ALTA';
    sampleQualityNote = `Amostra robusta (${n} rodadas): estimativa calibrada com validação fora da amostra.`;
  }

  return {
    reference,
    observed,
    modelEstimate: { player: pRound, tie: tRound, banker: bRound },
    statisticalConfidence,
    sampleQualityNote,
  };
}
