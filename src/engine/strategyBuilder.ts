import { getDozenOf, getRouletteColor, getWheelNeighbors, TIERS_NUMBERS, VOISINS_NUMBERS, ORPHELINS_NUMBERS } from './rouletteEngine';

export type QuantStrategyRuleType =
  | 'roulette_absence'
  | 'roulette_streak_break'
  | 'roulette_streak_follow'
  | 'roulette_sector_confluence'
  | 'aviator_conservative_stable'
  | 'aviator_post_low_recovery'
  | 'aviator_window_frequency'
  | 'aviator_purple_cluster';

export interface QuantStrategyParams {
  minDelay?: number;       // roulette_absence (ex: 5)
  minStreak?: number;      // roulette_streak_break/follow or aviator_post_low_recovery
  windowSize?: number;     // janela de observação (ex: 15..25)
  minConcentrationPct?: number; // setor roleta
  targetMultiplier?: number;    // Aviator alvo (ex: 1.50..3.00)
  lowThreshold?: number;        // Aviator teto baixo (ex: 1.50)
  minHitRatePct?: number;       // Aviator frequência mínima
  minPurpleCount?: number;      // Aviator contagem >=2x
  lookbackNoInstant?: number;   // Aviator rodadas sem <1.10x
}

export interface QuantStrategyDefinition {
  id: string;
  name: string;
  game: 'roulette' | 'aviator';
  enabled: boolean;
  isCustom: boolean;
  isEvolved: boolean;
  parentId?: string;
  ruleType: QuantStrategyRuleType;
  params: QuantStrategyParams;
  description: string;
}

export interface PointInTimeSignal {
  active: boolean;
  marketLabel: string;
  targetDescription: string;
  payoutMultiplier: number; // retorno total (ex: 2.0 para par/ímpar, 3.0 para dúzia, 1.50 para Aviator 1.50x)
  confidencePct: number;
  reason: string;
  isHit: (actualOutcome: number) => boolean;
}

const LS_KEY_STRATEGIES = 'quantlab_strategies_v1';

export const DEFAULT_QUANT_STRATEGIES: QuantStrategyDefinition[] = [
  {
    id: 'r_absence_dozen',
    name: 'Ausência de Dúzia (Atraso >= 5)',
    game: 'roulette',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'roulette_absence',
    params: { minDelay: 5 },
    description: 'Atua quando uma dúzia completa 5+ rodadas ausente, visando retorno estatístico (retorno 3x).',
  },
  {
    id: 'r_streak_break_color',
    name: 'Quebra de Corrida de Cor (3x+)',
    game: 'roulette',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'roulette_streak_break',
    params: { minStreak: 3 },
    description: 'Aponta para a cor oposta após 3+ saídas seguidas de Vermelho ou Preto.',
  },
  {
    id: 'r_streak_follow_color',
    name: 'Continuação de Tendência (3x+)',
    game: 'roulette',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'roulette_streak_follow',
    params: { minStreak: 3 },
    description: 'Acompanha corrida ativa de Vermelho/Preto quando o histórico sugere persistência.',
  },
  {
    id: 'r_sector_confluence',
    name: 'Confluência de Setor & Vizinhos ±2',
    game: 'roulette',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'roulette_sector_confluence',
    params: { windowSize: 20, minConcentrationPct: 48 },
    description: 'Foca no setor físico dominante (Voisins/Tiers/Orphelins) quando concentra >= 48% em 20 giros.',
  },
  {
    id: 'a_conservative_135',
    name: 'Aviator Saída Curta Estável (1.35x)',
    game: 'aviator',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'aviator_conservative_stable',
    params: { targetMultiplier: 1.35, lookbackNoInstant: 3 },
    description: 'Alvo 1.35x apenas quando as últimas 3 rodadas não tiveram crash instantâneo (<1.10x).',
  },
  {
    id: 'a_post_low_recovery_155',
    name: 'Recuperação Pós-Sequência Baixa (1.55x)',
    game: 'aviator',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'aviator_post_low_recovery',
    params: { minStreak: 2, lowThreshold: 1.5, targetMultiplier: 1.55 },
    description: 'Ativa após 2+ voos consecutivos abaixo de 1.50x buscando cashout em 1.55x.',
  },
  {
    id: 'a_window_freq_170',
    name: 'Frequência Recente >= 1.70x',
    game: 'aviator',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'aviator_window_frequency',
    params: { windowSize: 15, targetMultiplier: 1.7, minHitRatePct: 53 },
    description: 'Entra em 1.70x quando pelo menos 53% dos últimos 15 voos atingiram >= 1.70x.',
  },
  {
    id: 'a_purple_cluster_200',
    name: 'Bloco Roxo Ativo (2.00x)',
    game: 'aviator',
    enabled: true,
    isCustom: false,
    isEvolved: false,
    ruleType: 'aviator_purple_cluster',
    params: { windowSize: 8, minPurpleCount: 4, targetMultiplier: 2.0 },
    description: 'Entra em 2.00x durante blocos com >= 4 velas roxas (>= 2.00x) nas últimas 8 rodadas.',
  },
];

export function loadQuantStrategies(): QuantStrategyDefinition[] {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_QUANT_STRATEGIES;
    const raw = localStorage.getItem(LS_KEY_STRATEGIES);
    if (!raw) return DEFAULT_QUANT_STRATEGIES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_QUANT_STRATEGIES;
    return parsed;
  } catch {
    return DEFAULT_QUANT_STRATEGIES;
  }
}

export function saveQuantStrategies(strategies: QuantStrategyDefinition[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY_STRATEGIES, JSON.stringify(strategies));
  } catch {
    // ignore storage errors
  }
}

function inactiveSignal(reason: string): PointInTimeSignal {
  return {
    active: false,
    marketLabel: 'Aguardar',
    targetDescription: 'Sem entrada',
    payoutMultiplier: 1,
    confidencePct: 0,
    reason,
    isHit: () => false,
  };
}

/**
 * Avalia estritamente `point-in-time` usando APENAS `historyBeforeNewestFirst` (nunca olha o futuro).
 */
export function evaluateStrategyPointInTime(
  strategy: QuantStrategyDefinition,
  historyBeforeNewestFirst: number[]
): PointInTimeSignal {
  const hist = historyBeforeNewestFirst;
  const p = strategy.params;

  if (strategy.game === 'roulette') {
    if (strategy.ruleType === 'roulette_absence') {
      const minDelay = p.minDelay ?? 5;
      if (hist.length < 8) return inactiveSignal('Aguardando >= 8 giros.');
      const delays: Array<{ doz: 1 | 2 | 3; delay: number; label: string }> = ([1, 2, 3] as const).map(
        (doz) => {
          let delay = 0;
          for (const n of hist) {
            if (getDozenOf(n) === doz) break;
            delay++;
          }
          return { doz, delay, label: `${doz}ª Dúzia` };
        }
      );
      const top = [...delays].sort((a, b) => b.delay - a.delay)[0];
      if (top.delay >= minDelay) {
        return {
          active: true,
          marketLabel: top.label,
          targetDescription: `${top.label} (${top.doz === 1 ? '1–12' : top.doz === 2 ? '13–24' : '25–36'})`,
          payoutMultiplier: 3.0,
          confidencePct: Math.min(82, 48 + (top.delay - minDelay) * 6),
          reason: `${top.label} ausente há ${top.delay} giros (>= ${minDelay}).`,
          isHit: (actual) => getDozenOf(actual) === top.doz,
        };
      }
      return inactiveSignal(`Maior atraso de dúzia: ${top.delay}/${minDelay} giros.`);
    }

    if (strategy.ruleType === 'roulette_streak_break' || strategy.ruleType === 'roulette_streak_follow') {
      const minStreak = p.minStreak ?? 3;
      if (hist.length < minStreak) return inactiveSignal(`Aguardando >= ${minStreak} giros.`);
      const firstColor = getRouletteColor(hist[0]);
      if (firstColor === 'green') return inactiveSignal('Último giro foi Zero (0).');
      let streak = 0;
      for (const n of hist) {
        if (getRouletteColor(n) === firstColor) streak++;
        else break;
      }
      if (streak < minStreak) return inactiveSignal(`Corrida atual de cor: ${streak}/${minStreak}.`);

      const targetColor =
        strategy.ruleType === 'roulette_streak_break'
          ? firstColor === 'red'
            ? 'black'
            : 'red'
          : firstColor;
      const targetLabel = targetColor === 'red' ? 'Vermelho' : 'Preto';
      return {
        active: true,
        marketLabel: `Cor: ${targetLabel}`,
        targetDescription: targetLabel,
        payoutMultiplier: 2.0,
        confidencePct: Math.min(78, 52 + (streak - minStreak) * 6),
        reason: `Sequência de ${streak}× ${firstColor === 'red' ? 'Vermelho' : 'Preto'} (${
          strategy.ruleType === 'roulette_streak_break' ? 'reversão' : 'continuação'
        }).`,
        isHit: (actual) => getRouletteColor(actual) === targetColor,
      };
    }

    if (strategy.ruleType === 'roulette_sector_confluence') {
      const win = p.windowSize ?? 20;
      const minPct = p.minConcentrationPct ?? 48;
      if (hist.length < 10) return inactiveSignal('Aguardando >= 10 giros.');
      const slice = hist.slice(0, win);
      const vSet = new Set(VOISINS_NUMBERS);
      const tSet = new Set(TIERS_NUMBERS);
      const oSet = new Set(ORPHELINS_NUMBERS);
      const counts = [
        { name: 'Voisins du Zéro', set: vSet, count: slice.filter((n) => vSet.has(n)).length, expected: (17 / 37) * 100 },
        { name: 'Tiers du Cylindre', set: tSet, count: slice.filter((n) => tSet.has(n)).length, expected: (12 / 37) * 100 },
        { name: 'Orphelins', set: oSet, count: slice.filter((n) => oSet.has(n)).length, expected: (8 / 37) * 100 },
      ];
      const scored = counts
        .map((c) => ({ ...c, pct: (c.count / slice.length) * 100, edge: (c.count / slice.length) * 100 - c.expected }))
        .sort((a, b) => b.edge - a.edge);
      const best = scored[0];
      if (best.pct >= minPct) {
        const anchor = slice.find((n) => best.set.has(n)) ?? 0;
        const nb = getWheelNeighbors(anchor, 2);
        const nbSet = new Set(nb);
        const payout = 36 / best.set.size;
        return {
          active: true,
          marketLabel: `${best.name} + Vizinhos ${anchor} (±2)`,
          targetDescription: `${best.name} (Âncora ${anchor}: ${nb.join(', ')})`,
          payoutMultiplier: payout,
          confidencePct: Math.min(80, 50 + Math.round(best.edge)),
          reason: `${best.name} atingiu ${best.pct.toFixed(0)}% nos últimos ${slice.length} giros.`,
          isHit: (actual) => best.set.has(actual) || nbSet.has(actual),
        };
      }
      return inactiveSignal(`Concentração máxima (${best.name}): ${best.pct.toFixed(0)}% < ${minPct}%.`);
    }
  }

  // ==================== AVIATOR ====================
  if (strategy.ruleType === 'aviator_conservative_stable') {
    const target = p.targetMultiplier ?? 1.35;
    const lookback = p.lookbackNoInstant ?? 3;
    if (hist.length < lookback) return inactiveSignal(`Aguardando >= ${lookback} rodadas.`);
    const recent = hist.slice(0, lookback);
    const hasInstant = recent.some((m) => m < 1.1);
    if (!hasInstant && hist[0] >= 1.15) {
      return {
        active: true,
        marketLabel: `Cashout ${target.toFixed(2)}x`,
        targetDescription: `${target.toFixed(2)}x`,
        payoutMultiplier: target,
        confidencePct: 68,
        reason: `Últimas ${lookback} rodadas estáveis sem crash < 1.10x.`,
        isHit: (actual) => actual >= target,
      };
    }
    return inactiveSignal('Crash recente muito baixo (<1.10x); aguardar estabilização.');
  }

  if (strategy.ruleType === 'aviator_post_low_recovery') {
    const minStreak = p.minStreak ?? 2;
    const lowThresh = p.lowThreshold ?? 1.5;
    const target = p.targetMultiplier ?? 1.55;
    if (hist.length < minStreak) return inactiveSignal(`Aguardando >= ${minStreak} rodadas.`);
    let lowStreak = 0;
    for (const m of hist) {
      if (m < lowThresh) lowStreak++;
      else break;
    }
    if (lowStreak >= minStreak) {
      return {
        active: true,
        marketLabel: `Cashout ${target.toFixed(2)}x`,
        targetDescription: `${target.toFixed(2)}x`,
        payoutMultiplier: target,
        confidencePct: Math.min(76, 54 + (lowStreak - minStreak) * 5),
        reason: `${lowStreak} crashes seguidos < ${lowThresh.toFixed(2)}x.`,
        isHit: (actual) => actual >= target,
      };
    }
    return inactiveSignal(`Sequência baixa atual: ${lowStreak}/${minStreak}.`);
  }

  if (strategy.ruleType === 'aviator_window_frequency') {
    const win = p.windowSize ?? 15;
    const target = p.targetMultiplier ?? 1.7;
    const minHit = p.minHitRatePct ?? 53;
    if (hist.length < win) return inactiveSignal(`Aguardando >= ${win} rodadas.`);
    const slice = hist.slice(0, win);
    const rate = (slice.filter((m) => m >= target).length / win) * 100;
    if (rate >= minHit) {
      return {
        active: true,
        marketLabel: `Cashout ${target.toFixed(2)}x`,
        targetDescription: `${target.toFixed(2)}x`,
        payoutMultiplier: target,
        confidencePct: Math.min(78, Math.round(rate)),
        reason: `${rate.toFixed(0)}% dos últimos ${win} voos atingiram >= ${target.toFixed(2)}x.`,
        isHit: (actual) => actual >= target,
      };
    }
    return inactiveSignal(`Frequência >= ${target.toFixed(2)}x em ${rate.toFixed(0)}% (< ${minHit}%).`);
  }

  if (strategy.ruleType === 'aviator_purple_cluster') {
    const win = p.windowSize ?? 8;
    const minPurple = p.minPurpleCount ?? 4;
    const target = p.targetMultiplier ?? 2.0;
    if (hist.length < win) return inactiveSignal(`Aguardando >= ${win} rodadas.`);
    const slice = hist.slice(0, win);
    const purples = slice.filter((m) => m >= 2.0).length;
    if (purples >= minPurple && hist[0] < 10.0) {
      return {
        active: true,
        marketLabel: `Cashout ${target.toFixed(2)}x`,
        targetDescription: `${target.toFixed(2)}x`,
        payoutMultiplier: target,
        confidencePct: 60,
        reason: `${purples}/${win} velas roxas (>= 2.00x) na janela recente.`,
        isHit: (actual) => actual >= target,
      };
    }
    return inactiveSignal(`Velas roxas recentes: ${purples}/${win} (mínimo ${minPurple}).`);
  }

  return inactiveSignal('Regra não reconhecida.');
}
