import { evaluateBankrollLimits } from './aviatorBankrollManager';
import { runAviatorLearningEngine } from './aviatorLearningEngine';
import { analyzeAviatorPatterns } from './aviatorPatternEngine';
import { runAviatorStrategyEngine } from './aviatorStrategyEngine';
import { computeAviatorStatistics } from './aviatorStatisticsEngine';
import {
  AviatorBankrollConfig,
  AviatorBankrollState,
  AviatorCategoryRuleConfig,
  AviatorEngineAnalysis,
  AviatorLearningSnapshot,
  AviatorRoundRecord,
  DEFAULT_CATEGORY_CONFIG,
  LearningWindowKey,
} from './types';

export * from './types';
export * from './aviatorDatabase';
export * from './aviatorResultProcessor';
export * from './aviatorOcr';
export * from './aviatorPatternEngine';
export * from './aviatorStrategyEngine';
export * from './aviatorLearningEngine';
export * from './aviatorBankrollManager';
export * from './aviatorAutoBetManager';
export * from './aviatorCashOutManager';
export * from './aviatorStatisticsEngine';
export * from './aviatorTests';

export function analyzeAviatorEngine(params: {
  rounds: AviatorRoundRecord[];
  bankrollCfg: AviatorBankrollConfig;
  bankrollState: AviatorBankrollState;
  selectedWindow: LearningWindowKey;
  savedSnapshots: AviatorLearningSnapshot[];
  categoryCfg?: AviatorCategoryRuleConfig;
}): AviatorEngineAnalysis {
  const { rounds, bankrollCfg, bankrollState, selectedWindow, savedSnapshots, categoryCfg } = params;
  const catConfig = categoryCfg ?? DEFAULT_CATEGORY_CONFIG;

  const patterns = analyzeAviatorPatterns(rounds, catConfig);
  const strategies = runAviatorStrategyEngine(rounds, bankrollCfg.baseStakeAoa);
  const learning = runAviatorLearningEngine({
    rounds,
    strategyReport: strategies,
    selectedWindow,
    stakeAoa: bankrollCfg.baseStakeAoa,
    savedSnapshots,
  });
  const statistics = computeAviatorStatistics(rounds, catConfig);
  const bankrollStatus = evaluateBankrollLimits(bankrollCfg, bankrollState);

  return {
    totalRounds: rounds.length,
    lastRound: rounds.length > 0 ? rounds[rounds.length - 1] : null,
    patterns,
    strategies,
    learning,
    statistics,
    bankrollStatus,
    disclaimer:
      'Sistema de análise estatística e simulação educacional. Não garante lucro nem prevê com certeza multiplicadores gerados aleatoriamente.',
  };
}
