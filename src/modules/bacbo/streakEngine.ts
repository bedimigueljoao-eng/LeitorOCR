import {
  BacBoOutcome,
  BacBoRoundRecord,
  SideStreakSummary,
  StreakLengthStats,
  StreakReport,
} from './types';

function createEmptySide(outcome: BacBoOutcome, label: string): SideStreakSummary {
  const buckets = [
    { length: 2, label: '2x' },
    { length: 3, label: '3x' },
    { length: 4, label: '4x' },
    { length: 5, label: '5x+' },
  ];
  return {
    outcome,
    label,
    currentStreak: 0,
    maxHistoricalStreak: 0,
    byLength: buckets.map((b) => ({
      length: b.length,
      label: b.label,
      occurrences: 0,
      endedCount: 0,
      followedBy: { P: 0, B: 0, T: 0 },
    })),
  };
}

function getBucket(byLength: StreakLengthStats[], len: number): StreakLengthStats | null {
  if (len < 2) return null;
  if (len === 2) return byLength[0];
  if (len === 3) return byLength[1];
  if (len === 4) return byLength[2];
  return byLength[3];
}

export function analyzeStreaks(rounds: BacBoRoundRecord[]): StreakReport {
  const bySide: Record<BacBoOutcome, SideStreakSummary> = {
    P: createEmptySide('P', 'Player'),
    B: createEmptySide('B', 'Banker'),
    T: createEmptySide('T', 'Tie'),
  };

  if (rounds.length === 0) {
    return {
      currentSide: null,
      currentLength: 0,
      bySide,
      recentRuns: [],
    };
  }

  const runs: { outcome: BacBoOutcome; length: number; endedAtRound: number; nextOutcome: BacBoOutcome | null }[] = [];
  let runOutcome = rounds[0].outcome;
  let runLen = 1;

  for (let i = 1; i < rounds.length; i++) {
    const cur = rounds[i].outcome;
    if (cur === runOutcome) {
      runLen++;
    } else {
      runs.push({
        outcome: runOutcome,
        length: runLen,
        endedAtRound: rounds[i - 1].roundNumber,
        nextOutcome: cur,
      });
      runOutcome = cur;
      runLen = 1;
    }
  }
  // Corrida atualmente em curso no final do histórico
  runs.push({
    outcome: runOutcome,
    length: runLen,
    endedAtRound: rounds[rounds.length - 1].roundNumber,
    nextOutcome: null,
  });

  for (const r of runs) {
    const side = bySide[r.outcome];
    if (r.length > side.maxHistoricalStreak) {
      side.maxHistoricalStreak = r.length;
    }
    if (r.length >= 2) {
      // Conta cada patamar atingido dentro da corrida (2x, 3x, 4x, 5x+) para saber quantas vezes continuou vs terminou
      const bucket = getBucket(side.byLength, r.length);
      if (bucket) {
        bucket.occurrences++;
        if (r.nextOutcome !== null) {
          bucket.endedCount++;
          bucket.followedBy[r.nextOutcome]++;
        }
      }
    }
  }

  const lastRun = runs[runs.length - 1];
  bySide[lastRun.outcome].currentStreak = lastRun.length;

  return {
    currentSide: lastRun.outcome,
    currentLength: lastRun.length,
    bySide,
    recentRuns: runs
      .filter((r) => r.length >= 2)
      .slice(-8)
      .reverse()
      .map((r) => ({
        outcome: r.outcome,
        length: r.length,
        endedAtRound: r.endedAtRound,
      })),
  };
}
