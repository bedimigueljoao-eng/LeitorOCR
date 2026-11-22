import { BacBoOutcome, BacBoRoundRecord } from './types';

const LS_KEY_ROUNDS = 'roletavision_bacbo_rounds_v1';
const LS_KEY_META = 'roletavision_bacbo_meta_v1';
const IDB_NAME = 'RoletaVisionBacBoDB';
const IDB_VERSION = 1;
const IDB_STORE = 'rounds';

export interface BacBoDatabaseBackup {
  version: 1;
  exportedAt: string;
  rounds: BacBoRoundRecord[];
}

function isValidRecord(item: unknown): item is BacBoRoundRecord {
  if (!item || typeof item !== 'object') return false;
  const r = item as Record<string, unknown>;
  const validOutcome = r.outcome === 'P' || r.outcome === 'B' || r.outcome === 'T';
  return (
    typeof r.id === 'string' &&
    typeof r.roundNumber === 'number' &&
    typeof r.timestamp === 'string' &&
    validOutcome
  );
}

function openIndexedDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      resolve(null);
      return;
    }
    try {
      const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function syncRoundsToIndexedDb(rounds: BacBoRoundRecord[]): Promise<void> {
  const db = await openIndexedDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.clear();
      for (const r of rounds) {
        store.put(r);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function loadRoundsFromIndexedDb(): Promise<BacBoRoundRecord[] | null> {
  const db = await openIndexedDb();
  if (!db) return null;
  try {
    return await new Promise<BacBoRoundRecord[] | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const res = Array.isArray(req.result) ? req.result.filter(isValidRecord) : [];
        res.sort((a, b) => a.roundNumber - b.roundNumber);
        resolve(res);
      };
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export function loadRoundsSync(): BacBoRoundRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY_ROUNDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord).sort((a, b) => a.roundNumber - b.roundNumber);
  } catch {
    return [];
  }
}

export function saveRounds(rounds: BacBoRoundRecord[]): void {
  const ordered = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  try {
    localStorage.setItem(LS_KEY_ROUNDS, JSON.stringify(ordered));
    localStorage.setItem(
      LS_KEY_META,
      JSON.stringify({ updatedAt: new Date().toISOString(), count: ordered.length })
    );
  } catch {
    // Caso o localStorage atinja limite, mantem as 2500 rodadas mais recentes no espelho rapido
    try {
      localStorage.setItem(LS_KEY_ROUNDS, JSON.stringify(ordered.slice(-2500)));
    } catch {
      // ignore
    }
  }
  void syncRoundsToIndexedDb(ordered);
}

export function clearAllRounds(): void {
  try {
    localStorage.removeItem(LS_KEY_ROUNDS);
    localStorage.removeItem(LS_KEY_META);
  } catch {
    // ignore
  }
  void syncRoundsToIndexedDb([]);
}

export function createBackupPayload(rounds: BacBoRoundRecord[]): BacBoDatabaseBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    rounds: [...rounds].sort((a, b) => a.roundNumber - b.roundNumber),
  };
}

export function parseBackupPayload(jsonText: string): BacBoRoundRecord[] {
  const parsed = JSON.parse(jsonText);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray(parsed.rounds)
    ? parsed.rounds
    : null;
  if (!list) {
    throw new Error('Formato de cópia de segurança inválido.');
  }
  const valid = list.filter(isValidRecord);
  return valid
    .sort((a: BacBoRoundRecord, b: BacBoRoundRecord) => a.roundNumber - b.roundNumber)
    .map((item: BacBoRoundRecord, idx: number) => ({
      ...item,
      roundNumber: idx + 1,
    }));
}

export function exportRoundsToCsv(rounds: BacBoRoundRecord[]): string {
  const header = [
    'Rodada',
    'DataHora',
    'Resultado',
    'TotalPlayer',
    'TotalBanker',
    'TotalVencedor',
    'DadosPlayer',
    'DadosBanker',
    'SugestaoAnterior',
    'Acerto',
    'Origem',
  ].join(',');

  const rows = rounds.map((r) => {
    const sug = r.predictionBefore?.suggestion ?? 'NONE';
    const hit =
      sug === 'NONE' ? 'N/A' : sug === r.outcome ? 'ACERTO' : 'ERRO';
    const pDice = r.playerDice ? `${r.playerDice[0]}+${r.playerDice[1]}` : '';
    const bDice = r.bankerDice ? `${r.bankerDice[0]}+${r.bankerDice[1]}` : '';
    return [
      r.roundNumber,
      r.timestamp,
      r.outcome,
      r.playerTotal ?? '',
      r.bankerTotal ?? '',
      r.winningTotal ?? '',
      pDice,
      bDice,
      sug,
      hit,
      r.source,
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

export function filterRounds(
  rounds: BacBoRoundRecord[],
  options: {
    dateFrom?: string;
    dateTo?: string;
    outcomeFilter?: BacBoOutcome | 'ALL';
    patternQuery?: string;
  }
): BacBoRoundRecord[] {
  const q = (options.patternQuery ?? '').trim().toUpperCase();
  const fromMs = options.dateFrom ? Date.parse(options.dateFrom) : NaN;
  const toMs = options.dateTo ? Date.parse(`${options.dateTo}T23:59:59.999Z`) : NaN;

  let filtered = rounds.filter((r) => {
    if (options.outcomeFilter && options.outcomeFilter !== 'ALL' && r.outcome !== options.outcomeFilter) {
      return false;
    }
    const ts = Date.parse(r.timestamp);
    if (!Number.isNaN(fromMs) && !Number.isNaN(ts) && ts < fromMs) return false;
    if (!Number.isNaN(toMs) && !Number.isNaN(ts) && ts > toMs) return false;
    return true;
  });

  if (q.length > 0) {
    // Pesquisa por sequência ex: "B-P-B" ou "BBP" ou "TOTAL 12"
    const normalizedSeq = q.replace(/[^PBT]/g, '');
    if (normalizedSeq.length >= 2 && /^[PBT-]+$/.test(q.replace(/\s+/g, ''))) {
      const seqStr = rounds.map((r) => r.outcome).join('');
      const matchedIds = new Set<string>();
      let idx = seqStr.indexOf(normalizedSeq);
      while (idx !== -1) {
        for (let k = idx; k < idx + normalizedSeq.length; k++) {
          if (rounds[k]) matchedIds.add(rounds[k].id);
        }
        idx = seqStr.indexOf(normalizedSeq, idx + 1);
      }
      filtered = filtered.filter((r) => matchedIds.has(r.id));
    } else {
      filtered = filtered.filter((r) => {
        const patterns = r.predictionBefore?.detectedPatterns.join(' ').toUpperCase() ?? '';
        const totalStr = r.winningTotal !== null ? `TOTAL ${r.winningTotal}` : '';
        return (
          patterns.includes(q) ||
          totalStr.includes(q) ||
          r.outcome.includes(q)
        );
      });
    }
  }

  return filtered;
}
