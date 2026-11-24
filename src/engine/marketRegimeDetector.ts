import { getRouletteColor } from './rouletteEngine';

export interface WindowRegimeMetrics {
  windowSize: number;
  availableRounds: number;
  unpredictabilityPct: number;
  entropyPct: number;
}

export interface MarketRegimeReport {
  game: 'roulette' | 'aviator';
  sampleSize: number;
  unpredictabilityPct: number; // 0..100
  thresholdPct: number;
  blockEntries: boolean;
  bannerText: string;
  regimeStatus: 'ESTAVEL' | 'CAUTELA' | 'IMPREVISIVEL' | 'AMOSTRA_INSUFICIENTE';
  reasons: string[];
  windows: WindowRegimeMetrics[];
}

function shannonEntropyNormalized(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || counts.length <= 1) return 100;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  const maxH = Math.log2(counts.length);
  return maxH > 0 ? (h / maxH) * 100 : 100;
}

function evaluateRouletteWindow(spinsNewestFirst: number[], windowSize: number): WindowRegimeMetrics {
  const slice = spinsNewestFirst.slice(0, windowSize);
  const n = slice.length;
  if (n < 8) {
    return { windowSize, availableRounds: n, unpredictabilityPct: 80, entropyPct: 100 };
  }

  // Entropia de dúzias (D1, D2, D3) e setores (Voisins, Tiers, Orphelins)
  const dozCounts = [0, 0, 0];
  let redCount = 0;
  let blackCount = 0;
  let zeroCount = 0;

  for (const num of slice) {
    const col = getRouletteColor(num);
    if (col === 'green') zeroCount++;
    else if (col === 'red') redCount++;
    else blackCount++;

    if (num >= 1 && num <= 12) dozCounts[0]++;
    else if (num >= 13 && num <= 24) dozCounts[1]++;
    else if (num >= 25 && num <= 36) dozCounts[2]++;
  }

  const dozEntropy = shannonEntropyNormalized(dozCounts);

  // Taxa de alternância Red/Black (perto de 50-65% sem corridas consistentes aumenta dispersão, mas > 78% é alternância extrema/caótica)
  let transitions = 0;
  let pairs = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = getRouletteColor(slice[i]);
    const b = getRouletteColor(slice[i + 1]);
    if (a !== 'green' && b !== 'green') {
      pairs++;
      if (a !== b) transitions++;
    }
  }
  const altRate = pairs > 0 ? (transitions / pairs) * 100 : 50;

  // Dispersão de números únicos: quantos números distintos apareceram
  const uniqueRatio = new Set(slice).size / Math.min(37, n);

  // Equilíbrio extremo Red vs Black sem tendência dominante
  const pbTotal = redCount + blackCount;
  const colorImbalance = pbTotal > 0 ? (Math.abs(redCount - blackCount) / pbTotal) * 100 : 0;

  // Excesso anômalo de Zero (esperado ~2.70%)
  const zeroPct = (zeroCount / n) * 100;
  const zeroPenalty = zeroPct >= 8 ? 22 : zeroPct >= 5.5 ? 10 : 0;

  // Índice composto de imprevisibilidade:
  // alta entropia das dúzias + alta dispersão de números + ausência de dominância de cor + excesso de 0
  let score =
    dozEntropy * 0.45 +
    uniqueRatio * 28 +
    Math.max(0, 22 - colorImbalance * 0.7) +
    (altRate > 75 || (altRate >= 42 && altRate <= 58) ? 8 : 0) +
    zeroPenalty;

  score = Math.max(12, Math.min(98, Math.round(score)));
  return {
    windowSize,
    availableRounds: n,
    unpredictabilityPct: score,
    entropyPct: Math.round(dozEntropy),
  };
}

function evaluateAviatorWindow(multsNewestFirst: number[], windowSize: number): WindowRegimeMetrics {
  const slice = multsNewestFirst.slice(0, windowSize);
  const n = slice.length;
  if (n < 8) {
    return { windowSize, availableRounds: n, unpredictabilityPct: 80, entropyPct: 100 };
  }

  const low150Count = slice.filter((m) => m < 1.5).length;
  const low150Pct = (low150Count / n) * 100;

  const bands = [
    slice.filter((m) => m < 1.5).length,
    slice.filter((m) => m >= 1.5 && m < 2.0).length,
    slice.filter((m) => m >= 2.0 && m < 5.0).length,
    slice.filter((m) => m >= 5.0).length,
  ];
  const bandEntropy = shannonEntropyNormalized(bands);

  const avg = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((acc, m) => acc + (m - avg) ** 2, 0) / n;
  const coefVar = avg > 0 ? Math.sqrt(variance) / avg : 1;

  // Maior streak atual abaixo de 1.50x
  let lowStreak = 0;
  for (const m of slice) {
    if (m < 1.5) lowStreak++;
    else break;
  }

  let score = 26 + bandEntropy * 0.25;
  if (low150Pct >= 58) score += 28;
  else if (low150Pct >= 48) score += 14;
  if (lowStreak >= 3) score += 16;
  if (coefVar >= 1.55) score += 16;

  score = Math.max(15, Math.min(98, Math.round(score)));
  return {
    windowSize,
    availableRounds: n,
    unpredictabilityPct: score,
    entropyPct: Math.round(bandEntropy),
  };
}

export function detectMarketRegime(params: {
  game: 'roulette' | 'aviator';
  valuesNewestFirst: number[];
  thresholdPct?: number;
  minSampleSize?: number;
}): MarketRegimeReport {
  const { game, valuesNewestFirst } = params;
  const thresholdPct = params.thresholdPct ?? 60;
  const minSampleSize = params.minSampleSize ?? 12;
  const n = valuesNewestFirst.length;

  if (n < minSampleSize) {
    return {
      game,
      sampleSize: n,
      unpredictabilityPct: 100,
      thresholdPct,
      blockEntries: true,
      bannerText: `NÃO APOSTAR — AMOSTRA INSUFICIENTE (${n}/${minSampleSize} RODADAS)`,
      regimeStatus: 'AMOSTRA_INSUFICIENTE',
      reasons: [
        `Foram recolhidas ${n} rodadas; mínimo exigido de ${minSampleSize} rodadas para validar o regime estatístico.`,
      ],
      windows: [],
    };
  }

  const windowSizes = [20, 50, 100];
  const windows = windowSizes.map((ws) =>
    game === 'roulette'
      ? evaluateRouletteWindow(valuesNewestFirst, ws)
      : evaluateAviatorWindow(valuesNewestFirst, ws)
  );

  // Peso maior para janela imediata (20) + média ponderada de 50/100
  const w20 = windows[0].unpredictabilityPct;
  const w50 = windows[1].unpredictabilityPct;
  const w100 = windows[2].unpredictabilityPct;
  const combinedScore = Math.round(w20 * 0.55 + w50 * 0.3 + w100 * 0.15);

  const reasons: string[] = [];
  if (game === 'roulette') {
    const r20 = valuesNewestFirst.slice(0, 20);
    const zeroCount = r20.filter((v) => v === 0).length;
    const red = r20.filter((v) => getRouletteColor(v) === 'red').length;
    const black = r20.filter((v) => getRouletteColor(v) === 'black').length;
    const dozCounts = [
      r20.filter((v) => v >= 1 && v <= 12).length,
      r20.filter((v) => v >= 13 && v <= 24).length,
      r20.filter((v) => v >= 25 && v <= 36).length,
    ];
    if (zeroCount >= 2) {
      reasons.push(`Excesso anômalo de Zero: ${zeroCount}x nas últimas ${r20.length} rodadas (${((zeroCount / r20.length) * 100).toFixed(1)}% vs 2.7% esperado).`);
    }
    if (Math.abs(red - black) <= 2) {
      reasons.push(`Equilíbrio/alternância dispersa entre Vermelho (${red}) e Preto (${black}) sem tendência firme.`);
    }
    if (Math.max(...dozCounts) - Math.min(...dozCounts) <= 2) {
      reasons.push(`Entropia elevada nas dúzias (${dozCounts.join(' / ')}): nenhum setor domina a janela.`);
    }
    if (n >= 40) {
      const prior = valuesNewestFirst.slice(20, 60);
      const rRedPct = (red / Math.max(1, r20.length)) * 100;
      const pRedPct = (prior.filter((v) => getRouletteColor(v) === 'red').length / Math.max(1, prior.length)) * 100;
      if (Math.abs(rRedPct - pRedPct) >= 22) {
        reasons.push(`Desvio abrupto de distribuição recente (${rRedPct.toFixed(0)}% Vermelho vs ${pRedPct.toFixed(0)}% no bloco anterior).`);
      }
    }
  } else {
    const r20 = valuesNewestFirst.slice(0, 20);
    const low150 = r20.filter((m) => m < 1.5).length;
    const low150Pct = (low150 / Math.max(1, r20.length)) * 100;
    let lowStreak = 0;
    for (const m of r20) {
      if (m < 1.5) lowStreak++;
      else break;
    }
    if (low150Pct >= 50) {
      reasons.push(`Zona de crashes baixos: ${low150}/${r20.length} voos (${low150Pct.toFixed(0)}%) abaixo de 1.50x.`);
    }
    if (lowStreak >= 3) {
      reasons.push(`Sequência ativa de ${lowStreak} crashes seguidos abaixo de 1.50x.`);
    }
    const pinks = r20.filter((m) => m >= 10.0).length;
    if (pinks >= 2 && low150Pct >= 45) {
      reasons.push(`Volatilidade errática: ${pinks} picos >=10x misturados com quedas frequentes <1.50x.`);
    }
  }

  if (reasons.length === 0) {
    reasons.push(
      combinedScore > thresholdPct
        ? `Entropia elevada (${windows[0].entropyPct}%) e dispersão estatística acima do limiar de ${thresholdPct}%.`
        : `Variância e entropia dentro da faixa operável (${combinedScore}% <= ${thresholdPct}%).`
    );
  }

  const blockEntries = combinedScore > thresholdPct;
  const regimeStatus: MarketRegimeReport['regimeStatus'] = blockEntries
    ? 'IMPREVISIVEL'
    : combinedScore >= thresholdPct - 12
    ? 'CAUTELA'
    : 'ESTAVEL';

  const bannerText = blockEntries
    ? 'NÃO APOSTAR — IMPREVISIBILIDADE ELEVADA (AGUARDAR ESTABILIZAÇÃO)'
    : regimeStatus === 'CAUTELA'
    ? 'CAUTELA MODERADA — EXIGIR CONSENSO E BANCA REDUZIDA'
    : 'REGIME OPERÁVEL — DISTRIBUIÇÃO DENTRO DOS PARÂMETROS';

  return {
    game,
    sampleSize: n,
    unpredictabilityPct: combinedScore,
    thresholdPct,
    blockEntries,
    bannerText,
    regimeStatus,
    reasons,
    windows,
  };
}
