import {
  AviatorBankrollConfig,
  AviatorBankrollLimitStatus,
  AviatorBankrollState,
} from './types';

export function evaluateBankrollLimits(
  cfg: AviatorBankrollConfig,
  state: AviatorBankrollState
): AviatorBankrollLimitStatus {
  const reasons: string[] = [];

  const sessionLossAoa = Math.max(0, -state.netPnlAoa);
  const dailyLossAoa = sessionLossAoa;
  const weeklyLossAoa = sessionLossAoa;
  const sessionProfitAoa = Math.max(0, state.netPnlAoa);

  if (state.pausedUntilNextSession) {
    reasons.push('Sessão pausada manualmente pelo utilizador.');
  }

  if (cfg.sessionMaxLossAoa > 0 && sessionLossAoa >= cfg.sessionMaxLossAoa) {
    reasons.push(
      `Limite de perda da sessão atingido (${sessionLossAoa.toFixed(0)} / ${cfg.sessionMaxLossAoa.toFixed(0)} AOA).`
    );
  }

  if (cfg.dailyMaxLossAoa > 0 && dailyLossAoa >= cfg.dailyMaxLossAoa) {
    reasons.push(
      `Limite de perda diário atingido (${dailyLossAoa.toFixed(0)} / ${cfg.dailyMaxLossAoa.toFixed(0)} AOA).`
    );
  }

  if (cfg.weeklyMaxLossAoa > 0 && weeklyLossAoa >= cfg.weeklyMaxLossAoa) {
    reasons.push(
      `Limite de perda semanal atingido (${weeklyLossAoa.toFixed(0)} / ${cfg.weeklyMaxLossAoa.toFixed(0)} AOA).`
    );
  }

  if (cfg.winTargetAoa > 0 && sessionProfitAoa >= cfg.winTargetAoa) {
    reasons.push(
      `Meta de lucro atingida (+${sessionProfitAoa.toFixed(0)} / ${cfg.winTargetAoa.toFixed(0)} AOA). Encerrar sessão.`
    );
  }

  if (
    cfg.pauseAfterConsecutiveLosses > 0 &&
    state.currentConsecutiveLosses >= cfg.pauseAfterConsecutiveLosses
  ) {
    reasons.push(
      `Pausa automática após ${state.currentConsecutiveLosses} perdas consecutivas.`
    );
  }

  if (state.currentBalanceAoa < cfg.baseStakeAoa) {
    reasons.push('Saldo insuficiente para o valor base de aposta.');
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    sessionLossAoa,
    dailyLossAoa,
    weeklyLossAoa,
    sessionProfitAoa,
    consecutiveLosses: state.currentConsecutiveLosses,
  };
}

/**
 * Calcula stake permitida — PROÍBE ESTRITAMENTE Martingale ou aumento após perda.
 */
export function computeSafeFlatStake(
  requestedStakeAoa: number,
  cfg: AviatorBankrollConfig,
  state: AviatorBankrollState
): { allowed: boolean; stakeAoa: number; reason?: string } {
  const limitStatus = evaluateBankrollLimits(cfg, state);
  if (limitStatus.blocked) {
    return {
      allowed: false,
      stakeAoa: 0,
      reason: limitStatus.reasons[0],
    };
  }

  // Bloqueia qualquer tentativa de dobrar stake acima da stake base configurada
  const safeMax = Math.max(1, cfg.baseStakeAoa);
  const clampedStake = Math.min(Math.max(1, requestedStakeAoa), safeMax, state.currentBalanceAoa);
  return {
    allowed: clampedStake >= 1,
    stakeAoa: Math.round(clampedStake * 100) / 100,
    reason:
      requestedStakeAoa > safeMax
        ? `Politica anti-Martingale: valor limitado à aposta base de ${safeMax.toFixed(0)} AOA.`
        : undefined,
  };
}

export function applyBankrollSettlement(
  state: AviatorBankrollState,
  stakeAoa: number,
  targetMultiplier: number,
  actualCrashMultiplier: number
): AviatorBankrollState {
  const won = actualCrashMultiplier >= targetMultiplier;
  const payout = won ? Math.round(stakeAoa * targetMultiplier * 100) / 100 : 0;
  const netDelta = Math.round((payout - stakeAoa) * 100) / 100;
  const nextConsecutiveLosses = won ? 0 : state.currentConsecutiveLosses + 1;

  return {
    ...state,
    currentBalanceAoa: Math.max(0, Math.round((state.currentBalanceAoa + netDelta) * 100) / 100),
    totalStakedAoa: Math.round((state.totalStakedAoa + stakeAoa) * 100) / 100,
    totalRecoveredAoa: Math.round((state.totalRecoveredAoa + payout) * 100) / 100,
    netPnlAoa: Math.round((state.netPnlAoa + netDelta) * 100) / 100,
    currentConsecutiveLosses: nextConsecutiveLosses,
    maxConsecutiveLosses: Math.max(state.maxConsecutiveLosses, nextConsecutiveLosses),
    totalOperations: state.totalOperations + 1,
    wins: state.wins + (won ? 1 : 0),
    losses: state.losses + (won ? 0 : 1),
  };
}
