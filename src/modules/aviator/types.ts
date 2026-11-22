export type AviatorRoundPhase = 'WAITING' | 'FLYING' | 'CRASHED' | 'UNKNOWN';

export type AviatorColorTier = 'blue' | 'purple' | 'pink';

export type AviatorCategory =
  | 'under_1_50'
  | '1_50_to_2_00'
  | '2_00_to_3_00'
  | '3_00_to_5_00'
  | '5_00_to_10_00'
  | 'over_10_00';

export interface AviatorCategoryRuleConfig {
  lowCeiling: number;        // default 1.50
  midLowCeiling: number;     // default 2.00
  midCeiling: number;        // default 3.00
  highCeiling: number;       // default 5.00
  megaThreshold: number;     // default 10.00
}

export const DEFAULT_CATEGORY_CONFIG: AviatorCategoryRuleConfig = {
  lowCeiling: 1.5,
  midLowCeiling: 2.0,
  midCeiling: 3.0,
  highCeiling: 5.0,
  megaThreshold: 10.0,
};

export interface AviatorSuggestionSnapshot {
  strategyId: AviatorStrategyId | 'NONE';
  strategyName: string;
  shouldEnter: boolean;
  targetMultiplier: number | null;
  confidencePct: number;
  reason: string;
}

export interface AviatorRoundRecord {
  id: string;
  roundNumber: number;
  multiplier: number;
  category: AviatorCategory;
  colorTier: AviatorColorTier;
  timestamp: number;
  dateKey: string;
  timeLabel: string;
  source: 'ocr_live' | 'ocr_strip' | 'manual' | 'import' | 'screenshot';
  ocrConfidence: number;
  predictionBefore?: AviatorSuggestionSnapshot;
}

export interface AviatorLiveState {
  phase: AviatorRoundPhase;
  currentMultiplier: number | null;
  lastCrashMultiplier: number | null;
  isCrashedColor: boolean;
  roundStartedAt: number | null;
  lastUpdatedAt: number | null;
  ocrConfidence: number;
  captureMode: 'integrated_browser' | 'media_projection' | 'manual';
  historyVisibleCount: number;
}

export interface AviatorCaptureStatus {
  mediaProjectionActive: boolean;
  integratedBrowserOpen: boolean;
  captureIntervalMs: number;
  lowPowerMode: boolean;
  permissionState: 'idle' | 'pending' | 'granted' | 'denied';
  lastError: string | null;
}

export type AviatorPatternConfidence =
  | 'INSUFICIENTE'
  | 'BAIXA'
  | 'MODERADA'
  | 'CONSISTENTE';

export interface AviatorPattern {
  id: string;
  title: string;
  group: 'sequence' | 'repetition' | 'alternation' | 'block' | 'interval' | 'distribution';
  description: string;
  occurrences: number;
  sampleBase: number;
  frequencyPct: number;
  nextAbove150Pct: number;
  nextAbove200Pct: number;
  nextAbove500Pct: number;
  nextAvgMultiplier: number;
  confidence: AviatorPatternConfidence;
  activeNow: boolean;
  warning: string;
}

export interface AviatorPatternReport {
  discovered: AviatorPattern[];
  activeAlerts: AviatorPattern[];
  currentLowStreak: number;
  maxLowStreak: number;
  roundsSinceAbove2x: number;
  roundsSinceAbove5x: number;
  roundsSinceAbove10x: number;
  categoryCounts: Record<AviatorCategory, number>;
  categoryPcts: Record<AviatorCategory, number>;
  disclaimer: string;
}

export type AviatorStrategyId =
  | 'conservative_target'
  | 'intermediate_target'
  | 'high_multiplier'
  | 'sequence_pattern'
  | 'frequency_window'
  | 'block_cluster'
  | 'combined_consensus';

export interface AviatorStrategySignal {
  active: boolean;
  targetMultiplier: number | null;
  score: number;
  reason: string;
}

export interface AviatorStrategyResult {
  id: AviatorStrategyId;
  name: string;
  description: string;
  targetMultiplier: number;
  evaluatedEntries: number;
  hits: number;
  misses: number;
  hitRatePct: number;
  simulatedStakedAoa: number;
  simulatedNetPnlAoa: number;
  simulatedRoiPct: number;
  best20RoiPct: number;
  worst20RoiPct: number;
  recent25HitRatePct: number;
  recent25Entries: number;
  degradationFlag: boolean;
  currentSignal: AviatorStrategySignal;
}

export interface AviatorStrategyEngineReport {
  strategies: AviatorStrategyResult[];
  recommended: AviatorStrategyResult | null;
  activeSnapshot: AviatorSuggestionSnapshot;
  rankingByRoi: AviatorStrategyResult[];
  rankingByHitRate: AviatorStrategyResult[];
}

export type LearningWindowKey = '50' | '100' | '500' | '1000' | 'all';

export interface AviatorWindowComparison {
  windowKey: LearningWindowKey;
  label: string;
  sampleSize: number;
  trainHitRatePct: number;
  validationHitRatePct: number;
  validationRoiPct: number;
  overfitGapPct: number;
  degraded: boolean;
  bestStrategyId: AviatorStrategyId | null;
  bestStrategyName: string;
}

export interface AviatorLearningSnapshot {
  id: string;
  timestamp: number;
  sampleSize: number;
  bestStrategyName: string;
  validationHitRatePct: number;
  validationRoiPct: number;
}

export interface AviatorLearningReport {
  windows: AviatorWindowComparison[];
  selectedWindow: LearningWindowKey;
  oldVsNewDeltaPct: number;
  overfittingRisk: 'BAIXO' | 'MODERADO' | 'ELEVADO' | 'INSUFICIENTE';
  degradationWarning: string | null;
  recommendationNote: string;
  recentSnapshots: AviatorLearningSnapshot[];
}

export interface AviatorBankrollConfig {
  initialBalanceAoa: number;
  baseStakeAoa: number;
  sessionMaxLossAoa: number;
  dailyMaxLossAoa: number;
  weeklyMaxLossAoa: number;
  winTargetAoa: number;
  pauseAfterConsecutiveLosses: number;
  strictNoMartingale: true; // sempre true por política de segurança
}

export interface AviatorBankrollLimitStatus {
  blocked: boolean;
  reasons: string[];
  sessionLossAoa: number;
  dailyLossAoa: number;
  weeklyLossAoa: number;
  sessionProfitAoa: number;
  consecutiveLosses: number;
}

export interface AviatorBankrollState {
  currentBalanceAoa: number;
  totalStakedAoa: number;
  totalRecoveredAoa: number;
  netPnlAoa: number;
  maxConsecutiveLosses: number;
  currentConsecutiveLosses: number;
  totalOperations: number;
  wins: number;
  losses: number;
  sessionStartAt: number;
  pausedUntilNextSession: boolean;
}

export type AviatorAutoBetMode = 'off' | 'simulation' | 'manual_prepared';

export interface AviatorAutoBetConfig {
  enabled: boolean;
  mode: AviatorAutoBetMode;
  stakeAoa: number;
  strategyId: AviatorStrategyId;
  minConfidencePct: number;
  maxBetsPerSession: number;
  activeHourStart: number; // 0..23
  activeHourEnd: number;   // 0..23
  requireManualConfirmation: boolean;
}

export interface AviatorBetOperationRecord {
  id: string;
  roundNumber: number;
  timestamp: number;
  mode: 'simulation' | 'manual_confirmed';
  strategyName: string;
  stakeAoa: number;
  targetCashout: number;
  actualCrash: number | null;
  status: 'PENDING_CONFIRMATION' | 'ACTIVE_SIMULATION' | 'WON' | 'LOST' | 'CANCELLED' | 'UNCONFIRMED';
  payoutAoa: number;
  netAoa: number;
  note: string;
}

export interface AviatorAutoBetState {
  sessionBetsCount: number;
  pendingManualTicket: AviatorBetOperationRecord | null;
  operations: AviatorBetOperationRecord[];
  lastBlockReason: string | null;
}

export interface AviatorCashOutConfig {
  enabled: boolean;
  targetMultiplier: number;
  maxAttemptsPerSession: number;
  alertSoundEnabled: boolean;
}

export interface AviatorCashOutOperation {
  id: string;
  timestamp: number;
  targetMultiplier: number;
  liveMultiplierAtEvent: number;
  outcome: 'TARGET_REACHED_SIMULATED' | 'CRASHED_BEFORE_TARGET' | 'MANUAL_CONFIRMED' | 'UNCONFIRMED_EXTERNAL';
  note: string;
}

export interface AviatorCashOutState {
  attemptsCount: number;
  reachedCount: number;
  missedCount: number;
  alertActiveNow: boolean;
  alertMessage: string | null;
  operations: AviatorCashOutOperation[];
}

export interface AviatorStatisticsReport {
  totalRounds: number;
  overallAvgMultiplier: number;
  overallMedianMultiplier: number;
  overallMaxMultiplier: number;
  recent20AvgMultiplier: number;
  recent50AvgMultiplier: number;
  above2xPct: number;
  below150Pct: number;
  above5xPct: number;
  above10xPct: number;
  categoryCounts: Record<AviatorCategory, number>;
  categoryPcts: Record<AviatorCategory, number>;
  evaluatedSuggestions: number;
  suggestionHits: number;
  suggestionMisses: number;
  suggestionHitRatePct: number;
}

export type AviatorMarkovStateKey =
  | 'under_1_50'
  | '1_50_to_2_00'
  | '2_00_to_5_00'
  | '5_00_to_10_00'
  | 'over_10_00';

export interface AviatorPostPeakHorizonStats {
  horizonRounds: 1 | 3 | 5;
  sampleEvents: number;
  evaluatedRounds: number;
  under150Pct: number;
  under150DeltaPct: number;
  above200Pct: number;
  above500Pct: number;
  avgMultiplier: number;
  zScoreUnder150: number;
  statisticallySignificant: boolean;
  verdictLabel: string;
}

export interface AviatorPostPeakBucket {
  threshold: number;
  label: string;
  totalOccurrences: number;
  lastSeenRoundsAgo: number | null;
  activeJustHappened: boolean;
  horizons: AviatorPostPeakHorizonStats[];
}

export interface AviatorMarkovTransitionRow {
  fromState: AviatorMarkovStateKey;
  fromLabel: string;
  sampleCount: number;
  probsPct: Record<AviatorMarkovStateKey, number>;
  nextAvgMultiplier: number;
}

export interface AviatorPeakIntervalStats {
  threshold: number;
  label: string;
  count: number;
  minGap: number | null;
  medianGap: number | null;
  p90Gap: number | null;
  maxGap: number | null;
  currentGap: number;
  clusterRatePct: number;
}

export interface AviatorRegimeAnalysis {
  regime: 'INSUFICIENTE' | 'FRIO_CRISE' | 'NORMAL' | 'VOLATIL_PICOS';
  regimeLabel: string;
  cautionScore: number;
  recent15LowPct: number;
  recent15PeakCount: number;
  volatilityIndex: number;
  recommendedAction: string;
}

export interface AviatorLocalAiReport {
  baselineUnder150Pct: number;
  baselineAbove200Pct: number;
  baselineAvgMultiplier: number;
  postPeakBuckets: AviatorPostPeakBucket[];
  markovRows: AviatorMarkovTransitionRow[];
  currentMarkovState: AviatorMarkovStateKey | null;
  peakIntervals: AviatorPeakIntervalStats[];
  regime: AviatorRegimeAnalysis;
  localNarrativeSummary: string;
}

export interface AviatorEngineAnalysis {
  totalRounds: number;
  lastRound: AviatorRoundRecord | null;
  patterns: AviatorPatternReport;
  strategies: AviatorStrategyEngineReport;
  learning: AviatorLearningReport;
  statistics: AviatorStatisticsReport;
  bankrollStatus: AviatorBankrollLimitStatus;
  ai: AviatorLocalAiReport;
  disclaimer: string;
}

export interface AviatorTestCaseResult {
  name: string;
  passed: boolean;
  details: string;
}

export interface AviatorTestReport {
  passedCount: number;
  totalCount: number;
  allPassed: boolean;
  cases: AviatorTestCaseResult[];
}
