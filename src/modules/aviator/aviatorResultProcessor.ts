import {
  AviatorCategory,
  AviatorCategoryRuleConfig,
  AviatorColorTier,
  AviatorLiveState,
  AviatorRoundPhase,
  AviatorRoundRecord,
  AviatorSuggestionSnapshot,
  DEFAULT_CATEGORY_CONFIG,
} from './types';

export function roundMultiplier2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function isValidAviatorMultiplier(val: unknown): val is number {
  return (
    typeof val === 'number' &&
    Number.isFinite(val) &&
    val >= 1.0 &&
    val <= 100000
  );
}

export function classifyAviatorColorTier(multiplier: number): AviatorColorTier {
  if (multiplier >= 10.0) return 'pink';
  if (multiplier >= 2.0) return 'purple';
  return 'blue';
}

export function classifyAviatorCategory(
  multiplier: number,
  cfg: AviatorCategoryRuleConfig = DEFAULT_CATEGORY_CONFIG
): AviatorCategory {
  if (multiplier < cfg.lowCeiling) return 'under_1_50';
  if (multiplier < cfg.midLowCeiling) return '1_50_to_2_00';
  if (multiplier < cfg.midCeiling) return '2_00_to_3_00';
  if (multiplier < cfg.highCeiling) return '3_00_to_5_00';
  if (multiplier < cfg.megaThreshold) return '5_00_to_10_00';
  return 'over_10_00';
}

export function formatCategoryLabel(cat: AviatorCategory): string {
  switch (cat) {
    case 'under_1_50':
      return '< 1.50x';
    case '1_50_to_2_00':
      return '1.50x – 2.00x';
    case '2_00_to_3_00':
      return '2.00x – 3.00x';
    case '3_00_to_5_00':
      return '3.00x – 5.00x';
    case '5_00_to_10_00':
      return '> 5.00x (5–10x)';
    case 'over_10_00':
      return '> 10.00x';
  }
}

export function buildAviatorRoundRecord(params: {
  multiplier: number;
  existingRounds: AviatorRoundRecord[];
  source: AviatorRoundRecord['source'];
  ocrConfidence?: number;
  predictionBefore?: AviatorSuggestionSnapshot;
  categoryConfig?: AviatorCategoryRuleConfig;
  timestamp?: number;
}): { valid: boolean; reason?: string; record?: AviatorRoundRecord } {
  const mult = roundMultiplier2(params.multiplier);
  if (!isValidAviatorMultiplier(mult)) {
    return {
      valid: false,
      reason: 'Multiplicador inválido. Deve estar entre 1.00x e 100000.00x.',
    };
  }

  const conf = params.ocrConfidence ?? 1;
  if (params.source !== 'manual' && params.source !== 'import' && conf < 0.45) {
    return {
      valid: false,
      reason: 'Leitura OCR ignorada por baixa confiança (<45%).',
    };
  }

  const ts = params.timestamp ?? Date.now();
  const dt = new Date(ts);
  const dateKey = dt.toISOString().slice(0, 10);
  const timeLabel = dt.toLocaleTimeString('pt-PT', { hour12: false });
  const lastNum =
    params.existingRounds.length > 0
      ? params.existingRounds[params.existingRounds.length - 1].roundNumber
      : 0;

  const record: AviatorRoundRecord = {
    id: `av-${ts}-${lastNum + 1}-${Math.random().toString(36).slice(2, 6)}`,
    roundNumber: lastNum + 1,
    multiplier: mult,
    category: classifyAviatorCategory(mult, params.categoryConfig),
    colorTier: classifyAviatorColorTier(mult),
    timestamp: ts,
    dateKey,
    timeLabel,
    source: params.source,
    ocrConfidence: Math.max(0, Math.min(1, conf)),
    predictionBefore: params.predictionBefore,
  };

  return { valid: true, record };
}

export interface LiveCrashTransitionResult {
  nextPhase: AviatorRoundPhase;
  confirmedCrashMultiplier: number | null;
  nextState: AviatorLiveState;
}

/**
 * Máquina de estados para leitura contínua do multiplicador ao vivo no Aviator:
 * - Evita guardar multiplicadores parciais enquanto o avião ainda sobe (texto branco).
 * - Só confirma crash quando deteta cor vermelha / bandeira "VOOU!"/"FLEW AWAY!" ou entrada na faixa do histórico.
 * - Impede duplicação se o mesmo valor em crash ficar visível na tela por vários segundos.
 */
export function processLiveMultiplierTransition(params: {
  prevState: AviatorLiveState;
  liveMultiplier: number | null;
  isCrashedColor: boolean;
  ocrConfidence: number;
  historyVisibleCount: number;
  captureMode: AviatorLiveState['captureMode'];
  now?: number;
  lastRecordedMultiplier?: number | null;
  lastRecordedTimestamp?: number | null;
}): LiveCrashTransitionResult {
  const now = params.now ?? Date.now();
  const { prevState, liveMultiplier, isCrashedColor, ocrConfidence } = params;

  if (liveMultiplier === null || !isValidAviatorMultiplier(liveMultiplier) || ocrConfidence < 0.45) {
    const nextPhase: AviatorRoundPhase =
      prevState.phase === 'FLYING' && prevState.lastUpdatedAt && now - prevState.lastUpdatedAt < 2500
        ? 'FLYING'
        : 'WAITING';
    return {
      nextPhase,
      confirmedCrashMultiplier: null,
      nextState: {
        ...prevState,
        phase: nextPhase,
        currentMultiplier: nextPhase === 'WAITING' ? null : prevState.currentMultiplier,
        isCrashedColor: false,
        ocrConfidence,
        historyVisibleCount: params.historyVisibleCount,
        captureMode: params.captureMode,
        lastUpdatedAt: now,
      },
    };
  }

  const cleanMult = roundMultiplier2(liveMultiplier);

  if (isCrashedColor) {
    const recentlyRecordedSame =
      params.lastRecordedMultiplier !== undefined &&
      params.lastRecordedMultiplier !== null &&
      Math.abs(params.lastRecordedMultiplier - cleanMult) < 0.005 &&
      params.lastRecordedTimestamp !== undefined &&
      params.lastRecordedTimestamp !== null &&
      now - params.lastRecordedTimestamp < 9000;

    const alreadyLockedSameCrash =
      prevState.phase === 'CRASHED' &&
      prevState.lastCrashMultiplier !== null &&
      Math.abs(prevState.lastCrashMultiplier - cleanMult) < 0.005;

    const confirmedCrashMultiplier =
      alreadyLockedSameCrash || recentlyRecordedSame ? null : cleanMult;

    return {
      nextPhase: 'CRASHED',
      confirmedCrashMultiplier,
      nextState: {
        ...prevState,
        phase: 'CRASHED',
        currentMultiplier: cleanMult,
        lastCrashMultiplier: cleanMult,
        isCrashedColor: true,
        lastUpdatedAt: now,
        ocrConfidence,
        historyVisibleCount: params.historyVisibleCount,
        captureMode: params.captureMode,
      },
    };
  }

  // Texto branco em subida (FLYING)
  const startedNewFlight =
    prevState.phase !== 'FLYING' ||
    (prevState.currentMultiplier !== null && cleanMult < prevState.currentMultiplier - 0.15);

  return {
    nextPhase: 'FLYING',
    confirmedCrashMultiplier: null,
    nextState: {
      ...prevState,
      phase: 'FLYING',
      currentMultiplier: cleanMult,
      isCrashedColor: false,
      roundStartedAt: startedNewFlight ? now : prevState.roundStartedAt ?? now,
      lastUpdatedAt: now,
      ocrConfidence,
      historyVisibleCount: params.historyVisibleCount,
      captureMode: params.captureMode,
    },
  };
}

/**
 * Reconcilia faixa superior do histórico Aviator (ex: [1.38, 1.10, 1.60, 1.27, ...], mais recente à esquerda)
 * evitando duplicações e garantindo ordem cronológica (mais antigo -> mais novo).
 */
export function reconcileAviatorStrip(params: {
  incomingNewestFirst: number[];
  isFullStrip: boolean;
  existingRounds: AviatorRoundRecord[];
  source: AviatorRoundRecord['source'];
  ocrConfidence: number;
  activePrediction?: AviatorSuggestionSnapshot;
  categoryConfig?: AviatorCategoryRuleConfig;
}): AviatorRoundRecord[] {
  const validIncoming = params.incomingNewestFirst
    .filter((v) => isValidAviatorMultiplier(v))
    .map((v) => roundMultiplier2(v));

  if (validIncoming.length === 0) return [];

  const existing = params.existingRounds;
  let newMultipliersNewestFirst: number[] = [];

  if (!params.isFullStrip) {
    // Evento incremental de 1 ou poucos crashes novos
    const latestRecorded = existing.length > 0 ? existing[existing.length - 1] : null;
    if (
      latestRecorded &&
      validIncoming.length === 1 &&
      Math.abs(latestRecorded.multiplier - validIncoming[0]) < 0.005 &&
      Date.now() - latestRecorded.timestamp < 7000
    ) {
      return [];
    }
    newMultipliersNewestFirst = validIncoming;
  } else if (existing.length === 0) {
    newMultipliersNewestFirst = validIncoming;
  } else {
    // Alinha janela mais recente já gravada contra a faixa lida (newestFirst)
    const existingNewestFirst = [...existing]
      .slice(-Math.min(12, existing.length))
      .reverse()
      .map((r) => r.multiplier);

    let matchedShift = -1;
    for (let shift = 0; shift <= Math.min(8, validIncoming.length - 1); shift++) {
      const checkLen = Math.min(4, validIncoming.length - shift, existingNewestFirst.length);
      if (checkLen < 2 && existingNewestFirst.length >= 2) continue;
      let matches = 0;
      for (let i = 0; i < checkLen; i++) {
        if (Math.abs(validIncoming[shift + i] - existingNewestFirst[i]) < 0.005) {
          matches++;
        }
      }
      if (
        (checkLen >= 3 && matches >= checkLen - 1) ||
        (checkLen === 2 && matches === 2) ||
        (checkLen === 1 && matches === 1)
      ) {
        matchedShift = shift;
        break;
      }
    }

    if (matchedShift === 0) {
      return [];
    }
    if (matchedShift > 0) {
      newMultipliersNewestFirst = validIncoming.slice(0, matchedShift);
    } else {
      // Faixa totalmente diferente (abriu nova sessão ou scrollou muito): evita inundar com falsos positivos repetidos
      newMultipliersNewestFirst = validIncoming;
    }
  }

  if (newMultipliersNewestFirst.length === 0) return [];

  // Converte para cronológico (mais antigo primeiro)
  const chronological = [...newMultipliersNewestFirst].reverse();
  const created: AviatorRoundRecord[] = [];
  let rollingList = [...existing];
  const baseTs = Date.now();

  chronological.forEach((mult, idx) => {
    const built = buildAviatorRoundRecord({
      multiplier: mult,
      existingRounds: rollingList,
      source: params.source,
      ocrConfidence: params.ocrConfidence,
      predictionBefore: idx === chronological.length - 1 ? params.activePrediction : undefined,
      categoryConfig: params.categoryConfig,
      timestamp: baseTs - (chronological.length - 1 - idx) * 1000,
    });
    if (built.valid && built.record) {
      created.push(built.record);
      rollingList = [...rollingList, built.record];
    }
  });

  return created;
}
