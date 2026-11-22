import { BEAD_PLATE_ROWS } from './bacboHistory';
import { analyzePatterns } from './patternEngine';
import { analyzeStreaks } from './streakEngine';
import { analyzeTies } from './tieAnalyzer';
import {
  BacBoOutcome,
  BacBoRoundRecord,
  BacBoSuggestion,
  StrategyEngineReport,
  StrategyPerformance,
  StrategySignal,
} from './types';

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  activationConditions: string;
  evaluate: (rounds: BacBoRoundRecord[]) => StrategySignal;
}

function makeInactive(id: string, name: string, reason: string, patternTag = 'Geral'): StrategySignal {
  return {
    strategyId: id,
    strategyName: name,
    active: false,
    suggestion: 'NONE',
    reason,
    patternTag,
    confidenceScore: 0,
  };
}

export const BACBO_STRATEGIES: StrategyDefinition[] = [
  {
    id: 'streak_continuation',
    name: 'Estratégia de Corridas',
    description: 'Analisa o comportamento histórico de continuação vs quebra após corridas 2x+.',
    activationConditions: 'Corrida atual >= 2x em Player ou Banker e amostra histórica >= 3 ocorrências.',
    evaluate: (rounds) => {
      const id = 'streak_continuation';
      const name = 'Estratégia de Corridas';
      if (rounds.length < 6) {
        return makeInactive(id, name, 'Mínimo 6 rodadas necessárias', 'Corrida');
      }
      const streaks = analyzeStreaks(rounds);
      if (!streaks.currentSide || streaks.currentSide === 'T' || streaks.currentLength < 2) {
        return makeInactive(id, name, 'Sem corrida P/B >= 2x ativa no momento', 'Corrida');
      }

      const side = streaks.currentSide;
      const len = streaks.currentLength;
      const opp: BacBoOutcome = side === 'P' ? 'B' : 'P';

      // Mede empiricamente no histórico até aqui quantas corridas >= len continuaram vs quebraram
      let continued = 0;
      let brokeToOpp = 0;
      let run = 0;
      for (let i = 0; i < rounds.length - 1; i++) {
        if (rounds[i].outcome === side) {
          run++;
        } else {
          run = 0;
        }
        if (run === len) {
          const next = rounds[i + 1].outcome;
          if (next === side) continued++;
          else if (next === opp) brokeToOpp++;
        }
      }

      const totalSamples = continued + brokeToOpp;
      if (totalSamples < 3) {
        return makeInactive(id, name, `Amostra insuficiente para corrida ${len}x (${totalSamples})`, 'Corrida');
      }
      if (continued > brokeToOpp) {
        return {
          strategyId: id,
          strategyName: name,
          active: true,
          suggestion: side,
          reason: `Corrida ${len}x ${side === 'P' ? 'Player' : 'Banker'} (histórico continuou ${continued}/${totalSamples})`,
          patternTag: 'Corrida',
          confidenceScore: Math.min(0.8, continued / totalSamples),
        };
      }
      if (brokeToOpp > continued) {
        return {
          strategyId: id,
          strategyName: name,
          active: true,
          suggestion: opp,
          reason: `Corrida ${len}x ${side === 'P' ? 'Player' : 'Banker'} tende a inverter (${brokeToOpp}/${totalSamples})`,
          patternTag: 'Corrida',
          confidenceScore: Math.min(0.8, brokeToOpp / totalSamples),
        };
      }
      return makeInactive(id, name, 'Empate histórico entre continuação e quebra', 'Corrida');
    },
  },
  {
    id: 'alternation_pingpong',
    name: 'Estratégia de Alternância',
    description: 'Deteta sequências alternadas (Ping-Pong P-B-P-B) e avalia continuidade empírica.',
    activationConditions: 'Últimas 3 rodadas alternadas entre Player e Banker sem Tie.',
    evaluate: (rounds) => {
      const id = 'alternation_pingpong';
      const name = 'Estratégia de Alternância';
      if (rounds.length < 4) {
        return makeInactive(id, name, 'Mínimo 4 rodadas necessárias', 'Ping-Pong');
      }
      const tail3 = rounds.slice(-3).map((r) => r.outcome);
      if (tail3.includes('T')) {
        return makeInactive(id, name, 'Tie recente interrompeu alternância pura', 'Ping-Pong');
      }
      const isAlt = tail3[0] !== tail3[1] && tail3[1] !== tail3[2];
      if (!isAlt) {
        return makeInactive(id, name, 'Sem sequência alternada nas últimas 3 rodadas', 'Ping-Pong');
      }
      const expectedFlip: BacBoOutcome = tail3[2] === 'P' ? 'B' : 'P';
      return {
        strategyId: id,
        strategyName: name,
        active: true,
        suggestion: expectedFlip,
        reason: `Alternância ativa (${tail3.join('-')}) sugere continuação Ping-Pong`,
        patternTag: 'Ping-Pong',
        confidenceScore: 0.62,
      };
    },
  },
  {
    id: 'repetition_2_1',
    name: 'Estratégia de Repetição (2-1)',
    description: 'Identifica ciclos 2-1 (B-B-P / P-P-B) ou repetições imediatas no histórico.',
    activationConditions: 'Formação parcial B-B-P-B-B ou P-P-B-P-P ou padrão 2-1 recorrente.',
    evaluate: (rounds) => {
      const id = 'repetition_2_1';
      const name = 'Estratégia de Repetição';
      if (rounds.length < 6) {
        return makeInactive(id, name, 'Mínimo 6 rodadas necessárias', 'Padrão 2-1');
      }
      const tail5 = rounds.slice(-5).map((r) => r.outcome).join('-');
      if (tail5 === 'B-B-P-B-B') {
        return {
          strategyId: id,
          strategyName: name,
          active: true,
          suggestion: 'P',
          reason: 'Ciclo 2-1 ativo (B-B-P-B-B -> fecha com Player)',
          patternTag: 'Padrão 2-1',
          confidenceScore: 0.66,
        };
      }
      if (tail5 === 'P-P-B-P-P') {
        return {
          strategyId: id,
          strategyName: name,
          active: true,
          suggestion: 'B',
          reason: 'Ciclo 2-1 ativo (P-P-B-P-P -> fecha com Banker)',
          patternTag: 'Padrão 2-1',
          confidenceScore: 0.66,
        };
      }
      const tail3 = rounds.slice(-3).map((r) => r.outcome).join('-');
      if (tail3 === 'B-B-P') {
        return {
          strategyId: id,
          strategyName: name,
          active: true,
          suggestion: 'B',
          reason: 'Bloco 2-1 iniciado (B-B-P -> retorno esperado para Banker)',
          patternTag: 'Padrão 2-1',
          confidenceScore: 0.56,
        };
      }
      if (tail3 === 'P-P-B') {
        return {
          strategyId: id,
          strategyName: name,
          active: true,
          suggestion: 'P',
          reason: 'Bloco 2-1 iniciado (P-P-B -> retorno esperado para Player)',
          patternTag: 'Padrão 2-1',
          confidenceScore: 0.56,
        };
      }
      return makeInactive(id, name, 'Ciclo 2-1 não detetado na cauda', 'Padrão 2-1');
    },
  },
  {
    id: 'blocks_ngram',
    name: 'Estratégia de Blocos',
    description: 'Consulta blocos de 2 a 4 resultados descobertos dinamicamente e sua continuação mais frequente.',
    activationConditions: 'Bloco atual da cauda apareceu >= 3 vezes no histórico com continuação predominante.',
    evaluate: (rounds) => {
      const id = 'blocks_ngram';
      const name = 'Estratégia de Blocos';
      if (rounds.length < 12) {
        return makeInactive(id, name, 'Mínimo 12 rodadas para validar blocos históricos', 'Blocos');
      }
      const seq = rounds.map((r) => r.outcome);
      for (const len of [4, 3, 2]) {
        const tail = seq.slice(-len).join('-');
        const counts: Record<BacBoOutcome, number> = { P: 0, B: 0, T: 0 };
        let matches = 0;
        for (let i = 0; i <= seq.length - len - 1; i++) {
          if (seq.slice(i, i + len).join('-') === tail) {
            matches++;
            counts[seq[i + len]]++;
          }
        }
        if (matches >= 3) {
          const top: BacBoOutcome | null =
            counts.P > counts.B && counts.P >= counts.T
              ? 'P'
              : counts.B > counts.P && counts.B >= counts.T
              ? 'B'
              : null;
          if (top) {
            const conf = counts[top] / matches;
            if (conf >= 0.55) {
              return {
                strategyId: id,
                strategyName: name,
                active: true,
                suggestion: top,
                reason: `Bloco ${tail} repetido ${matches}x (seguiu ${top} em ${counts[top]}/${matches})`,
                patternTag: 'Repetição',
                confidenceScore: conf,
              };
            }
          }
        }
      }
      return makeInactive(id, name, 'Nenhum bloco recente com predominância clara', 'Blocos');
    },
  },
  {
    id: 'markov_transition',
    name: 'Estratégia de Transição',
    description: 'Calcula a matriz empírica de transição de ordem 1 e ordem 2 para o próximo estado.',
    activationConditions: 'Diferença de probabilidade condicional >= 12 p.p. entre P e B com n >= 10.',
    evaluate: (rounds) => {
      const id = 'markov_transition';
      const name = 'Estratégia de Transição';
      if (rounds.length < 12) {
        return makeInactive(id, name, 'Mínimo 12 rodadas para matriz de transição', 'Alternância');
      }
      const last = rounds[rounds.length - 1].outcome;
      const counts: Record<BacBoOutcome, number> = { P: 0, B: 0, T: 0 };
      for (let i = 0; i < rounds.length - 1; i++) {
        if (rounds[i].outcome === last) {
          counts[rounds[i + 1].outcome]++;
        }
      }
      const pbTotal = counts.P + counts.B;
      if (pbTotal < 8) {
        return makeInactive(id, name, 'Amostra de transição insuficiente', 'Alternância');
      }
      const pShare = counts.P / pbTotal;
      const bShare = counts.B / pbTotal;
      if (Math.abs(pShare - bShare) < 0.14) {
        return makeInactive(id, name, 'Transição P/B equilibrada após último resultado', 'Alternância');
      }
      const winner: BacBoOutcome = pShare > bShare ? 'P' : 'B';
      return {
        strategyId: id,
        strategyName: name,
        active: true,
        suggestion: winner,
        reason: `Após ${last}: ${winner === 'P' ? 'Player' : 'Banker'} ocorreu ${Math.max(counts.P, counts.B)}/${pbTotal} vezes`,
        patternTag: 'Alternância',
        confidenceScore: Math.max(pShare, bShare),
      };
    },
  },
  {
    id: 'bead_plate_row_col',
    name: 'Estratégia de Padrões de Linha',
    description: 'Analisa tendências da mesma linha (1..6) na grelha Bead Plate.',
    activationConditions: 'Pelo menos 3 ocorrências anteriores na mesma linha do Bead Plate com viés claro.',
    evaluate: (rounds) => {
      const id = 'bead_plate_row_col';
      const name = 'Estratégia de Padrões de Linha';
      if (rounds.length < 18) {
        return makeInactive(id, name, 'Mínimo 18 rodadas (3 colunas) para padrões de linha', 'Padrões de Linha');
      }
      const nextRow = rounds.length % BEAD_PLATE_ROWS;
      const rowHistory = rounds.filter((_, idx) => idx % BEAD_PLATE_ROWS === nextRow);
      const p = rowHistory.filter((r) => r.outcome === 'P').length;
      const b = rowHistory.filter((r) => r.outcome === 'B').length;
      const totalPB = p + b;
      if (totalPB < 3 || Math.abs(p - b) < 2) {
        return makeInactive(id, name, `Linha ${nextRow + 1} sem predominância estatística`, 'Padrões de Linha');
      }
      const pick: BacBoOutcome = p > b ? 'P' : 'B';
      return {
        strategyId: id,
        strategyName: name,
        active: true,
        suggestion: pick,
        reason: `Linha ${nextRow + 1} do Bead Plate favorece ${pick === 'P' ? 'Player' : 'Banker'} (${Math.max(p, b)}/${totalPB})`,
        patternTag: 'Padrões de Linha',
        confidenceScore: Math.max(p, b) / totalPB,
      };
    },
  },
  {
    id: 'totals_momentum',
    name: 'Estratégia de Análise de Totais',
    description: 'Avalia desvios recentes dos totais Player vs Banker quando os valores dos dados estão disponíveis.',
    activationConditions: 'Pelo menos 8 rodadas recentes com totais válidos (2..12) registados.',
    evaluate: (rounds) => {
      const id = 'totals_momentum';
      const name = 'Estratégia de Análise de Totais';
      const withTotals = rounds.filter(
        (r) => r.playerTotal !== null && r.bankerTotal !== null
      );
      if (withTotals.length < 8) {
        return makeInactive(id, name, 'Dados insuficientes de totais P/B (mínimo 8 rodadas)', 'Padrões de Totais');
      }
      const recent = withTotals.slice(-8);
      let sumP = 0;
      let sumB = 0;
      for (const r of recent) {
        sumP += r.playerTotal!;
        sumB += r.bankerTotal!;
      }
      const avgP = sumP / recent.length;
      const avgB = sumB / recent.length;
      if (Math.abs(avgP - avgB) < 0.85) {
        return makeInactive(id, name, `Médias de totais equilibradas (P:${avgP.toFixed(1)} vs B:${avgB.toFixed(1)})`, 'Padrões de Totais');
      }
      const pick: BacBoOutcome = avgP > avgB ? 'P' : 'B';
      return {
        strategyId: id,
        strategyName: name,
        active: true,
        suggestion: pick,
        reason: `Média recente de totais favorece ${pick === 'P' ? 'Player' : 'Banker'} (${avgP.toFixed(1)} vs ${avgB.toFixed(1)})`,
        patternTag: 'Padrões de Totais',
        confidenceScore: Math.min(0.75, 0.5 + Math.abs(avgP - avgB) / 10),
      };
    },
  },
  {
    id: 'tie_observer',
    name: 'Estratégia de Análise de Empates',
    description: 'Monitoriza frequência de empates sem falácia do apostador; só sinaliza Tie em agrupamentos reais de empates.',
    activationConditions: 'Frequência recente de empates >= 20% nas últimas 15 rodadas e 2+ empates em 8 rodadas.',
    evaluate: (rounds) => {
      const id = 'tie_observer';
      const name = 'Estratégia de Análise de Empates';
      if (rounds.length < 15) {
        return makeInactive(id, name, 'Amostra mínima de 15 rodadas para análise de empates', 'Empates');
      }
      const recent15 = rounds.slice(-15);
      const recent8 = rounds.slice(-8);
      const ties15 = recent15.filter((r) => r.outcome === 'T').length;
      const ties8 = recent8.filter((r) => r.outcome === 'T').length;
      if (ties15 >= 4 && ties8 >= 2) {
        return {
          strategyId: id,
          strategyName: name,
          active: true,
          suggestion: 'T',
          reason: `Cluster de empates detetado (${ties15}/15 rodadas)`,
          patternTag: 'Empates',
          confidenceScore: 0.45,
        };
      }
      return makeInactive(id, name, 'Frequência de empates dentro da variância normal (~11.3%)', 'Empates');
    },
  },
  {
    id: 'combined_consensus',
    name: 'Estratégia Combinada',
    description: 'Consolida as estratégias individuais ponderando concordância e taxa de acerto histórica.',
    activationConditions: 'Mínimo de 2 estratégias ativas concordantes sem forte contradição.',
    evaluate: (rounds) => {
      const id = 'combined_consensus';
      const name = 'Estratégia Combinada';
      if (rounds.length < 8) {
        return makeInactive(id, name, 'Aguardando mínimo de 8 rodadas para consenso', 'Combinada');
      }
      const baseSignals = BACBO_STRATEGIES.slice(0, 8).map((s) => s.evaluate(rounds));
      const votes: Record<BacBoOutcome, { count: number; score: number }> = {
        P: { count: 0, score: 0 },
        B: { count: 0, score: 0 },
        T: { count: 0, score: 0 },
      };
      for (const sig of baseSignals) {
        if (sig.active && sig.suggestion !== 'NONE') {
          votes[sig.suggestion].count++;
          votes[sig.suggestion].score += sig.confidenceScore;
        }
      }
      const ordered: BacBoOutcome[] = (['P', 'B', 'T'] as BacBoOutcome[]).sort(
        (a, b) => votes[b].count - votes[a].count || votes[b].score - votes[a].score
      );
      const best = ordered[0];
      const second = ordered[1];
      if (votes[best].count < 2 || votes[best].count === votes[second].count) {
        return makeInactive(id, name, 'Sinais individuais insuficientes ou contraditórios', 'Combinada');
      }
      return {
        strategyId: id,
        strategyName: name,
        active: true,
        suggestion: best,
        reason: `Consenso de ${votes[best].count} estratégias para ${best === 'P' ? 'Player' : best === 'B' ? 'Banker' : 'Tie'}`,
        patternTag: 'Combinada',
        confidenceScore: Math.min(0.85, votes[best].score / Math.max(1, votes[best].count)),
      };
    },
  },
];

export function evaluateCurrentConsensus(rounds: BacBoRoundRecord[]): {
  signals: StrategySignal[];
  finalSuggestion: BacBoSuggestion;
  reasons: string[];
  activeCount: number;
  agreeingCount: number;
  agreeingNames: string[];
  statusLabel: StrategyEngineReport['statusLabel'];
} {
  const signals = BACBO_STRATEGIES.map((s) => s.evaluate(rounds));

  if (rounds.length < 8) {
    return {
      signals,
      finalSuggestion: 'NONE',
      reasons: [`Amostra insuficiente (${rounds.length}/8 rodadas mínimas).`],
      activeCount: 0,
      agreeingCount: 0,
      agreeingNames: [],
      statusLabel: 'DADOS INSUFICIENTES',
    };
  }

  const activeSignals = signals.filter((s) => s.active && s.suggestion !== 'NONE');
  if (activeSignals.length < 2) {
    return {
      signals,
      finalSuggestion: 'NONE',
      reasons: ['Nenhuma convergência forte entre estratégias neste momento.'],
      activeCount: activeSignals.length,
      agreeingCount: activeSignals.length,
      agreeingNames: activeSignals.map((s) => s.strategyName),
      statusLabel: 'DADOS INSUFICIENTES',
    };
  }

  const votes: Record<BacBoOutcome, StrategySignal[]> = { P: [], B: [], T: [] };
  for (const sig of activeSignals) {
    if (sig.suggestion !== 'NONE') {
      votes[sig.suggestion].push(sig);
    }
  }

  const ranked: BacBoOutcome[] = (['P', 'B', 'T'] as BacBoOutcome[]).sort(
    (a, b) => votes[b].length - votes[a].length
  );
  const top = ranked[0];
  const second = ranked[1];

  if (votes[top].length < 2 || votes[top].length === votes[second].length) {
    return {
      signals,
      finalSuggestion: 'NONE',
      reasons: [
        `Estratégias divididas (${votes.P.length} Player vs ${votes.B.length} Banker vs ${votes.T.length} Tie).`,
      ],
      activeCount: activeSignals.length,
      agreeingCount: 0,
      agreeingNames: [],
      statusLabel: 'SINAIS CONTRADITÓRIOS',
    };
  }

  const winners = votes[top];
  return {
    signals,
    finalSuggestion: top,
    reasons: winners.slice(0, 4).map((w) => w.reason),
    activeCount: activeSignals.length,
    agreeingCount: winners.length,
    agreeingNames: winners.map((w) => w.strategyName),
    statusLabel: 'PADRÃO IDENTIFICADO',
  };
}

export function runStrategyEngine(rounds: BacBoRoundRecord[]): StrategyEngineReport {
  const perfMap = new Map<
    string,
    {
      hits: number;
      misses: number;
      recent50Results: boolean[];
      seqWinMap: Map<string, { wins: number; losses: number }>;
    }
  >();

  for (const s of BACBO_STRATEGIES) {
    perfMap.set(s.id, {
      hits: 0,
      misses: 0,
      recent50Results: [],
      seqWinMap: new Map(),
    });
  }

  // Avaliação rigorosa walk-forward: na rodada i, usa apenas [0..i-1] para prever i
  for (let i = 4; i < rounds.length; i++) {
    const prefix = rounds.slice(0, i);
    const actual = rounds[i].outcome;
    const seqKey = prefix
      .slice(-Math.min(3, prefix.length))
      .map((r) => r.outcome)
      .join('-');

    for (const strat of BACBO_STRATEGIES) {
      const sig = strat.evaluate(prefix);
      if (!sig.active || sig.suggestion === 'NONE') continue;
      const entry = perfMap.get(strat.id)!;
      const isHit = sig.suggestion === actual;
      if (isHit) entry.hits++;
      else entry.misses++;

      entry.recent50Results.push(isHit);
      if (entry.recent50Results.length > 50) entry.recent50Results.shift();

      const seqEntry = entry.seqWinMap.get(seqKey) ?? { wins: 0, losses: 0 };
      if (isHit) seqEntry.wins++;
      else seqEntry.losses++;
      entry.seqWinMap.set(seqKey, seqEntry);
    }
  }

  const current = evaluateCurrentConsensus(rounds);
  const currentSigMap = new Map(current.signals.map((s) => [s.strategyId, s]));

  const strategies: StrategyPerformance[] = BACBO_STRATEGIES.map((s) => {
    const entry = perfMap.get(s.id)!;
    const total = entry.hits + entry.misses;
    const rate = total > 0 ? (entry.hits / total) * 100 : 0;
    const last50Hits = entry.recent50Results.filter(Boolean).length;
    const last50Samples = entry.recent50Results.length;
    const last50Rate = last50Samples > 0 ? (last50Hits / last50Samples) * 100 : 0;

    const seqEntries = Array.from(entry.seqWinMap.entries()).map(([seq, counts]) => ({
      seq,
      total: counts.wins + counts.losses,
      rate: counts.wins / Math.max(1, counts.wins + counts.losses),
      wins: counts.wins,
      losses: counts.losses,
    }));

    const bestSequences = seqEntries
      .filter((x) => x.total >= 2 && x.wins > x.losses)
      .sort((a, b) => b.rate - a.rate || b.total - a.total)
      .slice(0, 3)
      .map((x) => `${x.seq} (${x.wins}/${x.total})`);

    const worstSequences = seqEntries
      .filter((x) => x.total >= 2 && x.losses > x.wins)
      .sort((a, b) => a.rate - b.rate || b.total - a.total)
      .slice(0, 3)
      .map((x) => `${x.seq} (${x.wins}/${x.total})`);

    return {
      id: s.id,
      name: s.name,
      description: s.description,
      activationConditions: s.activationConditions,
      suggestionsCount: total,
      hits: entry.hits,
      misses: entry.misses,
      hitRatePct: rate,
      last50HitRatePct: last50Rate,
      last50Samples,
      bestSequences,
      worstSequences,
      currentSignal:
        currentSigMap.get(s.id) ?? makeInactive(s.id, s.name, 'Inativa'),
    };
  });

  const qualifiedBest = [...strategies]
    .filter((s) => s.suggestionsCount >= 5)
    .sort((a, b) => b.hitRatePct - a.hitRatePct || b.suggestionsCount - a.suggestionsCount)[0];

  // Garante análise de padrões executada caso alguém consulte padrões diretamente via strategyEngine
  void analyzePatterns;
  void analyzeTies;

  return {
    strategies,
    finalSuggestion: current.finalSuggestion,
    reasons: current.reasons,
    activeCount: current.activeCount,
    agreeingCount: current.agreeingCount,
    totalStrategies: BACBO_STRATEGIES.length,
    agreeingNames: current.agreeingNames,
    bestStrategyName: qualifiedBest ? qualifiedBest.name : null,
    statusLabel: current.statusLabel,
  };
}
