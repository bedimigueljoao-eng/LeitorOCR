import { classifyAviatorCategory } from './aviatorResultProcessor';
import {
  AviatorCategory,
  AviatorCategoryRuleConfig,
  AviatorPattern,
  AviatorPatternConfidence,
  AviatorPatternReport,
  AviatorRoundRecord,
  DEFAULT_CATEGORY_CONFIG,
} from './types';

function computeConfidence(occurrences: number, sampleBase: number): AviatorPatternConfidence {
  if (sampleBase < 15 || occurrences < 3) return 'INSUFICIENTE';
  if (occurrences < 6) return 'BAIXA';
  if (occurrences < 14) return 'MODERADA';
  return 'CONSISTENTE';
}

function summarizeNextOutcomes(nextMultipliers: number[]) {
  if (nextMultipliers.length === 0) {
    return {
      nextAbove150Pct: 0,
      nextAbove200Pct: 0,
      nextAbove500Pct: 0,
      nextAvgMultiplier: 0,
    };
  }
  const n = nextMultipliers.length;
  const above150 = nextMultipliers.filter((m) => m >= 1.5).length;
  const above200 = nextMultipliers.filter((m) => m >= 2.0).length;
  const above500 = nextMultipliers.filter((m) => m >= 5.0).length;
  const sum = nextMultipliers.reduce((acc, m) => acc + m, 0);
  return {
    nextAbove150Pct: (above150 / n) * 100,
    nextAbove200Pct: (above200 / n) * 100,
    nextAbove500Pct: (above500 / n) * 100,
    nextAvgMultiplier: sum / n,
  };
}

export function analyzeAviatorPatterns(
  rounds: AviatorRoundRecord[],
  cfg: AviatorCategoryRuleConfig = DEFAULT_CATEGORY_CONFIG
): AviatorPatternReport {
  const categoryCounts: Record<AviatorCategory, number> = {
    under_1_50: 0,
    '1_50_to_2_00': 0,
    '2_00_to_3_00': 0,
    '3_00_to_5_00': 0,
    '5_00_to_10_00': 0,
    over_10_00: 0,
  };

  for (const r of rounds) {
    const cat = classifyAviatorCategory(r.multiplier, cfg);
    categoryCounts[cat]++;
  }

  const total = rounds.length;
  const categoryPcts: Record<AviatorCategory, number> = {
    under_1_50: total > 0 ? (categoryCounts.under_1_50 / total) * 100 : 0,
    '1_50_to_2_00': total > 0 ? (categoryCounts['1_50_to_2_00'] / total) * 100 : 0,
    '2_00_to_3_00': total > 0 ? (categoryCounts['2_00_to_3_00'] / total) * 100 : 0,
    '3_00_to_5_00': total > 0 ? (categoryCounts['3_00_to_5_00'] / total) * 100 : 0,
    '5_00_to_10_00': total > 0 ? (categoryCounts['5_00_to_10_00'] / total) * 100 : 0,
    over_10_00: total > 0 ? (categoryCounts.over_10_00 / total) * 100 : 0,
  };

  let currentLowStreak = 0;
  let maxLowStreak = 0;
  let runningLow = 0;
  for (const r of rounds) {
    if (r.multiplier < cfg.lowCeiling) {
      runningLow++;
      if (runningLow > maxLowStreak) maxLowStreak = runningLow;
    } else {
      runningLow = 0;
    }
  }
  currentLowStreak = runningLow;

  let roundsSinceAbove2x = 0;
  for (let i = total - 1; i >= 0; i--) {
    if (rounds[i].multiplier >= 2.0) break;
    roundsSinceAbove2x++;
  }

  let roundsSinceAbove5x = 0;
  for (let i = total - 1; i >= 0; i--) {
    if (rounds[i].multiplier >= 5.0) break;
    roundsSinceAbove5x++;
  }

  let roundsSinceAbove10x = 0;
  for (let i = total - 1; i >= 0; i--) {
    if (rounds[i].multiplier >= 10.0) break;
    roundsSinceAbove10x++;
  }

  const discovered: AviatorPattern[] = [];

  if (total >= 4) {
    // 1. Sequência de 2 baixos consecutivos (<1.50x)
    const seq2Next: number[] = [];
    for (let i = 1; i < total - 1; i++) {
      if (rounds[i - 1].multiplier < cfg.lowCeiling && rounds[i].multiplier < cfg.lowCeiling) {
        seq2Next.push(rounds[i + 1].multiplier);
      }
    }
    discovered.push({
      id: 'pat_2_low_seq',
      title: `Sequência de 2× < ${cfg.lowCeiling.toFixed(2)}x`,
      group: 'sequence',
      description: `Duas rodadas seguidas abaixo de ${cfg.lowCeiling.toFixed(2)}x.`,
      occurrences: seq2Next.length,
      sampleBase: Math.max(0, total - 2),
      frequencyPct: total > 2 ? (seq2Next.length / (total - 2)) * 100 : 0,
      ...summarizeNextOutcomes(seq2Next),
      confidence: computeConfidence(seq2Next.length, total),
      activeNow: currentLowStreak === 2,
      warning: 'Padrão descritivo histórico; rodadas no Aviator são estatisticamente independentes.',
    });

    // 2. Sequência de 3+ baixos consecutivos (<1.50x)
    const seq3Next: number[] = [];
    for (let i = 2; i < total - 1; i++) {
      if (
        rounds[i - 2].multiplier < cfg.lowCeiling &&
        rounds[i - 1].multiplier < cfg.lowCeiling &&
        rounds[i].multiplier < cfg.lowCeiling
      ) {
        seq3Next.push(rounds[i + 1].multiplier);
      }
    }
    discovered.push({
      id: 'pat_3plus_low_seq',
      title: `Bloco de 3+ baixos (< ${cfg.lowCeiling.toFixed(2)}x)`,
      group: 'sequence',
      description: `Três ou mais crashes seguidos abaixo de ${cfg.lowCeiling.toFixed(2)}x.`,
      occurrences: seq3Next.length,
      sampleBase: Math.max(0, total - 3),
      frequencyPct: total > 3 ? (seq3Next.length / (total - 3)) * 100 : 0,
      ...summarizeNextOutcomes(seq3Next),
      confidence: computeConfidence(seq3Next.length, total),
      activeNow: currentLowStreak >= 3,
      warning: 'Sequências longas de baixos não garantem recuperação imediata; não dobrar aposta.',
    });

    // 3. Após multiplicador alto (>=5.00x)
    const after5xNext: number[] = [];
    for (let i = 0; i < total - 1; i++) {
      if (rounds[i].multiplier >= cfg.highCeiling) {
        after5xNext.push(rounds[i + 1].multiplier);
      }
    }
    discovered.push({
      id: 'pat_after_5x',
      title: `Após multiplicador alto (>= ${cfg.highCeiling.toFixed(2)}x)`,
      group: 'interval',
      description: `Comportamento imediato na rodada seguinte após um voo >= ${cfg.highCeiling.toFixed(2)}x.`,
      occurrences: after5xNext.length,
      sampleBase: Math.max(0, total - 1),
      frequencyPct: total > 1 ? (after5xNext.length / (total - 1)) * 100 : 0,
      ...summarizeNextOutcomes(after5xNext),
      confidence: computeConfidence(after5xNext.length, total),
      activeNow: rounds[total - 1].multiplier >= cfg.highCeiling,
      warning: 'Multiplicadores altos frequentemente vêm seguidos de variação aleatória; validar em amostra ampla.',
    });

    // 4. Alternância Baixo (<2.00x) -> Médio/Alto (>=2.00x) -> Baixo
    const altNext: number[] = [];
    for (let i = 2; i < total - 1; i++) {
      const a = rounds[i - 2].multiplier < 2.0;
      const b = rounds[i - 1].multiplier >= 2.0;
      const c = rounds[i].multiplier < 2.0;
      if (a && b && c) {
        altNext.push(rounds[i + 1].multiplier);
      }
    }
    const isAltNow =
      total >= 3 &&
      rounds[total - 3].multiplier < 2.0 &&
      rounds[total - 2].multiplier >= 2.0 &&
      rounds[total - 1].multiplier < 2.0;
    discovered.push({
      id: 'pat_alternation_2x',
      title: 'Alternância (<2x · >=2x · <2x)',
      group: 'alternation',
      description: 'Oscilação alternada entre azul (<2.00x) e roxo/rosa (>=2.00x).',
      occurrences: altNext.length,
      sampleBase: Math.max(0, total - 3),
      frequencyPct: total > 3 ? (altNext.length / (total - 3)) * 100 : 0,
      ...summarizeNextOutcomes(altNext),
      confidence: computeConfidence(altNext.length, total),
      activeNow: isAltNow,
      warning: 'Alternância observada historicamente pode quebrar a qualquer instante.',
    });

    // 5. Repetição de >= 2.00x seguidos (2+ voos roxos/rosa)
    const rep2xNext: number[] = [];
    for (let i = 1; i < total - 1; i++) {
      if (rounds[i - 1].multiplier >= 2.0 && rounds[i].multiplier >= 2.0) {
        rep2xNext.push(rounds[i + 1].multiplier);
      }
    }
    const isRep2xNow =
      total >= 2 && rounds[total - 2].multiplier >= 2.0 && rounds[total - 1].multiplier >= 2.0;
    discovered.push({
      id: 'pat_repeat_2x',
      title: 'Repetição >= 2.00x (2+ seguidos)',
      group: 'repetition',
      description: 'Blocos de dois ou mais multiplicadores seguidos acima de 2.00x.',
      occurrences: rep2xNext.length,
      sampleBase: Math.max(0, total - 2),
      frequencyPct: total > 2 ? (rep2xNext.length / (total - 2)) * 100 : 0,
      ...summarizeNextOutcomes(rep2xNext),
      confidence: computeConfidence(rep2xNext.length, total),
      activeNow: isRep2xNow,
      warning: 'Aglutinações de >=2x são comuns na variância sem implicar tendência garantida.',
    });

    // 6. Bloco recente de 10 rodadas frio vs quente (>=2x <= 2 em 10 ou >= 6 em 10)
    const blockColdNext: number[] = [];
    for (let i = 9; i < total - 1; i++) {
      let ge2 = 0;
      for (let j = i - 9; j <= i; j++) {
        if (rounds[j].multiplier >= 2.0) ge2++;
      }
      if (ge2 <= 3) {
        blockColdNext.push(rounds[i + 1].multiplier);
      }
    }
    const recent10Ge2 =
      total >= 10 ? rounds.slice(-10).filter((r) => r.multiplier >= 2.0).length : 5;
    discovered.push({
      id: 'pat_cold_block_10',
      title: 'Bloco Frio (<=3 de 10 acima de 2.00x)',
      group: 'block',
      description: 'Janela de 10 rodadas com forte predominância abaixo de 2.00x.',
      occurrences: blockColdNext.length,
      sampleBase: Math.max(0, total - 10),
      frequencyPct: total > 10 ? (blockColdNext.length / (total - 10)) * 100 : 0,
      ...summarizeNextOutcomes(blockColdNext),
      confidence: computeConfidence(blockColdNext.length, total),
      activeNow: total >= 10 && recent10Ge2 <= 3,
      warning: 'Distribuições extremas em 10 rodadas podem persistir por variância natural.',
    });

    // 7. Intervalo longo sem >= 10.00x (Rosa)
    const afterDry10xNext: number[] = [];
    let dry10x = 0;
    for (let i = 0; i < total - 1; i++) {
      if (rounds[i].multiplier >= cfg.megaThreshold) {
        dry10x = 0;
      } else {
        dry10x++;
      }
      if (dry10x >= 20) {
        afterDry10xNext.push(rounds[i + 1].multiplier);
      }
    }
    discovered.push({
      id: 'pat_dry_10x',
      title: `Intervalo >= 20 rodadas sem >= ${cfg.megaThreshold.toFixed(0)}x`,
      group: 'interval',
      description: `Período prolongado sem multiplicador rosa (>= ${cfg.megaThreshold.toFixed(0)}x).`,
      occurrences: afterDry10xNext.length,
      sampleBase: Math.max(0, total - 20),
      frequencyPct: total > 20 ? (afterDry10xNext.length / (total - 20)) * 100 : 0,
      ...summarizeNextOutcomes(afterDry10xNext),
      confidence: computeConfidence(afterDry10xNext.length, total),
      activeNow: roundsSinceAbove10x >= 20,
      warning: 'Falácia do apostador: atraso de multiplicador rosa NÃO aumenta a probabilidade da próxima rodada.',
    });
  }

  const activeAlerts = discovered.filter((p) => p.activeNow);

  return {
    discovered,
    activeAlerts,
    currentLowStreak,
    maxLowStreak,
    roundsSinceAbove2x,
    roundsSinceAbove5x,
    roundsSinceAbove10x,
    categoryCounts,
    categoryPcts,
    disclaimer:
      'Aviso estatístico: Aviator utiliza geração aleatória independente (Provably Fair). Padrões e médias são apenas descritivos do histórico observado e não garantem resultados futuros.',
  };
}
