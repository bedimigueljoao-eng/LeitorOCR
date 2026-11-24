export type AviatorBandKey =
  | 'under_1_50'
  | '1_50_to_1_99'
  | '2_00_to_4_99'
  | '5_00_to_9_99'
  | 'over_10_00';

export interface AviatorBandStat {
  key: AviatorBandKey;
  label: string;
  colorClass: string;
  count: number;
  pct: number;
}

export interface AviatorGapMetrics {
  threshold: number;
  label: string;
  count: number;
  currentGap: number;
  minGap: number | null;
  medianGap: number | null;
  maxGap: number | null;
}

export interface QuantAviatorReport {
  totalRounds: number;
  lastMultiplier: number | null;
  bands: AviatorBandStat[];
  lowUnder2StreakCurrent: number;
  lowUnder2StreakMax: number;
  lowUnder150StreakCurrent: number;
  lowUnder150StreakMax: number;
  purpleGap: AviatorGapMetrics;
  pinkGap: AviatorGapMetrics;
  movingAvg10: number;
  movingAvg20: number;
  overallAvg: number;
  medianAll: number;
  recent20StdDev: number;
  recent20CoefVar: number;
  postPinkUnder150Pct: number | null;
  postPinkSamples: number;
  recent20Multipliers: number[];
}

export function isValidAviatorValue(val: number): boolean {
  return Number.isFinite(val) && val >= 1.0 && val <= 10000.0;
}

export function classifyAviatorBand(mult: number): AviatorBandKey {
  if (mult < 1.5) return 'under_1_50';
  if (mult < 2.0) return '1_50_to_1_99';
  if (mult < 5.0) return '2_00_to_4_99';
  if (mult < 10.0) return '5_00_to_9_99';
  return 'over_10_00';
}

export function getAviatorPillColorTier(mult: number): 'blue' | 'purple' | 'pink' {
  if (mult >= 10.0) return 'pink';
  if (mult >= 2.0) return 'purple';
  return 'blue';
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function computeGapMetrics(
  newestFirst: number[],
  threshold: number,
  label: string
): AviatorGapMetrics {
  // Converte para cronológico (mais antigo -> mais recente) para gaps entre eventos
  const chrono = [...newestFirst].reverse();
  const indices: number[] = [];
  for (let i = 0; i < chrono.length; i++) {
    if (chrono[i] >= threshold) indices.push(i);
  }
  const gaps: number[] = [];
  for (let k = 1; k < indices.length; k++) {
    gaps.push(indices[k] - indices[k - 1] - 1);
  }
  gaps.sort((a, b) => a - b);

  let currentGap = 0;
  for (let i = 0; i < newestFirst.length; i++) {
    if (newestFirst[i] >= threshold) break;
    currentGap++;
  }

  return {
    threshold,
    label,
    count: indices.length,
    currentGap,
    minGap: gaps.length > 0 ? gaps[0] : null,
    medianGap: gaps.length > 0 ? median(gaps) : null,
    maxGap: gaps.length > 0 ? gaps[gaps.length - 1] : null,
  };
}

export function analyzeQuantAviator(multipliersNewestFirst: number[]): QuantAviatorReport {
  const clean = multipliersNewestFirst
    .filter(isValidAviatorValue)
    .map((m) => Math.round(m * 100) / 100)
    .slice(0, 500);
  const total = clean.length;

  const counts: Record<AviatorBandKey, number> = {
    under_1_50: 0,
    '1_50_to_1_99': 0,
    '2_00_to_4_99': 0,
    '5_00_to_9_99': 0,
    over_10_00: 0,
  };
  for (const m of clean) {
    counts[classifyAviatorBand(m)]++;
  }

  const bandSpecs: Array<{ key: AviatorBandKey; label: string; colorClass: string }> = [
    { key: 'under_1_50', label: '< 1.50x', colorClass: 'text-sky-300' },
    { key: '1_50_to_1_99', label: '1.50x – 1.99x', colorClass: 'text-blue-300' },
    { key: '2_00_to_4_99', label: '2.00x – 4.99x', colorClass: 'text-purple-300' },
    { key: '5_00_to_9_99', label: '5.00x – 9.99x', colorClass: 'text-violet-300' },
    { key: 'over_10_00', label: '>= 10.00x', colorClass: 'text-fuchsia-300' },
  ];

  const bands: AviatorBandStat[] = bandSpecs.map((b) => ({
    ...b,
    count: counts[b.key],
    pct: total > 0 ? (counts[b.key] / total) * 100 : 0,
  }));

  // Streaks atuais (começando do index 0 = mais recente)
  let lowUnder2StreakCurrent = 0;
  for (const m of clean) {
    if (m < 2.0) lowUnder2StreakCurrent++;
    else break;
  }

  let lowUnder150StreakCurrent = 0;
  for (const m of clean) {
    if (m < 1.5) lowUnder150StreakCurrent++;
    else break;
  }

  let lowUnder2StreakMax = 0;
  let run2 = 0;
  let lowUnder150StreakMax = 0;
  let run150 = 0;
  for (let i = total - 1; i >= 0; i--) {
    const m = clean[i];
    if (m < 2.0) {
      run2++;
      if (run2 > lowUnder2StreakMax) lowUnder2StreakMax = run2;
    } else run2 = 0;

    if (m < 1.5) {
      run150++;
      if (run150 > lowUnder150StreakMax) lowUnder150StreakMax = run150;
    } else run150 = 0;
  }

  const recent10 = clean.slice(0, 10);
  const recent20 = clean.slice(0, 20);
  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const movingAvg10 = avg(recent10);
  const movingAvg20 = avg(recent20);
  const overallAvg = avg(clean);
  const medianAll = median(clean);

  const variance20 =
    recent20.length > 0
      ? recent20.reduce((acc, m) => acc + (m - movingAvg20) ** 2, 0) / recent20.length
      : 0;
  const recent20StdDev = Math.sqrt(variance20);
  const recent20CoefVar = movingAvg20 > 0 ? recent20StdDev / movingAvg20 : 0;

  // Pós-pico >=10x (no cronológico, verifica rodada imediatamente seguinte)
  const chrono = [...clean].reverse();
  let postPinkSamples = 0;
  let postPinkLow = 0;
  for (let i = 0; i < chrono.length - 1; i++) {
    if (chrono[i] >= 10.0) {
      postPinkSamples++;
      if (chrono[i + 1] < 1.5) postPinkLow++;
    }
  }

  return {
    totalRounds: total,
    lastMultiplier: total > 0 ? clean[0] : null,
    bands,
    lowUnder2StreakCurrent,
    lowUnder2StreakMax,
    lowUnder150StreakCurrent,
    lowUnder150StreakMax,
    purpleGap: computeGapMetrics(clean, 2.0, 'Velas Roxas (>= 2.00x)'),
    pinkGap: computeGapMetrics(clean, 10.0, 'Velas Rosas (>= 10.00x)'),
    movingAvg10,
    movingAvg20,
    overallAvg,
    medianAll,
    recent20StdDev,
    recent20CoefVar,
    postPinkUnder150Pct: postPinkSamples > 0 ? (postPinkLow / postPinkSamples) * 100 : null,
    postPinkSamples,
    recent20Multipliers: recent20,
  };
}
