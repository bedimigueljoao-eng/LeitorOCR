import { applyBankrollSettlement, computeSafeFlatStake } from './aviatorBankrollManager';
import {
  AviatorAutoBetConfig,
  AviatorAutoBetState,
  AviatorBankrollConfig,
  AviatorBankrollState,
  AviatorBetOperationRecord,
  AviatorStrategyEngineReport,
} from './types';

export const KWANZABET_API_CAPABILITY_NOTICE =
  'A KwanzaBet não disponibiliza API pública autorizada para envio automático de apostas ou cash out externo. Para segurança da conta e conformidade técnica, o módulo opera apenas em Modo Simulação ou Modo Preparação Manual (com confirmação explícita do utilizador).';

export function createInitialAutoBetState(): AviatorAutoBetState {
  return {
    sessionBetsCount: 0,
    pendingManualTicket: null,
    operations: [],
    lastBlockReason: null,
  };
}

export function isWithinOperatingSchedule(
  cfg: AviatorAutoBetConfig,
  hourOfDay: number = new Date().getHours()
): boolean {
  if (cfg.activeHourStart === cfg.activeHourEnd) return true;
  if (cfg.activeHourStart < cfg.activeHourEnd) {
    return hourOfDay >= cfg.activeHourStart && hourOfDay <= cfg.activeHourEnd;
  }
  // Janela noturna atravessando meia-noite (ex: 20h às 03h)
  return hourOfDay >= cfg.activeHourStart || hourOfDay <= cfg.activeHourEnd;
}

export function evaluateAutoBetOpportunity(params: {
  autoCfg: AviatorAutoBetConfig;
  autoState: AviatorAutoBetState;
  bankrollCfg: AviatorBankrollConfig;
  bankrollState: AviatorBankrollState;
  strategyReport: AviatorStrategyEngineReport;
  nextRoundNumber: number;
  nowHour?: number;
}): {
  nextAutoState: AviatorAutoBetState;
  ticketCreated: AviatorBetOperationRecord | null;
} {
  const { autoCfg, autoState, bankrollCfg, bankrollState, strategyReport } = params;

  if (!autoCfg.enabled || autoCfg.mode === 'off') {
    return { nextAutoState: autoState, ticketCreated: null };
  }

  if (autoState.sessionBetsCount >= autoCfg.maxBetsPerSession) {
    return {
      nextAutoState: {
        ...autoState,
        lastBlockReason: `Limite máximo de ${autoCfg.maxBetsPerSession} apostas na sessão atingido.`,
      },
      ticketCreated: null,
    };
  }

  if (!isWithinOperatingSchedule(autoCfg, params.nowHour)) {
    return {
      nextAutoState: {
        ...autoState,
        lastBlockReason: `Fora do horário autorizado (${autoCfg.activeHourStart}h–${autoCfg.activeHourEnd}h).`,
      },
      ticketCreated: null,
    };
  }

  const stakeCheck = computeSafeFlatStake(autoCfg.stakeAoa, bankrollCfg, bankrollState);
  if (!stakeCheck.allowed) {
    return {
      nextAutoState: {
        ...autoState,
        lastBlockReason: stakeCheck.reason ?? 'Bloqueado pela Gestão de Banca.',
      },
      ticketCreated: null,
    };
  }

  const selectedStrategy =
    strategyReport.strategies.find((s) => s.id === autoCfg.strategyId) ??
    strategyReport.recommended;

  if (
    !selectedStrategy ||
    !selectedStrategy.currentSignal.active ||
    selectedStrategy.currentSignal.score < autoCfg.minConfidencePct
  ) {
    return {
      nextAutoState: {
        ...autoState,
        lastBlockReason: null,
      },
      ticketCreated: null,
    };
  }

  const target =
    selectedStrategy.currentSignal.targetMultiplier ?? selectedStrategy.targetMultiplier;

  if (autoCfg.mode === 'manual_prepared') {
    if (autoState.pendingManualTicket) {
      return { nextAutoState: autoState, ticketCreated: null };
    }
    const ticket: AviatorBetOperationRecord = {
      id: `op-man-${Date.now()}`,
      roundNumber: params.nextRoundNumber,
      timestamp: Date.now(),
      mode: 'manual_confirmed',
      strategyName: selectedStrategy.name,
      stakeAoa: stakeCheck.stakeAoa,
      targetCashout: target,
      actualCrash: null,
      status: 'PENDING_CONFIRMATION',
      payoutAoa: 0,
      netAoa: 0,
      note: 'Aguardando confirmação explícita do utilizador na plataforma Kwanzabet.',
    };
    return {
      nextAutoState: {
        ...autoState,
        pendingManualTicket: ticket,
        lastBlockReason: null,
      },
      ticketCreated: ticket,
    };
  }

  // Modo 1: Simulação (sem interação real com a casa)
  const simTicket: AviatorBetOperationRecord = {
    id: `op-sim-${Date.now()}-${params.nextRoundNumber}`,
    roundNumber: params.nextRoundNumber,
    timestamp: Date.now(),
    mode: 'simulation',
    strategyName: selectedStrategy.name,
    stakeAoa: stakeCheck.stakeAoa,
    targetCashout: target,
    actualCrash: null,
    status: 'ACTIVE_SIMULATION',
    payoutAoa: 0,
    netAoa: 0,
    note: 'Entrada simulada localmente (Modo Simulação).',
  };

  return {
    nextAutoState: {
      ...autoState,
      sessionBetsCount: autoState.sessionBetsCount + 1,
      operations: [simTicket, ...autoState.operations].slice(0, 100),
      lastBlockReason: null,
    },
    ticketCreated: simTicket,
  };
}

export function settleActiveAutoBetOnCrash(params: {
  autoState: AviatorAutoBetState;
  bankrollState: AviatorBankrollState;
  crashMultiplier: number;
}): {
  nextAutoState: AviatorAutoBetState;
  nextBankrollState: AviatorBankrollState;
} {
  let nextBankroll = params.bankrollState;
  let updatedAny = false;

  const updatedOps = params.autoState.operations.map((op) => {
    if (op.status !== 'ACTIVE_SIMULATION') return op;
    updatedAny = true;
    const won = params.crashMultiplier >= op.targetCashout;
    const payout = won ? Math.round(op.stakeAoa * op.targetCashout * 100) / 100 : 0;
    const net = Math.round((payout - op.stakeAoa) * 100) / 100;
    nextBankroll = applyBankrollSettlement(
      nextBankroll,
      op.stakeAoa,
      op.targetCashout,
      params.crashMultiplier
    );
    return {
      ...op,
      actualCrash: params.crashMultiplier,
      status: won ? ('WON' as const) : ('LOST' as const),
      payoutAoa: payout,
      netAoa: net,
      note: won
        ? `Simulação: atingiu ${op.targetCashout.toFixed(2)}x antes do crash em ${params.crashMultiplier.toFixed(2)}x.`
        : `Simulação: crash em ${params.crashMultiplier.toFixed(2)}x abaixo de ${op.targetCashout.toFixed(2)}x.`,
    };
  });

  if (!updatedAny) {
    return { nextAutoState: params.autoState, nextBankrollState: params.bankrollState };
  }

  return {
    nextAutoState: {
      ...params.autoState,
      operations: updatedOps,
    },
    nextBankrollState: nextBankroll,
  };
}

export function confirmManualTicketAction(
  autoState: AviatorAutoBetState,
  confirm: boolean
): AviatorAutoBetState {
  const pending = autoState.pendingManualTicket;
  if (!pending) return autoState;

  if (!confirm) {
    const cancelled: AviatorBetOperationRecord = {
      ...pending,
      status: 'CANCELLED',
      note: 'Preparação manual cancelada pelo utilizador.',
    };
    return {
      ...autoState,
      pendingManualTicket: null,
      operations: [cancelled, ...autoState.operations].slice(0, 100),
    };
  }

  const confirmed: AviatorBetOperationRecord = {
    ...pending,
    status: 'UNCONFIRMED',
    note: 'Confirmado pelo utilizador na preparação manual; liquidação depende do resultado confirmado na plataforma.',
  };
  return {
    ...autoState,
    sessionBetsCount: autoState.sessionBetsCount + 1,
    pendingManualTicket: null,
    operations: [confirmed, ...autoState.operations].slice(0, 100),
  };
}
