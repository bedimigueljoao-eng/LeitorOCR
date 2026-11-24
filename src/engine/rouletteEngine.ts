export type RouletteColor = 'green' | 'red' | 'black';

export type RouletteSectorId = 'voisins' | 'tiers' | 'orphelins' | 'zero_spiel';

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
export const ZERO_SPIEL_NUMBERS = [12, 35, 3, 26, 0, 32, 15];

export interface RouletteNumberStat {
  number: number;
  color: RouletteColor;
  count: number;
  pct: number;
  currentDelay: number;
  maxDelay: number;
}

export interface RouletteGroupStat {
  id: string;
  label: string;
  count: number;
  pct: number;
  expectedPct: number;
  currentDelay: number;
  maxDelay: number;
  currentStreak: number;
  maxStreak: number;
}

export interface RouletteSectorStat {
  id: RouletteSectorId;
  label: string;
  numbers: number[];
  count: number;
  pct: number;
  expectedPct: number;
  deltaPct: number;
  currentDelay: number;
}

export interface QuantRouletteReport {
  totalSpins: number;
  lastNumber: number | null;
  lastColor: RouletteColor | null;
  numberStats: RouletteNumberStat[];
  hotNumbers: RouletteNumberStat[];
  coldNumbers: RouletteNumberStat[];
  colors: {
    red: RouletteGroupStat;
    black: RouletteGroupStat;
    green: RouletteGroupStat;
  };
  parity: {
    even: RouletteGroupStat;
    odd: RouletteGroupStat;
  };
  halves: {
    low: RouletteGroupStat;
    high: RouletteGroupStat;
  };
  dozens: RouletteGroupStat[];
  columns: RouletteGroupStat[];
  sectors: RouletteSectorStat[];
  recommendedAnchor: number;
  neighborsPlusMinus2: number[];
  topSector: RouletteSectorStat;
  recent20Numbers: number[];
}

export function isValidRouletteNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 36;
}

export function getRouletteColor(num: number): RouletteColor {
  if (num === 0) return 'green';
  return RED_NUMBERS.has(num) ? 'red' : 'black';
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

function computeGroupStat(
  spinsNewestFirst: number[],
  id: string,
  label: string,
  expectedPct: number,
  predicate: (n: number) => boolean
): RouletteGroupStat {
  const total = spinsNewestFirst.length;
  let count = 0;
  for (const n of spinsNewestFirst) {
    if (predicate(n)) count++;
  }

  let currentDelay = 0;
  for (const n of spinsNewestFirst) {
    if (predicate(n)) break;
    currentDelay++;
  }

  let currentStreak = 0;
  for (const n of spinsNewestFirst) {
    if (predicate(n)) currentStreak++;
    else break;
  }

  // Cronológico (mais antigo -> mais recente) para calcular máximos
  let maxDelay = 0;
  let runDelay = 0;
  let maxStreak = 0;
  let runStreak = 0;
  for (let i = total - 1; i >= 0; i--) {
    if (predicate(spinsNewestFirst[i])) {
      runDelay = 0;
      runStreak++;
      if (runStreak > maxStreak) maxStreak = runStreak;
    } else {
      runStreak = 0;
      runDelay++;
      if (runDelay > maxDelay) maxDelay = runDelay;
    }
  }

  return {
    id,
    label,
    count,
    pct: total > 0 ? (count / total) * 100 : 0,
    expectedPct,
    currentDelay,
    maxDelay,
    currentStreak,
    maxStreak,
  };
}

export function analyzeQuantRoulette(spinsNewestFirst: number[]): QuantRouletteReport {
  const clean = spinsNewestFirst.filter(isValidRouletteNumber).slice(0, 500);
  const total = clean.length;

  const numberStats: RouletteNumberStat[] = Array.from({ length: 37 }, (_, num) => {
    let count = 0;
    for (const s of clean) {
      if (s === num) count++;
    }
    let currentDelay = 0;
    for (const s of clean) {
      if (s === num) break;
      currentDelay++;
    }
    let maxDelay = 0;
    let runDelay = 0;
    for (let i = total - 1; i >= 0; i--) {
      if (clean[i] === num) runDelay = 0;
      else {
        runDelay++;
        if (runDelay > maxDelay) maxDelay = runDelay;
      }
    }
    return {
      number: num,
      color: getRouletteColor(num),
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      currentDelay,
      maxDelay,
    };
  });

  const hotNumbers = [...numberStats]
    .sort((a, b) => b.count - a.count || a.currentDelay - b.currentDelay)
    .slice(0, 6);
  const coldNumbers = [...numberStats]
    .sort((a, b) => b.currentDelay - a.currentDelay || a.count - b.count)
    .slice(0, 6);

  const colors = {
    red: computeGroupStat(clean, 'red', 'Vermelho', (18 / 37) * 100, (n) => getRouletteColor(n) === 'red'),
    black: computeGroupStat(clean, 'black', 'Preto', (18 / 37) * 100, (n) => getRouletteColor(n) === 'black'),
    green: computeGroupStat(clean, 'green', 'Zero (0)', (1 / 37) * 100, (n) => n === 0),
  };

  const parity = {
    even: computeGroupStat(clean, 'even', 'Par', (18 / 37) * 100, (n) => n > 0 && n % 2 === 0),
    odd: computeGroupStat(clean, 'odd', 'Ímpar', (18 / 37) * 100, (n) => n > 0 && n % 2 === 1),
  };

  const halves = {
    low: computeGroupStat(clean, 'low', '1–18 (Baixo)', (18 / 37) * 100, (n) => n >= 1 && n <= 18),
    high: computeGroupStat(clean, 'high', '19–36 (Alto)', (18 / 37) * 100, (n) => n >= 19 && n <= 36),
  };

  const dozens: RouletteGroupStat[] = [
    computeGroupStat(clean, 'd1', '1ª Dúzia (1–12)', (12 / 37) * 100, (n) => getDozenOf(n) === 1),
    computeGroupStat(clean, 'd2', '2ª Dúzia (13–24)', (12 / 37) * 100, (n) => getDozenOf(n) === 2),
    computeGroupStat(clean, 'd3', '3ª Dúzia (25–36)', (12 / 37) * 100, (n) => getDozenOf(n) === 3),
  ];

  const columns: RouletteGroupStat[] = [
    computeGroupStat(clean, 'c1', 'Coluna 1 (1,4..34)', (12 / 37) * 100, (n) => getColumnOf(n) === 1),
    computeGroupStat(clean, 'c2', 'Coluna 2 (2,5..35)', (12 / 37) * 100, (n) => getColumnOf(n) === 2),
    computeGroupStat(clean, 'c3', 'Coluna 3 (3,6..36)', (12 / 37) * 100, (n) => getColumnOf(n) === 3),
  ];

  const sectorDefs: Array<{ id: RouletteSectorId; label: string; numbers: number[] }> = [
    { id: 'voisins', label: 'Voisins du Zéro', numbers: VOISINS_NUMBERS },
    { id: 'tiers', label: 'Tiers du Cylindre', numbers: TIERS_NUMBERS },
    { id: 'orphelins', label: 'Orphelins', numbers: ORPHELINS_NUMBERS },
    { id: 'zero_spiel', label: 'Zero Spiel', numbers: ZERO_SPIEL_NUMBERS },
  ];

  const sectors: RouletteSectorStat[] = sectorDefs.map((sec) => {
    const set = new Set(sec.numbers);
    const stat = computeGroupStat(clean, sec.id, sec.label, (sec.numbers.length / 37) * 100, (n) => set.has(n));
    return {
      id: sec.id,
      label: sec.label,
      numbers: sec.numbers,
      count: stat.count,
      pct: stat.pct,
      expectedPct: stat.expectedPct,
      deltaPct: stat.pct - stat.expectedPct,
      currentDelay: stat.currentDelay,
    };
  });

  const topSector = [...sectors].sort((a, b) => b.deltaPct - a.deltaPct || b.pct - a.pct)[0];

  // Escolhe número âncora usando ponderação recência + vizinhos físicos ±2
  const scores = new Array<number>(37).fill(0);
  const recent25 = clean.slice(0, 25);
  recent25.forEach((n, idx) => {
    const w = (recent25.length - idx) / Math.max(1, recent25.length);
    scores[n] += 1.2 * w;
    for (const nb of getWheelNeighbors(n, 2)) {
      scores[nb] += 0.28 * w;
    }
  });
  let recommendedAnchor = clean[0] ?? 0;
  let bestScore = -1;
  for (let n = 0; n <= 36; n++) {
    if (scores[n] > bestScore) {
      bestScore = scores[n];
      recommendedAnchor = n;
    }
  }

  return {
    totalSpins: total,
    lastNumber: total > 0 ? clean[0] : null,
    lastColor: total > 0 ? getRouletteColor(clean[0]) : null,
    numberStats,
    hotNumbers,
    coldNumbers,
    colors,
    parity,
    halves,
    dozens,
    columns,
    sectors,
    recommendedAnchor,
    neighborsPlusMinus2: getWheelNeighbors(recommendedAnchor, 2),
    topSector,
    recent20Numbers: clean.slice(0, 20),
  };
}
