import { BacBoCellEvent } from '../../plugins/browserScanner';
import { validateAndBuildBacBoRound } from './bacboResultProcessor';
import { BacBoOutcome, BacBoPredictionSnapshot, BacBoRoundRecord } from './types';

export interface BacBoOcrIntakeResult {
  newRecords: BacBoRoundRecord[];
  ignoredCount: number;
  lastDetectedSummary: string;
}

export interface BacBoScannedCell {
  outcome: BacBoOutcome;
  total: number | null;
  row: number;
  col: number;
}

export interface BacBoScreenshotScanResult {
  cells: BacBoScannedCell[];
  outcomes: BacBoOutcome[];
  width: number;
  height: number;
  engine: 'ai-vision' | 'hsv-grid';
  notes?: string;
}

export interface BacBoBatchParseResult {
  items: { outcome: BacBoOutcome; total: number | null }[];
  invalidTokens: string[];
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
        const inc = incomingSigs[endIdx - tailSigs.length + k];
        const prevSig = tailSigs[k];
        if (inc !== prevSig) {
          const [incOut, incTot] = inc.split(':');
          const [prevOut, prevTot] = prevSig.split(':');
          if (!(incOut === prevOut && (incTot === '-1' || prevTot === '-1'))) {
            ok = false;
            break;
          }
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
      const last = existingRounds[existingRounds.length - 1];
      const newest = itemsNewestFirst[0];
      const newestTotal = newest.total > 0 ? newest.total : null;
      if (
        last.outcome === newest.outcome &&
        (last.winningTotal === newestTotal || last.winningTotal === null || newestTotal === null)
      ) {
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
 * Converte RGB (0..255) para HSV (H: 0..360, S: 0..1, V: 0..1).
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const maxC = Math.max(rf, gf, bf);
  const minC = Math.min(rf, gf, bf);
  const delta = maxC - minC;

  let h = 0;
  if (delta > 0.0001) {
    if (maxC === rf) {
      h = 60 * (((gf - bf) / delta) % 6);
    } else if (maxC === gf) {
      h = 60 * ((bf - rf) / delta + 2);
    } else {
      h = 60 * ((rf - gf) / delta + 4);
    }
    if (h < 0) h += 360;
  }

  const s = maxC > 0 ? delta / maxC : 0;
  return [h, s, maxC];
}

/**
 * Classifica um pixel de círculo Bac Bo (P = Azul, B = Vermelho, T = Dourado/Mostarda/Verde)
 * filtrando tinta branca de dígitos, fundo branco/cinza da grelha e feltro castanho escuro.
 */
export function classifyBacBoPixelHsv(r: number, g: number, b: number): BacBoOutcome | null {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (s < 0.16 || v < 0.16) return null;
  if (s < 0.22 && v > 0.65) return null;

  // Player (Azul vivo ou esmaecido na vinheta esquerda)
  if (h >= 186 && h <= 255 && s >= 0.17 && v >= 0.22) {
    return 'P';
  }
  // Banker (Vermelho vivo ou levemente esmaecido à esquerda — separado do castanho/dourado)
  if ((h <= 20 || h >= 330) && s >= 0.24 && v >= 0.22) {
    return 'B';
  }
  // Tie (Dourado/Mostarda brilhante da grelha ou Verde — exclui castanho escuro <= 0.59 val)
  if ((h >= 24 && h <= 62 && s >= 0.40 && v >= 0.60) || (h >= 82 && h <= 165 && s >= 0.26)) {
    return 'T';
  }
  return null;
}

function isWhiteGridBackgroundPixel(r: number, g: number, b: number): boolean {
  const [, s, v] = rgbToHsv(r, g, b);
  return s <= 0.22 && v >= 0.72;
}

/**
 * Detetor determinístico offline da grelha Bead Plate (6 linhas) sobre buffer RGBA.
 * 1) Isola âncoras Azuis (P) e Vermelhas (B) para eliminar bordas externas castanhas/douradas
 * 2) Segmenta colunas preenchidas e até 6 linhas da grelha
 * 3) Valida contexto de grelha branca para colunas puramente Tie
 * 4) Retorna células em ordem cronológica (coluna esq->dir, linha topo->base).
 */
export function scanBacBoBeadPlateCanvasData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): BacBoScannedCell[] {
  if (width < 48 || height < 24) return [];

  const step = Math.max(1, Math.floor(Math.min(width, height) / 90));
  let anchorMinX = width;
  let anchorMaxX = -1;
  let anchorMinY = height;
  let anchorMaxY = -1;
  let anchorCount = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);
      const anyP = h >= 188 && h <= 254 && s >= 0.18 && v >= 0.22;
      const anyB = (h <= 20 || h >= 330) && s >= 0.24 && v >= 0.22;
      if (anyP || anyB) {
        anchorCount++;
        if (x < anchorMinX) anchorMinX = x;
        if (x > anchorMaxX) anchorMaxX = x;
        if (y < anchorMinY) anchorMinY = y;
        if (y > anchorMaxY) anchorMaxY = y;
      }
    }
  }

  let gridTop = 0;
  let gridBottom = height - 1;
  let scanLeft = 0;
  let scanRight = width - 1;

  if (anchorCount >= 10 && anchorMaxY > anchorMinY + 12 && anchorMaxX > anchorMinX + 12) {
    const spanY = anchorMaxY - anchorMinY;
    const padY = Math.max(2, Math.round(spanY * 0.045));
    gridTop = Math.max(0, anchorMinY - padY);
    gridBottom = Math.min(height - 1, anchorMaxY + padY);
    const estRowH = Math.max(8, Math.floor((gridBottom - gridTop) / 6));
    scanLeft = Math.max(0, anchorMinX - Math.round(estRowH * 0.25));
    scanRight = Math.min(width - 1, anchorMaxX + Math.round(estRowH * 1.15));
  }

  const gridH = gridBottom - gridTop + 1;
  const rows = gridH >= 48 ? 6 : 1;
  const rowH = gridH / rows;
  const colStep = Math.max(1, Math.round(rowH / 12));
  const yStep = Math.max(1, Math.round(rowH / 10));

  const xBins = Math.max(1, Math.floor((scanRight - scanLeft) / colStep) + 1);
  const colHits = new Array<number>(xBins).fill(0);
  let yRowsChecked = 0;

  const yStartScan = gridTop + Math.max(1, Math.round(rowH * 0.12));
  const yEndScan = gridBottom - Math.round(rowH * 0.12);
  for (let y = yStartScan; y <= yEndScan; y += yStep) {
    yRowsChecked++;
    for (let bi = 0; bi < xBins; bi++) {
      const x = Math.min(scanRight, scanLeft + bi * colStep);
      const idx = (y * width + x) * 4;
      if (classifyBacBoPixelHsv(data[idx], data[idx + 1], data[idx + 2])) {
        colHits[bi]++;
      }
    }
  }
  if (yRowsChecked < 3) return [];

  const minColBinHits = Math.max(2, Math.floor(yRowsChecked / 7));
  const rawBands: { xStart: number; xEnd: number }[] = [];
  let inBand = false;
  let bandStart = scanLeft;

  for (let bi = 0; bi < xBins; bi++) {
    const x = Math.min(scanRight, scanLeft + bi * colStep);
    if (colHits[bi] >= minColBinHits) {
      if (!inBand) {
        inBand = true;
        bandStart = x;
      }
    } else if (inBand) {
      if (x - bandStart >= Math.max(4, rowH * 0.35)) {
        rawBands.push({ xStart: bandStart, xEnd: x });
      }
      inBand = false;
    }
  }
  if (inBand && scanRight - bandStart >= Math.max(4, rowH * 0.35)) {
    rawBands.push({ xStart: bandStart, xEnd: scanRight });
  }

  const colIntervals: { xStart: number; xEnd: number }[] = [];
  for (const band of rawBands) {
    const bw = band.xEnd - band.xStart;
    // Ignora meia-bola cortada na borda extrema esquerda
    if (band.xStart <= 2 && bw < rowH * 0.45) {
      continue;
    }
    const subCols = bw < rowH * 1.45 ? 1 : Math.max(1, Math.round(bw / Math.max(6, rowH * 0.98)));
    const subW = bw / subCols;
    for (let sc = 0; sc < subCols; sc++) {
      const c0 = Math.round(band.xStart + sc * subW);
      const c1 = Math.round(band.xStart + (sc + 1) * subW);
      if (c1 - c0 >= 4) {
        colIntervals.push({ xStart: c0, xEnd: c1 });
      }
    }
  }

  const cells: BacBoScannedCell[] = [];
  let acceptedColIdx = 0;
  for (const col of colIntervals) {
    const marginX = Math.max(1, Math.floor((col.xEnd - col.xStart) / 6));
    const x0 = Math.max(0, col.xStart + marginX);
    const x1 = Math.min(width - 1, col.xEnd - marginX);
    if (x1 <= x0) continue;

    // Verifica se a faixa da coluna pertence ao cartão branco (evita feltro castanho puro)
    const cxCol = Math.floor((x0 + x1) / 2);
    let whiteBgSamples = 0;
    let colPbCount = 0;
    for (let y = gridTop; y <= gridBottom; y += Math.max(1, Math.floor(rowH / 6))) {
      const idx = (y * width + cxCol) * 4;
      if (isWhiteGridBackgroundPixel(data[idx], data[idx + 1], data[idx + 2])) {
        whiteBgSamples++;
      }
      const out = classifyBacBoPixelHsv(data[idx], data[idx + 1], data[idx + 2]);
      if (out === 'P' || out === 'B') colPbCount++;
    }
    if (colPbCount === 0 && whiteBgSamples < 2) {
      continue;
    }

    const colCells: BacBoScannedCell[] = [];
    for (let r = 0; r < rows; r++) {
      const y0 = Math.max(0, Math.round(gridTop + r * rowH + rowH * 0.16));
      const y1 = Math.min(height - 1, Math.round(gridTop + (r + 1) * rowH - rowH * 0.16));
      if (y1 <= y0) continue;

      let votesP = 0;
      let votesB = 0;
      let votesT = 0;
      let totalSamples = 0;
      const sx = Math.max(1, Math.floor((x1 - x0) / 4));
      const sy = Math.max(1, Math.floor((y1 - y0) / 4));

      for (let y = y0; y <= y1; y += sy) {
        for (let x = x0; x <= x1; x += sx) {
          totalSamples++;
          const idx = (y * width + x) * 4;
          const out = classifyBacBoPixelHsv(data[idx], data[idx + 1], data[idx + 2]);
          if (out === 'P') votesP++;
          else if (out === 'B') votesB++;
          else if (out === 'T') votesT++;
        }
      }

      const best = Math.max(votesP, votesB, votesT);
      if (totalSamples >= 4 && best >= Math.max(3, Math.floor(totalSamples * 0.2))) {
        const outcome: BacBoOutcome =
          votesP === best ? 'P' : votesT === best ? 'T' : 'B';
        colCells.push({
          outcome,
          total: null,
          row: r,
          col: acceptedColIdx,
        });
      }
    }

    if (colCells.length > 0) {
      cells.push(...colCells);
      acceptedColIdx++;
    }
  }

  return cells;
}

async function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Erro ao ler ficheiro.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Scanner de imagem de Bead Plate Bac Bo para pré-carregar mesas ou prints:
 * - Recorte direto da grelha (0..100%) por padrão quando a imagem é um recorte horizontal
 * - Tenta extração completa (cores + números 2..12) via servidor Gemini se disponível,
 *   com fallback imediato para o motor local HSV 2D offline.
 */
export async function scanBacBoScreenshotImage(
  file: File,
  options?: {
    fullImage?: boolean;
    roiTopPct?: number;
    roiHeightPct?: number;
    tryServerVision?: boolean;
  }
): Promise<BacBoScreenshotScanResult> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { cells: [], outcomes: [], width: bitmap.width, height: bitmap.height, engine: 'hsv-grid' };
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const looksLikeCroppedPlate = canvas.width / Math.max(1, canvas.height) >= 2.1;
  const useFullImage = options?.fullImage ?? looksLikeCroppedPlate;

  const topPct = useFullImage ? 0 : (options?.roiTopPct ?? 64);
  const heightPct = useFullImage ? 100 : (options?.roiHeightPct ?? 26);

  const topY = Math.max(0, Math.floor(canvas.height * (topPct / 100)));
  const cropH = Math.max(24, Math.min(canvas.height - topY, Math.floor(canvas.height * (heightPct / 100))));
  const imgData = ctx.getImageData(0, topY, canvas.width, cropH);

  // Primeiro tenta leitura completa com totais (2..12) no backend se disponível (browser/PC)
  const shouldTryServer =
    options?.tryServerVision !== false &&
    typeof window !== 'undefined' &&
    !window.location.protocol.startsWith('capacitor');

  if (shouldTryServer) {
    try {
      let imagePayload: string;
      if (!useFullImage) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = canvas.width;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        if (cropCtx) {
          cropCtx.putImageData(imgData, 0, 0);
          imagePayload = cropCanvas.toDataURL('image/jpeg', 0.92);
        } else {
          imagePayload = await fileToBase64DataUrl(file);
        }
      } else {
        imagePayload = await fileToBase64DataUrl(file);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch('/api/analyze-bacbo-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imagePayload,
          mimeType: file.type || 'image/jpeg',
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const json = (await res.json()) as {
          cellsChronological?: { outcome: BacBoOutcome; total: number | null }[];
          notes?: string;
        };
        if (Array.isArray(json.cellsChronological) && json.cellsChronological.length >= 4) {
          const cells: BacBoScannedCell[] = json.cellsChronological.map((c, idx) => ({
            outcome: c.outcome,
            total: typeof c.total === 'number' && c.total >= 2 && c.total <= 12 ? c.total : null,
            row: idx % 6,
            col: Math.floor(idx / 6),
          }));
          return {
            cells,
            outcomes: cells.map((c) => c.outcome),
            width: canvas.width,
            height: canvas.height,
            engine: 'ai-vision',
            notes: json.notes,
          };
        }
      }
    } catch {
      // Fallback silencioso para o scanner local HSV 2D offline
    }
  }

  const cells = scanBacBoBeadPlateCanvasData(imgData.data, imgData.width, imgData.height);
  return {
    cells,
    outcomes: cells.map((c) => c.outcome),
    width: canvas.width,
    height: canvas.height,
    engine: 'hsv-grid',
  };
}

/**
 * Analisa texto/lote de jogadas anteriores (ex: "P8 B10 T7 P B T9 J7 E6").
 */
export function parseBacBoBatchSequence(rawText: string): BacBoBatchParseResult {
  const items: { outcome: BacBoOutcome; total: number | null }[] = [];
  const invalidTokens: string[] = [];

  if (!rawText || !rawText.trim()) {
    return { items, invalidTokens };
  }

  const tokens = rawText
    .trim()
    .split(/[\s,;|\n\r/]+/)
    .filter(Boolean);

  for (const rawTok of tokens) {
    const upper = rawTok.trim().toUpperCase();
    const match = /^([PBTEJ])[:\-]?(\d{1,2})?$/.exec(upper);
    if (!match) {
      invalidTokens.push(rawTok);
      continue;
    }

    const letter = match[1];
    const outcome: BacBoOutcome =
      letter === 'P' || letter === 'J' ? 'P' : letter === 'B' ? 'B' : 'T';

    let total: number | null = null;
    if (match[2] !== undefined) {
      const parsedNum = Number(match[2]);
      if (!Number.isInteger(parsedNum) || parsedNum < 2 || parsedNum > 12) {
        invalidTokens.push(rawTok);
        continue;
      }
      total = parsedNum;
    }

    items.push({ outcome, total });
  }

  return { items, invalidTokens };
}

/**
 * Converte uma sequência pré-sessão em registros cronológicos prontos para o motor do Bac Bo.
 */
export function buildPreSessionBacBoRounds(
  items: { outcome: BacBoOutcome; total: number | null }[],
  existingRounds: BacBoRoundRecord[],
  mode: 'replace' | 'append'
): BacBoRoundRecord[] {
  const baseRounds = mode === 'replace' ? [] : [...existingRounds];
  const running = [...baseRounds];
  const now = Date.now();
  const spacingMs = 20000;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ts = new Date(now - (items.length - i) * spacingMs).toISOString();
    const res = validateAndBuildBacBoRound(
      {
        outcome: item.outcome,
        winningTotal:
          typeof item.total === 'number' && item.total >= 2 && item.total <= 12 ? item.total : null,
        source: 'import',
        timestamp: ts,
        skipDuplicateWindow: true,
      },
      running,
      null
    );
    if (res.valid && res.record) {
      running.push(res.record);
    }
  }

  return running;
}
