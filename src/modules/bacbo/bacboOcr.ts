import { BacBoCellEvent } from '../../plugins/browserScanner';
import { validateAndBuildBacBoRound } from './bacboResultProcessor';
import { BacBoOutcome, BacBoPredictionSnapshot, BacBoRoundRecord } from './types';

export interface BacBoOcrIntakeResult {
  newRecords: BacBoRoundRecord[];
  ignoredCount: number;
  lastDetectedSummary: string;
}

/**
 * Converte eventos do leitor nativo Android (mais recente no índice 0)
 * para novos registros cronológicos validados, evitando qualquer duplicação.
 */
export function processNativeBacBoDetection(
  itemsNewestFirst: BacBoCellEvent[],
  isFullPlate: boolean,
  existingRounds: BacBoRoundRecord[],
  currentPrediction?: BacBoPredictionSnapshot | null
): BacBoOcrIntakeResult {
  if (!itemsNewestFirst || itemsNewestFirst.length === 0) {
    return { newRecords: [], ignoredCount: 0, lastDetectedSummary: 'Sem leitura' };
  }

  // Inverte para cronológico: oldest -> newest
  const chronological = [...itemsNewestFirst].reverse();
  const sig = (o: BacBoOutcome, t: number | null) => `${o}:${t ?? -1}`;

  let toInsert = chronological;

  if (isFullPlate && existingRounds.length > 0) {
    // Tenta alinhar o fim do histórico atual com o início/meio da leitura da grelha completa
    const tail = existingRounds.slice(-Math.min(6, existingRounds.length));
    const tailSigs = tail.map((r) => sig(r.outcome, r.winningTotal));
    const incomingSigs = chronological.map((c) => sig(c.outcome, c.total > 0 ? c.total : null));

    let matchedEndIdx = -1;
    for (let endIdx = incomingSigs.length; endIdx >= tailSigs.length; endIdx--) {
      let ok = true;
      for (let k = 0; k < tailSigs.length; k++) {
        if (incomingSigs[endIdx - tailSigs.length + k] !== tailSigs[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matchedEndIdx = endIdx;
        break;
      }
    }

    if (matchedEndIdx >= 0) {
      toInsert = chronological.slice(matchedEndIdx);
    } else if (existingRounds.length >= 4) {
      // Se já havia histórico guardado e a leitura inteira difere (nova mesa/sessão), anexa apenas se diferente
      const last = existingRounds[existingRounds.length - 1];
      const newest = itemsNewestFirst[0];
      const newestTotal = newest.total > 0 ? newest.total : null;
      if (last.outcome === newest.outcome && last.winningTotal === newestTotal) {
        toInsert = [];
      }
    }
  }

  const created: BacBoRoundRecord[] = [];
  let ignored = 0;
  const runningRounds = [...existingRounds];
  const isBatch = toInsert.length > 1;
  const baseNow = Date.now();

  for (let idx = 0; idx < toInsert.length; idx++) {
    const item = toInsert[idx];
    const validTotal = item.total >= 2 && item.total <= 12 ? item.total : null;
    const validP =
      typeof item.playerTotal === 'number' && item.playerTotal >= 2 && item.playerTotal <= 12
        ? item.playerTotal
        : null;
    const validB =
      typeof item.bankerTotal === 'number' && item.bankerTotal >= 2 && item.bankerTotal <= 12
        ? item.bankerTotal
        : null;

    // Mantém consistência caso o placar tenha captado transição
    let useP = validP;
    let useB = validB;
    if (useP !== null && useB !== null) {
      const derived = useP > useB ? 'P' : useB > useP ? 'B' : 'T';
      if (derived !== item.outcome) {
        useP = null;
        useB = null;
      }
    } else {
      useP = null;
      useB = null;
    }

    const roundTimestamp = isBatch
      ? new Date(baseNow - (toInsert.length - 1 - idx) * 20000).toISOString()
      : new Date(baseNow).toISOString();

    const res = validateAndBuildBacBoRound(
      {
        outcome: item.outcome,
        playerTotal: useP,
        bankerTotal: useB,
        winningTotal: validTotal,
        source: 'ocr',
        timestamp: roundTimestamp,
        skipDuplicateWindow: isBatch,
      },
      runningRounds,
      !isBatch ? currentPrediction : null
    );
    if (res.valid && res.record) {
      created.push(res.record);
      runningRounds.push(res.record);
    } else {
      ignored++;
    }
  }

  const head = itemsNewestFirst[0];
  const scorePart =
    typeof head.playerTotal === 'number' &&
    head.playerTotal >= 2 &&
    typeof head.bankerTotal === 'number' &&
    head.bankerTotal >= 2
      ? ` ${head.playerTotal}×${head.bankerTotal}`
      : head.total >= 2 && head.total <= 12
      ? ` (${head.total})`
      : '';
  const summary = `${head.outcome === 'P' ? 'Player' : head.outcome === 'B' ? 'Banker' : 'Tie'}${scorePart}`;

  return {
    newRecords: created,
    ignoredCount: ignored,
    lastDetectedSummary: summary,
  };
}

/**
 * Scanner de imagem local (upload/cola de captura Bac Bo no navegador)
 * Suporta a grelha Bead Plate de 6 linhas (ordem cronológica: coluna esquerda->direita, topo->base).
 */
export async function scanBacBoScreenshotImage(
  file: File,
  roiTopPct: number,
  roiHeightPct: number
): Promise<{ outcomes: BacBoOutcome[]; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { outcomes: [], width: bitmap.width, height: bitmap.height };
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const topY = Math.max(0, Math.floor(canvas.height * (roiTopPct / 100)));
  const cropH = Math.max(24, Math.min(canvas.height - topY, Math.floor(canvas.height * (roiHeightPct / 100))));
  const imgData = ctx.getImageData(0, topY, canvas.width, cropH);
  const { data, width, height } = imgData;

  const classifyPixel = (r: number, g: number, b: number): BacBoOutcome | null => {
    if (r > 182 && g > 182 && b > 182) return null;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (maxC < 45 || maxC - minC < 26) return null;
    // Tie dourado verificado ANTES de Red
    if ((g > b + 32 && g > 90 && r > 115 && r - g < 88) || (g > r + 15 && g > b + 15)) {
      return 'T';
    }
    if (b > r + 24 && b >= g - 12 && b > 80) return 'P';
    if (r > b + 30 && r > g + 40 && r > 90 && g < b + 45) return 'B';
    return null;
  };

  // Analisa perfil horizontal para localizar colunas da grelha
  const stepX = Math.max(2, Math.floor(width / 300));
  const stepY = Math.max(2, Math.floor(height / 140));
  const colDensity: { x: number; hits: number }[] = [];

  for (let x = 0; x < width; x += stepX) {
    let hits = 0;
    for (let y = 0; y < height; y += stepY) {
      const idx = (y * width + x) * 4;
      if (classifyPixel(data[idx], data[idx + 1], data[idx + 2])) hits++;
    }
    colDensity.push({ x, hits });
  }

  const colBands: { xStart: number; xEnd: number }[] = [];
  let inBand = false;
  let bandStart = 0;
  for (const c of colDensity) {
    if (c.hits >= 2) {
      if (!inBand) {
        inBand = true;
        bandStart = c.x;
      }
    } else if (inBand) {
      if (c.x - bandStart >= stepX * 2) {
        colBands.push({ xStart: bandStart, xEnd: c.x });
      }
      inBand = false;
    }
  }
  if (inBand && width - bandStart >= stepX * 2) {
    colBands.push({ xStart: bandStart, xEnd: width });
  }

  // Se houver múltiplas bandas horizontais (colunas do Bead Plate), divide em 6 linhas por coluna
  const outcomes: BacBoOutcome[] = [];
  const rows = height >= 60 ? 6 : 1;
  const rowH = height / rows;

  for (const band of colBands) {
    for (let r = 0; r < rows; r++) {
      const y0 = Math.floor(r * rowH + rowH * 0.15);
      const y1 = Math.floor((r + 1) * rowH - rowH * 0.15);
      let votesP = 0;
      let votesB = 0;
      let votesT = 0;
      let totalSamples = 0;

      for (let x = band.xStart; x < band.xEnd; x += stepX) {
        for (let y = y0; y <= y1; y += stepY) {
          totalSamples++;
          const idx = (y * width + x) * 4;
          const out = classifyPixel(data[idx], data[idx + 1], data[idx + 2]);
          if (out === 'P') votesP++;
          else if (out === 'B') votesB++;
          else if (out === 'T') votesT++;
        }
      }

      const best = Math.max(votesP, votesB, votesT);
      if (totalSamples >= 4 && best >= Math.max(3, Math.floor(totalSamples * 0.18))) {
        if (votesP === best) outcomes.push('P');
        else if (votesT === best) outcomes.push('T');
        else outcomes.push('B');
      }
    }
  }

  return { outcomes, width: canvas.width, height: canvas.height };
}
