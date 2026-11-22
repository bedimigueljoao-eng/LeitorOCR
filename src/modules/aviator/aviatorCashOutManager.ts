import {
  AviatorCashOutConfig,
  AviatorCashOutOperation,
  AviatorCashOutState,
  AviatorLiveState,
} from './types';

export function createInitialCashOutState(): AviatorCashOutState {
  return {
    attemptsCount: 0,
    reachedCount: 0,
    missedCount: 0,
    alertActiveNow: false,
    alertMessage: null,
    operations: [],
  };
}

/**
 * Avalia em tempo real se o multiplicador ao vivo atingiu o alvo de Cash Out configurado.
 * Nunca afirma execução automática na KwanzaBet; emite apenas alerta e registo de monitorização.
 */
export function evaluateLiveCashOutTarget(
  cfg: AviatorCashOutConfig,
  cashState: AviatorCashOutState,
  liveState: AviatorLiveState
): AviatorCashOutState {
  if (!cfg.enabled) {
    if (!cashState.alertActiveNow) return cashState;
    return {
      ...cashState,
      alertActiveNow: false,
      alertMessage: null,
    };
  }

  if (
    liveState.phase === 'FLYING' &&
    liveState.currentMultiplier !== null &&
    liveState.currentMultiplier >= cfg.targetMultiplier
  ) {
    return {
      ...cashState,
      alertActiveNow: true,
      alertMessage: `ALVO ${cfg.targetMultiplier.toFixed(2)}x ATINGIDO (Atual: ${liveState.currentMultiplier.toFixed(2)}x) — Executar Cash Out manual na plataforma.`,
    };
  }

  if (cashState.alertActiveNow && liveState.phase !== 'FLYING') {
    return {
      ...cashState,
      alertActiveNow: false,
      alertMessage: null,
    };
  }

  return cashState;
}

export function recordCashOutOutcomeOnCrash(
  cfg: AviatorCashOutConfig,
  cashState: AviatorCashOutState,
  crashMultiplier: number,
  simulatedMode: boolean
): AviatorCashOutState {
  if (!cfg.enabled || cashState.attemptsCount >= cfg.maxAttemptsPerSession) {
    return { ...cashState, alertActiveNow: false, alertMessage: null };
  }

  const reached = crashMultiplier >= cfg.targetMultiplier;
  const op: AviatorCashOutOperation = {
    id: `co-${Date.now()}`,
    timestamp: Date.now(),
    targetMultiplier: cfg.targetMultiplier,
    liveMultiplierAtEvent: crashMultiplier,
    outcome: reached
      ? simulatedMode
        ? 'TARGET_REACHED_SIMULATED'
        : 'UNCONFIRMED_EXTERNAL'
      : 'CRASHED_BEFORE_TARGET',
    note: reached
      ? simulatedMode
        ? `Simulação: alvo ${cfg.targetMultiplier.toFixed(2)}x superado (crash em ${crashMultiplier.toFixed(2)}x).`
        : `Alvo ${cfg.targetMultiplier.toFixed(2)}x atingido visualmente (crash em ${crashMultiplier.toFixed(2)}x); execução real depende de confirmação na Kwanzabet.`
      : `Crash em ${crashMultiplier.toFixed(2)}x antes do alvo ${cfg.targetMultiplier.toFixed(2)}x.`,
  };

  return {
    attemptsCount: cashState.attemptsCount + 1,
    reachedCount: cashState.reachedCount + (reached ? 1 : 0),
    missedCount: cashState.missedCount + (reached ? 0 : 1),
    alertActiveNow: false,
    alertMessage: null,
    operations: [op, ...cashState.operations].slice(0, 100),
  };
}
