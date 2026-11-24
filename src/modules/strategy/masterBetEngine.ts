import { getRouletteColor, WHEEL_ORDER } from '../../utils/rouletteEngine';
import type { BacBoRoundRecord } from '../bacbo';
import type { AviatorRoundRecord } from '../aviator';

export type UnifiedGameKey = 'roulette' | 'bacbo' | 'aviator';
export type ConfidenceTier = 'Baixa' | 'Média' | 'Alta';

export interface ObservationMetric {
  label: string;
  count: number;
  pct: number;
  expectedPct: number;
  currentDelay: number;
  maxStreak: number;
}

export interface StrategySignal {
  id: string;
  game: UnifiedGameKey;
  market: string;
  direction: string;
  houseEdgePct: number;
  score: number; // 0..100
  confidenceTier: ConfidenceTier;
  sampleSize: number;
  delayRounds: number;
  observedPct: number;
  expectedPct: number;
  statisticalBasis: string;
}

export interface MasterBetRecommendation {
  game: UnifiedGameKey;
  action: 'APOSTAR' | 'AGUARDAR';
  market: string;
  direction: string;
  score: number;
  confidenceTier: ConfidenceTier;
  houseEdgePct: number;
  sampleSize: number;
  ocrConfidencePct: number;
  suggestedStakeAoa: number;
  bankrollBlockedReason: string | null;
  rationale: string;
  disclaimer: string;
}

export interface BankrollPolicyConfig {
  initialBalanceAoa: number;
  currentBalanceAoa: number;
  unitPct: number; // 0.5 .. 10%
  dailyStopLossPct: number; // e.g. 15%
  dailyStopWinPct: number; // e.g. 25%
}

export interface SessionBetEntry {
  id: string;
  timestamp: number;
  game: UnifiedGameKey;
  site: string;
  suggestedMarket: string;
  suggestedDirection: string;
  suggestedStakeAoa: number;
  userAction: 'followed' | 'skipped' | 'custom';
  realStakeAoa: number;
  won: boolean;
  pnlAoa: number;
  balanceAfterAoa: number;
}

export interface VirtualSimConfig {
  game: UnifiedGameKey;
  rounds: number;
  startingBalanceAoa: number;
  baseStakeAoa: number;
  strategy: 'flat_low_edge' | 'selective_delay' | 'martingale_capped';
  seed?: number;
}

export interface VirtualSimResult {
  game: UnifiedGameKey;
  strategy: VirtualSimConfig['strategy'];
  roundsPlayed: number;
  startingBalanceAoa: number;
  endingBalanceAoa: number;
  netPnlAoa: number;
  roiPct: number;
  maxDrawdownPct: number;
  hitRatePct: number;
  theoreticalHouseEdgePct: number;
  balanceCurve: number[];
  takeaway: string;
}

export interface HouseEdgeFact {
  game: string;
  market: string;
  winProbPct: string;
  payout: string;
  houseEdgePct: string;
  note: string;
}

export const DISCLAIMER_TEXT = 'Isto são padrões observados. A casa tem vantagem a longo prazo.';

export const HOUSE_EDGE_KNOWLEDGE_TABLE: HouseEdgeFact[] = [
  {
    game: 'Roleta Europeia',
    market: 'Vermelho/Preto · Par/Ímpar · 1-18/19-36',
    winProbPct: '48.65% (18/37)',
    payout: '1:1',
    houseEdgePct: '2.70%',
    note: 'Menor vantagem da casa na roleta sem regra La Partage; o zero (0) gera o edge.',
  },
  {
    game: 'Roleta Europeia',
    market: 'Dúzias / Colunas',
    winProbPct: '32.43% (12/37)',
    payout: '2:1',
    houseEdgePct: '2.70%',
    note: 'Mesma esperança matemática (-2.70%), porém com maior variância de curto prazo.',
  },
  {
    game: 'Roleta Europeia',
    market: 'Pleno (Número Direto)',
    winProbPct: '2.70% (1/37)',
    payout: '35:1',
    houseEdgePct: '2.70%',
    note: 'Alta dispersão: longos atrasos (50–150 giros) são estatisticamente normais.',
  },
  {
    game: 'Bac Bo',
    market: 'Player / Banker',
    winProbPct: '~44.62% (+reembolso parcial em Tie)',
    payout: '1:1 (90% devolvido no Tie)',
    houseEdgePct: '1.21%',
    note: 'Mercado mais eficiente do Bac Bo pela devolução de 90% da aposta em caso de empate.',
  },
  {
    game: 'Bac Bo',
    market: 'Tie (Empate 2–12)',
    winProbPct: '~10.76% agregado',
    payout: '4:1 a 88:1 conforme soma',
    houseEdgePct: '11.27% – 14.36%',
    note: 'Vantagem da casa muito alta; nunca deve ser usado como aposta base contínua.',
  },
  {
    game: 'Aviator',
    market: 'Cash Out 1.50x – 2.00x (RTP 97%)',
    winProbPct: '64.67% @1.50x · 48.50% @2.00x',
    payout: 'Variável',
    houseEdgePct: '3.00%',
    note: 'Cada ronda é gerada criptograficamente de forma independente (Provably Fair).',
  },
];

const VOISINS_SET = new Set([22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25]);
const TIERS_SET = new Set([27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33]);
const ORPHELINS_SET = new Set([1, 20, 14, 31, 9, 17, 34, 6]);

export function classifyConfidence(score: number): ConfidenceTier {
  if (score >= 70) return 'Alta';
  if (score >= 42) return 'Média';
  return 'Baixa';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeDelayAndStreak<T>(
  newestFirst: T[],
  predicate: (item: T) => boolean
): { currentDelay: number; maxStreak: number; count: number } {
  let currentDelay = newestFirst.length;
  let foundFirst = false;
  let count = 0;
  let run = 0;
  let maxStreak = 0;

  for (let i = 0; i < newestFirst.length; i++) {
    const match = predicate(newestFirst[i]);
    if (match) {
      count++;
      if (!foundFirst) {
        currentDelay = i;
        foundFirst = true;
      }
      run++;
      if (run > maxStreak) maxStreak = run;
    } else {
      run = 0;
    }
  }
  return { currentDelay, maxStreak, count };
}

export function buildPureObservation(params: {
  game: UnifiedGameKey;
  rouletteNewestFirst: number[];
  bacboRounds: BacBoRoundRecord[];
  aviatorRounds: AviatorRoundRecord[];
  windowSize?: number;
}): {
  sampleSize: number;
  metrics: ObservationMetric[];
} {
  const limit = clamp(params.windowSize ?? 80, 20, 100);

  if (params.game === 'roulette') {
    const sample = params.rouletteNewestFirst.slice(0, limit);
    const n = sample.length;
    if (n === 0) return { sampleSize: 0, metrics: [] };

    const defs: Array<{ label: string; expectedPct: number; test: (v: number) => boolean }> = [
      { label: 'Vermelho', expectedPct: 48.65, test: (v) => getRouletteColor(v) === 'red' },
      { label: 'Preto', expectedPct: 48.65, test: (v) => getRouletteColor(v) === 'black' },
      { label: 'Zero (0)', expectedPct: 2.7, test: (v) => v === 0 },
      { label: 'Par (2..36)', expectedPct: 48.65, test: (v) => v !== 0 && v % 2 === 0 },
      { label: 'Ímpar (1..35)', expectedPct: 48.65, test: (v) => v % 2 === 1 },
      { label: '1ª Dúzia (1-12)', expectedPct: 32.43, test: (v) => v >= 1 && v <= 12 },
      { label: '2ª Dúzia (13-24)', expectedPct: 32.43, test: (v) => v >= 13 && v <= 24 },
      { label: '3ª Dúzia (25-36)', expectedPct: 32.43, test: (v) => v >= 25 && v <= 36 },
      { label: 'Voisins du Zéro', expectedPct: 45.95, test: (v) => VOISINS_SET.has(v) },
      { label: 'Tiers du Cylindre', expectedPct: 32.43, test: (v) => TIERS_SET.has(v) },
      { label: 'Orphelins', expectedPct: 21.62, test: (v) => ORPHELINS_SET.has(v) },
    ];

    return {
      sampleSize: n,
      metrics: defs.map((d) => {
        const res = computeDelayAndStreak(sample, d.test);
        return {
          label: d.label,
          count: res.count,
          pct: Number(((res.count / n) * 100).toFixed(1)),
          expectedPct: d.expectedPct,
          currentDelay: res.currentDelay,
          maxStreak: res.maxStreak,
        };
      }),
    };
  }

  if (params.game === 'bacbo') {
    const sample = [...params.bacboRounds].slice(-limit).reverse(); // newestFirst
    const n = sample.length;
    if (n === 0) return { sampleSize: 0, metrics: [] };

    const defs: Array<{ label: string; expectedPct: number; test: (r: BacBoRoundRecord) => boolean }> = [
      { label: 'Player (Azul)', expectedPct: 44.62, test: (r) => r.outcome === 'P' },
      { label: 'Banker (Vermelho)', expectedPct: 44.62, test: (r) => r.outcome === 'B' },
      { label: 'Tie (Empate)', expectedPct: 10.76, test: (r) => r.outcome === 'T' },
    ];

    return {
      sampleSize: n,
      metrics: defs.map((d) => {
        const res = computeDelayAndStreak(sample, d.test);
        return {
          label: d.label,
          count: res.count,
          pct: Number(((res.count / n) * 100).toFixed(1)),
          expectedPct: d.expectedPct,
          currentDelay: res.currentDelay,
          maxStreak: res.maxStreak,
        };
      }),
    };
  }

  const sample = [...params.aviatorRounds].slice(-limit).reverse(); // newestFirst
  const n = sample.length;
  if (n === 0) return { sampleSize: 0, metrics: [] };

  const defs: Array<{ label: string; expectedPct: number; test: (r: AviatorRoundRecord) => boolean }> = [
    { label: 'Crash Baixo (< 1.50x)', expectedPct: 35.3, test: (r) => r.multiplier < 1.5 },
    { label: 'Abaixo de 2.00x', expectedPct: 51.5, test: (r) => r.multiplier < 2.0 },
    { label: 'Vela Roxa (2.00x–9.99x)', expectedPct: 38.8, test: (r) => r.multiplier >= 2.0 && r.multiplier < 10.0 },
    { label: 'Vela Rosa (>= 10.00x)', expectedPct: 9.7, test: (r) => r.multiplier >= 10.0 },
  ];

  return {
    sampleSize: n,
    metrics: defs.map((d) => {
      const res = computeDelayAndStreak(sample, d.test);
      return {
        label: d.label,
        count: res.count,
        pct: Number(((res.count / n) * 100).toFixed(1)),
        expectedPct: d.expectedPct,
        currentDelay: res.currentDelay,
        maxStreak: res.maxStreak,
      };
    }),
  };
}

export function evaluateStrategySignals(params: {
  game: UnifiedGameKey;
  rouletteNewestFirst: number[];
  bacboRounds: BacBoRoundRecord[];
  aviatorRounds: AviatorRoundRecord[];
  ocrConfidencePct: number;
}): StrategySignal[] {
  const obs = buildPureObservation({ ...params, windowSize: 80 });
  const n = obs.sampleSize;
  if (n === 0) return [];

  const ocrFactor = clamp(params.ocrConfidencePct / 100, 0.45, 1.0);
  const sampleFactor = clamp(n / 40, 0.25, 1.0);
  const signals: StrategySignal[] = [];

  if (params.game === 'roulette') {
    const red = obs.metrics.find((m) => m.label === 'Vermelho')!;
    const black = obs.metrics.find((m) => m.label === 'Preto')!;
    const dominantColor = red.currentDelay >= black.currentDelay ? 'Vermelho' : 'Preto';
    const colorDelay = Math.max(red.currentDelay, black.currentDelay);
    const colorObs = dominantColor === 'Vermelho' ? red.pct : black.pct;
    const colorScore = Math.round(
      clamp((34 + colorDelay * 7 + Math.max(0, 48.65 - colorObs) * 1.1) * sampleFactor * ocrFactor, 15, 92)
    );

    signals.push({
      id: 'roulette-color',
      game: 'roulette',
      market: 'Cor (Vermelho / Preto)',
      direction: dominantColor,
      houseEdgePct: 2.7,
      score: colorScore,
      confidenceTier: classifyConfidence(colorScore),
      sampleSize: n,
      delayRounds: colorDelay,
      observedPct: colorObs,
      expectedPct: 48.65,
      statisticalBasis: `${dominantColor} ausente há ${colorDelay} giros (${colorObs}% nos últimos ${n}).`,
    });

    const even = obs.metrics.find((m) => m.label.startsWith('Par'))!;
    const odd = obs.metrics.find((m) => m.label.startsWith('Ímpar'))!;
    const domParity = even.currentDelay >= odd.currentDelay ? 'Par' : 'Ímpar';
    const parDelay = Math.max(even.currentDelay, odd.currentDelay);
    const parObs = domParity === 'Par' ? even.pct : odd.pct;
    const parScore = Math.round(
      clamp((32 + parDelay * 7 + Math.max(0, 48.65 - parObs)) * sampleFactor * ocrFactor, 15, 90)
    );

    signals.push({
      id: 'roulette-parity',
      game: 'roulette',
      market: 'Par / Ímpar',
      direction: domParity,
      houseEdgePct: 2.7,
      score: parScore,
      confidenceTier: classifyConfidence(parScore),
      sampleSize: n,
      delayRounds: parDelay,
      observedPct: parObs,
      expectedPct: 48.65,
      statisticalBasis: `${domParity} com atraso de ${parDelay} giros (${parObs}% em ${n} giros).`,
    });

    const dozens = obs.metrics.filter((m) => m.label.includes('Dúzia'));
    const topDozen = [...dozens].sort((a, b) => b.currentDelay - a.currentDelay)[0];
    if (topDozen) {
      const dozScore = Math.round(
        clamp((28 + topDozen.currentDelay * 4.8 + Math.max(0, 32.43 - topDozen.pct)) * sampleFactor * ocrFactor, 12, 88)
      );
      signals.push({
        id: 'roulette-dozen',
        game: 'roulette',
        market: 'Dúzia em Atraso',
        direction: topDozen.label,
        houseEdgePct: 2.7,
        score: dozScore,
        confidenceTier: classifyConfidence(dozScore),
        sampleSize: n,
        delayRounds: topDozen.currentDelay,
        observedPct: topDozen.pct,
        expectedPct: 32.43,
        statisticalBasis: `${topDozen.label} há ${topDozen.currentDelay} giros sem sair (${topDozen.pct}% em ${n}).`,
      });
    }

    const head = params.rouletteNewestFirst[0];
    const headIdx = WHEEL_ORDER.indexOf(head);
    const wheelNeighbors =
      headIdx >= 0
        ? [-2, -1, 0, 1, 2].map((off) => WHEEL_ORDER[(headIdx + off + WHEEL_ORDER.length) % WHEEL_ORDER.length])
        : [];
    const sectors = obs.metrics.filter(
      (m) => m.label.includes('Voisins') || m.label.includes('Tiers') || m.label.includes('Orphelins')
    );
    const hotSector = [...sectors].sort((a, b) => (b.pct - b.expectedPct) - (a.pct - a.expectedPct))[0];
    if (hotSector) {
      const secScore = Math.round(
        clamp((30 + (hotSector.pct - hotSector.expectedPct) * 1.8) * sampleFactor * ocrFactor, 12, 82)
      );
      signals.push({
        id: 'roulette-sector',
        game: 'roulette',
        market: 'Setor da Roda + Vizinhos ±2',
        direction: `${hotSector.label} · [${wheelNeighbors.join(', ')}]`,
        houseEdgePct: 2.7,
        score: secScore,
        confidenceTier: classifyConfidence(secScore),
        sampleSize: n,
        delayRounds: hotSector.currentDelay,
        observedPct: hotSector.pct,
        expectedPct: hotSector.expectedPct,
        statisticalBasis: `Setor ${hotSector.label} a ${hotSector.pct}% (base ${hotSector.expectedPct}%), âncora ${head}.`,
      });
    }
  } else if (params.game === 'bacbo') {
    const pMet = obs.metrics.find((m) => m.label.startsWith('Player'))!;
    const bMet = obs.metrics.find((m) => m.label.startsWith('Banker'))!;
    const tMet = obs.metrics.find((m) => m.label.startsWith('Tie'))!;

    const domSide = pMet.currentDelay >= bMet.currentDelay ? 'Player (Azul)' : 'Banker (Vermelho)';
    const sideDelay = Math.max(pMet.currentDelay, bMet.currentDelay);
    const sideObs = domSide.startsWith('Player') ? pMet.pct : bMet.pct;
    const pbScore = Math.round(
      clamp((38 + sideDelay * 7.5 + Math.max(0, 44.62 - sideObs) * 1.1) * sampleFactor * ocrFactor, 18, 91)
    );

    signals.push({
      id: 'bacbo-pb',
      game: 'bacbo',
      market: 'Player / Banker (Baixa Vantagem)',
      direction: domSide,
      houseEdgePct: 1.21,
      score: pbScore,
      confidenceTier: classifyConfidence(pbScore),
      sampleSize: n,
      delayRounds: sideDelay,
      observedPct: sideObs,
      expectedPct: 44.62,
      statisticalBasis: `${domSide} ausente há ${sideDelay} rondas (${sideObs}% em ${n}), house edge 1.21%.`,
    });

    const tieScore = Math.round(
      clamp((14 + tMet.currentDelay * 1.9) * sampleFactor * ocrFactor, 10, 58)
    );
    signals.push({
      id: 'bacbo-tie',
      game: 'bacbo',
      market: 'Tie (Empate - Alto Edge)',
      direction: 'Tie (Cobertura opcional mínima)',
      houseEdgePct: 12.1,
      score: tieScore,
      confidenceTier: classifyConfidence(tieScore),
      sampleSize: n,
      delayRounds: tMet.currentDelay,
      observedPct: tMet.pct,
      expectedPct: 10.76,
      statisticalBasis: `Sem Tie há ${tMet.currentDelay} rondas (${tMet.pct}% em ${n}). Edge elevado (12.1%).`,
    });
  } else {
    const low = obs.metrics.find((m) => m.label.includes('2.00x'))!;
    const purple = obs.metrics.find((m) => m.label.includes('Roxa'))!;
    const pink = obs.metrics.find((m) => m.label.includes('Rosa'))!;

    const recent5 = [...params.aviatorRounds].slice(-5);
    const lowStreak = recent5.filter((r) => r.multiplier < 2.0).length;

    const safeScore = Math.round(
      clamp((34 + lowStreak * 8 + purple.currentDelay * 4.5) * sampleFactor * ocrFactor, 16, 86)
    );
    signals.push({
      id: 'aviator-safe-15',
      game: 'aviator',
      market: 'Cash Out Conservador (1.50x)',
      direction: 'Saída automática em 1.50x',
      houseEdgePct: 3.0,
      score: safeScore,
      confidenceTier: classifyConfidence(safeScore),
      sampleSize: n,
      delayRounds: purple.currentDelay,
      observedPct: Number((100 - obs.metrics[0].pct).toFixed(1)),
      expectedPct: 64.67,
      statisticalBasis: `${lowStreak}/5 últimas abaixo de 2.00x; velas >=2x ausentes há ${purple.currentDelay} rodadas.`,
    });

    const purpleScore = Math.round(
      clamp((24 + purple.currentDelay * 5.2 + pink.currentDelay * 0.9) * sampleFactor * ocrFactor, 12, 79)
    );
    signals.push({
      id: 'aviator-2x',
      game: 'aviator',
      market: 'Alvo Moderado (2.00x)',
      direction: 'Saída automática em 2.00x',
      houseEdgePct: 3.0,
      score: purpleScore,
      confidenceTier: classifyConfidence(purpleScore),
      sampleSize: n,
      delayRounds: purple.currentDelay,
      observedPct: Number((purple.pct + pink.pct).toFixed(1)),
      expectedPct: 48.5,
      statisticalBasis: `Vela roxa/rosa (${'>='}2.00x) representa ${(purple.pct + pink.pct).toFixed(1)}% nas últimas ${n}.`,
    });
  }

  return signals.sort((a, b) => b.score - a.score);
}

export function computeMasterBet(params: {
  game: UnifiedGameKey;
  signals: StrategySignal[];
  bankroll: BankrollPolicyConfig;
  ocrConfidencePct: number;
}): MasterBetRecommendation {
  const { game, signals, bankroll, ocrConfidencePct } = params;
  const pnlPct =
    bankroll.initialBalanceAoa > 0
      ? ((bankroll.currentBalanceAoa - bankroll.initialBalanceAoa) / bankroll.initialBalanceAoa) * 100
      : 0;

  let blockReason: string | null = null;
  if (pnlPct <= -Math.abs(bankroll.dailyStopLossPct)) {
    blockReason = `Stop-Loss diário atingido (${pnlPct.toFixed(1)}% <= -${bankroll.dailyStopLossPct}%).`;
  } else if (pnlPct >= Math.abs(bankroll.dailyStopWinPct)) {
    blockReason = `Stop-Win diário atingido (+${pnlPct.toFixed(1)}% >= +${bankroll.dailyStopWinPct}%).`;
  } else if (bankroll.currentBalanceAoa <= 0) {
    blockReason = 'Saldo atual insuficiente para nova entrada.';
  }

  const baseUnitAoa = Math.max(1, Number(((bankroll.currentBalanceAoa * bankroll.unitPct) / 100).toFixed(2)));

  if (signals.length === 0 || signals[0].sampleSize < 4) {
    const n = signals[0]?.sampleSize ?? 0;
    return {
      game,
      action: 'AGUARDAR',
      market: game === 'bacbo' ? 'Player / Banker' : game === 'aviator' ? 'Cash Out 1.50x' : 'Vermelho / Preto',
      direction: 'Recolher pelo menos 4 resultados antes de apostar',
      score: Math.min(35, n * 8),
      confidenceTier: 'Baixa',
      houseEdgePct: game === 'bacbo' ? 1.21 : game === 'aviator' ? 3.0 : 2.7,
      sampleSize: n,
      ocrConfidencePct,
      suggestedStakeAoa: 0,
      bankrollBlockedReason: blockReason,
      rationale: `Amostra insuficiente (n=${n}/4). Aguarde mais capturas para avaliar desvios reais.`,
      disclaimer: DISCLAIMER_TEXT,
    };
  }

  // Filtra sinais de altíssimo edge quando fracos, priorizando mercados de menor edge da casa
  const lowEdgeSignals = signals.filter((s) => s.houseEdgePct <= 3.5);
  const candidate =
    lowEdgeSignals.length > 0 && (signals[0].score < 70 || signals[0].houseEdgePct > 5)
      ? lowEdgeSignals[0]
      : signals[0];

  if (blockReason) {
    return {
      game,
      action: 'AGUARDAR',
      market: candidate.market,
      direction: candidate.direction,
      score: candidate.score,
      confidenceTier: candidate.confidenceTier,
      houseEdgePct: candidate.houseEdgePct,
      sampleSize: candidate.sampleSize,
      ocrConfidencePct,
      suggestedStakeAoa: 0,
      bankrollBlockedReason: blockReason,
      rationale: `${blockReason} Proteção de banca ativada.`,
      disclaimer: DISCLAIMER_TEXT,
    };
  }

  if (candidate.score < 50) {
    return {
      game,
      action: 'AGUARDAR',
      market: candidate.market,
      direction: `Sinal fraco · preferência conservadora: ${candidate.direction}`,
      score: candidate.score,
      confidenceTier: candidate.confidenceTier,
      houseEdgePct: candidate.houseEdgePct,
      sampleSize: candidate.sampleSize,
      ocrConfidencePct,
      suggestedStakeAoa: Number((baseUnitAoa * 0.5).toFixed(2)),
      bankrollBlockedReason: null,
      rationale: `Sinal fraco (${candidate.score}/100). Se optar por jogar, priorize ${candidate.market} (edge ${candidate.houseEdgePct}%) com meia unidade.`,
      disclaimer: DISCLAIMER_TEXT,
    };
  }

  const stakeMultiplier = candidate.score >= 75 ? 1.25 : 1.0;
  return {
    game,
    action: 'APOSTAR',
    market: candidate.market,
    direction: candidate.direction,
    score: candidate.score,
    confidenceTier: candidate.confidenceTier,
    houseEdgePct: candidate.houseEdgePct,
    sampleSize: candidate.sampleSize,
    ocrConfidencePct,
    suggestedStakeAoa: Number((baseUnitAoa * stakeMultiplier).toFixed(2)),
    bankrollBlockedReason: null,
    rationale: `${candidate.statisticalBasis} OCR médio ${ocrConfidencePct.toFixed(0)}%.`,
    disclaimer: DISCLAIMER_TEXT,
  };
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runBankrollSimulation(cfg: VirtualSimConfig): VirtualSimResult {
  const rng = createMulberry32(cfg.seed ?? Date.now());
  const rounds = clamp(Math.round(cfg.rounds), 20, 2000);
  let balance = cfg.startingBalanceAoa;
  let peak = balance;
  let maxDrawdownPct = 0;
  let hits = 0;
  let totalWagered = 0;
  let stake = cfg.baseStakeAoa;
  let missStreak = 0;
  const curve: number[] = [Number(balance.toFixed(2))];

  const houseEdgePct = cfg.game === 'bacbo' ? 1.21 : cfg.game === 'aviator' ? 3.0 : 2.7;

  for (let i = 0; i < rounds; i++) {
    if (balance < 1) break;
    if (cfg.strategy === 'selective_delay' && missStreak < 1 && i % 3 !== 0) {
      // Simula filtragem seletiva (não entra em toda rodada; mesma esperança matemática por aposta)
      curve.push(Number(balance.toFixed(2)));
      continue;
    }

    const activeStake = Math.min(balance, stake);
    totalWagered += activeStake;

    let net = 0;
    let won = false;

    if (cfg.game === 'roulette') {
      const pocket = Math.floor(rng() * 37);
      won = pocket >= 1 && pocket <= 18; // Vermelho / Par equivalente
      net = won ? activeStake : -activeStake;
    } else if (cfg.game === 'bacbo') {
      const pSum = Math.floor(rng() * 6) + 1 + Math.floor(rng() * 6) + 1;
      const bSum = Math.floor(rng() * 6) + 1 + Math.floor(rng() * 6) + 1;
      if (pSum > bSum) {
        won = true;
        net = activeStake;
      } else if (pSum === bSum) {
        // Reembolso 90% no Tie
        net = -activeStake * 0.1;
      } else {
        net = -activeStake;
      }
    } else {
      // Aviator 97% RTP em alvo 1.50x => P(win) = 0.97 / 1.50 = 64.667%
      won = rng() < 0.97 / 1.5;
      net = won ? activeStake * 0.5 : -activeStake;
    }

    balance = Math.max(0, balance + net);
    if (won) {
      hits++;
      missStreak = 0;
      stake = cfg.baseStakeAoa;
    } else {
      missStreak++;
      if (cfg.strategy === 'martingale_capped') {
        stake = Math.min(cfg.baseStakeAoa * 8, stake * 2);
      } else {
        stake = cfg.baseStakeAoa;
      }
    }

    if (balance > peak) peak = balance;
    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    curve.push(Number(balance.toFixed(2)));
  }

  const netPnl = balance - cfg.startingBalanceAoa;
  const roiPct = totalWagered > 0 ? (netPnl / totalWagered) * 100 : 0;
  const roundsExecuted = Math.max(1, curve.length - 1);

  const takeaway =
    cfg.strategy === 'martingale_capped'
      ? 'Martingale aumenta acertos curtos, mas gera drawdowns abruptos nas sequências negativas sem alterar o edge da casa.'
      : cfg.strategy === 'selective_delay'
      ? 'Entrar menos vezes reduz exposição e volatilidade total da banca, preservando capital por mais tempo.'
      : `Aposta fixa mantém variância controlada; após ${roundsExecuted} rondas o retorno converge para -${houseEdgePct.toFixed(2)}% do volume apostado.`;

  return {
    game: cfg.game,
    strategy: cfg.strategy,
    roundsPlayed: roundsExecuted,
    startingBalanceAoa: cfg.startingBalanceAoa,
    endingBalanceAoa: Number(balance.toFixed(2)),
    netPnlAoa: Number(netPnl.toFixed(2)),
    roiPct: Number(roiPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(1)),
    hitRatePct: Number(((hits / roundsExecuted) * 100).toFixed(1)),
    theoreticalHouseEdgePct: houseEdgePct,
    balanceCurve: curve,
    takeaway,
  };
}
