import {
  evaluateStrategyPointInTime,
  PointInTimeSignal,
  QuantStrategyDefinition,
} from './strategyBuilder';

export type QuantWindowKey = '30' | '100' | '300' | 'all';

export interface StrategyWindowMetrics {
  windowKey: QuantWindowKey;
  label: string;
  entries: number;
  hits: number;
  hitRatePct: number;
  roiPct: number;
  netPnlAoa: number;
  maxDrawdownAoa: number;
  maxDrawdownPct: number;
}

export interface StrategyLearningEvaluation {
  strategy: QuantStrategyDefinition;
  currentSignal: PointInTimeSignal;
  overall: StrategyWindowMetrics;
  byWindow: StrategyWindowMetrics[];
  consistencyScore: number; // 0..100
  outOfSampleHitRatePct: number;
  outOfSampleRoiPct: number;
  outOfSampleEntries: number;
}

export interface ContinuousLearningReport {
  game: 'roulette' | 'aviator';
  totalRounds: number;
  evaluations: StrategyLearningEvaluation[];
  topStrategy: StrategyLearningEvaluation | null;
  activeBestSignal: StrategyLearningEvaluation | null;
  evolutionNotes: string[];
}

function backtestPointInTimeSlice(
  strategy: QuantStrategyDefinition,
  historyNewestFirst: number[],
  windowKey: QuantWindowKey,
  label: string,
  stakeAoa: number
): StrategyWindowMetrics {
  const slice =
    windowKey === 'all'
      ? historyNewestFirst
      : historyNewestFirst.slice(0, Math.min(historyNewestFirst.length, Number(windowKey)));

  // Converte para ordem cronológica: index 0 é a mais antiga, index N-1 é a mais recente
  const chrono = [...slice].reverse();
  let entries = 0;
  let hits = 0;
  let netPnlAoa = 0;
  let peakEquity = 0;
  let maxDrawdownAoa = 0;

  for (let i = 3; i < chrono.length; i++) {
    // Passa apenas histórico ANTERIOR ao resultado i (mais recente primeiro!)
    const historyBeforeNewestFirst = chrono.slice(0, i).reverse();
    const sig = evaluateStrategyPointInTime(strategy, historyBeforeNewestFirst);
    if (!sig.active) continue;

    const actual = chrono[i];
    const hit = sig.isHit(actual);
    const pnl = hit ? stakeAoa * (sig.payoutMultiplier - 1) : -stakeAoa;

    entries++;
    if (hit) hits++;
    netPnlAoa += pnl;
    if (netPnlAoa > peakEquity) peakEquity = netPnlAoa;
    const dd = peakEquity - netPnlAoa;
    if (dd > maxDrawdownAoa) maxDrawdownAoa = dd;
  }

  const staked = entries * stakeAoa;
  const hitRatePct = entries > 0 ? (hits / entries) * 100 : 0;
  const roiPct = staked > 0 ? (netPnlAoa / staked) * 100 : 0;
  const baseRef = Math.max(stakeAoa * 10, staked);
  const maxDrawdownPct = baseRef > 0 ? Math.min(100, (maxDrawdownAoa / baseRef) * 100) : 0;

  return {
    windowKey,
    label,
    entries,
    hits,
    hitRatePct,
    roiPct,
    netPnlAoa,
    maxDrawdownAoa,
    maxDrawdownPct,
  };
}

export function evaluateContinuousLearning(params: {
  game: 'roulette' | 'aviator';
  historyNewestFirst: number[];
  strategies: QuantStrategyDefinition[];
  stakeAoa: number;
}): ContinuousLearningReport {
  const { game, historyNewestFirst, strategies, stakeAoa } = params;
  const gameStrategies = strategies.filter((s) => s.game === game && s.enabled);

  const windowSpecs: Array<{ key: QuantWindowKey; label: string }> = [
    { key: '30', label: 'Últimas 30' },
    { key: '100', label: 'Últimas 100' },
    { key: '300', label: 'Últimas 300' },
    { key: 'all', label: 'Todo Histórico' },
  ];

  // Divide estritamente para OOS: primeiros 65% treino, últimos 35% validação fora da amostra
  const chronoAll = [...historyNewestFirst].reverse();
  const splitIdx = Math.max(6, Math.floor(chronoAll.length * 0.65));

  const evaluations: StrategyLearningEvaluation[] = gameStrategies.map((strategy) => {
    const byWindow = windowSpecs.map((w) =>
      backtestPointInTimeSlice(strategy, historyNewestFirst, w.key, w.label, stakeAoa)
    );
    const overall = byWindow[byWindow.length - 1];

    // Out-of-Sample estrito (apenas no terço final cronológico)
    let oosEntries = 0;
    let oosHits = 0;
    let oosPnl = 0;
    if (chronoAll.length >= 16) {
      for (let i = splitIdx; i < chronoAll.length; i++) {
        const beforeNewest = chronoAll.slice(0, i).reverse();
        const sig = evaluateStrategyPointInTime(strategy, beforeNewest);
        if (!sig.active) continue;
        oosEntries++;
        const hit = sig.isHit(chronoAll[i]);
        if (hit) oosHits++;
        oosPnl += hit ? stakeAoa * (sig.payoutMultiplier - 1) : -stakeAoa;
      }
    }

    const outOfSampleHitRatePct = oosEntries > 0 ? (oosHits / oosEntries) * 100 : overall.hitRatePct;
    const outOfSampleRoiPct =
      oosEntries > 0 ? (oosPnl / (oosEntries * stakeAoa)) * 100 : overall.roiPct;

    // Score de consistência: combina ROI, estabilidade entre janelas e penalização por drawdown
    const w30 = byWindow[0];
    const w100 = byWindow[1];
    const stabilityPenalty =
      w30.entries >= 3 && w100.entries >= 5
        ? Math.min(25, Math.abs(w30.hitRatePct - w100.hitRatePct) * 0.5)
        : 10;
    const ddPenalty = Math.min(35, overall.maxDrawdownPct * 0.6);
    const roiBonus = Math.max(-25, Math.min(35, outOfSampleRoiPct * 0.8));
    const sampleBonus = overall.entries >= 10 ? 15 : overall.entries >= 4 ? 7 : 0;

    const consistencyScore = Math.max(
      0,
      Math.min(100, Math.round(50 + roiBonus + sampleBonus - stabilityPenalty - ddPenalty))
    );

    const currentSignal = evaluateStrategyPointInTime(strategy, historyNewestFirst);

    return {
      strategy,
      currentSignal,
      overall,
      byWindow,
      consistencyScore,
      outOfSampleHitRatePct,
      outOfSampleRoiPct,
      outOfSampleEntries: oosEntries,
    };
  });

  evaluations.sort(
    (a, b) =>
      b.consistencyScore - a.consistencyScore ||
      b.outOfSampleRoiPct - a.outOfSampleRoiPct ||
      b.overall.hitRatePct - a.overall.hitRatePct
  );

  const topStrategy = evaluations[0] ?? null;
  const activeBestSignal =
    evaluations.find((ev) => ev.currentSignal.active) ?? null;

  const evolutionNotes: string[] = [];
  if (historyNewestFirst.length < 16) {
    evolutionNotes.push(
      `Recolher >= 16 rodadas (atual: ${historyNewestFirst.length}) para habilitar validação Out-of-Sample e evolução.`
    );
  } else if (topStrategy) {
    evolutionNotes.push(
      `Melhor consistência atual: "${topStrategy.strategy.name}" (Score ${topStrategy.consistencyScore}/100 · OOS ${topStrategy.outOfSampleHitRatePct.toFixed(
        1
      )}% em ${topStrategy.outOfSampleEntries} entradas).`
    );
  }

  return {
    game,
    totalRounds: historyNewestFirst.length,
    evaluations,
    topStrategy,
    activeBestSignal,
    evolutionNotes,
  };
}

function generateMutatedVariants(base: QuantStrategyDefinition): QuantStrategyDefinition[] {
  const variants: QuantStrategyDefinition[] = [];
  const p = base.params;
  const tag = Date.now().toString(36).slice(-4);

  if (base.ruleType === 'roulette_absence') {
    const cur = p.minDelay ?? 5;
    for (const d of [cur - 1, cur + 1, cur + 2].filter((x) => x >= 3 && x <= 10)) {
      variants.push({
        ...base,
        id: `${base.id}_evo_d${d}_${tag}`,
        name: `${base.name.split(' (')[0]} (Atraso >= ${d} · Evoluída)`,
        isCustom: true,
        isEvolved: true,
        parentId: base.id,
        params: { ...p, minDelay: d },
      });
    }
  } else if (base.ruleType === 'roulette_streak_break' || base.ruleType === 'roulette_streak_follow') {
    const cur = p.minStreak ?? 3;
    for (const s of [cur + 1, cur - 1].filter((x) => x >= 2 && x <= 6)) {
      variants.push({
        ...base,
        id: `${base.id}_evo_s${s}_${tag}`,
        name: `${base.name.split(' (')[0]} (${s}x+ · Evoluída)`,
        isCustom: true,
        isEvolved: true,
        parentId: base.id,
        params: { ...p, minStreak: s },
      });
    }
  } else if (base.ruleType === 'aviator_post_low_recovery') {
    const curStreak = p.minStreak ?? 2;
    const curTarget = p.targetMultiplier ?? 1.55;
    const combos = [
      { minStreak: Math.min(4, curStreak + 1), targetMultiplier: 1.45 },
      { minStreak: Math.min(4, curStreak + 1), targetMultiplier: 1.65 },
      { minStreak: curStreak, targetMultiplier: Math.max(1.25, Math.round((curTarget - 0.15) * 100) / 100) },
    ];
    for (const c of combos) {
      variants.push({
        ...base,
        id: `${base.id}_evo_${c.minStreak}s_${Math.round(c.targetMultiplier * 100)}_${tag}`,
        name: `Pós-Baixo ${c.minStreak}x -> ${c.targetMultiplier.toFixed(2)}x (Evoluída)`,
        isCustom: true,
        isEvolved: true,
        parentId: base.id,
        params: { ...p, minStreak: c.minStreak, targetMultiplier: c.targetMultiplier },
      });
    }
  } else if (base.ruleType === 'aviator_window_frequency') {
    const curHit = p.minHitRatePct ?? 53;
    for (const delta of [-5, 5, 8]) {
      const nextHit = Math.max(45, Math.min(75, curHit + delta));
      const nextTarget = delta > 0 ? 1.5 : 1.85;
      variants.push({
        ...base,
        id: `${base.id}_evo_f${nextHit}_${tag}`,
        name: `Freq. >= ${nextTarget.toFixed(2)}x (${nextHit}% · Evoluída)`,
        isCustom: true,
        isEvolved: true,
        parentId: base.id,
        params: { ...p, minHitRatePct: nextHit, targetMultiplier: nextTarget },
      });
    }
  } else if (base.ruleType === 'aviator_conservative_stable') {
    const curLook = p.lookbackNoInstant ?? 3;
    for (const nextLook of [curLook + 1, curLook + 2].filter((x) => x <= 6)) {
      variants.push({
        ...base,
        id: `${base.id}_evo_l${nextLook}_${tag}`,
        name: `Saída Estável 1.40x (${nextLook} rod. · Evoluída)`,
        isCustom: true,
        isEvolved: true,
        parentId: base.id,
        params: { ...p, lookbackNoInstant: nextLook, targetMultiplier: 1.4 },
      });
    }
  }

  return variants;
}

/**
 * Gera variações das estratégias ativas, testa Out-of-Sample e promove apenas
 * variantes que superam o baseline em consistência e baixo drawdown.
 */
export function evolveTopStrategies(params: {
  game: 'roulette' | 'aviator';
  historyNewestFirst: number[];
  existingStrategies: QuantStrategyDefinition[];
  stakeAoa: number;
}): {
  promoted: QuantStrategyDefinition[];
  rejectedCount: number;
  summaryNote: string;
} {
  const { game, historyNewestFirst, existingStrategies, stakeAoa } = params;
  if (historyNewestFirst.length < 24) {
    return {
      promoted: [],
      rejectedCount: 0,
      summaryNote: `Mínimo 24 rodadas para evoluir estratégias Out-of-Sample (atual: ${historyNewestFirst.length}).`,
    };
  }

  const baseReport = evaluateContinuousLearning({
    game,
    historyNewestFirst,
    strategies: existingStrategies,
    stakeAoa,
  });

  const bestBaseScore = baseReport.topStrategy?.consistencyScore ?? 50;
  const bestBaseDd = baseReport.topStrategy?.overall.maxDrawdownPct ?? 100;

  const activeBases = existingStrategies
    .filter((s) => s.game === game && s.enabled && !s.isEvolved)
    .slice(0, 4);

  const candidatePool: QuantStrategyDefinition[] = [];
  for (const b of activeBases) {
    candidatePool.push(...generateMutatedVariants(b));
  }

  if (candidatePool.length === 0) {
    return {
      promoted: [],
      rejectedCount: 0,
      summaryNote: 'Nenhuma variação elegível gerada para o conjunto atual.',
    };
  }

  const candidateReport = evaluateContinuousLearning({
    game,
    historyNewestFirst,
    strategies: candidatePool,
    stakeAoa,
  });

  const existingNames = new Set(existingStrategies.map((s) => s.name));
  const promoted: QuantStrategyDefinition[] = [];
  let rejectedCount = 0;

  for (const ev of candidateReport.evaluations) {
    const meetsEntries = ev.overall.entries >= 4;
    const beatsBaseline =
      ev.consistencyScore >= bestBaseScore + 2 &&
      ev.overall.maxDrawdownPct <= Math.max(25, bestBaseDd + 5);
    const positiveOrBetterRoi = ev.outOfSampleRoiPct > -5;

    if (meetsEntries && beatsBaseline && positiveOrBetterRoi && !existingNames.has(ev.strategy.name)) {
      promoted.push(ev.strategy);
      existingNames.add(ev.strategy.name);
      if (promoted.length >= 2) break;
    } else {
      rejectedCount++;
    }
  }

  const summaryNote =
    promoted.length > 0
      ? `Motor de Evolução promoveu ${promoted.length} variante(s) validada(s) fora da amostra (${rejectedCount} descartadas por menor consistência).`
      : `Nenhuma mutação superou as estratégias atuais em consistência e baixo drawdown (${rejectedCount} testadas e rejeitadas).`;

  return { promoted, rejectedCount, summaryNote };
}
