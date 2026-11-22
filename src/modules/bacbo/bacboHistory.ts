import { BacBoBeadCell, BacBoOutcome, BacBoRoundRecord } from './types';

export const BEAD_PLATE_ROWS = 6;

export function buildBeadPlate(rounds: BacBoRoundRecord[]): BacBoBeadCell[] {
  return rounds.map((r, idx) => ({
    roundNumber: r.roundNumber,
    outcome: r.outcome,
    winningTotal: r.winningTotal,
    row: idx % BEAD_PLATE_ROWS,
    col: Math.floor(idx / BEAD_PLATE_ROWS),
    recordId: r.id,
  }));
}

export function getOutcomesSequence(rounds: BacBoRoundRecord[]): BacBoOutcome[] {
  return rounds.map((r) => r.outcome);
}

export function sliceRecentRounds(
  rounds: BacBoRoundRecord[],
  windowSize: number
): BacBoRoundRecord[] {
  if (rounds.length <= windowSize) return rounds;
  return rounds.slice(rounds.length - windowSize);
}

export function formatOutcomeLabel(outcome: BacBoOutcome | 'NONE'): string {
  if (outcome === 'P') return 'PLAYER';
  if (outcome === 'B') return 'BANKER';
  if (outcome === 'T') return 'TIE';
  return 'SEM SUGESTÃO';
}

export interface BacBoRoundCycleStatus {
  phase: 'BETTING_WINDOW' | 'ROLLING' | 'WAITING_RESULT';
  label: string;
  countdownSec: number;
  detail: string;
}

/**
 * Ciclo real observado na Kwanzabet Bac Bo:
 * - 0s..9s após o resultado sair: janela para apostas (dados ainda parados).
 * - 9s..21s: dados a girar (~10–12s) até parar no próximo resultado.
 */
export function getBacBoRoundCycleStatus(
  lastLiveResultAtMs: number | null,
  nowMs: number = Date.now()
): BacBoRoundCycleStatus {
  if (!lastLiveResultAtMs) {
    return {
      phase: 'WAITING_RESULT',
      label: 'A aguardar resultado',
      countdownSec: 0,
      detail: 'Ciclo sincroniza assim que sair o próximo resultado',
    };
  }
  const elapsedSec = Math.max(0, Math.floor((nowMs - lastLiveResultAtMs) / 1000));
  if (elapsedSec < 9) {
    const rem = 9 - elapsedSec;
    return {
      phase: 'BETTING_WINDOW',
      label: `Apostas: ${rem}s`,
      countdownSec: rem,
      detail: `Resultado saiu · dados giram em ${rem}s`,
    };
  }
  if (elapsedSec < 21) {
    const rem = 21 - elapsedSec;
    return {
      phase: 'ROLLING',
      label: `Dados a girar: ~${rem}s`,
      countdownSec: rem,
      detail: `Dados a girar (~10–12s) · resultado em ~${rem}s`,
    };
  }
  return {
    phase: 'WAITING_RESULT',
    label: 'A ler resultado...',
    countdownSec: 0,
    detail: 'Aguardando confirmação do próximo resultado na grelha',
  };
}
