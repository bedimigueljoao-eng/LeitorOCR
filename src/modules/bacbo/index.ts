import { buildBeadPlate } from './bacboHistory';
import { computeCalibratedProbabilities, runLearningEngine } from './learningEngine';
import { analyzePatterns } from './patternEngine';
import { computeBacBoStatistics } from './statisticsEngine';
import { runStrategyEngine } from './strategyEngine';
import { analyzeStreaks } from './streakEngine';
import { analyzeTies } from './tieAnalyzer';
import {
  BacBoEngineAnalysis,
  BacBoPredictionSnapshot,
  BacBoRoundRecord,
} from './types';

export * from './types';
export * from './bacboDatabase';
export * from './bacboHistory';
export * from './bacboOcr';
export * from './bacboResultProcessor';
export * from './streakEngine';
export * from './patternEngine';
export * from './tieAnalyzer';
export * from './strategyEngine';
export * from './learningEngine';
export * from './statisticsEngine';
export * from './bacboTests';

export function analyzeBacBoEngine(
  rounds: BacBoRoundRecord[],
  previousProbs?: { player: number; tie: number; banker: number } | null
): BacBoEngineAnalysis {
  const beadPlate = buildBeadPlate(rounds);
  const streaks = analyzeStreaks(rounds);
  const patterns = analyzePatterns(rounds);
  const ties = analyzeTies(rounds);
  const strategies = runStrategyEngine(rounds);
  const learning = runLearningEngine(rounds, strategies);
  const statistics = computeBacBoStatistics(rounds, strategies.strategies);
  const probabilities = computeCalibratedProbabilities(rounds, strategies, previousProbs);

  const streakLabel = streaks.currentSide
    ? `${streaks.currentLength}x ${
        streaks.currentSide === 'P'
          ? 'Player'
          : streaks.currentSide === 'B'
          ? 'Banker'
          : 'Tie'
      }`
    : 'Nenhuma';

  const currentSnapshot: BacBoPredictionSnapshot = {
    suggestion: strategies.finalSuggestion,
    reasons: strategies.reasons,
    activeStrategies: strategies.strategies
      .filter((s) => s.currentSignal.active)
      .map((s) => s.name),
    agreeingStrategies: strategies.agreeingNames,
    totalEvaluatedStrategies: strategies.totalStrategies,
    probabilities: {
      player: probabilities.modelEstimate.player,
      tie: probabilities.modelEstimate.tie,
      banker: probabilities.modelEstimate.banker,
    },
    detectedPatterns: strategies.strategies
      .filter((s) => s.currentSignal.active)
      .map((s) => s.currentSignal.patternTag),
    streakLabel,
    confidenceLabel: probabilities.statisticalConfidence,
  };

  return {
    totalRounds: rounds.length,
    lastOutcome: rounds.length > 0 ? rounds[rounds.length - 1].outcome : null,
    beadPlate,
    streaks,
    patterns,
    ties,
    strategies,
    learning,
    statistics,
    probabilities,
    currentSnapshot,
  };
}
