import {
  AviatorLocalAiReport,
  AviatorMarkovStateKey,
  AviatorMarkovTransitionRow,
  AviatorPeakIntervalStats,
  AviatorPostPeakBucket,
  AviatorPostPeakHorizonStats,
  AviatorRegimeAnalysis,
  AviatorRoundRecord,
} from './types';

const MARKOV_STATES: Array<{ key: AviatorMarkovStateKey; label: string }> = [
  { key: 'under_1_50', label: '< 1.50x (Baixo)' },
  { key: '1_50_to_2_00', label: '1.50x – 1.99x' },
  { key: '2_00_to_5_00', label: '2.00x – 4.99x (Roxo)' },
  { key: '5_00_to_10_00', label: '5.00x – 9.99x (Alto)' },
  { key: 'over_10_00', label: '>= 10.00x (Rosa)' },
];

export function classifyMarkovState(mult: number): AviatorMarkovStateKey {
  if (mult < 1.5) return 'under_1_50';
  if (mult < 2.0) return '1_50_to_2_00';
  if (mult < 5.0) return '2_00_to_5_00';
  if (mult < 10.0) return '5_00_to_10_00';
  return 'over_10_00';
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function computePostPeakBucket(
  rounds: AviatorRoundRecord[],
  threshold: number,
  label: string,
  baselineUnder150Pct: number
): AviatorPostPeakBucket {
  const peakIndices: number[] = [];
  for (let i = 0; i < rounds.length; i++) {
    if (rounds[i].multiplier >= threshold) {
      peakIndices.push(i);
    }
  }

  const totalOccurrences = peakIndices.length;
  const lastIdx = totalOccurrences > 0 ? peakIndices[totalOccurrences - 1] : null;
  const lastSeenRoundsAgo = lastIdx !== null ? rounds.length - 1 - lastIdx : null;
  const activeJustHappened = lastSeenRoundsAgo === 0;

  const p0 = baselineUnder150Pct / 100;
  const horizons: AviatorPostPeakHorizonStats[] = ([1, 3, 5] as const).map((h) => {
    const validEvents = peakIndices.filter((idx) => idx + h < rounds.length);
    const nextMults: number[] = [];
    for (const idx of validEvents) {
      for (let step = 1; step <= h; step++) {
        nextMults.push(rounds[idx + step].multiplier);
      }
    }

    const evaluatedRounds = nextMults.length;
    if (evaluatedRounds === 0) {
      return {
        horizonRounds: h,
        sampleEvents: 0,
        evaluatedRounds: 0,
        under150Pct: 0,
        under150DeltaPct: 0,
        above200Pct: 0,
        above500Pct: 0,
        avgMultiplier: 0,
        zScoreUnder150: 0,
        statisticallySignificant: false,
        verdictLabel: 'Amostra insuficiente',
      };
    }

    const under150Count = nextMults.filter((m) => m < 1.5).length;
    const above200Count = nextMults.filter((m) => m >= 2.0).length;
    const above500Count = nextMults.filter((m) => m >= 5.0).length;
    const sum = nextMults.reduce((acc, m) => acc + m, 0);

    const under150Pct = (under150Count / evaluatedRounds) * 100;
    const under150DeltaPct = under150Pct - baselineUnder150Pct;
    const above200Pct = (above200Count / evaluatedRounds) * 100;
    const above500Pct = (above500Count / evaluatedRounds) * 100;
    const avgMultiplier = sum / evaluatedRounds;

    let zScoreUnder150 = 0;
    if (p0 > 0.01 && p0 < 0.99 && evaluatedRounds > 0) {
      const p1 = under150Count / evaluatedRounds;
      const se = Math.sqrt((p0 * (1 - p0)) / evaluatedRounds);
      zScoreUnder150 = se > 0 ? (p1 - p0) / se : 0;
    }

    const statisticallySignificant = evaluatedRounds >= 15 && Math.abs(zScoreUnder150) >= 1.96;

    let verdictLabel = 'Comportamento normal / aleatório';
    if (evaluatedRounds < 10) {
      verdictLabel = 'Amostra insuficiente (<10 rod.)';
    } else if (statisticallySignificant && under150DeltaPct > 0) {
      verdictLabel = 'Mais baixos que o normal (significativo)';
    } else if (statisticallySignificant && under150DeltaPct < 0) {
      verdictLabel = 'Menos baixos após pico (significativo)';
    } else if (under150DeltaPct >= 8) {
      verdictLabel = 'Leve alta de baixos (sem significância)';
    } else if (under150DeltaPct <= -8) {
      verdictLabel = 'Leve queda de baixos (sem significância)';
    }

    return {
      horizonRounds: h,
      sampleEvents: validEvents.length,
      evaluatedRounds,
      under150Pct,
      under150DeltaPct,
      above200Pct,
      above500Pct,
      avgMultiplier,
      zScoreUnder150,
      statisticallySignificant,
      verdictLabel,
    };
  });

  return {
    threshold,
    label,
    totalOccurrences,
    lastSeenRoundsAgo,
    activeJustHappened,
    horizons,
  };
}

function computeMarkovMatrix(rounds: AviatorRoundRecord[]): AviatorMarkovTransitionRow[] {
  const buckets = new Map<
    AviatorMarkovStateKey,
    { counts: Record<AviatorMarkovStateKey, number>; total: number; nextSum: number }
  >();

  for (const st of MARKOV_STATES) {
    buckets.set(st.key, {
      counts: {
        under_1_50: 0,
        '1_50_to_2_00': 0,
        '2_00_to_5_00': 0,
        '5_00_to_10_00': 0,
        over_10_00: 0,
      },
      total: 0,
      nextSum: 0,
    });
  }

  for (let i = 0; i < rounds.length - 1; i++) {
    const fromKey = classifyMarkovState(rounds[i].multiplier);
    const toKey = classifyMarkovState(rounds[i + 1].multiplier);
    const entry = buckets.get(fromKey)!;
    entry.counts[toKey]++;
    entry.total++;
    entry.nextSum += rounds[i + 1].multiplier;
  }

  return MARKOV_STATES.map((st) => {
    const entry = buckets.get(st.key)!;
    const total = entry.total;
    const probsPct: Record<AviatorMarkovStateKey, number> = {
      under_1_50: total > 0 ? (entry.counts.under_1_50 / total) * 100 : 0,
      '1_50_to_2_00': total > 0 ? (entry.counts['1_50_to_2_00'] / total) * 100 : 0,
      '2_00_to_5_00': total > 0 ? (entry.counts['2_00_to_5_00'] / total) * 100 : 0,
      '5_00_to_10_00': total > 0 ? (entry.counts['5_00_to_10_00'] / total) * 100 : 0,
      over_10_00: total > 0 ? (entry.counts.over_10_00 / total) * 100 : 0,
    };

    return {
      fromState: st.key,
      fromLabel: st.label,
      sampleCount: total,
      probsPct,
      nextAvgMultiplier: total > 0 ? entry.nextSum / total : 0,
    };
  });
}

function computePeakIntervals(
  rounds: AviatorRoundRecord[],
  threshold: number,
  label: string
): AviatorPeakIntervalStats {
  const indices: number[] = [];
  for (let i = 0; i < rounds.length; i++) {
    if (rounds[i].multiplier >= threshold) indices.push(i);
  }

  const gaps: number[] = [];
  let clustered = 0;
  for (let k = 1; k < indices.length; k++) {
    const gap = indices[k] - indices[k - 1] - 1;
    gaps.push(gap);
    if (gap <= 2) clustered++;
  }
  gaps.sort((a, b) => a - b);

  let currentGap = 0;
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (rounds[i].multiplier >= threshold) break;
    currentGap++;
  }

  return {
    threshold,
    label,
    count: indices.length,
    minGap: gaps.length > 0 ? gaps[0] : null,
    medianGap: quantile(gaps, 0.5),
    p90Gap: quantile(gaps, 0.9),
    maxGap: gaps.length > 0 ? gaps[gaps.length - 1] : null,
    currentGap,
    clusterRatePct: gaps.length > 0 ? (clustered / gaps.length) * 100 : 0,
  };
}

function computeRegimeAnalysis(
  rounds: AviatorRoundRecord[],
  baselineUnder150Pct: number,
  postPeak10x: AviatorPostPeakBucket | undefined
): AviatorRegimeAnalysis {
  if (rounds.length < 15) {
    return {
      regime: 'INSUFICIENTE',
      regimeLabel: 'Amostra Insuficiente (<15 rodadas)',
      cautionScore: 30,
      recent15LowPct: 0,
      recent15PeakCount: 0,
      volatilityIndex: 0,
      recommendedAction: 'Recolher pelo menos 15 rodadas antes de ativar filtros de regime.',
    };
  }

  const recent15 = rounds.slice(-15);
  const lowCount = recent15.filter((r) => r.multiplier < 1.5).length;
  const recent15LowPct = (lowCount / recent15.length) * 100;
  const recent15PeakCount = recent15.filter((r) => r.multiplier >= 5.0).length;

  const mean = recent15.reduce((acc, r) => acc + r.multiplier, 0) / recent15.length;
  const variance =
    recent15.reduce((acc, r) => acc + (r.multiplier - mean) ** 2, 0) / recent15.length;
  const stdDev = Math.sqrt(variance);
  const volatilityIndex = mean > 0 ? stdDev / mean : 0;

  let cautionScore = 35;
  if (recent15LowPct >= 60) cautionScore += 30;
  else if (recent15LowPct >= baselineUnder150Pct + 12) cautionScore += 18;
  if (volatilityIndex >= 1.5) cautionScore += 18;
  if (postPeak10x?.activeJustHappened) cautionScore += 12;
  cautionScore = Math.max(10, Math.min(98, Math.round(cautionScore)));

  if (recent15LowPct >= 55) {
    return {
      regime: 'FRIO_CRISE',
      regimeLabel: 'Regime Frio / Alta Sequência de Baixos',
      cautionScore,
      recent15LowPct,
      recent15PeakCount,
      volatilityIndex,
      recommendedAction:
        'Predomínio de crashes < 1.50x nas últimas 15 rodadas. Priorizar pausa ou alvos mínimos (<= 1.30x) sem aumentar aposta.',
    };
  }

  if (recent15PeakCount >= 3 || volatilityIndex >= 1.45) {
    return {
      regime: 'VOLATIL_PICOS',
      regimeLabel: 'Regime Volátil / Presença de Picos',
      cautionScore,
      recent15LowPct,
      recent15PeakCount,
      volatilityIndex,
      recommendedAction:
        'Variância elevada por picos recentes. Picos podem alternar com crashes instantâneos; mantenha banca fixa e gestão rígida.',
    };
  }

  return {
    regime: 'NORMAL',
    regimeLabel: 'Regime Equilibrado / Normal',
    cautionScore,
    recent15LowPct,
    recent15PeakCount,
    volatilityIndex,
    recommendedAction:
      'Distribuição recente próxima da média histórica. Operar apenas dentro das regras e limites da banca.',
  };
}

export function analyzeAviatorLocalAi(rounds: AviatorRoundRecord[]): AviatorLocalAiReport {
  const total = rounds.length;
  const baselineUnder150Pct =
    total > 0 ? (rounds.filter((r) => r.multiplier < 1.5).length / total) * 100 : 0;
  const baselineAbove200Pct =
    total > 0 ? (rounds.filter((r) => r.multiplier >= 2.0).length / total) * 100 : 0;
  const baselineAvgMultiplier =
    total > 0 ? rounds.reduce((acc, r) => acc + r.multiplier, 0) / total : 0;

  const postPeakBuckets: AviatorPostPeakBucket[] = [
    computePostPeakBucket(rounds, 5, 'Picos >= 5.00x', baselineUnder150Pct),
    computePostPeakBucket(rounds, 10, 'Rosas >= 10.00x', baselineUnder150Pct),
    computePostPeakBucket(rounds, 25, 'Grandes Picos >= 25.00x', baselineUnder150Pct),
    computePostPeakBucket(rounds, 50, 'Extremos >= 50.00x', baselineUnder150Pct),
  ];

  const markovRows = computeMarkovMatrix(rounds);
  const currentMarkovState =
    total > 0 ? classifyMarkovState(rounds[total - 1].multiplier) : null;

  const peakIntervals: AviatorPeakIntervalStats[] = [
    computePeakIntervals(rounds, 5, 'Intervalos entre >= 5.00x'),
    computePeakIntervals(rounds, 10, 'Intervalos entre >= 10.00x (Rosas)'),
  ];

  const post10 = postPeakBuckets.find((b) => b.threshold === 10);
  const regime = computeRegimeAnalysis(rounds, baselineUnder150Pct, post10);

  let localNarrativeSummary =
    'Registe pelo menos 15 rodadas para a IA estatística medir comportamento pós-pico, transições e regime atual.';
  if (total >= 15) {
    const h1_10 = post10?.horizons[0];
    const h3_10 = post10?.horizons[1];
    const post10Text =
      h1_10 && h1_10.evaluatedRounds >= 3
        ? `Após rosas (>=10x), a rodada seguinte caiu <1.50x em ${h1_10.under150Pct.toFixed(
            1
          )}% (${h1_10.under150DeltaPct >= 0 ? '+' : ''}${h1_10.under150DeltaPct.toFixed(
            1
          )} p.p. vs média global de ${baselineUnder150Pct.toFixed(
            1
          )}%, z=${h1_10.zScoreUnder150.toFixed(2)}: ${h1_10.verdictLabel}). Nas 3 rodadas seguintes: ${
            h3_10?.under150Pct.toFixed(1) ?? '0.0'
          }% abaixo de 1.50x.`
        : 'Ainda há poucas ocorrências >= 10.00x no histórico para medir o pós-pico com fiabilidade.';

    const p10Int = peakIntervals[1];
    const intervalText =
      p10Int && p10Int.medianGap !== null
        ? `Intervalo mediano entre >=10x: ${p10Int.medianGap.toFixed(
            0
          )} rodadas (máx: ${p10Int.maxGap}, atual: ${p10Int.currentGap} rodadas sem >=10x, cluster <=3 rodadas: ${p10Int.clusterRatePct.toFixed(
            0
          )}%).`
        : 'Ainda sem 2 picos >=10x para medir espaçamento.';

    localNarrativeSummary = `${regime.regimeLabel} (Cautela ${regime.cautionScore}/100). ${post10Text} ${intervalText}`;
  }

  return {
    baselineUnder150Pct,
    baselineAbove200Pct,
    baselineAvgMultiplier,
    postPeakBuckets,
    markovRows,
    currentMarkovState,
    peakIntervals,
    regime,
    localNarrativeSummary,
  };
}

export function answerAviatorQuestionLocally(
  rounds: AviatorRoundRecord[],
  report: AviatorLocalAiReport,
  question: string
): string {
  if (rounds.length < 5) {
    return `Ainda existem apenas ${rounds.length} rodadas registadas. Recolha pelo menos 15–30 rodadas para a IA analisar o comportamento pós-pico e os padrões com rigor estatístico.`;
  }

  const q = question.toLowerCase();
  const post5 = report.postPeakBuckets.find((b) => b.threshold === 5);
  const post10 = report.postPeakBuckets.find((b) => b.threshold === 10);
  const post25 = report.postPeakBuckets.find((b) => b.threshold === 25);

  if (
    q.includes('alto') ||
    q.includes('grave') ||
    q.includes('pico') ||
    q.includes('10x') ||
    q.includes('25x') ||
    q.includes('50x') ||
    q.includes('baixo') ||
    q.includes('depois') ||
    q.includes('após')
  ) {
    const lines: string[] = [
      `Análise Pós-Pico nos teus ${rounds.length} voos reais (média global <1.50x = ${report.baselineUnder150Pct.toFixed(1)}%):`,
    ];

    for (const bucket of [post5, post10, post25]) {
      if (!bucket) continue;
      const h1 = bucket.horizons[0];
      const h3 = bucket.horizons[1];
      if (bucket.totalOccurrences === 0) {
        lines.push(`• ${bucket.label}: 0 ocorrências registadas até agora.`);
      } else {
        lines.push(
          `• ${bucket.label} (${bucket.totalOccurrences}x): na 1ª rodada após = ${h1.under150Pct.toFixed(
            1
          )}% <1.50x (${h1.under150DeltaPct >= 0 ? '+' : ''}${h1.under150DeltaPct.toFixed(
            1
          )} p.p., z=${h1.zScoreUnder150.toFixed(2)} — ${h1.verdictLabel}); nas 3 seguintes = ${h3.under150Pct.toFixed(
            1
          )}% <1.50x.`
        );
      }
    }

    const p10Int = report.peakIntervals[1];
    if (p10Int && p10Int.medianGap !== null) {
      lines.push(
        `• Sequências de pico (>=10x): ${p10Int.clusterRatePct.toFixed(
          1
        )}% repetiram outro pico dentro de 3 rodadas; intervalo mediano de ${p10Int.medianGap.toFixed(
          0
        )} rodadas (atual sem >=10x: ${p10Int.currentGap}).`
      );
    }

    lines.push(
      'Nota honesta: mesmo se houver variação na amostra, o RNG do Aviator é independente em cada rodada — trate qualquer excesso pós-pico como alerta de cautela, nunca como certeza.'
    );
    return lines.join('\n');
  }

  if (q.includes('markov') || q.includes('próxima') || q.includes('transição') || q.includes('padr')) {
    const curRow = report.markovRows.find((r) => r.fromState === report.currentMarkovState);
    if (!curRow || curRow.sampleCount === 0) {
      return `${report.localNarrativeSummary}\nAinda sem transições suficientes a partir do estado atual.`;
    }
    return [
      `Estado atual (${curRow.fromLabel}, ${curRow.sampleCount} amostras históricas):`,
      `• Próx. <1.50x: ${curRow.probsPct.under_1_50.toFixed(1)}% | 1.50–1.99x: ${curRow.probsPct['1_50_to_2_00'].toFixed(
        1
      )}% | >=2.00x: ${(
        curRow.probsPct['2_00_to_5_00'] +
        curRow.probsPct['5_00_to_10_00'] +
        curRow.probsPct.over_10_00
      ).toFixed(1)}%`,
      `• Média seguinte após este estado: ${curRow.nextAvgMultiplier.toFixed(2)}x.`,
      `Regime atual: ${report.regime.regimeLabel} (Cautela ${report.regime.cautionScore}/100).`,
    ].join('\n');
  }

  return `${report.localNarrativeSummary}\nRecomendação atual: ${report.regime.recommendedAction}`;
}
