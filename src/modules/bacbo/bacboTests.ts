import {
  createBackupPayload,
  loadRoundsSync,
  parseBackupPayload,
  saveRounds,
} from './bacboDatabase';
import { validateAndBuildBacBoRound } from './bacboResultProcessor';
import { computeCalibratedProbabilities } from './learningEngine';
import { analyzePatterns } from './patternEngine';
import { computeBacBoStatistics } from './statisticsEngine';
import { runStrategyEngine } from './strategyEngine';
import { analyzeStreaks } from './streakEngine';
import { analyzeTies, THEORETICAL_TIE_RATE_PCT } from './tieAnalyzer';
import {
  BacBoOutcome,
  BacBoRoundRecord,
  BacBoTestCaseResult,
  BacBoTestReport,
} from './types';

function makeRoundsFromSeq(
  seq: BacBoOutcome[],
  totals?: (number | null)[]
): BacBoRoundRecord[] {
  const list: BacBoRoundRecord[] = [];
  for (let i = 0; i < seq.length; i++) {
    const o = seq[i];
    const wt = totals && totals[i] !== undefined ? totals[i] : o === 'T' ? 7 : 8;
    const pTot = o === 'P' ? (wt ?? 8) : o === 'B' ? Math.max(2, (wt ?? 8) - 2) : (wt ?? 7);
    const bTot = o === 'B' ? (wt ?? 9) : o === 'P' ? Math.max(2, (wt ?? 8) - 2) : (wt ?? 7);
    const res = validateAndBuildBacBoRound(
      {
        outcome: o,
        playerTotal: pTot,
        bankerTotal: bTot,
        winningTotal: wt,
        source: 'manual',
        timestamp: new Date(Date.now() + i * 2000).toISOString(),
      },
      list
    );
    if (res.record) list.push(res.record);
  }
  return list;
}

export function runAllBacBoTests(): BacBoTestReport {
  const cases: BacBoTestCaseResult[] = [];

  // 1. Corridas (Streaks)
  try {
    const rounds = makeRoundsFromSeq(['B', 'B', 'B', 'P', 'P', 'P', 'P', 'T', 'T']);
    const streaks = analyzeStreaks(rounds);
    const ok =
      streaks.currentSide === 'T' &&
      streaks.currentLength === 2 &&
      streaks.bySide.B.maxHistoricalStreak === 3 &&
      streaks.bySide.P.maxHistoricalStreak === 4 &&
      streaks.bySide.B.byLength[1].endedCount === 1;
    cases.push({
      name: 'Corridas (Streaks)',
      passed: ok,
      details: ok
        ? 'Identificou corridas 3x Banker, 4x Player, 2x Tie e encerramento corretamente.'
        : 'Falha ao contabilizar corridas.',
    });
  } catch (e) {
    cases.push({ name: 'Corridas (Streaks)', passed: false, details: String(e) });
  }

  // 2. Ping-Pong
  try {
    const rounds = makeRoundsFromSeq(['P', 'B', 'P', 'B', 'P', 'B', 'P', 'B']);
    const pat = analyzePatterns(rounds);
    const pb = pat.discoveredPatterns.find((p) => p.id === 'pingpong_pb');
    const ok = Boolean(pb && pb.occurrences === 3);
    cases.push({
      name: 'Ping-Pong',
      passed: ok,
      details: ok
        ? `Padrão P-B-P-B detetado com ${pb!.occurrences} ocorrências.`
        : 'Falha ao detetar Ping-Pong.',
    });
  } catch (e) {
    cases.push({ name: 'Ping-Pong', passed: false, details: String(e) });
  }

  // 3. Padrão 2-1
  try {
    const rounds = makeRoundsFromSeq(['B', 'B', 'P', 'B', 'B', 'P', 'B', 'B', 'P']);
    const pat = analyzePatterns(rounds);
    const twoOne = pat.discoveredPatterns.find((p) => p.id === '2_1_bbp');
    const ok = Boolean(twoOne && twoOne.occurrences >= 2);
    cases.push({
      name: 'Padrão 2-1',
      passed: ok,
      details: ok
        ? `Ciclo B-B-P-B-B-P detetado (${twoOne!.occurrences} ocorrências).`
        : 'Falha ao detetar padrão 2-1.',
    });
  } catch (e) {
    cases.push({ name: 'Padrão 2-1', passed: false, details: String(e) });
  }

  // 4. Padrões de totais
  try {
    const rounds = makeRoundsFromSeq(
      ['P', 'B', 'T', 'T', 'B'],
      [12, 12, 2, 2, 12]
    );
    const pat = analyzePatterns(rounds);
    const ok =
      pat.totals.total12Count === 3 &&
      pat.totals.total2Count === 2 &&
      pat.totals.consecutiveEqualTotals >= 2 &&
      pat.totals.alerts.some((a) => a.includes('TOTAL 12')) &&
      pat.totals.alerts.some((a) => a.includes('TOTAL 2'));
    cases.push({
      name: 'Padrões de totais',
      passed: ok,
      details: ok
        ? 'Contabilizou repetições de total 2 e total 12 e gerou alertas corretos.'
        : 'Falha na análise de totais.',
    });
  } catch (e) {
    cases.push({ name: 'Padrões de totais', passed: false, details: String(e) });
  }

  // 5. Empates
  try {
    const seq: BacBoOutcome[] = [
      'T',
      ...Array<BacBoOutcome>(22).fill('B'),
    ];
    const rounds = makeRoundsFromSeq(seq, [12, ...Array<number>(22).fill(8)]);
    const ties = analyzeTies(rounds);
    const t12 = ties.byTotal.find((x) => x.total === 12);
    const hasDelayAlert = ties.alerts.some((a) => a.code === 'DELAYED_20_PLUS');
    const ok =
      ties.totalTies === 1 &&
      ties.roundsSinceLastTie === 22 &&
      Math.abs(ties.theoreticalTieRatePct - THEORETICAL_TIE_RATE_PCT) < 0.01 &&
      Boolean(t12 && t12.count === 1) &&
      hasDelayAlert;
    cases.push({
      name: 'Empates',
      passed: ok,
      details: ok
        ? 'Distinção de totais 2..12, referência 11.27% e alerta >20 rodadas validados.'
        : 'Falha no módulo de empates.',
    });
  } catch (e) {
    cases.push({ name: 'Empates', passed: false, details: String(e) });
  }

  // 6. Identificação de resultados
  try {
    const validDice = validateAndBuildBacBoRound(
      { playerDice: [5, 6], bankerDice: [2, 3], source: 'manual' },
      []
    );
    const invalidRange = validateAndBuildBacBoRound(
      { outcome: 'P', winningTotal: 15, source: 'manual' },
      []
    );
    const inconsistent = validateAndBuildBacBoRound(
      { outcome: 'B', playerTotal: 10, bankerTotal: 4, source: 'manual' },
      []
    );
    const ok =
      validDice.valid &&
      validDice.record?.outcome === 'P' &&
      validDice.record?.playerTotal === 11 &&
      !invalidRange.valid &&
      !inconsistent.valid;
    cases.push({
      name: 'Identificação de resultados',
      passed: ok,
      details: ok
        ? 'Validou dados 1..6, consistência P/B/T e rejeitou totais inválidos/inconsistentes.'
        : 'Falha na validação do processador de resultados.',
    });
  } catch (e) {
    cases.push({ name: 'Identificação de resultados', passed: false, details: String(e) });
  }

  // 7. Cálculo de percentagens
  try {
    const smallRounds = makeRoundsFromSeq(['P', 'B', 'P', 'B', 'P']);
    const smallStrat = runStrategyEngine(smallRounds);
    const smallProbs = computeCalibratedProbabilities(smallRounds, smallStrat);

    const largerRounds = makeRoundsFromSeq(
      Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 'B' : i % 3 === 1 ? 'P' : 'B'))
    );
    const largerStrat = runStrategyEngine(largerRounds);
    const largerProbs = computeCalibratedProbabilities(largerRounds, largerStrat);
    const sum =
      largerProbs.modelEstimate.player +
      largerProbs.modelEstimate.tie +
      largerProbs.modelEstimate.banker;

    const ok =
      smallProbs.statisticalConfidence === 'DADOS INSUFICIENTES' &&
      largerProbs.statisticalConfidence !== 'DADOS INSUFICIENTES' &&
      Math.abs(sum - 100) <= 0.2;
    cases.push({
      name: 'Cálculo de percentagens',
      passed: ok,
      details: ok
        ? `Exibiu DADOS INSUFICIENTES (<12) e normalizou modelo calibrado (${sum.toFixed(1)}%).`
        : 'Falha no cálculo de percentagens.',
    });
  } catch (e) {
    cases.push({ name: 'Cálculo de percentagens', passed: false, details: String(e) });
  }

  // 8. Contagem de acertos e erros
  try {
    const r1 = validateAndBuildBacBoRound(
      { outcome: 'P', source: 'manual' },
      [],
      {
        suggestion: 'NONE',
        reasons: [],
        activeStrategies: [],
        agreeingStrategies: [],
        totalEvaluatedStrategies: 9,
        probabilities: { player: 44.4, tie: 11.2, banker: 44.4 },
        detectedPatterns: [],
        streakLabel: '',
        confidenceLabel: 'DADOS INSUFICIENTES',
      }
    ).record!;
    const r2 = validateAndBuildBacBoRound(
      { outcome: 'B', source: 'manual' },
      [r1],
      {
        suggestion: 'B',
        reasons: ['Teste'],
        activeStrategies: ['Estratégia de Corridas'],
        agreeingStrategies: ['Estratégia de Corridas'],
        totalEvaluatedStrategies: 9,
        probabilities: { player: 42, tie: 11, banker: 47 },
        detectedPatterns: ['Ping-Pong'],
        streakLabel: '1x Player',
        confidenceLabel: 'BAIXA',
      }
    ).record!;
    const r3 = validateAndBuildBacBoRound(
      { outcome: 'T', source: 'manual' },
      [r1, r2],
      {
        suggestion: 'P',
        reasons: ['Teste'],
        activeStrategies: ['Estratégia de Alternância'],
        agreeingStrategies: ['Estratégia de Alternância'],
        totalEvaluatedStrategies: 9,
        probabilities: { player: 47, tie: 11, banker: 42 },
        detectedPatterns: ['Ping-Pong'],
        streakLabel: '1x Banker',
        confidenceLabel: 'BAIXA',
      }
    ).record!;

    const stats = computeBacBoStatistics([r1, r2, r3], []);
    // r1 era NONE -> não conta; r2 acertou B (1 hit); r3 sugeriu P mas deu Tie (1 miss) => 2 sugestões, 1 acerto, 1 erro (50%)
    const ok =
      stats.overall.suggestions === 2 &&
      stats.overall.hits === 1 &&
      stats.overall.misses === 1 &&
      Math.abs(stats.overall.hitRatePct - 50) < 0.01;
    cases.push({
      name: 'Contagem de acertos e erros',
      passed: ok,
      details: ok
        ? 'NONE não contou como erro, Tie contabilizado como resultado independente (1/2 = 50%).'
        : `Contagem inesperada: ${stats.overall.hits}/${stats.overall.suggestions}.`,
    });
  } catch (e) {
    cases.push({ name: 'Contagem de acertos e erros', passed: false, details: String(e) });
  }

  // 9. Persistência da base de dados
  try {
    const original = loadRoundsSync();
    const sample = makeRoundsFromSeq(['P', 'B', 'T']);
    saveRounds(sample);
    const loaded = loadRoundsSync();
    const backup = createBackupPayload(loaded);
    const restored = parseBackupPayload(JSON.stringify(backup));
    // Restaura estado original do utilizador sem estragar os dados reais
    saveRounds(original);

    const ok =
      loaded.length === 3 &&
      restored.length === 3 &&
      restored[0].outcome === 'P' &&
      restored[2].outcome === 'T';
    cases.push({
      name: 'Persistência da base de dados',
      passed: ok,
      details: ok
        ? 'Gravação local, leitura síncrona, cópia de segurança e restauro validados sem perda.'
        : 'Falha na persistência local.',
    });
  } catch (e) {
    cases.push({ name: 'Persistência da base de dados', passed: false, details: String(e) });
  }

  const passed = cases.filter((c) => c.passed).length;
  return {
    executedAt: new Date().toLocaleTimeString('pt-PT', { hour12: false }),
    total: cases.length,
    passed,
    failed: cases.length - passed,
    cases,
  };
}
