import { evaluateCurrentConsensus } from './strategyEngine';
import {
  BacBoOutcome,
  BacBoRoundRecord,
  BacBoSuggestion,
  BreakdownStat,
  StatisticsReport,
  StrategyPerformance,
} from './types';

function makeStat(label: string): BreakdownStat {
  return { label, suggestions: 0, hits: 0, misses: 0, hitRatePct: 0 };
}

function addOutcome(stat: BreakdownStat, hit: boolean): void {
  stat.suggestions++;
  if (hit) stat.hits++;
  else stat.misses++;
  stat.hitRatePct = stat.suggestions > 0 ? (stat.hits / stat.suggestions) * 100 : 0;
}

export function computeBacBoStatistics(
  rounds: BacBoRoundRecord[],
  strategiesPerf: StrategyPerformance[]
): StatisticsReport {
  const overall = makeStat('Desempenho Geral');
  const last50 = makeStat('Últimas 50 Sugestões');
  const last100 = makeStat('Últimas 100 Sugestões');

  const byOption: Record<BacBoOutcome, BreakdownStat> = {
    P: makeStat('Player'),
    B: makeStat('Banker'),
    T: makeStat('Tie'),
  };

  const duringBankerRun = makeStat('Durante Corridas Banker');
  const duringPlayerRun = makeStat('Durante Corridas Player');

  const len2 = makeStat('Corridas 2x');
  const len3 = makeStat('Corridas 3x');
  const len4 = makeStat('Corridas 4x');
  const len5Plus = makeStat('Corridas 5x+');

  const patternCategories = [
    'Ping-Pong',
    'Padrão 2-1',
    'Repetição',
    'Alternância',
    'Padrões de Linha',
    'Padrões de Totais',
  ];
  const byPatternMap = new Map<string, BreakdownStat>();
  for (const cat of patternCategories) byPatternMap.set(cat, makeStat(cat));

  const evaluatedEvents: { suggestion: BacBoOutcome; hit: boolean }[] = [];

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const prefix = rounds.slice(0, i);

    // Regra estrita: usa o snapshot gravado ANTES da rodada se existir; senão calcula walk-forward sem alterar passado
    let suggestion: BacBoSuggestion = 'NONE';
    let patternTags: string[] = [];

    if (r.predictionBefore) {
      suggestion = r.predictionBefore.suggestion;
      patternTags = r.predictionBefore.detectedPatterns;
    } else if (i >= 8) {
      const evalPrev = evaluateCurrentConsensus(prefix);
      suggestion = evalPrev.finalSuggestion;
      patternTags = evalPrev.signals
        .filter((s) => s.active && s.suggestion === suggestion)
        .map((s) => s.patternTag);
    }

    // Regra: se não houver sugestão, NÃO contabilizar como erro
    if (suggestion === 'NONE') continue;

    // Empate tratado como resultado independente; avalia apenas a opção efetivamente sugerida
    const isHit = suggestion === r.outcome;
    addOutcome(overall, isHit);
    addOutcome(byOption[suggestion], isHit);
    evaluatedEvents.push({ suggestion, hit: isHit });

    // Corrida ativa imediatamente antes do resultado i
    if (prefix.length > 0) {
      const prevOutcome = prefix[prefix.length - 1].outcome;
      let runLen = 0;
      for (let k = prefix.length - 1; k >= 0 && prefix[k].outcome === prevOutcome; k--) {
        runLen++;
      }
      if (runLen >= 2) {
        if (prevOutcome === 'B') addOutcome(duringBankerRun, isHit);
        if (prevOutcome === 'P') addOutcome(duringPlayerRun, isHit);
        if (runLen === 2) addOutcome(len2, isHit);
        else if (runLen === 3) addOutcome(len3, isHit);
        else if (runLen === 4) addOutcome(len4, isHit);
        else if (runLen >= 5) addOutcome(len5Plus, isHit);
      }
    }

    // Contabiliza apenas uma vez por categoria de padrão por rodada
    const uniqueTags = new Set(patternTags);
    for (const tag of uniqueTags) {
      const pStat = byPatternMap.get(tag);
      if (pStat) addOutcome(pStat, isHit);
    }
  }

  for (const ev of evaluatedEvents.slice(-50)) {
    addOutcome(last50, ev.hit);
  }
  for (const ev of evaluatedEvents.slice(-100)) {
    addOutcome(last100, ev.hit);
  }

  const byStrategy: BreakdownStat[] = strategiesPerf.map((s) => ({
    label: s.name,
    suggestions: s.suggestionsCount,
    hits: s.hits,
    misses: s.misses,
    hitRatePct: s.hitRatePct,
  }));

  return {
    overall,
    last50,
    last100,
    byOption,
    byStrategy,
    byStreakSide: {
      duringBankerRun,
      duringPlayerRun,
    },
    byStreakLength: {
      len2,
      len3,
      len4,
      len5Plus,
    },
    byPattern: Array.from(byPatternMap.values()),
  };
}
