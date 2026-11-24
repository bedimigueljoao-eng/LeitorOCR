export type RouletteColor = 'green' | 'red' | 'black';
export type StrategyProfile = 'neighbors' | 'sectors' | 'balanced';

export type SuggestedColor = 'Vermelho' | 'Preto';
export type SuggestedParity = 'Par' | 'Ímpar';
export type SuggestedHalf = '1–18 (Baixo)' | '19–36 (Alto)';

export interface FieldSuggestions {
  color: SuggestedColor;
  colorReason: string;
  parity: SuggestedParity;
  parityReason: string;
  half: SuggestedHalf;
  halfReason: string;
  dozenIndex: 1 | 2 | 3;
  dozenLabel: string;
  dozenReason: string;
  columnIndex: 1 | 2 | 3;
  columnLabel: string;
  columnReason: string;
  anchorNumber: number;
  neighbors: number[];
  sectorName: string;
}

export interface MarketEvaluation {
  market: string;
  predicted: string;
  actual: string;
  hit: boolean;
}

export interface RoundEvaluation {
  spinIndex: number;
  actualNumber: number;
  actualColor: RouletteColor;
  markets: MarketEvaluation[];
  hitsCount: number;
  totalMarkets: number;
}

export interface MarketAccuracy {
  market: string;
  hits: number;
  attempts: number;
  ratePct: number;
  expectedRandomPct: number;
}

export interface AccuracySummary {
  evaluatedRounds: number;
  totalHits: number;
  totalAttempts: number;
  overallRatePct: number;
  levelLabel: string;
  byMarket: MarketAccuracy[];
  lastRound: RoundEvaluation | null;
  recentRounds: RoundEvaluation[];
  tableHistoryRounds: number;
  tableHistoryHits: number;
  tableHistoryAttempts: number;
  tableHistoryRatePct: number;
}

export interface RouletteAnalysis {
  totalSpins: number;
  lastNumber: number | null;
  recommendedAnchor: number;
  neighbors: number[];
  recommendedSector: {
    name: string;
    numbers: number[];
    hitRatePct: number;
  };
  dozens: {
    index: 1 | 2 | 3;
    label: string;
    shortLabel: string;
    delay: number;
    count: number;
  }[];
  columns: {
    index: 1 | 2 | 3;
    label: string;
    delay: number;
    count: number;
  }[];
  outsideStats: {
    redPct: number;
    blackPct: number;
    greenPct: number;
    evenPct: number;
    oddPct: number;
    lowPct: number;
    highPct: number;
  };
  hotNumbers: { number: number; count: number }[];
  coldNumbers: { number: number; count: number }[];
  learnedFollowups: { number: number; count: number }[];
  suggestedChips: number[];
  coveragePct: number;
  stakePerUnitAoa: number;
  totalRoundStakeAoa: number;
  fieldSuggestions: FieldSuggestions;
  accuracy: AccuracySummary;
}

export const WHEEL_ORDER: number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const RED_NUMBERS = new Set<number>([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const VOISINS_NUMBERS = [
  22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25,
];
export const TIERS_NUMBERS = [27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33];
export const ORPHELINS_NUMBERS = [1, 20, 14, 31, 9, 17, 34, 6];

export const INITIAL_SCREENSHOT_SPINS: number[] = [
  0, 28, 9, 17, 12, 3, 30, 25, 20, 2, 32, 12, 28,
];

export function getRouletteColor(num: number): RouletteColor {
  if (num === 0) return 'green';
  return RED_NUMBERS.has(num) ? 'red' : 'black';
}

export function getWheelNeighbors(anchor: number, radius = 2): number[] {
  const idx = WHEEL_ORDER.indexOf(anchor);
  if (idx === -1) return [anchor];
  const result: number[] = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const pos = ((idx + offset) % WHEEL_ORDER.length + WHEEL_ORDER.length) % WHEEL_ORDER.length;
    result.push(WHEEL_ORDER[pos]);
  }
  return result;
}

export function getDozenOf(num: number): 0 | 1 | 2 | 3 {
  if (num === 0) return 0;
  if (num <= 12) return 1;
  if (num <= 24) return 2;
  return 3;
}

export function getColumnOf(num: number): 0 | 1 | 2 | 3 {
  if (num === 0) return 0;
  return (((num - 1) % 3) + 1) as 1 | 2 | 3;
}

/**
 * Gera a sugestão para TODOS os campos da mesa usando um histórico (mais recente em index 0).
 */
export function computeFieldSuggestions(
  spinsNewestFirst: number[],
  profile: StrategyProfile = 'neighbors'
): {
  suggestions: FieldSuggestions;
  suggestedChips: number[];
  topSector: { name: string; numbers: number[]; hitRatePct: number };
  dozens: { index: 1 | 2 | 3; label: string; shortLabel: string; delay: number; count: number }[];
  columns: { index: 1 | 2 | 3; label: string; delay: number; count: number }[];
  hotNumbers: { number: number; count: number }[];
  coldNumbers: { number: number; count: number }[];
  learnedFollowups: { number: number; count: number }[];
} {
  const total = spinsNewestFirst.length;
  const freq = new Array<number>(37).fill(0);
  for (const n of spinsNewestFirst) {
    if (n >= 0 && n <= 36) freq[n]++;
  }

  const last = total > 0 ? spinsNewestFirst[0] : 0;

  // Transições aprendidas: o que costuma sair após o número atual
  const transitions = new Array<number>(37).fill(0);
  for (let i = 1; i < total; i++) {
    const prev = spinsNewestFirst[i];
    const next = spinsNewestFirst[i - 1];
    if (prev === last && next >= 0 && next <= 36) {
      transitions[next]++;
    }
  }

  const learnedFollowups = Array.from({ length: 37 }, (_, n) => ({
    number: n,
    count: transitions[n],
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  // Pontuação para número âncora + vizinhos
  const recentWindow = spinsNewestFirst.slice(0, 20);
  const scores = new Array<number>(37).fill(0);
  recentWindow.forEach((num, idx) => {
    const recencyWeight = (recentWindow.length - idx) / recentWindow.length;
    scores[num] += 1.2 * recencyWeight;
    for (const nb of getWheelNeighbors(num, 1)) {
      scores[nb] += 0.35 * recencyWeight;
    }
  });
  for (let n = 0; n <= 36; n++) {
    scores[n] += transitions[n] * 1.6;
  }

  let anchor = last;
  let bestScore = -1;
  for (let n = 0; n <= 36; n++) {
    if (scores[n] > bestScore) {
      bestScore = scores[n];
      anchor = n;
    }
  }

  const neighbors = getWheelNeighbors(anchor, 2);

  // Setores físicos
  const sectors = [
    { name: 'Voisins du Zéro', numbers: VOISINS_NUMBERS },
    { name: 'Tiers du Cylindre', numbers: TIERS_NUMBERS },
    { name: 'Orphelins', numbers: ORPHELINS_NUMBERS },
  ].map((s) => {
    const set = new Set(s.numbers);
    const hits = recentWindow.filter((n) => set.has(n)).length;
    const hitRatePct = recentWindow.length > 0 ? (hits / recentWindow.length) * 100 : 0;
    return { ...s, hitRatePct, normalizedDensity: hits / s.numbers.length };
  });
  sectors.sort((a, b) => b.normalizedDensity - a.normalizedDensity);
  const topSector = sectors[0];

  // Dúzias (Blocos)
  const dozens = ([1, 2, 3] as const).map((dz) => {
    const delayIdx = spinsNewestFirst.findIndex((n) => getDozenOf(n) === dz);
    const count = spinsNewestFirst.filter((n) => getDozenOf(n) === dz).length;
    const label =
      dz === 1 ? '1ª Dúzia (1–12)' : dz === 2 ? '2ª Dúzia (13–24)' : '3ª Dúzia (25–36)';
    const shortLabel = dz === 1 ? '1st 12' : dz === 2 ? '2nd 12' : '3rd 12';
    return {
      index: dz,
      label,
      shortLabel,
      delay: delayIdx === -1 ? total : delayIdx,
      count,
    };
  });
  const delayedDozen = [...dozens].sort((a, b) => b.delay - a.delay)[0];

  // Colunas (2to1)
  const columns = ([1, 2, 3] as const).map((col) => {
    const delayIdx = spinsNewestFirst.findIndex((n) => getColumnOf(n) === col);
    const count = spinsNewestFirst.filter((n) => getColumnOf(n) === col).length;
    return {
      index: col,
      label: `Coluna ${col}`,
      delay: delayIdx === -1 ? total : delayIdx,
      count,
    };
  });
  const delayedColumn = [...columns].sort((a, b) => b.delay - a.delay)[0];

  // Análise de Cor (Vermelho vs Preto) - sequência atual e equilíbrio nos últimos 12 giros
  const recent12 = spinsNewestFirst.slice(0, 12);
  const red12 = recent12.filter((n) => getRouletteColor(n) === 'red').length;
  const black12 = recent12.filter((n) => getRouletteColor(n) === 'black').length;
  let redStreak = 0;
  let blackStreak = 0;
  for (const n of spinsNewestFirst) {
    const c = getRouletteColor(n);
    if (c === 'red' && blackStreak === 0) redStreak++;
    else if (c === 'black' && redStreak === 0) blackStreak++;
    else break;
  }

  let suggestedColor: SuggestedColor = red12 <= black12 ? 'Vermelho' : 'Preto';
  let colorReason = `Equilíbrio nos últimos 12 giros (${red12}V / ${black12}P)`;
  if (redStreak >= 3) {
    suggestedColor = 'Preto';
    colorReason = `Sequência de ${redStreak} vermelhos seguidos`;
  } else if (blackStreak >= 3) {
    suggestedColor = 'Vermelho';
    colorReason = `Sequência de ${blackStreak} pretos seguidos`;
  }

  // Análise de Paridade (Par vs Ímpar)
  const even12 = recent12.filter((n) => n !== 0 && n % 2 === 0).length;
  const odd12 = recent12.filter((n) => n !== 0 && n % 2 === 1).length;
  let evenStreak = 0;
  let oddStreak = 0;
  for (const n of spinsNewestFirst) {
    if (n === 0) break;
    if (n % 2 === 0 && oddStreak === 0) evenStreak++;
    else if (n % 2 === 1 && evenStreak === 0) oddStreak++;
    else break;
  }

  let suggestedParity: SuggestedParity = even12 <= odd12 ? 'Par' : 'Ímpar';
  let parityReason = `Frequência recente (${even12} Par / ${odd12} Ímp)`;
  if (evenStreak >= 3) {
    suggestedParity = 'Ímpar';
    parityReason = `Sequência de ${evenStreak} pares seguidos`;
  } else if (oddStreak >= 3) {
    suggestedParity = 'Par';
    parityReason = `Sequência de ${oddStreak} ímpares seguidos`;
  }

  // Análise de Força / Metade (1-18 vs 19-36)
  const low12 = recent12.filter((n) => n >= 1 && n <= 18).length;
  const high12 = recent12.filter((n) => n >= 19 && n <= 36).length;
  const suggestedHalf: SuggestedHalf = low12 <= high12 ? '1–18 (Baixo)' : '19–36 (Alto)';
  const halfReason = `Distribuição recente (${low12} Baixos / ${high12} Altos)`;

  const hotNumbers = Array.from({ length: 37 }, (_, n) => ({
    number: n,
    count: freq[n],
  }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const coldNumbers = Array.from({ length: 37 }, (_, n) => ({
    number: n,
    count: freq[n],
  }))
    .sort((a, b) => a.count - b.count)
    .slice(0, 6);

  let suggestedChips: number[];
  if (profile === 'neighbors') {
    suggestedChips = Array.from(
      new Set([...neighbors, ...learnedFollowups.slice(0, 2).map((x) => x.number)])
    );
  } else if (profile === 'sectors') {
    suggestedChips = topSector.numbers.slice(0, 8);
  } else {
    const hotTop = hotNumbers.slice(0, 3).map((x) => x.number);
    suggestedChips = Array.from(new Set([...neighbors.slice(0, 3), ...hotTop, 0]));
  }

  return {
    suggestions: {
      color: suggestedColor,
      colorReason,
      parity: suggestedParity,
      parityReason,
      half: suggestedHalf,
      halfReason,
      dozenIndex: delayedDozen.index,
      dozenLabel: delayedDozen.label,
      dozenReason: `${delayedDozen.delay} giros sem sair`,
      columnIndex: delayedColumn.index,
      columnLabel: delayedColumn.label,
      columnReason: `${delayedColumn.delay} giros sem sair`,
      anchorNumber: anchor,
      neighbors,
      sectorName: topSector.name,
    },
    suggestedChips,
    topSector: {
      name: topSector.name,
      numbers: topSector.numbers,
      hitRatePct: topSector.hitRatePct,
    },
    dozens,
    columns,
    hotNumbers,
    coldNumbers,
    learnedFollowups,
  };
}

/**
 * Avalia passo a passo (walk-forward) o nível de acerto real em todos os campos:
 * para cada giro i, usa apenas os giros anteriores a i para prever e testa se acertou em i.
 */
export function evaluateAccuracy(
  sessionSpinsNewestFirst: number[],
  profile: StrategyProfile = 'neighbors',
  learnedPriorSpinsNewestFirst: number[] = []
): AccuracySummary {
  const emptyMarkets: MarketAccuracy[] = [
    { market: 'Vermelho / Preto', hits: 0, attempts: 0, ratePct: 0, expectedRandomPct: 48.6 },
    { market: 'Par / Ímpar', hits: 0, attempts: 0, ratePct: 0, expectedRandomPct: 48.6 },
    { market: '1–18 / 19–36', hits: 0, attempts: 0, ratePct: 0, expectedRandomPct: 48.6 },
    { market: 'Dúzias (Blocos)', hits: 0, attempts: 0, ratePct: 0, expectedRandomPct: 32.4 },
    { market: 'Colunas (2to1)', hits: 0, attempts: 0, ratePct: 0, expectedRandomPct: 32.4 },
    { market: 'Vizinhos (±2)', hits: 0, attempts: 0, ratePct: 0, expectedRandomPct: 13.5 },
    { market: 'Setor da Roda', hits: 0, attempts: 0, ratePct: 0, expectedRandomPct: 32.4 },
  ];

  // Backtest imediato sobre o histórico já lido da mesa (até últimas 30 rodadas)
  let tableHistoryRounds = 0;
  let tableHistoryHits = 0;
  let tableHistoryAttempts = 0;
  if (learnedPriorSpinsNewestFirst.length >= 4) {
    const tableChrono = [...learnedPriorSpinsNewestFirst.slice(0, 30)].reverse();
    for (let i = 1; i < tableChrono.length; i++) {
      const priorNewestFirst = tableChrono.slice(0, i).reverse();
      const { suggestions, topSector } = computeFieldSuggestions(priorNewestFirst, profile);
      const actual = tableChrono[i];
      const actualColor = getRouletteColor(actual);
      const hitsArr = [
        (suggestions.color === 'Vermelho' && actualColor === 'red') ||
          (suggestions.color === 'Preto' && actualColor === 'black'),
        actual !== 0 &&
          ((suggestions.parity === 'Par' && actual % 2 === 0) ||
            (suggestions.parity === 'Ímpar' && actual % 2 === 1)),
        actual !== 0 &&
          ((suggestions.half.startsWith('1–18') && actual <= 18) ||
            (suggestions.half.startsWith('19–36') && actual >= 19)),
        getDozenOf(actual) === suggestions.dozenIndex,
        getColumnOf(actual) === suggestions.columnIndex,
        suggestions.neighbors.includes(actual),
        topSector.numbers.includes(actual),
      ];
      tableHistoryRounds++;
      tableHistoryAttempts += hitsArr.length;
      tableHistoryHits += hitsArr.filter(Boolean).length;
    }
  }
  const tableHistoryRatePct =
    tableHistoryAttempts > 0 ? (tableHistoryHits / tableHistoryAttempts) * 100 : 0;

  if (sessionSpinsNewestFirst.length === 0) {
    return {
      evaluatedRounds: 0,
      totalHits: 0,
      totalAttempts: 0,
      overallRatePct: 0,
      levelLabel:
        learnedPriorSpinsNewestFirst.length > 0
          ? 'Sessão zerada (aprendizagem preservada)'
          : 'Sessão virgem (aguardando 1ª jogada)',
      byMarket: emptyMarkets,
      lastRound: null,
      recentRounds: [],
      tableHistoryRounds,
      tableHistoryHits,
      tableHistoryAttempts,
      tableHistoryRatePct,
    };
  }

  // Ordem cronológica da sessão atual: oldest -> newest (avalia últimas 100 rodadas para rapidez)
  const boundedSession = sessionSpinsNewestFirst.slice(0, 100);
  const sessionChronological = [...boundedSession].reverse();

  const marketStats = [
    { market: 'Vermelho / Preto', hits: 0, attempts: 0, expectedRandomPct: 48.6 },
    { market: 'Par / Ímpar', hits: 0, attempts: 0, expectedRandomPct: 48.6 },
    { market: '1–18 / 19–36', hits: 0, attempts: 0, expectedRandomPct: 48.6 },
    { market: 'Dúzias (Blocos)', hits: 0, attempts: 0, expectedRandomPct: 32.4 },
    { market: 'Colunas (2to1)', hits: 0, attempts: 0, expectedRandomPct: 32.4 },
    { market: 'Vizinhos (±2)', hits: 0, attempts: 0, expectedRandomPct: 13.5 },
    { market: 'Setor da Roda', hits: 0, attempts: 0, expectedRandomPct: 32.4 },
  ];

  const roundEvaluations: RoundEvaluation[] = [];

  for (let i = 0; i < sessionChronological.length; i++) {
    const priorSessionNewestFirst = sessionChronological.slice(0, i).reverse();
    const combinedPriorNewestFirst = [
      ...priorSessionNewestFirst,
      ...learnedPriorSpinsNewestFirst,
    ].slice(0, 150);

    // Se ainda não existia nenhum giro prévio (nem na mesa/backup), o primeiro giro apenas inicia a leitura
    if (combinedPriorNewestFirst.length === 0) {
      continue;
    }

    const { suggestions, topSector } = computeFieldSuggestions(combinedPriorNewestFirst, profile);
    const actual = sessionChronological[i];
    const actualColor = getRouletteColor(actual);

    const colorActualLabel =
      actualColor === 'green' ? 'Zero (0)' : actualColor === 'red' ? 'Vermelho' : 'Preto';
    const colorHit =
      (suggestions.color === 'Vermelho' && actualColor === 'red') ||
      (suggestions.color === 'Preto' && actualColor === 'black');

    const parityActualLabel =
      actual === 0 ? 'Zero (0)' : actual % 2 === 0 ? 'Par' : 'Ímpar';
    const parityHit =
      actual !== 0 &&
      ((suggestions.parity === 'Par' && actual % 2 === 0) ||
        (suggestions.parity === 'Ímpar' && actual % 2 === 1));

    const halfActualLabel =
      actual === 0 ? 'Zero (0)' : actual <= 18 ? '1–18 (Baixo)' : '19–36 (Alto)';
    const halfHit =
      actual !== 0 &&
      ((suggestions.half.startsWith('1–18') && actual <= 18) ||
        (suggestions.half.startsWith('19–36') && actual >= 19));

    const actualDz = getDozenOf(actual);
    const dzActualLabel =
      actualDz === 0
        ? 'Zero (0)'
        : actualDz === 1
        ? '1ª Dúzia (1–12)'
        : actualDz === 2
        ? '2ª Dúzia (13–24)'
        : '3ª Dúzia (25–36)';
    const dzHit = actualDz === suggestions.dozenIndex;

    const actualCol = getColumnOf(actual);
    const colActualLabel = actualCol === 0 ? 'Zero (0)' : `Coluna ${actualCol}`;
    const colHit = actualCol === suggestions.columnIndex;

    const neighborsHit = suggestions.neighbors.includes(actual);

    const sectorHit = topSector.numbers.includes(actual);
    const actualSectorLabel = VOISINS_NUMBERS.includes(actual)
      ? 'Voisins du Zéro'
      : TIERS_NUMBERS.includes(actual)
      ? 'Tiers du Cylindre'
      : 'Orphelins';

    const evals: MarketEvaluation[] = [
      {
        market: 'Vermelho / Preto',
        predicted: suggestions.color,
        actual: colorActualLabel,
        hit: colorHit,
      },
      {
        market: 'Par / Ímpar',
        predicted: suggestions.parity,
        actual: parityActualLabel,
        hit: parityHit,
      },
      {
        market: '1–18 / 19–36',
        predicted: suggestions.half,
        actual: halfActualLabel,
        hit: halfHit,
      },
      {
        market: 'Dúzias (Blocos)',
        predicted: suggestions.dozenLabel,
        actual: dzActualLabel,
        hit: dzHit,
      },
      {
        market: 'Colunas (2to1)',
        predicted: suggestions.columnLabel,
        actual: colActualLabel,
        hit: colHit,
      },
      {
        market: 'Vizinhos (±2)',
        predicted: suggestions.neighbors.join(', '),
        actual: String(actual),
        hit: neighborsHit,
      },
      {
        market: 'Setor da Roda',
        predicted: topSector.name,
        actual: actualSectorLabel,
        hit: sectorHit,
      },
    ];

    evals.forEach((ev, mIdx) => {
      marketStats[mIdx].attempts++;
      if (ev.hit) marketStats[mIdx].hits++;
    });

    roundEvaluations.push({
      spinIndex: i + 1,
      actualNumber: actual,
      actualColor,
      markets: evals,
      hitsCount: evals.filter((e) => e.hit).length,
      totalMarkets: evals.length,
    });
  }

  if (roundEvaluations.length === 0) {
    return {
      evaluatedRounds: 0,
      totalHits: 0,
      totalAttempts: 0,
      overallRatePct: 0,
      levelLabel: '1º giro lido · Aguardando próxima rodada para medir acerto',
      byMarket: emptyMarkets,
      lastRound: null,
      recentRounds: [],
      tableHistoryRounds,
      tableHistoryHits,
      tableHistoryAttempts,
      tableHistoryRatePct,
    };
  }

  const totalHits = marketStats.reduce((acc, m) => acc + m.hits, 0);
  const totalAttempts = marketStats.reduce((acc, m) => acc + m.attempts, 0);
  const overallRatePct = totalAttempts > 0 ? (totalHits / totalAttempts) * 100 : 0;

  let levelLabel = 'Leitura em Calibração';
  if (roundEvaluations.length >= 3) {
    if (overallRatePct >= 46) levelLabel = 'Nível Alto (Acima da Média Teórica)';
    else if (overallRatePct >= 34) levelLabel = 'Nível Equilibrado (Dentro do Esperado)';
    else levelLabel = 'Nível Baixo (Variância Desfavorável)';
  }

  const newestRounds = [...roundEvaluations].reverse();

  return {
    evaluatedRounds: roundEvaluations.length,
    totalHits,
    totalAttempts,
    overallRatePct,
    levelLabel,
    byMarket: marketStats.map((m) => ({
      ...m,
      ratePct: m.attempts > 0 ? (m.hits / m.attempts) * 100 : 0,
    })),
    lastRound: newestRounds[0] ?? null,
    recentRounds: newestRounds.slice(0, 8),
    tableHistoryRounds,
    tableHistoryHits,
    tableHistoryAttempts,
    tableHistoryRatePct,
  };
}

export function analyzeSpins(
  sessionSpinsNewestFirst: number[],
  profile: StrategyProfile = 'neighbors',
  bankrollAoa = 238.39,
  unitStakeAoa = 10,
  learnedPriorSpinsNewestFirst: number[] = []
): RouletteAnalysis {
  const combinedForPrediction = [...sessionSpinsNewestFirst, ...learnedPriorSpinsNewestFirst];
  const total = combinedForPrediction.length;
  const computed = computeFieldSuggestions(combinedForPrediction, profile);
  const accuracy = evaluateAccuracy(
    sessionSpinsNewestFirst,
    profile,
    learnedPriorSpinsNewestFirst
  );

  if (total === 0) {
    return {
      totalSpins: 0,
      lastNumber: null,
      recommendedAnchor: 0,
      neighbors: computed.suggestions.neighbors,
      recommendedSector: computed.topSector,
      dozens: computed.dozens,
      columns: computed.columns,
      outsideStats: {
        redPct: 0,
        blackPct: 0,
        greenPct: 0,
        evenPct: 0,
        oddPct: 0,
        lowPct: 0,
        highPct: 0,
      },
      hotNumbers: [],
      coldNumbers: [],
      learnedFollowups: [],
      suggestedChips: [],
      coveragePct: 0,
      stakePerUnitAoa: unitStakeAoa,
      totalRoundStakeAoa: 0,
      fieldSuggestions: computed.suggestions,
      accuracy,
    };
  }

  const redCount = combinedForPrediction.filter((n) => getRouletteColor(n) === 'red').length;
  const blackCount = combinedForPrediction.filter((n) => getRouletteColor(n) === 'black').length;
  const greenCount = combinedForPrediction.filter((n) => n === 0).length;
  const evenCount = combinedForPrediction.filter((n) => n !== 0 && n % 2 === 0).length;
  const oddCount = combinedForPrediction.filter((n) => n !== 0 && n % 2 === 1).length;
  const lowCount = combinedForPrediction.filter((n) => n >= 1 && n <= 18).length;
  const highCount = combinedForPrediction.filter((n) => n >= 19 && n <= 36).length;

  const safeMaxRound = Math.max(unitStakeAoa, Math.floor(bankrollAoa * 0.25));
  const affordableChipsCount = Math.min(
    computed.suggestedChips.length,
    Math.max(1, Math.floor(safeMaxRound / Math.max(1, unitStakeAoa)))
  );
  const finalChips = computed.suggestedChips.slice(0, Math.max(5, affordableChipsCount));
  const cappedStake =
    finalChips.length * unitStakeAoa > bankrollAoa
      ? Math.max(1, Math.floor(bankrollAoa / Math.max(1, finalChips.length)))
      : unitStakeAoa;

  return {
    totalSpins: total,
    lastNumber: combinedForPrediction[0],
    recommendedAnchor: computed.suggestions.anchorNumber,
    neighbors: computed.suggestions.neighbors,
    recommendedSector: computed.topSector,
    dozens: computed.dozens,
    columns: computed.columns,
    outsideStats: {
      redPct: (redCount / total) * 100,
      blackPct: (blackCount / total) * 100,
      greenPct: (greenCount / total) * 100,
      evenPct: (evenCount / total) * 100,
      oddPct: (oddCount / total) * 100,
      lowPct: (lowCount / total) * 100,
      highPct: (highCount / total) * 100,
    },
    hotNumbers: computed.hotNumbers,
    coldNumbers: computed.coldNumbers,
    learnedFollowups: computed.learnedFollowups,
    suggestedChips: finalChips,
    coveragePct: (finalChips.length / 37) * 100,
    stakePerUnitAoa: cappedStake,
    totalRoundStakeAoa: finalChips.length * cappedStake,
    fieldSuggestions: computed.suggestions,
    accuracy,
  };
}
