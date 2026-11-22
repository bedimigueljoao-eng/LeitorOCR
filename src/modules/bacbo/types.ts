export type BacBoOutcome = 'P' | 'B' | 'T';
export type BacBoSuggestion = BacBoOutcome | 'NONE';

export interface BacBoRoundRecord {
  id: string;
  roundNumber: number;
  timestamp: string; // ISO 8601
  outcome: BacBoOutcome;
  playerTotal: number | null; // 2..12
  bankerTotal: number | null; // 2..12
  winningTotal: number | null; // 2..12
  playerDice: [number, number] | null; // [1..6, 1..6]
  bankerDice: [number, number] | null; // [1..6, 1..6]
  source: 'ocr' | 'manual' | 'import';
  predictionBefore?: BacBoPredictionSnapshot | null;
}

export interface BacBoPredictionSnapshot {
  suggestion: BacBoSuggestion;
  reasons: string[];
  activeStrategies: string[];
  agreeingStrategies: string[];
  totalEvaluatedStrategies: number;
  probabilities: {
    player: number;
    tie: number;
    banker: number;
  };
  detectedPatterns: string[];
  streakLabel: string;
  confidenceLabel: string;
}

export interface BacBoBeadCell {
  roundNumber: number;
  outcome: BacBoOutcome;
  winningTotal: number | null;
  row: number; // 0..5
  col: number; // 0..N
  recordId: string;
}

export interface StreakLengthStats {
  length: number;
  label: string;
  occurrences: number;
  endedCount: number;
  followedBy: Record<BacBoOutcome, number>;
}

export interface SideStreakSummary {
  outcome: BacBoOutcome;
  label: string;
  currentStreak: number;
  maxHistoricalStreak: number;
  byLength: StreakLengthStats[];
}

export interface StreakReport {
  currentSide: BacBoOutcome | null;
  currentLength: number;
  bySide: Record<BacBoOutcome, SideStreakSummary>;
  recentRuns: { outcome: BacBoOutcome; length: number; endedAtRound: number }[];
}

export interface DiscoveredPattern {
  id: string;
  name: string;
  category: 'alternation' | 'two_one' | 'block' | 'row_col' | 'totals' | 'irregular';
  sequence: string;
  occurrences: number;
  repeatRatePct: number;
  lastOccurrenceRound: number | null;
  nextCounts: Record<BacBoOutcome, number>;
  mostFrequentNext: BacBoOutcome | null;
  sampleSufficient: boolean;
  confidenceLabel: 'INSUFICIENTE' | 'BAIXA' | 'MODERADA' | 'CONSISTENTE';
}

export interface RowColInsight {
  rowOrCol: string;
  sampleCount: number;
  playerCount: number;
  bankerCount: number;
  tieCount: number;
  description: string;
}

export interface TotalsAnalysis {
  validTotalsCount: number;
  total2Count: number;
  total12Count: number;
  consecutiveEqualTotals: number;
  mostFrequentTotals: { total: number; count: number }[];
  leastFrequentTotals: { total: number; count: number }[];
  avgAbsDiff: number | null;
  outcomeFrequency: Record<BacBoOutcome, number>;
  alerts: string[];
}

export interface PatternReport {
  discoveredPatterns: DiscoveredPattern[];
  rowPatterns: RowColInsight[];
  colPatterns: RowColInsight[];
  totals: TotalsAnalysis;
  activePatternSummary: string;
}

export interface TieTotalStat {
  total: number; // 2..12
  count: number;
  observedPct: number;
  theoreticalPct: number;
}

export interface TieAlert {
  code:
    | 'RECENT_TIE'
    | 'ABOVE_AVG_INTERVAL'
    | 'UNUSUAL_STAT'
    | 'DELAYED_20_PLUS';
  title: string;
  description: string;
}

export interface TieAnalysisReport {
  totalRounds: number;
  totalTies: number;
  roundsSinceLastTie: number;
  observedTieRatePct: number;
  theoreticalTieRatePct: number;
  meanInterval: number | null;
  maxInterval: number;
  last50TiePct: number;
  last100TiePct: number;
  last500TiePct: number;
  byTotal: TieTotalStat[];
  alerts: TieAlert[];
  independenceNote: string;
}

export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  active: boolean;
  suggestion: BacBoSuggestion;
  reason: string;
  patternTag: string;
  confidenceScore: number; // 0..1
}

export interface StrategyPerformance {
  id: string;
  name: string;
  description: string;
  activationConditions: string;
  suggestionsCount: number;
  hits: number;
  misses: number;
  hitRatePct: number;
  last50HitRatePct: number;
  last50Samples: number;
  bestSequences: string[];
  worstSequences: string[];
  currentSignal: StrategySignal;
}

export interface StrategyEngineReport {
  strategies: StrategyPerformance[];
  finalSuggestion: BacBoSuggestion;
  reasons: string[];
  activeCount: number;
  agreeingCount: number;
  totalStrategies: number;
  agreeingNames: string[];
  bestStrategyName: string | null;
  statusLabel: 'PADRÃO IDENTIFICADO' | 'SINAIS CONTRADITÓRIOS' | 'DADOS INSUFICIENTES';
}

export interface PeriodPerformance {
  label: string;
  roundsCount: number;
  suggestionsCount: number;
  hits: number;
  misses: number;
  hitRatePct: number;
}

export interface DynamicModelCandidate {
  id: string;
  pattern: string;
  predictedNext: BacBoOutcome;
  trainSupport: number;
  trainHitRatePct: number;
  validationSupport: number;
  validationHitRatePct: number;
  beatsBaseline: boolean;
}

export interface LearningReport {
  rolling50HitRatePct: number;
  rolling50Samples: number;
  overallHitRatePct: number;
  overallSamples: number;
  periods: PeriodPerformance[];
  degradingStrategies: string[];
  topValidatedStrategies: string[];
  dynamicModels: DynamicModelCandidate[];
  outOfSampleHitRatePct: number;
  outOfSampleSamples: number;
  overfitWarning: string | null;
}

export interface BreakdownStat {
  label: string;
  suggestions: number;
  hits: number;
  misses: number;
  hitRatePct: number;
}

export interface StatisticsReport {
  overall: BreakdownStat;
  last50: BreakdownStat;
  last100: BreakdownStat;
  byOption: Record<BacBoOutcome, BreakdownStat>;
  byStrategy: BreakdownStat[];
  byStreakSide: {
    duringBankerRun: BreakdownStat;
    duringPlayerRun: BreakdownStat;
  };
  byStreakLength: {
    len2: BreakdownStat;
    len3: BreakdownStat;
    len4: BreakdownStat;
    len5Plus: BreakdownStat;
  };
  byPattern: BreakdownStat[];
}

export interface ProbabilityBreakdown {
  reference: { player: number; tie: number; banker: number };
  observed: { player: number; tie: number; banker: number };
  modelEstimate: { player: number; tie: number; banker: number };
  statisticalConfidence: 'DADOS INSUFICIENTES' | 'BAIXA' | 'MODERADA' | 'ALTA';
  sampleQualityNote: string;
}

export interface BacBoEngineAnalysis {
  totalRounds: number;
  lastOutcome: BacBoOutcome | null;
  beadPlate: BacBoBeadCell[];
  streaks: StreakReport;
  patterns: PatternReport;
  ties: TieAnalysisReport;
  strategies: StrategyEngineReport;
  learning: LearningReport;
  statistics: StatisticsReport;
  probabilities: ProbabilityBreakdown;
  currentSnapshot: BacBoPredictionSnapshot;
}

export interface BacBoTestCaseResult {
  name: string;
  passed: boolean;
  details: string;
}

export interface BacBoTestReport {
  executedAt: string;
  total: number;
  passed: number;
  failed: number;
  cases: BacBoTestCaseResult[];
}
