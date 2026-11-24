import { buildQuantAnalystDecision } from './aiQuantAnalyst';
import { analyzeQuantAviator } from './aviatorEngine';
import { evaluateContinuousLearning, evolveTopStrategies } from './continuousLearning';
import { detectMarketRegime } from './marketRegimeDetector';
import {
  OcrTemporalStabilizer,
  reconcileCoherentStrip,
  validateAviatorCellToken,
  validateRouletteCellToken,
} from './ocrPipeline';
import { analyzeQuantRoulette } from './rouletteEngine';
import { DEFAULT_QUANT_STRATEGIES } from './strategyBuilder';

export interface QuantLabTestResult {
  name: string;
  passed: boolean;
  details: string;
}

export function runQuantLabTests(): {
  passedCount: number;
  totalCount: number;
  allPassed: boolean;
  cases: QuantLabTestResult[];
} {
  const cases: QuantLabTestResult[] = [];

  // 1. OCR Validação Estrita Roleta (cor vs número + rejeição 100x / 18 vs 13)
  const rOk18 = validateRouletteCellToken('18', 'red', 92);
  const rBad18vs13 = validateRouletteCellToken('13', 'red', 92); // 13 é preto!
  const rBadLightning = validateRouletteCellToken('100x', 'red', 95);
  cases.push({
    name: '1. OCR Validação Roleta (Domínio 0-36 & Cor Pixel)',
    passed: rOk18.accepted && rOk18.value === 18 && !rBad18vs13.accepted && !rBadLightning.accepted,
    details: `18(red)=${rOk18.accepted}, 13(red) rejeitado=${!rBad18vs13.accepted}, 100x rejeitado=${!rBadLightning.accepted}`,
  });

  // 2. OCR Validação Aviator + Estabilizador Temporal 2 leituras + Deduplicação Coerente
  const aOk = validateAviatorCellToken('6.36x', 'purple', 88);
  const aBad = validateAviatorCellToken('25.00x', 'blue', 90);
  const stab = new OcrTemporalStabilizer();
  const s1 = stab.pushAndCheck([6.36, 3.57, 11.43, 1.28]);
  const s2 = stab.pushAndCheck([6.36, 3.57, 11.43, 1.28]);
  const rec = reconcileCoherentStrip([3.57, 11.43, 1.28], [6.36, 3.57, 11.43, 1.28]);
  cases.push({
    name: '2. OCR Aviator, Estabilização 2x & Reconciliação',
    passed: aOk.accepted && !aBad.accepted && !s1 && s2 && rec.newCommitted.length === 1 && rec.newCommitted[0] === 6.36,
    details: `1.ª leitura=${s1}, 2.ª leitura=${s2}, novo commit=${rec.newCommitted[0]}x`,
  });

  // 3. Módulo Roleta: Setores, Dúzias, Colunas e Vizinhos ±2
  const sampleSpins = [27, 34, 16, 32, 10, 18, 0, 28, 13, 19, 34, 25, 17, 2, 21, 4, 19, 15, 32, 0];
  const rRep = analyzeQuantRoulette(sampleSpins);
  cases.push({
    name: '3. Motor Roleta (Setores Físicos, Atrasos & Vizinhos ±2)',
    passed: rRep.totalSpins === 20 && rRep.neighborsPlusMinus2.length === 5 && rRep.sectors.length === 4,
    details: `Âncora=${rRep.recommendedAnchor}, Vizinhos=[${rRep.neighborsPlusMinus2.join(',')}], Setor top=${rRep.topSector.label}`,
  });

  // 4. Módulo Aviator: 5 Faixas, Streaks e Gaps
  const sampleAviator = [3.57, 11.43, 1.28, 1.33, 2.21, 2.21, 19.12, 1.4, 1.0, 2.64, 1.23, 1.25, 256.78, 1.13, 1.0, 4.5];
  const aRep = analyzeQuantAviator(sampleAviator);
  cases.push({
    name: '4. Motor Aviator (5 Faixas, Gaps Roxo/Rosa & Média/Desvio)',
    passed: aRep.totalRounds === 16 && aRep.bands.length === 5 && aRep.pinkGap.count === 3,
    details: `Média20=${aRep.movingAvg20.toFixed(2)}x, Rosas=${aRep.pinkGap.count}, Gap atual >=10x=${aRep.pinkGap.currentGap}`,
  });

  // 5. Detector de Imprevisibilidade (Bloqueio Obrigatório > 60%)
  const chaoticAviator = Array.from({ length: 24 }, (_, i) => (i % 5 === 0 ? 12.5 : 1.08 + (i % 3) * 0.1));
  const regimeBlocked = detectMarketRegime({ game: 'aviator', valuesNewestFirst: chaoticAviator, thresholdPct: 60 });
  cases.push({
    name: '5. Detector de Imprevisibilidade (Regra Bloqueio > 60%)',
    passed: regimeBlocked.blockEntries && regimeBlocked.bannerText.includes('NÃO APOSTAR'),
    details: `Índice=${regimeBlocked.unpredictabilityPct}%, Bloqueio=${regimeBlocked.blockEntries}`,
  });

  // 6. Aprendizagem Contínua Point-in-Time + Motor de Evolução + Analista IA
  const longAviator = Array.from({ length: 40 }, (_, i) =>
    i % 4 === 0 ? 1.18 : i % 4 === 1 ? 1.32 : i % 4 === 2 ? 2.4 : 1.85
  );
  const learn = evaluateContinuousLearning({
    game: 'aviator',
    historyNewestFirst: longAviator,
    strategies: DEFAULT_QUANT_STRATEGIES,
    stakeAoa: 100,
  });
  const evo = evolveTopStrategies({
    game: 'aviator',
    historyNewestFirst: longAviator,
    existingStrategies: DEFAULT_QUANT_STRATEGIES,
    stakeAoa: 100,
  });
  const stableRegime = detectMarketRegime({
    game: 'aviator',
    valuesNewestFirst: longAviator,
    thresholdPct: 85,
  });
  const decision = buildQuantAnalystDecision({
    game: 'aviator',
    regime: stableRegime,
    learning: learn,
    bankroll: {
      initialBalanceAoa: 2500,
      currentBalanceAoa: 2500,
      baseStakeAoa: 100,
      stopLossAoa: 500,
      stopWinAoa: 800,
      pauseAfterConsecutiveLosses: 3,
      consecutiveLosses: 0,
      sessionPnlAoa: 0,
    },
  });
  cases.push({
    name: '6. Aprendizagem OOS, Evolução & Analista Quant',
    passed: learn.evaluations.length === 4 && typeof evo.summaryNote === 'string' && decision.sampleSize === 40,
    details: `Top=${learn.topStrategy?.strategy.name}, Decisão=${decision.decision}, ${evo.summaryNote}`,
  });

  const passedCount = cases.filter((c) => c.passed).length;
  return {
    passedCount,
    totalCount: cases.length,
    allPassed: passedCount === cases.length,
    cases,
  };
}
