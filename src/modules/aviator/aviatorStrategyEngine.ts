import {
  AviatorRoundRecord,
  AviatorStrategyEngineReport,
  AviatorStrategyId,
  AviatorStrategyResult,
  AviatorStrategySignal,
  AviatorSuggestionSnapshot,
} from './types';

interface StrategyDefinition {
  id: AviatorStrategyId;
  name: string;
  description: string;
  targetMultiplier: number;
  evaluateAt: (historyBefore: AviatorRoundRecord[]) => AviatorStrategySignal;
}

const STRATEGIES: StrategyDefinition[] = [
  {
    id: 'conservative_target',
    name: 'Estratégia Conservadora (1.30x)',
    description: 'Busca saídas curtas em 1.30x após estabilização sem crash instantâneo < 1.10x.',
    targetMultiplier: 1.3,
    evaluateAt: (hist) => {
      if (hist.length < 2) {
        return { active: false, targetMultiplier: 1.3, score: 0, reason: 'Aguardando >= 2 rodadas.' };
      }
      const last = hist[hist.length - 1];
      const last3 = hist.slice(-3);
      const instantCrashes = last3.filter((r) => r.multiplier < 1.1).length;
      if (last.multiplier >= 1.15 && instantCrashes === 0) {
        return {
          active: true,
          targetMultiplier: 1.3,
          score: 68,
          reason: `Últimas ${last3.length} rodadas sem crash instantâneo (<1.10x). Alvo 1.30x.`,
        };
      }
      return {
        active: false,
        targetMultiplier: 1.3,
        score: 25,
        reason: 'Crash muito baixo recente (<1.10x); aguardar estabilização.',
      };
    },
  },
  {
    id: 'intermediate_target',
    name: 'Estratégia Intermediária (1.80x)',
    description: 'Alvo equilibrado em 1.80x quando a frequência recente >= 1.80x acompanha a janela.',
    targetMultiplier: 1.8,
    evaluateAt: (hist) => {
      if (hist.length < 5) {
        return { active: false, targetMultiplier: 1.8, score: 0, reason: 'Aguardando >= 5 rodadas.' };
      }
      const recent10 = hist.slice(-Math.min(10, hist.length));
      const hits = recent10.filter((r) => r.multiplier >= 1.8).length;
      const pct = (hits / recent10.length) * 100;
      const active = pct >= 45;
      return {
        active,
        targetMultiplier: 1.8,
        score: active ? 62 : 30,
        reason: active
          ? `${hits}/${recent10.length} rodadas recentes atingiram >= 1.80x (${pct.toFixed(0)}%).`
          : `Frequência recente de >= 1.80x baixa (${pct.toFixed(0)}%).`,
      };
    },
  },
  {
    id: 'high_multiplier',
    name: 'Estratégia Multiplicador Alto (3.50x)',
    description: 'Observa janelas com presença de picos altos (>= 3.50x) sem entrada forçada.',
    targetMultiplier: 3.5,
    evaluateAt: (hist) => {
      if (hist.length < 8) {
        return { active: false, targetMultiplier: 3.5, score: 0, reason: 'Aguardando >= 8 rodadas.' };
      }
      const recent12 = hist.slice(-Math.min(12, hist.length));
      const highCount = recent12.filter((r) => r.multiplier >= 3.5).length;
      const last = hist[hist.length - 1];
      const active = highCount >= 2 && last.multiplier < 10.0;
      return {
        active,
        targetMultiplier: 3.5,
        score: active ? 52 : 20,
        reason: active
          ? `${highCount} voos >= 3.50x nas últimas ${recent12.length} rodadas.`
          : 'Pouca atividade >= 3.50x na janela recente.',
      };
    },
  },
  {
    id: 'sequence_pattern',
    name: 'Estratégia Baseada em Sequências (1.50x)',
    description: 'Avalia comportamento histórico logo após 2 rodadas consecutivas abaixo de 1.50x.',
    targetMultiplier: 1.5,
    evaluateAt: (hist) => {
      if (hist.length < 3) {
        return { active: false, targetMultiplier: 1.5, score: 0, reason: 'Aguardando >= 3 rodadas.' };
      }
      const a = hist[hist.length - 2].multiplier < 1.5;
      const b = hist[hist.length - 1].multiplier < 1.5;
      if (a && b) {
        return {
          active: true,
          targetMultiplier: 1.5,
          score: 64,
          reason: 'Sinal de sequência: 2 rodadas seguidas < 1.50x. Alvo 1.50x.',
        };
      }
      return {
        active: false,
        targetMultiplier: 1.5,
        score: 18,
        reason: 'Sem sequência dupla < 1.50x ativa.',
      };
    },
  },
  {
    id: 'frequency_window',
    name: 'Estratégia Baseada em Frequência (1.60x)',
    description: 'Compara taxa recente de 1.60x (últimas 15 rodadas) frente à taxa global.',
    targetMultiplier: 1.6,
    evaluateAt: (hist) => {
      if (hist.length < 15) {
        return { active: false, targetMultiplier: 1.6, score: 0, reason: 'Aguardando >= 15 rodadas.' };
      }
      const globalHits = hist.filter((r) => r.multiplier >= 1.6).length / hist.length;
      const recent = hist.slice(-15);
      const recentHits = recent.filter((r) => r.multiplier >= 1.6).length / recent.length;
      const active = recentHits >= 0.52 && recentHits >= globalHits * 0.9;
      return {
        active,
        targetMultiplier: 1.6,
        score: active ? 65 : 28,
        reason: active
          ? `Janela 15 rod.: ${(recentHits * 100).toFixed(0)}% >= 1.60x (global ${(globalHits * 100).toFixed(0)}%).`
          : `Frequência recente de 1.60x em ${(recentHits * 100).toFixed(0)}%.`,
      };
    },
  },
  {
    id: 'block_cluster',
    name: 'Estratégia Baseada em Blocos (2.00x)',
    description: 'Identifica blocos recentes de roxos/rosa (>= 2.00x) após um salto >= 2.00x.',
    targetMultiplier: 2.0,
    evaluateAt: (hist) => {
      if (hist.length < 6) {
        return { active: false, targetMultiplier: 2.0, score: 0, reason: 'Aguardando >= 6 rodadas.' };
      }
      const recent6 = hist.slice(-6);
      const above2Count = recent6.filter((r) => r.multiplier >= 2.0).length;
      const last = hist[hist.length - 1];
      const active = above2Count >= 3 && last.multiplier >= 2.0 && last.multiplier < 8.0;
      return {
        active,
        targetMultiplier: 2.0,
        score: active ? 58 : 22,
        reason: active
          ? `Bloco forte: ${above2Count}/6 voos >= 2.00x com último em ${last.multiplier.toFixed(2)}x.`
          : 'Sem bloco ativo de voos >= 2.00x.',
      };
    },
  },
  {
    id: 'combined_consensus',
    name: 'Estratégia Combinada (Consenso 1.45x)',
    description: 'Só ativa entrada quando pelo menos 3 das estratégias anteriores concordam simultaneamente.',
    targetMultiplier: 1.45,
    evaluateAt: (hist) => {
      if (hist.length < 6) {
        return { active: false, targetMultiplier: 1.45, score: 0, reason: 'Aguardando >= 6 rodadas.' };
      }
      const subSignals = STRATEGIES.slice(0, 6).map((s) => s.evaluateAt(hist));
      const activeCount = subSignals.filter((s) => s.active).length;
      const active = activeCount >= 3;
      return {
        active,
        targetMultiplier: 1.45,
        score: active ? Math.min(82, 50 + activeCount * 6) : 20 + activeCount * 8,
        reason: active
          ? `Consenso de ${activeCount}/6 estratégias independentes. Alvo conservador 1.45x.`
          : `Consenso insuficiente (${activeCount}/6 ativas; mínimo 3).`,
      };
    },
  },
];

export function backtestSingleStrategy(
  def: StrategyDefinition,
  rounds: AviatorRoundRecord[],
  stakeAoa = 100
): AviatorStrategyResult {
  let evaluatedEntries = 0;
  let hits = 0;
  let misses = 0;
  let netPnl = 0;
  const entryPnls: number[] = [];
  const entryHits: boolean[] = [];

  for (let i = 0; i < rounds.length; i++) {
    const historyBefore = rounds.slice(0, i);
    const sig = def.evaluateAt(historyBefore);
    if (!sig.active) continue;

    const target = sig.targetMultiplier ?? def.targetMultiplier;
    const actual = rounds[i].multiplier;
    const isHit = actual >= target;
    const pnl = isHit ? stakeAoa * (target - 1) : -stakeAoa;

    evaluatedEntries++;
    if (isHit) hits++;
    else misses++;
    netPnl += pnl;
    entryPnls.push(pnl);
    entryHits.push(isHit);
  }

  const staked = evaluatedEntries * stakeAoa;
  const hitRatePct = evaluatedEntries > 0 ? (hits / evaluatedEntries) * 100 : 0;
  const roiPct = staked > 0 ? (netPnl / staked) * 100 : 0;

  let best20RoiPct = 0;
  let worst20RoiPct = 0;
  if (entryPnls.length >= 5) {
    const winSize = Math.min(20, entryPnls.length);
    best20RoiPct = -Infinity;
    worst20RoiPct = Infinity;
    for (let i = 0; i <= entryPnls.length - winSize; i++) {
      let winSum = 0;
      for (let j = i; j < i + winSize; j++) winSum += entryPnls[j];
      const wRoi = (winSum / (winSize * stakeAoa)) * 100;
      if (wRoi > best20RoiPct) best20RoiPct = wRoi;
      if (wRoi < worst20RoiPct) worst20RoiPct = wRoi;
    }
    if (!Number.isFinite(best20RoiPct)) best20RoiPct = roiPct;
    if (!Number.isFinite(worst20RoiPct)) worst20RoiPct = roiPct;
  }

  const recentHitsSlice = entryHits.slice(-25);
  const recent25Entries = recentHitsSlice.length;
  const recent25Hits = recentHitsSlice.filter(Boolean).length;
  const recent25HitRatePct =
    recent25Entries > 0 ? (recent25Hits / recent25Entries) * 100 : 0;

  const degradationFlag =
    evaluatedEntries >= 20 &&
    recent25Entries >= 10 &&
    recent25HitRatePct < hitRatePct - 10;

  const currentSignal = def.evaluateAt(rounds);

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    targetMultiplier: def.targetMultiplier,
    evaluatedEntries,
    hits,
    misses,
    hitRatePct,
    simulatedStakedAoa: staked,
    simulatedNetPnlAoa: netPnl,
    simulatedRoiPct: roiPct,
    best20RoiPct,
    worst20RoiPct,
    recent25HitRatePct,
    recent25Entries,
    degradationFlag,
    currentSignal,
  };
}

export function runAviatorStrategyEngine(
  rounds: AviatorRoundRecord[],
  stakeAoa = 100
): AviatorStrategyEngineReport {
  const strategies = STRATEGIES.map((def) => backtestSingleStrategy(def, rounds, stakeAoa));

  const rankingByRoi = [...strategies].sort((a, b) => {
    if (a.evaluatedEntries === 0 && b.evaluatedEntries === 0) return 0;
    if (a.evaluatedEntries === 0) return 1;
    if (b.evaluatedEntries === 0) return -1;
    return b.simulatedRoiPct - a.simulatedRoiPct || b.hitRatePct - a.hitRatePct;
  });

  const rankingByHitRate = [...strategies].sort((a, b) => {
    if (a.evaluatedEntries === 0 && b.evaluatedEntries === 0) return 0;
    if (a.evaluatedEntries === 0) return 1;
    if (b.evaluatedEntries === 0) return -1;
    return b.hitRatePct - a.hitRatePct || b.simulatedRoiPct - a.simulatedRoiPct;
  });

  const activeStrategies = strategies.filter((s) => s.currentSignal.active);

  // Recomendada prioriza estratégia com sinal ativo e melhor histórico (ou melhor ROI quando >= 10 entradas)
  let recommended: AviatorStrategyResult | null = null;
  if (activeStrategies.length > 0) {
    recommended =
      [...activeStrategies].sort((a, b) => {
        const aScore = a.evaluatedEntries >= 10 ? a.simulatedRoiPct + a.currentSignal.score : a.currentSignal.score;
        const bScore = b.evaluatedEntries >= 10 ? b.simulatedRoiPct + b.currentSignal.score : b.currentSignal.score;
        return bScore - aScore;
      })[0] ?? null;
  } else if (rankingByRoi.length > 0 && rankingByRoi[0].evaluatedEntries > 0) {
    recommended = rankingByRoi[0];
  }

  let activeSnapshot: AviatorSuggestionSnapshot;
  if (rounds.length === 0) {
    activeSnapshot = {
      strategyId: 'NONE',
      strategyName: 'Sem dados',
      shouldEnter: false,
      targetMultiplier: null,
      confidencePct: 0,
      reason: 'Aguardando leitura ou registo de rodadas do Aviator.',
    };
  } else if (recommended && recommended.currentSignal.active) {
    activeSnapshot = {
      strategyId: recommended.id,
      strategyName: recommended.name,
      shouldEnter: true,
      targetMultiplier: recommended.currentSignal.targetMultiplier ?? recommended.targetMultiplier,
      confidencePct: recommended.currentSignal.score,
      reason: recommended.currentSignal.reason,
    };
  } else {
    activeSnapshot = {
      strategyId: 'NONE',
      strategyName: 'Aguardar',
      shouldEnter: false,
      targetMultiplier: null,
      confidencePct: 0,
      reason: 'Nenhuma estratégia com sinal estatístico ativo neste momento.',
    };
  }

  return {
    strategies,
    recommended,
    activeSnapshot,
    rankingByRoi,
    rankingByHitRate,
  };
}

export function getAllAviatorStrategyDefinitions() {
  return STRATEGIES;
}
