import { ContinuousLearningReport } from './continuousLearning';
import { MarketRegimeReport } from './marketRegimeDetector';

export interface QuantBankrollPolicy {
  initialBalanceAoa: number;
  currentBalanceAoa: number;
  baseStakeAoa: number;
  stopLossAoa: number;
  stopWinAoa: number;
  pauseAfterConsecutiveLosses: number;
  consecutiveLosses: number;
  sessionPnlAoa: number;
}

export interface QuantAnalystDecision {
  decision: 'ENTRAR' | 'NAO_APOSTAR';
  headline: string;
  marketOrTarget: string;
  confidencePct: number;
  authorStrategyName: string;
  statisticalJustification: string;
  sampleSize: number;
  validatedHitRatePct: number;
  bankrollBlocked: boolean;
  bankrollBlockReasons: string[];
  disclaimer: string;
}

export function buildQuantAnalystDecision(params: {
  game: 'roulette' | 'aviator';
  regime: MarketRegimeReport;
  learning: ContinuousLearningReport;
  bankroll: QuantBankrollPolicy;
}): QuantAnalystDecision {
  const { game, regime, learning, bankroll } = params;
  const disclaimer = `Base: ${regime.sampleSize} rodadas observadas. Resultados passados em jogos RNG/Provably Fair não garantem retornos futuros.`;

  const bankrollBlockReasons: string[] = [];
  if (bankroll.sessionPnlAoa <= -Math.abs(bankroll.stopLossAoa)) {
    bankrollBlockReasons.push(
      `Stop-Loss atingido (${bankroll.sessionPnlAoa.toFixed(0)} AOA <= -${bankroll.stopLossAoa.toFixed(0)} AOA).`
    );
  }
  if (bankroll.sessionPnlAoa >= Math.abs(bankroll.stopWinAoa)) {
    bankrollBlockReasons.push(
      `Stop-Win atingido (+${bankroll.sessionPnlAoa.toFixed(0)} AOA >= +${bankroll.stopWinAoa.toFixed(0)} AOA).`
    );
  }
  if (bankroll.consecutiveLosses >= bankroll.pauseAfterConsecutiveLosses) {
    bankrollBlockReasons.push(
      `Pausa automática após ${bankroll.consecutiveLosses} perdas consecutivas.`
    );
  }

  const bankrollBlocked = bankrollBlockReasons.length > 0;

  if (bankrollBlocked) {
    return {
      decision: 'NAO_APOSTAR',
      headline: 'NÃO APOSTAR — PROTEÇÃO DE BANCA ATIVA',
      marketOrTarget: 'Sessão Pausada',
      confidencePct: 0,
      authorStrategyName: 'Gestor de Risco QuantLab',
      statisticalJustification: bankrollBlockReasons.join(' '),
      sampleSize: regime.sampleSize,
      validatedHitRatePct: learning.topStrategy?.outOfSampleHitRatePct ?? 0,
      bankrollBlocked: true,
      bankrollBlockReasons,
      disclaimer,
    };
  }

  if (regime.blockEntries) {
    return {
      decision: 'NAO_APOSTAR',
      headline: regime.bannerText,
      marketOrTarget: 'Aguardar estabilização',
      confidencePct: 0,
      authorStrategyName: 'Detector de Imprevisibilidade',
      statisticalJustification: regime.reasons.join(' '),
      sampleSize: regime.sampleSize,
      validatedHitRatePct: learning.topStrategy?.outOfSampleHitRatePct ?? 0,
      bankrollBlocked: false,
      bankrollBlockReasons: [],
      disclaimer,
    };
  }

  const active = learning.activeBestSignal;
  if (!active || !active.currentSignal.active) {
    return {
      decision: 'NAO_APOSTAR',
      headline: 'AGUARDAR GATILHO — SEM CONFLUÊNCIA ATIVA',
      marketOrTarget: 'Sem entrada no momento',
      confidencePct: 0,
      authorStrategyName: learning.topStrategy?.strategy.name ?? 'Motor de Estratégias',
      statisticalJustification:
        learning.topStrategy?.currentSignal.reason ??
        'Nenhuma estratégia habilitada satisfez os critérios estatísticos nesta rodada.',
      sampleSize: regime.sampleSize,
      validatedHitRatePct: learning.topStrategy?.outOfSampleHitRatePct ?? 0,
      bankrollBlocked: false,
      bankrollBlockReasons: [],
      disclaimer,
    };
  }

  return {
    decision: 'ENTRAR',
    headline: `ENTRAR — ${active.currentSignal.targetDescription}`,
    marketOrTarget: active.currentSignal.targetDescription,
    confidencePct: Math.min(92, Math.round((active.currentSignal.confidencePct + active.consistencyScore) / 2)),
    authorStrategyName: active.strategy.name,
    statisticalJustification: `${active.currentSignal.reason} Consistência ${active.consistencyScore}/100 · Acerto OOS ${active.outOfSampleHitRatePct.toFixed(
      1
    )}% (n=${active.overall.entries} entradas, drawdown máx ${active.overall.maxDrawdownPct.toFixed(1)}%).`,
    sampleSize: regime.sampleSize,
    validatedHitRatePct: active.outOfSampleHitRatePct,
    bankrollBlocked: false,
    bankrollBlockReasons: [],
    disclaimer,
  };
}
