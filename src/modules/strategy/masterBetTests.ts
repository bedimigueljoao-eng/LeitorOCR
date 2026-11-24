import assert from 'node:assert/strict';
import {
  buildPureObservation,
  classifyConfidence,
  computeMasterBet,
  DISCLAIMER_TEXT,
  evaluateStrategySignals,
  runBankrollSimulation,
} from './masterBetEngine';
import type { BacBoRoundRecord } from '../bacbo';
import type { AviatorRoundRecord } from '../aviator';

function makeBacBoRounds(outcomes: Array<'P' | 'B' | 'T'>): BacBoRoundRecord[] {
  return outcomes.map((o, idx) => ({
    id: `bb-${idx}`,
    roundNumber: idx + 1,
    timestamp: new Date(Date.now() - (outcomes.length - idx) * 15000).toISOString(),
    outcome: o,
    playerTotal: o === 'P' ? 9 : o === 'B' ? 4 : 7,
    bankerTotal: o === 'B' ? 10 : o === 'P' ? 5 : 7,
    winningTotal: o === 'B' ? 10 : o === 'P' ? 9 : 7,
    playerDice: null,
    bankerDice: null,
    source: 'manual',
  }));
}

function makeAviatorRounds(mults: number[]): AviatorRoundRecord[] {
  return mults.map((m, idx) => {
    const ts = Date.now() - (mults.length - idx) * 15000;
    const d = new Date(ts);
    return {
      id: `av-${idx}`,
      roundNumber: idx + 1,
      timestamp: ts,
      multiplier: m,
      category:
        m < 1.5
          ? 'under_1_50'
          : m < 2
          ? '1_50_to_2_00'
          : m < 3
          ? '2_00_to_3_00'
          : m < 5
          ? '3_00_to_5_00'
          : m < 10
          ? '5_00_to_10_00'
          : 'over_10_00',
      colorTier: m < 2 ? 'blue' : m < 10 ? 'purple' : 'pink',
      dateKey: d.toISOString().slice(0, 10),
      timeLabel: d.toISOString().slice(11, 19),
      source: 'manual',
      ocrConfidence: 0.95,
    };
  });
}

export function runMasterBetTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const tests: Array<{ name: string; fn: () => void }> = [
    {
      name: '1. Pure observation calculates roulette streaks and delays accurately',
      fn: () => {
        // newestFirst: 5 blacks in a row then red
        const spins = [2, 4, 6, 8, 10, 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21];
        const obs = buildPureObservation({
          game: 'roulette',
          rouletteNewestFirst: spins,
          bacboRounds: [],
          aviatorRounds: [],
        });
        assert.equal(obs.sampleSize, 16);
        const red = obs.metrics.find((m) => m.label === 'Vermelho')!;
        const black = obs.metrics.find((m) => m.label === 'Preto')!;
        assert.equal(red.currentDelay, 5);
        assert.equal(black.currentDelay, 0);
        assert.equal(black.maxStreak, 5);
      },
    },
    {
      name: '2. Master Bet waits on insufficient sample size (<4) with disclaimer',
      fn: () => {
        const signals = evaluateStrategySignals({
          game: 'roulette',
          rouletteNewestFirst: [1, 3, 5],
          bacboRounds: [],
          aviatorRounds: [],
          ocrConfidencePct: 90,
        });
        const master = computeMasterBet({
          game: 'roulette',
          signals,
          bankroll: {
            initialBalanceAoa: 1000,
            currentBalanceAoa: 1000,
            unitPct: 2,
            dailyStopLossPct: 15,
            dailyStopWinPct: 25,
          },
          ocrConfidencePct: 90,
        });
        assert.equal(master.action, 'AGUARDAR');
        assert.equal(master.suggestedStakeAoa, 0);
        assert.equal(master.disclaimer, DISCLAIMER_TEXT);
      },
    },
    {
      name: '3. Master Bet enforces daily stop-loss protection',
      fn: () => {
        const bbRounds = makeBacBoRounds(Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 'P' : 'B')));
        const signals = evaluateStrategySignals({
          game: 'bacbo',
          rouletteNewestFirst: [],
          bacboRounds: bbRounds,
          aviatorRounds: [],
          ocrConfidencePct: 92,
        });
        const master = computeMasterBet({
          game: 'bacbo',
          signals,
          bankroll: {
            initialBalanceAoa: 1000,
            currentBalanceAoa: 820, // -18% <= -15%
            unitPct: 2,
            dailyStopLossPct: 15,
            dailyStopWinPct: 25,
          },
          ocrConfidencePct: 92,
        });
        assert.equal(master.action, 'AGUARDAR');
        assert.ok(master.bankrollBlockedReason?.includes('Stop-Loss'));
      },
    },
    {
      name: '4. Master Bet prioritizes low-edge Bac Bo Player/Banker over Tie',
      fn: () => {
        // 30 rounds without Tie and 7 Bankers in a row
        const outcomes: Array<'P' | 'B' | 'T'> = [
          ...Array.from({ length: 23 }, (_, i) => (i % 2 === 0 ? 'P' : 'B') as 'P' | 'B'),
          'B', 'B', 'B', 'B', 'B', 'B', 'B',
        ];
        const bbRounds = makeBacBoRounds(outcomes);
        const signals = evaluateStrategySignals({
          game: 'bacbo',
          rouletteNewestFirst: [],
          bacboRounds: bbRounds,
          aviatorRounds: [],
          ocrConfidencePct: 95,
        });
        const master = computeMasterBet({
          game: 'bacbo',
          signals,
          bankroll: {
            initialBalanceAoa: 1000,
            currentBalanceAoa: 1000,
            unitPct: 2,
            dailyStopLossPct: 15,
            dailyStopWinPct: 25,
          },
          ocrConfidencePct: 95,
        });
        assert.equal(master.houseEdgePct, 1.21);
        assert.ok(master.direction.includes('Player'));
      },
    },
    {
      name: '5. Confidence tiers classify 0-100 scores properly',
      fn: () => {
        assert.equal(classifyConfidence(25), 'Baixa');
        assert.equal(classifyConfidence(55), 'Média');
        assert.equal(classifyConfidence(82), 'Alta');
      },
    },
    {
      name: '6. Virtual bankroll simulator runs deterministically for Aviator, Roulette, and Bac Bo',
      fn: () => {
        const avRounds = makeAviatorRounds([1.2, 1.4, 1.1, 2.3, 1.5]);
        assert.equal(avRounds.length, 5);
        const simR = runBankrollSimulation({
          game: 'roulette',
          rounds: 200,
          startingBalanceAoa: 1000,
          baseStakeAoa: 10,
          strategy: 'flat_low_edge',
          seed: 42,
        });
        const simB = runBankrollSimulation({
          game: 'bacbo',
          rounds: 200,
          startingBalanceAoa: 1000,
          baseStakeAoa: 10,
          strategy: 'selective_delay',
          seed: 42,
        });
        assert.equal(simR.theoreticalHouseEdgePct, 2.7);
        assert.equal(simB.theoreticalHouseEdgePct, 1.21);
        assert.ok(simR.balanceCurve.length > 10);
        assert.ok(simB.balanceCurve.length > 10);
      },
    },
  ];

  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`FAIL: ${t.name}`, err);
    }
  }
  console.log(`MasterBet Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.includes('masterBetTests');

if (isDirectRun) {
  const res = runMasterBetTests();
  if (res.failed > 0) process.exit(1);
}
