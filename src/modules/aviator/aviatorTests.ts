import {
  analyzeAviatorLocalAi,
  answerAviatorQuestionLocally,
} from './aviatorAiAnalyzer';
import {
  confirmManualTicketAction,
  createInitialAutoBetState,
  evaluateAutoBetOpportunity,
  settleActiveAutoBetOnCrash,
} from './aviatorAutoBetManager';
import {
  applyBankrollSettlement,
  computeSafeFlatStake,
  evaluateBankrollLimits,
} from './aviatorBankrollManager';
import {
  createInitialCashOutState,
  evaluateLiveCashOutTarget,
  recordCashOutOutcomeOnCrash,
} from './aviatorCashOutManager';
import {
  createAviatorBackupPayload,
  createInitialBankrollState,
  DEFAULT_AUTOBET_CONFIG,
  DEFAULT_BANKROLL_CONFIG,
  DEFAULT_CASHOUT_CONFIG,
  exportAviatorRoundsToCsv,
  parseAviatorBackupPayload,
} from './aviatorDatabase';
import { runAviatorLearningEngine } from './aviatorLearningEngine';
import { parseAviatorHistoryText, parseAviatorMultiplierToken } from './aviatorOcr';
import { analyzeAviatorPatterns } from './aviatorPatternEngine';
import {
  buildAviatorRoundRecord,
  classifyAviatorCategory,
  isValidAviatorMultiplier,
  processLiveMultiplierTransition,
  reconcileAviatorStrip,
} from './aviatorResultProcessor';
import { runAviatorStrategyEngine } from './aviatorStrategyEngine';
import {
  AviatorLiveState,
  AviatorRoundRecord,
  AviatorTestCaseResult,
  AviatorTestReport,
} from './types';

function assert(cond: boolean, name: string, details: string): AviatorTestCaseResult {
  return { name, passed: cond, details: cond ? `OK: ${details}` : `FALHOU: ${details}` };
}

export function runAllAviatorTests(): AviatorTestReport {
  const cases: AviatorTestCaseResult[] = [];

  // 1. OCR de multiplicadores e rejeição de tokens inválidos
  const m1 = parseAviatorMultiplierToken('1.39x');
  const m2 = parseAviatorMultiplierToken('48,92X');
  const mBad = parseAviatorMultiplierToken('0.75x');
  const stripParsed = parseAviatorHistoryText('1.38x 1.10x 1.60x 1.27x 3.20x 4.58x 48.92x');
  cases.push(
    assert(
      m1 === 1.39 && m2 === 48.92 && mBad === null && stripParsed.multipliers.length === 7,
      '1. OCR e Parsing de Multiplicadores',
      `Tokens=${m1}/${m2}, rejeitou=${String(mBad)}, faixa=${stripParsed.multipliers.length} itens`
    )
  );

  // 2. Validação de intervalos (<1.00 inválido) e classificação por categorias
  const validRec = buildAviatorRoundRecord({
    multiplier: 12.4,
    existingRounds: [],
    source: 'manual',
  });
  const invalidRec = buildAviatorRoundRecord({
    multiplier: 0.99,
    existingRounds: [],
    source: 'manual',
  });
  cases.push(
    assert(
      Boolean(validRec.valid && classifyAviatorCategory(12.4) === 'over_10_00') &&
        !invalidRec.valid &&
        !isValidAviatorMultiplier(-2),
      '2. Classificação e Validação de Intervalos',
      `12.40x=${classifyAviatorCategory(12.4)}, 0.99x rejeitado=${!invalidRec.valid}`
    )
  );

  // 3. Máquina de estados ao vivo (voo branco -> crash vermelho -> sem duplicação)
  const initLive: AviatorLiveState = {
    phase: 'WAITING',
    currentMultiplier: null,
    lastCrashMultiplier: null,
    isCrashedColor: false,
    roundStartedAt: null,
    lastUpdatedAt: null,
    ocrConfidence: 1,
    captureMode: 'integrated_browser',
    historyVisibleCount: 7,
  };
  const stepFly = processLiveMultiplierTransition({
    prevState: initLive,
    liveMultiplier: 1.39,
    isCrashedColor: false,
    ocrConfidence: 0.92,
    historyVisibleCount: 7,
    captureMode: 'integrated_browser',
    now: 1000,
  });
  const stepCrash1 = processLiveMultiplierTransition({
    prevState: stepFly.nextState,
    liveMultiplier: 2.15,
    isCrashedColor: true,
    ocrConfidence: 0.95,
    historyVisibleCount: 7,
    captureMode: 'integrated_browser',
    now: 2500,
  });
  const stepCrashDup = processLiveMultiplierTransition({
    prevState: stepCrash1.nextState,
    liveMultiplier: 2.15,
    isCrashedColor: true,
    ocrConfidence: 0.95,
    historyVisibleCount: 7,
    captureMode: 'integrated_browser',
    now: 3000,
  });
  cases.push(
    assert(
      stepFly.confirmedCrashMultiplier === null &&
        stepCrash1.confirmedCrashMultiplier === 2.15 &&
        stepCrashDup.confirmedCrashMultiplier === null,
      '3. Deteção de Início/Fim de Rodada e Anti-Duplicação',
      `Voo=${stepFly.nextPhase}, Crash=${stepCrash1.confirmedCrashMultiplier}, Duplicado bloqueado=${stepCrashDup.confirmedCrashMultiplier === null}`
    )
  );

  // 4. Reconciliação de faixa histórica (sem duplicar ao deslizar)
  const initialRounds: AviatorRoundRecord[] = [];
  const added1 = reconcileAviatorStrip({
    incomingNewestFirst: [1.38, 1.1, 1.6, 1.27, 3.2],
    isFullStrip: true,
    existingRounds: initialRounds,
    source: 'ocr_strip',
    ocrConfidence: 0.92,
  });
  const addedSame = reconcileAviatorStrip({
    incomingNewestFirst: [1.38, 1.1, 1.6, 1.27, 3.2],
    isFullStrip: true,
    existingRounds: added1,
    source: 'ocr_strip',
    ocrConfidence: 0.92,
  });
  const addedNew = reconcileAviatorStrip({
    incomingNewestFirst: [4.5, 1.38, 1.1, 1.6, 1.27],
    isFullStrip: true,
    existingRounds: added1,
    source: 'ocr_strip',
    ocrConfidence: 0.92,
  });
  cases.push(
    assert(
      added1.length === 5 &&
        addedSame.length === 0 &&
        addedNew.length === 1 &&
        addedNew[0].multiplier === 4.5,
      '4. Reconciliação Incremental da Faixa de Histórico',
      `Iniciais=${added1.length}, Repetida=${addedSame.length}, Nova=${addedNew[0]?.multiplier ?? 0}x`
    )
  );

  // 5. Persistência Backup JSON & Exportação CSV
  const backupJson = createAviatorBackupPayload(added1);
  const restored = parseAviatorBackupPayload(backupJson);
  const csv = exportAviatorRoundsToCsv(added1);
  cases.push(
    assert(
      restored.valid && restored.rounds.length === 5 && csv.split('\n').length === 6,
      '5. Backup JSON, Restauro e Exportação CSV',
      `Restauradas=${restored.rounds.length} rodadas, linhas CSV=${csv.split('\n').length}`
    )
  );

  // Construir série sintética de 60 rodadas para testar padrões, estratégias e aprendizagem
  const sampleMults = [
    1.12, 1.28, 2.45, 1.05, 3.1, 1.41, 1.33, 5.8, 1.22, 2.05,
    1.15, 1.18, 1.9, 1.34, 4.2, 1.48, 2.6, 1.09, 1.35, 11.4,
    1.21, 1.42, 2.18, 1.39, 1.1, 1.6, 1.27, 3.2, 4.58, 48.92,
    1.44, 1.29, 2.04, 1.16, 1.31, 6.2, 1.45, 1.38, 2.75, 1.08,
    1.49, 1.32, 3.65, 1.2, 1.14, 2.33, 1.46, 5.1, 1.25, 1.37,
    1.11, 1.4, 2.9, 1.26, 1.3, 4.1, 1.19, 2.15, 1.42, 3.05,
  ];
  const dataset: AviatorRoundRecord[] = [];
  sampleMults.forEach((m, idx) => {
    const res = buildAviatorRoundRecord({
      multiplier: m,
      existingRounds: dataset,
      source: 'manual',
      timestamp: 1700000000000 + idx * 15000,
    });
    if (res.record) dataset.push(res.record);
  });

  // 6. Motor de padrões e desagregação sem falsas garantias
  const patReport = analyzeAviatorPatterns(dataset);
  cases.push(
    assert(
      patReport.discovered.length >= 6 && patReport.disclaimer.includes('independente'),
      '6. Motor de Descoberta de Padrões',
      `${patReport.discovered.length} grupos analisados, aviso honesto presente`
    )
  );

  // 7. Motor de 7 estratégias e backtesting
  const stratReport = runAviatorStrategyEngine(dataset, 100);
  const totalStrategies = stratReport.strategies.length;
  cases.push(
    assert(
      totalStrategies === 7 &&
        stratReport.strategies.every((s) => Number.isFinite(s.simulatedRoiPct)),
      '7. 7 Estratégias + Backtesting Simulado',
      `${totalStrategies} estratégias avaliadas, melhor ROI=${stratReport.rankingByRoi[0]?.simulatedRoiPct.toFixed(1)}%`
    )
  );

  // 8. Motor de aprendizagem contínua (múltiplas janelas + treino/validação)
  const learnReport = runAviatorLearningEngine({
    rounds: dataset,
    strategyReport: stratReport,
    selectedWindow: '50',
    stakeAoa: 100,
    savedSnapshots: [],
  });
  cases.push(
    assert(
      learnReport.windows.length === 5 && learnReport.overfittingRisk !== 'INSUFICIENTE',
      '8. Aprendizagem Contínua & Validação Fora da Amostra',
      `5 janelas avaliadas, risco overfitting=${learnReport.overfittingRisk}`
    )
  );

  // 9. Política anti-Martingale e Limites Obrigatórios da Banca
  const bkCfg = { ...DEFAULT_BANKROLL_CONFIG, baseStakeAoa: 100, sessionMaxLossAoa: 200, pauseAfterConsecutiveLosses: 2 };
  let bkState = createInitialBankrollState(bkCfg);
  const martingaleAttempt = computeSafeFlatStake(400, bkCfg, bkState);
  bkState = applyBankrollSettlement(bkState, 100, 1.5, 1.1); // perda 1 (-100)
  bkState = applyBankrollSettlement(bkState, 100, 1.5, 1.2); // perda 2 (-100 => perda sessão 200)
  const limitStatus = evaluateBankrollLimits(bkCfg, bkState);
  cases.push(
    assert(
      martingaleAttempt.stakeAoa === 100 && limitStatus.blocked && limitStatus.reasons.length >= 2,
      '9. Gestão de Banca: Bloqueio Anti-Martingale e Limites Obrigatórios',
      `Stake limitada=${martingaleAttempt.stakeAoa} AOA, bloqueado após 2 perdas=${limitStatus.blocked}`
    )
  );

  // 10. Auto Bet Manager: Simulação e Liquidação
  const autoCfg = {
    ...DEFAULT_AUTOBET_CONFIG,
    enabled: true,
    mode: 'simulation' as const,
    strategyId: 'conservative_target' as const,
    minConfidencePct: 40,
  };
  const freshBk = createInitialBankrollState(DEFAULT_BANKROLL_CONFIG);
  const autoEval = evaluateAutoBetOpportunity({
    autoCfg,
    autoState: createInitialAutoBetState(),
    bankrollCfg: DEFAULT_BANKROLL_CONFIG,
    bankrollState: freshBk,
    strategyReport: stratReport,
    nextRoundNumber: dataset.length + 1,
    nowHour: 12,
  });
  const settled = settleActiveAutoBetOnCrash({
    autoState: autoEval.nextAutoState,
    bankrollState: freshBk,
    crashMultiplier: 2.0,
  });
  cases.push(
    assert(
      Boolean(autoEval.ticketCreated) &&
        settled.nextAutoState.operations[0]?.status === 'WON' &&
        settled.nextBankrollState.netPnlAoa > 0,
      '10. Simulação de Auto Bet & Liquidação P&L',
      `Ticket=${autoEval.ticketCreated?.targetCashout}x, P&L=+${settled.nextBankrollState.netPnlAoa} AOA`
    )
  );

  // 11. Preparação Manual exige confirmação explícita
  const manEval = evaluateAutoBetOpportunity({
    autoCfg: { ...autoCfg, mode: 'manual_prepared' },
    autoState: createInitialAutoBetState(),
    bankrollCfg: DEFAULT_BANKROLL_CONFIG,
    bankrollState: freshBk,
    strategyReport: stratReport,
    nextRoundNumber: dataset.length + 1,
    nowHour: 12,
  });
  const manConfirmed = confirmManualTicketAction(manEval.nextAutoState, true);
  cases.push(
    assert(
      manEval.nextAutoState.pendingManualTicket?.status === 'PENDING_CONFIRMATION' &&
        manConfirmed.pendingManualTicket === null &&
        manConfirmed.operations[0]?.status === 'UNCONFIRMED',
      '11. Modo Preparação Manual com Confirmação Explícita',
      `Pendente criado e convertido após confirmação sem falso sucesso automático`
    )
  );

  // 12. Cash Out Manager alerta ao vivo no alvo
  const coCfg = { ...DEFAULT_CASHOUT_CONFIG, enabled: true, targetMultiplier: 1.5 };
  const coAlert = evaluateLiveCashOutTarget(coCfg, createInitialCashOutState(), {
    ...stepFly.nextState,
    phase: 'FLYING',
    currentMultiplier: 1.58,
  });
  const coClosed = recordCashOutOutcomeOnCrash(coCfg, coAlert, 2.2, true);
  cases.push(
    assert(
      coAlert.alertActiveNow && coClosed.reachedCount === 1 && !coClosed.alertActiveNow,
      '12. Cash Out Manager: Alerta em Tempo Real e Registo',
      `Alerta ativo em 1.58x=${coAlert.alertActiveNow}, atingidos=${coClosed.reachedCount}`
    )
  );

  // 13. IA Local: Analisador Pós-Pico, Matriz de Markov e Detetor de Regimes
  const aiReport = analyzeAviatorLocalAi(dataset);
  const bucket10 = aiReport.postPeakBuckets.find((b) => b.threshold === 10);
  const markovTotal = aiReport.markovRows.reduce((acc, r) => acc + r.sampleCount, 0);
  cases.push(
    assert(
      aiReport.postPeakBuckets.length === 4 &&
        (bucket10?.totalOccurrences ?? 0) === 2 &&
        markovTotal === dataset.length - 1 &&
        aiReport.regime.regime !== 'INSUFICIENTE',
      '13. IA Pós-Pico, Matriz Markov & Detetor de Regimes',
      `>=10x=${bucket10?.totalOccurrences ?? 0}x, Transições=${markovTotal}, Regime=${aiReport.regime.regimeLabel}`
    )
  );

  // 14. Q&A Estatístico Local Offline Pós-Pico
  const qaAnswer = answerAviatorQuestionLocally(
    dataset,
    aiReport,
    'Quando sai número muito alto acima de 10x vem números baixos depois?'
  );
  cases.push(
    assert(
      qaAnswer.includes('Análise Pós-Pico') && qaAnswer.includes('independente'),
      '14. Resposta Offline da IA sobre Pós-Pico',
      `Diagnóstico gerado (${qaAnswer.length} chars) com aviso de independência RNG`
    )
  );

  const passedCount = cases.filter((c) => c.passed).length;
  return {
    passedCount,
    totalCount: cases.length,
    allPassed: passedCount === cases.length,
    cases,
  };
}
