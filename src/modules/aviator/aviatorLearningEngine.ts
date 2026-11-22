import { runAviatorStrategyEngine } from './aviatorStrategyEngine';
import {
  AviatorLearningReport,
  AviatorLearningSnapshot,
  AviatorRoundRecord,
  AviatorStrategyEngineReport,
  AviatorWindowComparison,
  LearningWindowKey,
} from './types';

function evaluateWindow(
  rounds: AviatorRoundRecord[],
  windowKey: LearningWindowKey,
  label: string,
  stakeAoa: number
): AviatorWindowComparison {
  const slice =
    windowKey === 'all'
      ? rounds
      : rounds.slice(-Math.min(rounds.length, Number(windowKey)));

  if (slice.length < 12) {
    return {
      windowKey,
      label,
      sampleSize: slice.length,
      trainHitRatePct: 0,
      validationHitRatePct: 0,
      validationRoiPct: 0,
      overfitGapPct: 0,
      degraded: false,
      bestStrategyId: null,
      bestStrategyName: 'Amostra insuficiente (<12)',
    };
  }

  // Separa estritamente 70% treino vs 30% validação fora da amostra
  const splitIdx = Math.max(8, Math.floor(slice.length * 0.7));
  const trainSet = slice.slice(0, splitIdx);
  const valSet = slice.slice(splitIdx);

  const trainReport = runAviatorStrategyEngine(trainSet, stakeAoa);
  const bestOnTrain =
    trainReport.rankingByRoi.find((s) => s.evaluatedEntries >= 3) ??
    trainReport.strategies[0];

  const valReport = runAviatorStrategyEngine(valSet, stakeAoa);
  const matchedOnVal =
    valReport.strategies.find((s) => s.id === bestOnTrain.id) ?? valReport.strategies[0];

  const trainHit = bestOnTrain.hitRatePct;
  const valHit = matchedOnVal.hitRatePct;
  const overfitGapPct = trainHit - valHit;
  const degraded =
    matchedOnVal.evaluatedEntries >= 3 &&
    (overfitGapPct > 15 || matchedOnVal.simulatedRoiPct < -15);

  return {
    windowKey,
    label,
    sampleSize: slice.length,
    trainHitRatePct: trainHit,
    validationHitRatePct: valHit,
    validationRoiPct: matchedOnVal.simulatedRoiPct,
    overfitGapPct,
    degraded,
    bestStrategyId: bestOnTrain.id,
    bestStrategyName: bestOnTrain.name,
  };
}

export function runAviatorLearningEngine(params: {
  rounds: AviatorRoundRecord[];
  strategyReport: AviatorStrategyEngineReport;
  selectedWindow: LearningWindowKey;
  stakeAoa: number;
  savedSnapshots: AviatorLearningSnapshot[];
}): AviatorLearningReport {
  const { rounds, strategyReport, selectedWindow, stakeAoa, savedSnapshots } = params;

  const windowSpecs: Array<{ key: LearningWindowKey; label: string }> = [
    { key: '50', label: 'Últimas 50' },
    { key: '100', label: 'Últimas 100' },
    { key: '500', label: 'Últimas 500' },
    { key: '1000', label: 'Últimas 1000' },
    { key: 'all', label: 'Todo o Histórico' },
  ];

  const windows = windowSpecs.map((spec) =>
    evaluateWindow(rounds, spec.key, spec.label, stakeAoa)
  );

  const activeWin =
    windows.find((w) => w.windowKey === selectedWindow) ?? windows[1];

  let overfittingRisk: AviatorLearningReport['overfittingRisk'] = 'INSUFICIENTE';
  if (rounds.length >= 20) {
    if (activeWin.overfitGapPct > 18) overfittingRisk = 'ELEVADO';
    else if (activeWin.overfitGapPct > 8) overfittingRisk = 'MODERADO';
    else overfittingRisk = 'BAIXO';
  }

  // Comparação entre estratégia anterior (conservadora base) e melhor modelo validado
  const baseline = strategyReport.strategies[0];
  const oldHit = baseline?.hitRatePct ?? 0;
  const newHit = activeWin.sampleSize >= 12 ? activeWin.validationHitRatePct : oldHit;
  const oldVsNewDeltaPct = newHit - oldHit;

  const degradedStrategies = strategyReport.strategies.filter((s) => s.degradationFlag);
  let degradationWarning: string | null = null;
  if (activeWin.degraded) {
    degradationWarning = `Alerta: "${activeWin.bestStrategyName}" perdeu desempenho na validação fora da amostra (${activeWin.validationRoiPct.toFixed(1)}% ROI).`;
  } else if (degradedStrategies.length > 0) {
    degradationWarning = `Queda recente detetada em ${degradedStrategies.length} estratégia(s): ${degradedStrategies
      .map((s) => s.name)
      .join(', ')}.`;
  }

  const recommendationNote =
    rounds.length < 30
      ? `A recolher histórico (${rounds.length}/30 rodadas mínimas) para validação cruzada fiável.`
      : overfittingRisk === 'ELEVADO'
      ? 'Diferença alta entre treino e validação; prefira a estratégia combinada ou conservadora e evite ajustar parâmetros ao ruído.'
      : `Janela ${activeWin.label} validada: melhor equilíbrio atual em "${activeWin.bestStrategyName}".`;

  return {
    windows,
    selectedWindow,
    oldVsNewDeltaPct,
    overfittingRisk,
    degradationWarning,
    recommendationNote,
    recentSnapshots: savedSnapshots.slice(-10).reverse(),
  };
}
