import {
  AviatorAutoBetConfig,
  AviatorBankrollConfig,
  AviatorBankrollState,
  AviatorCashOutConfig,
  AviatorCategory,
  AviatorLearningSnapshot,
  AviatorRoundRecord,
  AviatorStrategyId,
  LearningWindowKey,
} from './types';

const DB_NAME = 'aviator_intelligence_db';
const DB_VERSION = 1;
const STORE_ROUNDS = 'aviator_rounds';

const KEY_ROUNDS = 'aviator_rounds_v1';
const KEY_BANKROLL_CFG = 'aviator_bankroll_cfg_v1';
const KEY_BANKROLL_STATE = 'aviator_bankroll_state_v1';
const KEY_AUTOBET_CFG = 'aviator_autobet_cfg_v1';
const KEY_CASHOUT_CFG = 'aviator_cashout_cfg_v1';
const KEY_LEARNING_SNAPSHOTS = 'aviator_learning_snapshots_v1';
const KEY_LEARNING_WINDOW = 'aviator_learning_window_v1';

const MAX_ROUNDS_LOCAL = 3000;

function openAviatorDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ROUNDS)) {
          db.createObjectStore(STORE_ROUNDS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function loadAviatorRoundsSync(): AviatorRoundRecord[] {
  try {
    const raw = localStorage.getItem(KEY_ROUNDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadAviatorRoundsFromIndexedDb(): Promise<AviatorRoundRecord[]> {
  const db = await openAviatorDb();
  if (!db) return loadAviatorRoundsSync();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_ROUNDS, 'readonly');
      const store = tx.objectStore(STORE_ROUNDS);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? (req.result as AviatorRoundRecord[]) : [];
        list.sort((a, b) => a.roundNumber - b.roundNumber || a.timestamp - b.timestamp);
        resolve(list);
      };
      req.onerror = () => resolve(loadAviatorRoundsSync());
    } catch {
      resolve(loadAviatorRoundsSync());
    }
  });
}

export async function saveAviatorRounds(rounds: AviatorRoundRecord[]): Promise<void> {
  const trimmed = rounds.slice(-MAX_ROUNDS_LOCAL);
  try {
    localStorage.setItem(KEY_ROUNDS, JSON.stringify(trimmed));
  } catch {
    // ignore storage quota errors
  }

  const db = await openAviatorDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_ROUNDS, 'readwrite');
      const store = tx.objectStore(STORE_ROUNDS);
      store.clear();
      for (const r of trimmed) {
        store.put(r);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAllAviatorRounds(): Promise<void> {
  try {
    localStorage.removeItem(KEY_ROUNDS);
  } catch {
    // ignore
  }
  const db = await openAviatorDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_ROUNDS, 'readwrite');
      tx.objectStore(STORE_ROUNDS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function filterAviatorRounds(
  rounds: AviatorRoundRecord[],
  filters: {
    dateFrom?: string;
    dateTo?: string;
    category?: AviatorCategory | 'ALL';
    minMultiplier?: number | null;
    maxMultiplier?: number | null;
    strategyQuery?: string;
  }
): AviatorRoundRecord[] {
  return rounds.filter((r) => {
    if (filters.dateFrom && r.dateKey < filters.dateFrom) return false;
    if (filters.dateTo && r.dateKey > filters.dateTo) return false;
    if (filters.category && filters.category !== 'ALL' && r.category !== filters.category) {
      return false;
    }
    if (
      filters.minMultiplier !== null &&
      filters.minMultiplier !== undefined &&
      r.multiplier < filters.minMultiplier
    ) {
      return false;
    }
    if (
      filters.maxMultiplier !== null &&
      filters.maxMultiplier !== undefined &&
      r.multiplier > filters.maxMultiplier
    ) {
      return false;
    }
    if (filters.strategyQuery && filters.strategyQuery.trim().length > 0) {
      const q = filters.strategyQuery.trim().toLowerCase();
      const sName = r.predictionBefore?.strategyName?.toLowerCase() ?? '';
      const reason = r.predictionBefore?.reason?.toLowerCase() ?? '';
      if (!sName.includes(q) && !reason.includes(q)) return false;
    }
    return true;
  });
}

export function exportAviatorRoundsToCsv(rounds: AviatorRoundRecord[]): string {
  const header = [
    'Rodada',
    'Data',
    'Hora',
    'Multiplicador',
    'Categoria',
    'Cor',
    'Origem',
    'ConfiancaOCR',
    'EstrategiaAntes',
    'AlvoAntes',
  ].join(',');

  const rows = rounds.map((r) =>
    [
      r.roundNumber,
      r.dateKey,
      r.timeLabel,
      r.multiplier.toFixed(2),
      r.category,
      r.colorTier,
      r.source,
      r.ocrConfidence.toFixed(2),
      `"${(r.predictionBefore?.strategyName ?? '').replace(/"/g, '""')}"`,
      r.predictionBefore?.targetMultiplier?.toFixed(2) ?? '',
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

export function createAviatorBackupPayload(rounds: AviatorRoundRecord[]): string {
  return JSON.stringify(
    {
      app: 'RoletaVision-AviatorIntelligence',
      version: 1,
      exportedAt: new Date().toISOString(),
      totalRounds: rounds.length,
      rounds,
    },
    null,
    2
  );
}

export function parseAviatorBackupPayload(rawJson: string): {
  valid: boolean;
  rounds: AviatorRoundRecord[];
  error?: string;
} {
  try {
    const parsed = JSON.parse(rawJson);
    const list = Array.isArray(parsed) ? parsed : parsed?.rounds;
    if (!Array.isArray(list)) {
      return { valid: false, rounds: [], error: 'Formato de backup inválido.' };
    }
    const clean: AviatorRoundRecord[] = [];
    for (const item of list) {
      if (
        item &&
        typeof item.multiplier === 'number' &&
        Number.isFinite(item.multiplier) &&
        item.multiplier >= 1.0 &&
        item.multiplier <= 100000
      ) {
        clean.push({
          id: String(item.id ?? `av-imp-${clean.length + 1}`),
          roundNumber: Number(item.roundNumber) || clean.length + 1,
          multiplier: Math.round(item.multiplier * 100) / 100,
          category: item.category ?? 'under_1_50',
          colorTier: item.colorTier ?? (item.multiplier >= 10 ? 'pink' : item.multiplier >= 2 ? 'purple' : 'blue'),
          timestamp: Number(item.timestamp) || Date.now(),
          dateKey: String(item.dateKey ?? new Date().toISOString().slice(0, 10)),
          timeLabel: String(item.timeLabel ?? '00:00:00'),
          source: item.source ?? 'import',
          ocrConfidence: typeof item.ocrConfidence === 'number' ? item.ocrConfidence : 1,
          predictionBefore: item.predictionBefore,
        });
      }
    }
    clean.sort((a, b) => a.roundNumber - b.roundNumber || a.timestamp - b.timestamp);
    return { valid: true, rounds: clean };
  } catch (e) {
    return {
      valid: false,
      rounds: [],
      error: e instanceof Error ? e.message : 'Erro ao ler JSON.',
    };
  }
}

// Configurações & estados persistentes específicos do Aviator
export const DEFAULT_BANKROLL_CONFIG: AviatorBankrollConfig = {
  initialBalanceAoa: 1000,
  baseStakeAoa: 100,
  sessionMaxLossAoa: 300,
  dailyMaxLossAoa: 500,
  weeklyMaxLossAoa: 1200,
  winTargetAoa: 400,
  pauseAfterConsecutiveLosses: 3,
  strictNoMartingale: true,
};

export function createInitialBankrollState(cfg: AviatorBankrollConfig): AviatorBankrollState {
  return {
    currentBalanceAoa: cfg.initialBalanceAoa,
    totalStakedAoa: 0,
    totalRecoveredAoa: 0,
    netPnlAoa: 0,
    maxConsecutiveLosses: 0,
    currentConsecutiveLosses: 0,
    totalOperations: 0,
    wins: 0,
    losses: 0,
    sessionStartAt: Date.now(),
    pausedUntilNextSession: false,
  };
}

export const DEFAULT_AUTOBET_CONFIG: AviatorAutoBetConfig = {
  enabled: false,
  mode: 'simulation',
  stakeAoa: 100,
  strategyId: 'conservative_target',
  minConfidencePct: 55,
  maxBetsPerSession: 15,
  activeHourStart: 0,
  activeHourEnd: 23,
  requireManualConfirmation: true,
};

export const DEFAULT_CASHOUT_CONFIG: AviatorCashOutConfig = {
  enabled: false,
  targetMultiplier: 1.5,
  maxAttemptsPerSession: 15,
  alertSoundEnabled: true,
};

export function loadBankrollConfig(): AviatorBankrollConfig {
  try {
    const raw = localStorage.getItem(KEY_BANKROLL_CFG);
    if (!raw) return DEFAULT_BANKROLL_CONFIG;
    return { ...DEFAULT_BANKROLL_CONFIG, ...JSON.parse(raw), strictNoMartingale: true };
  } catch {
    return DEFAULT_BANKROLL_CONFIG;
  }
}

export function saveBankrollConfig(cfg: AviatorBankrollConfig): void {
  try {
    localStorage.setItem(
      KEY_BANKROLL_CFG,
      JSON.stringify({ ...cfg, strictNoMartingale: true })
    );
  } catch {
    // ignore
  }
}

export function loadBankrollState(cfg: AviatorBankrollConfig): AviatorBankrollState {
  try {
    const raw = localStorage.getItem(KEY_BANKROLL_STATE);
    if (!raw) return createInitialBankrollState(cfg);
    return { ...createInitialBankrollState(cfg), ...JSON.parse(raw) };
  } catch {
    return createInitialBankrollState(cfg);
  }
}

export function saveBankrollState(state: AviatorBankrollState): void {
  try {
    localStorage.setItem(KEY_BANKROLL_STATE, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function loadAutoBetConfig(): AviatorAutoBetConfig {
  try {
    const raw = localStorage.getItem(KEY_AUTOBET_CFG);
    if (!raw) return DEFAULT_AUTOBET_CONFIG;
    return { ...DEFAULT_AUTOBET_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AUTOBET_CONFIG;
  }
}

export function saveAutoBetConfig(cfg: AviatorAutoBetConfig): void {
  try {
    localStorage.setItem(KEY_AUTOBET_CFG, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

export function loadCashOutConfig(): AviatorCashOutConfig {
  try {
    const raw = localStorage.getItem(KEY_CASHOUT_CFG);
    if (!raw) return DEFAULT_CASHOUT_CONFIG;
    return { ...DEFAULT_CASHOUT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CASHOUT_CONFIG;
  }
}

export function saveCashOutConfig(cfg: AviatorCashOutConfig): void {
  try {
    localStorage.setItem(KEY_CASHOUT_CFG, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

export function loadLearningSnapshots(): AviatorLearningSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY_LEARNING_SNAPSHOTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLearningSnapshots(list: AviatorLearningSnapshot[]): void {
  try {
    localStorage.setItem(KEY_LEARNING_SNAPSHOTS, JSON.stringify(list.slice(-30)));
  } catch {
    // ignore
  }
}

export function loadSelectedLearningWindow(): LearningWindowKey {
  try {
    const raw = localStorage.getItem(KEY_LEARNING_WINDOW);
    if (raw === '50' || raw === '100' || raw === '500' || raw === '1000' || raw === 'all') {
      return raw;
    }
  } catch {
    // ignore
  }
  return '100';
}

export function saveSelectedLearningWindow(w: LearningWindowKey): void {
  try {
    localStorage.setItem(KEY_LEARNING_WINDOW, w);
  } catch {
    // ignore
  }
}

export type { AviatorStrategyId };
