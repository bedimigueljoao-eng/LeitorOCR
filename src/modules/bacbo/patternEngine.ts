import { BEAD_PLATE_ROWS } from './bacboHistory';
import {
  BacBoOutcome,
  BacBoRoundRecord,
  DiscoveredPattern,
  PatternReport,
  RowColInsight,
  TotalsAnalysis,
} from './types';

function emptyCounts(): Record<BacBoOutcome, number> {
  return { P: 0, B: 0, T: 0 };
}

function getMostFrequentOutcome(counts: Record<BacBoOutcome, number>): BacBoOutcome | null {
  const entries: [BacBoOutcome, number][] = [
    ['P', counts.P],
    ['B', counts.B],
    ['T', counts.T],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  if (entries[0][1] === 0) return null;
  if (entries[0][1] === entries[1][1]) return null;
  return entries[0][0];
}

function classifyConfidence(
  occurrences: number,
  nextCounts: Record<BacBoOutcome, number>
): { sampleSufficient: boolean; label: DiscoveredPattern['confidenceLabel'] } {
  const totalFollow = nextCounts.P + nextCounts.B + nextCounts.T;
  if (occurrences < 4 || totalFollow < 4) {
    return { sampleSufficient: false, label: 'INSUFICIENTE' };
  }
  const top = Math.max(nextCounts.P, nextCounts.B, nextCounts.T);
  const dominance = top / totalFollow;
  if (occurrences >= 10 && dominance >= 0.6) {
    return { sampleSufficient: true, label: 'CONSISTENTE' };
  }
  if (occurrences >= 6 && dominance >= 0.52) {
    return { sampleSufficient: true, label: 'MODERADA' };
  }
  return { sampleSufficient: true, label: 'BAIXA' };
}

function scanSequenceOccurrences(
  seq: BacBoOutcome[],
  target: BacBoOutcome[],
  rounds: BacBoRoundRecord[],
  id: string,
  name: string,
  category: DiscoveredPattern['category']
): DiscoveredPattern | null {
  if (seq.length < target.length) return null;
  let occurrences = 0;
  let lastOccurrenceRound: number | null = null;
  const nextCounts = emptyCounts();

  for (let i = 0; i <= seq.length - target.length; i++) {
    let match = true;
    for (let j = 0; j < target.length; j++) {
      if (seq[i + j] !== target[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      occurrences++;
      lastOccurrenceRound = rounds[i + target.length - 1].roundNumber;
      if (i + target.length < seq.length) {
        nextCounts[seq[i + target.length]]++;
      }
    }
  }

  if (occurrences === 0) return null;

  const possibleWindows = Math.max(1, seq.length - target.length + 1);
  const repeatRatePct = (occurrences / possibleWindows) * 100;
  const conf = classifyConfidence(occurrences, nextCounts);

  return {
    id,
    name,
    category,
    sequence: target.join('-'),
    occurrences,
    repeatRatePct,
    lastOccurrenceRound,
    nextCounts,
    mostFrequentNext: conf.sampleSufficient ? getMostFrequentOutcome(nextCounts) : null,
    sampleSufficient: conf.sampleSufficient,
    confidenceLabel: conf.label,
  };
}

export function analyzeTotals(rounds: BacBoRoundRecord[]): TotalsAnalysis {
  const counts = new Map<number, number>();
  for (let t = 2; t <= 12; t++) counts.set(t, 0);

  let validTotalsCount = 0;
  let total2Count = 0;
  let total12Count = 0;
  let consecutiveEqualTotals = 0;
  let maxConsecutiveEqual = 0;
  let prevTotal: number | null = null;
  let absDiffSum = 0;
  let absDiffCount = 0;

  const outcomeFrequency: Record<BacBoOutcome, number> = { P: 0, B: 0, T: 0 };

  for (const r of rounds) {
    outcomeFrequency[r.outcome]++;
    const wt = r.winningTotal;
    if (wt !== null && wt >= 2 && wt <= 12) {
      validTotalsCount++;
      counts.set(wt, (counts.get(wt) ?? 0) + 1);
      if (wt === 2) total2Count++;
      if (wt === 12) total12Count++;

      if (prevTotal !== null && prevTotal === wt) {
        consecutiveEqualTotals++;
        if (consecutiveEqualTotals > maxConsecutiveEqual) {
          maxConsecutiveEqual = consecutiveEqualTotals;
        }
      } else {
        consecutiveEqualTotals = 1;
      }
      prevTotal = wt;
    } else {
      consecutiveEqualTotals = 0;
      prevTotal = null;
    }

    if (r.playerTotal !== null && r.bankerTotal !== null) {
      absDiffSum += Math.abs(r.playerTotal - r.bankerTotal);
      absDiffCount++;
    }
  }

  const list = Array.from(counts.entries()).map(([total, count]) => ({ total, count }));
  const mostFrequentTotals = [...list]
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  const leastFrequentTotals = [...list]
    .sort((a, b) => a.count - b.count)
    .slice(0, 4);

  const alerts: string[] = [];
  const recent20 = rounds.slice(-20);
  const recent12Count = recent20.filter((r) => r.winningTotal === 12).length;
  const recent2Count = recent20.filter((r) => r.winningTotal === 2).length;
  if (recent12Count >= 2) {
    alerts.push(`TOTAL 12 REPETIDO: ${recent12Count} ocorrências recentes.`);
  }
  if (recent2Count >= 2) {
    const tailConsec2 =
      rounds.length >= 2 &&
      rounds[rounds.length - 1].winningTotal === 2 &&
      rounds[rounds.length - 2].winningTotal === 2;
    alerts.push(
      tailConsec2
        ? 'TOTAL 2: 2 ocorrências consecutivas.'
        : `TOTAL 2 REPETIDO: ${recent2Count} ocorrências recentes.`
    );
  }
  if (
    rounds.length >= 2 &&
    rounds[rounds.length - 1].winningTotal !== null &&
    rounds[rounds.length - 1].winningTotal === rounds[rounds.length - 2].winningTotal
  ) {
    alerts.push(
      `TOTAIS CONSECUTIVOS IGUAIS: total ${rounds[rounds.length - 1].winningTotal} repetido na sequência.`
    );
  }

  return {
    validTotalsCount,
    total2Count,
    total12Count,
    consecutiveEqualTotals: maxConsecutiveEqual,
    mostFrequentTotals,
    leastFrequentTotals,
    avgAbsDiff: absDiffCount > 0 ? absDiffSum / absDiffCount : null,
    outcomeFrequency,
    alerts,
  };
}

export function analyzePatterns(rounds: BacBoRoundRecord[]): PatternReport {
  const seq = rounds.map((r) => r.outcome);
  const totals = analyzeTotals(rounds);

  if (rounds.length === 0) {
    return {
      discoveredPatterns: [],
      rowPatterns: [],
      colPatterns: [],
      totals,
      activePatternSummary: 'Sem dados suficientes',
    };
  }

  const candidates: DiscoveredPattern[] = [];

  // 1. Padrões alternados estruturados e 2-1
  const namedTemplates: {
    id: string;
    name: string;
    cat: DiscoveredPattern['category'];
    target: BacBoOutcome[];
  }[] = [
    { id: 'pingpong_pb', name: 'PING-PONG (P-B-P-B)', cat: 'alternation', target: ['P', 'B', 'P', 'B'] },
    { id: 'pingpong_bp', name: 'PING-PONG (B-P-B-P)', cat: 'alternation', target: ['B', 'P', 'B', 'P'] },
    { id: '2_1_bbp', name: 'PADRÃO 2-1 (B-B-P-B-B-P)', cat: 'two_one', target: ['B', 'B', 'P', 'B', 'B', 'P'] },
    { id: '2_1_ppb', name: 'PADRÃO 2-1 (P-P-B-P-P-B)', cat: 'two_one', target: ['P', 'P', 'B', 'P', 'P', 'B'] },
    { id: '2_1_short_bbp', name: 'BLOCO 2-1 (B-B-P)', cat: 'two_one', target: ['B', 'B', 'P'] },
    { id: '2_1_short_ppb', name: 'BLOCO 2-1 (P-P-B)', cat: 'two_one', target: ['P', 'P', 'B'] },
  ];

  for (const tpl of namedTemplates) {
    const found = scanSequenceOccurrences(seq, tpl.target, rounds, tpl.id, tpl.name, tpl.cat);
    if (found) candidates.push(found);
  }

  // 2. Descoberta dinâmica de blocos reais de 2, 3, 4 e 5 resultados a partir do histórico (não pré-definidos)
  const ngramMap = new Map<
    string,
    {
      len: number;
      occurrences: number;
      lastRound: number;
      nextCounts: Record<BacBoOutcome, number>;
    }
  >();

  for (const blockLen of [2, 3, 4, 5]) {
    if (seq.length < blockLen) continue;
    for (let i = 0; i <= seq.length - blockLen; i++) {
      const key = seq.slice(i, i + blockLen).join('-');
      const existing = ngramMap.get(key) ?? {
        len: blockLen,
        occurrences: 0,
        lastRound: rounds[i + blockLen - 1].roundNumber,
        nextCounts: emptyCounts(),
      };
      existing.occurrences++;
      existing.lastRound = rounds[i + blockLen - 1].roundNumber;
      if (i + blockLen < seq.length) {
        existing.nextCounts[seq[i + blockLen]]++;
      }
      ngramMap.set(key, existing);
    }
  }

  const dynamicBlocks: DiscoveredPattern[] = [];
  for (const [key, data] of ngramMap.entries()) {
    const minOcc = data.len === 2 ? 3 : 2;
    if (data.occurrences < minOcc) continue;
    const possible = Math.max(1, seq.length - data.len + 1);
    const conf = classifyConfidence(data.occurrences, data.nextCounts);
    dynamicBlocks.push({
      id: `ngram_${data.len}_${key}`,
      name: `BLOCO DESCOBERTO (${data.len})`,
      category: 'block',
      sequence: key,
      occurrences: data.occurrences,
      repeatRatePct: (data.occurrences / possible) * 100,
      lastOccurrenceRound: data.lastRound,
      nextCounts: data.nextCounts,
      mostFrequentNext: conf.sampleSufficient ? getMostFrequentOutcome(data.nextCounts) : null,
      sampleSufficient: conf.sampleSufficient,
      confidenceLabel: conf.label,
    });
  }

  // Mantém os blocos dinâmicos mais relevantes (evita duplicar os templates já listados)
  const existingSeqs = new Set(candidates.map((c) => c.sequence));
  dynamicBlocks
    .filter((b) => !existingSeqs.has(b.sequence))
    .sort((a, b) => b.occurrences - a.occurrences || b.sequence.length - a.sequence.length)
    .slice(0, 10)
    .forEach((b) => candidates.push(b));

  // 3. Alternâncias irregulares (mudanças frequentes de lado sem formar sequência fixa)
  if (seq.length >= 6) {
    let switches = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] !== seq[i - 1]) switches++;
    }
    const switchRate = (switches / (seq.length - 1)) * 100;
    if (switchRate >= 58) {
      candidates.push({
        id: 'irregular_alt',
        name: 'ALTERNÂNCIA IRREGULAR',
        category: 'irregular',
        sequence: seq.slice(-6).join('-'),
        occurrences: switches,
        repeatRatePct: switchRate,
        lastOccurrenceRound: rounds[rounds.length - 1].roundNumber,
        nextCounts: emptyCounts(),
        mostFrequentNext: null,
        sampleSufficient: seq.length >= 12,
        confidenceLabel: seq.length >= 20 ? 'BAIXA' : 'INSUFICIENTE',
      });
    }
  }

  // 4. Padrões de Linha e Coluna da grelha Bead Plate (6 linhas)
  const rowPatterns: RowColInsight[] = [];
  for (let row = 0; row < BEAD_PLATE_ROWS; row++) {
    const rowItems = rounds.filter((_, idx) => idx % BEAD_PLATE_ROWS === row);
    if (rowItems.length === 0) continue;
    let p = 0;
    let b = 0;
    let t = 0;
    for (const item of rowItems) {
      if (item.outcome === 'P') p++;
      else if (item.outcome === 'B') b++;
      else t++;
    }
    let desc = 'Distribuição equilibrada';
    if (rowItems.length >= 3) {
      if (b > p + 1) desc = `Predominância de Banker (${b}B vs ${p}P)`;
      else if (p > b + 1) desc = `Predominância de Player (${p}P vs ${b}B)`;
      else desc = `Alternância equilibrada (${p}P / ${b}B / ${t}T)`;
    }
    rowPatterns.push({
      rowOrCol: `Linha ${row + 1}`,
      sampleCount: rowItems.length,
      playerCount: p,
      bankerCount: b,
      tieCount: t,
      description: desc,
    });
  }

  const colPatterns: RowColInsight[] = [];
  const totalCols = Math.ceil(rounds.length / BEAD_PLATE_ROWS);
  const startCol = Math.max(0, totalCols - 6);
  for (let col = startCol; col < totalCols; col++) {
    const colItems = rounds.slice(col * BEAD_PLATE_ROWS, (col + 1) * BEAD_PLATE_ROWS);
    let p = 0;
    let b = 0;
    let t = 0;
    let switches = 0;
    for (let i = 0; i < colItems.length; i++) {
      const o = colItems[i].outcome;
      if (o === 'P') p++;
      else if (o === 'B') b++;
      else t++;
      if (i > 0 && colItems[i].outcome !== colItems[i - 1].outcome) switches++;
    }
    const desc =
      colItems.length >= 3 && switches >= colItems.length - 2
        ? 'Coluna alternada'
        : b > p
        ? `Coluna Banker (${b}B / ${p}P)`
        : p > b
        ? `Coluna Player (${p}P / ${b}B)`
        : 'Coluna neutra';
    colPatterns.push({
      rowOrCol: `Coluna ${col + 1}`,
      sampleCount: colItems.length,
      playerCount: p,
      bankerCount: b,
      tieCount: t,
      description: desc,
    });
  }

  // Resumo do padrão mais recente ativo na cauda
  let activePatternSummary = 'Em observação';
  const tail4 = seq.slice(-4).join('-');
  const tail6 = seq.slice(-6).join('-');
  if (tail4 === 'P-B-P-B' || tail4 === 'B-P-B-P') {
    activePatternSummary = `Ping-Pong (${tail4})`;
  } else if (tail6 === 'B-B-P-B-B-P' || tail6 === 'P-P-B-P-P-B') {
    activePatternSummary = `Padrão 2-1 (${tail6})`;
  } else if (seq.length >= 3) {
    const last = seq[seq.length - 1];
    let run = 0;
    for (let i = seq.length - 1; i >= 0 && seq[i] === last; i--) run++;
    if (run >= 2) {
      activePatternSummary = `Corrida ${run}x ${last === 'P' ? 'Player' : last === 'B' ? 'Banker' : 'Tie'}`;
    } else {
      const counts3 = seq.slice(-3);
      const b3 = counts3.filter((x) => x === 'B').length;
      const p3 = counts3.filter((x) => x === 'P').length;
      activePatternSummary = `${b3} Banker, ${p3} Player (últimos 3)`;
    }
  }

  candidates.sort((a, b) => b.occurrences - a.occurrences);

  return {
    discoveredPatterns: candidates,
    rowPatterns,
    colPatterns,
    totals,
    activePatternSummary,
  };
}
