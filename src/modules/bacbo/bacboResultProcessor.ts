import {
  BacBoOutcome,
  BacBoPredictionSnapshot,
  BacBoRoundRecord,
} from './types';

export interface RawBacBoInput {
  outcome?: BacBoOutcome | null;
  playerTotal?: number | null;
  bankerTotal?: number | null;
  winningTotal?: number | null;
  playerDice?: [number, number] | null;
  bankerDice?: [number, number] | null;
  source: 'ocr' | 'manual' | 'import';
  timestamp?: string;
  skipDuplicateWindow?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  record?: BacBoRoundRecord;
}

function isValidDie(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= 6;
}

function isValidTotal(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 2 && v <= 12;
}

export function validateAndBuildBacBoRound(
  raw: RawBacBoInput,
  existingRounds: BacBoRoundRecord[],
  predictionBefore?: BacBoPredictionSnapshot | null
): ValidationResult {
  let pDice = raw.playerDice ?? null;
  let bDice = raw.bankerDice ?? null;
  let pTotal = raw.playerTotal ?? null;
  let bTotal = raw.bankerTotal ?? null;

  if (pDice) {
    if (!isValidDie(pDice[0]) || !isValidDie(pDice[1])) {
      return { valid: false, reason: 'Dados Player inválidos (devem ser 1..6).' };
    }
    const sumP = pDice[0] + pDice[1];
    if (pTotal !== null && pTotal !== sumP) {
      return { valid: false, reason: 'Soma dos dados Player não corresponde ao total.' };
    }
    pTotal = sumP;
  }

  if (bDice) {
    if (!isValidDie(bDice[0]) || !isValidDie(bDice[1])) {
      return { valid: false, reason: 'Dados Banker inválidos (devem ser 1..6).' };
    }
    const sumB = bDice[0] + bDice[1];
    if (bTotal !== null && bTotal !== sumB) {
      return { valid: false, reason: 'Soma dos dados Banker não corresponde ao total.' };
    }
    bTotal = sumB;
  }

  if (pTotal !== null && !isValidTotal(pTotal)) {
    return { valid: false, reason: 'Total Player fora do intervalo válido (2..12).' };
  }
  if (bTotal !== null && !isValidTotal(bTotal)) {
    return { valid: false, reason: 'Total Banker fora do intervalo válido (2..12).' };
  }

  let outcome = raw.outcome ?? null;
  if (pTotal !== null && bTotal !== null) {
    const derived: BacBoOutcome =
      pTotal > bTotal ? 'P' : bTotal > pTotal ? 'B' : 'T';
    if (outcome && outcome !== derived) {
      return {
        valid: false,
        reason: `Inconsistência: totais (${pTotal} vs ${bTotal}) indicam ${derived}, mas recebido ${outcome}.`,
      };
    }
    outcome = derived;
  }

  if (outcome !== 'P' && outcome !== 'B' && outcome !== 'T') {
    return { valid: false, reason: 'Resultado incompleto (deve ser P, B ou T).' };
  }

  let winningTotal = raw.winningTotal ?? null;
  if (winningTotal !== null && !isValidTotal(winningTotal)) {
    return { valid: false, reason: 'Total vencedor inválido (deve ser 2..12).' };
  }
  if (winningTotal === null && pTotal !== null && bTotal !== null) {
    winningTotal = outcome === 'P' ? pTotal : outcome === 'B' ? bTotal : pTotal;
  }

  const nextRoundNumber =
    existingRounds.length > 0
      ? existingRounds[existingRounds.length - 1].roundNumber + 1
      : 1;

  const timestamp = raw.timestamp ?? new Date().toISOString();

  // Evita duplicação acidental de leitura OCR ao vivo idêntica dentro de < 1.2s
  if (raw.source === 'ocr' && !raw.skipDuplicateWindow && existingRounds.length > 0) {
    const prev = existingRounds[existingRounds.length - 1];
    const dt = Math.abs(Date.parse(timestamp) - Date.parse(prev.timestamp));
    if (
      !Number.isNaN(dt) &&
      dt < 1200 &&
      prev.outcome === outcome &&
      prev.winningTotal === winningTotal &&
      prev.playerTotal === pTotal &&
      prev.bankerTotal === bTotal
    ) {
      return { valid: false, reason: 'Leitura OCR duplicada ignorada.' };
    }
  }

  const record: BacBoRoundRecord = {
    id: `bb_${nextRoundNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roundNumber: nextRoundNumber,
    timestamp,
    outcome,
    playerTotal: pTotal,
    bankerTotal: bTotal,
    winningTotal,
    playerDice: pDice,
    bankerDice: bDice,
    source: raw.source,
    predictionBefore: predictionBefore ?? null,
  };

  return { valid: true, record };
}
