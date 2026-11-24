import { createWorker, Worker } from 'tesseract.js';
import { getAviatorPillColorTier, isValidAviatorValue } from './aviatorEngine';
import { getRouletteColor, isValidRouletteNumber, RouletteColor } from './rouletteEngine';

export interface RoiBox {
  xPct: number; // 0..1
  yPct: number; // 0..1
  wPct: number; // 0.05..1
  hPct: number; // 0.03..1
}

export interface RoiProfile {
  id: string;
  name: string;
  game: 'roulette' | 'aviator';
  roi: RoiBox;
  expectedCells: number;
  newestOnLeft: boolean;
  updatedAt: number;
}

export interface OcrCellDiagnostic {
  index: number;
  rawText: string;
  parsedValue: number | null;
  detectedColor: string;
  expectedColor: string;
  confidencePct: number;
  accepted: boolean;
  rejectReason?: string;
}

export interface OcrFrameResult {
  game: 'roulette' | 'aviator';
  valuesNewestFirst: number[];
  overallConfidencePct: number;
  cells: OcrCellDiagnostic[];
  stabilized: boolean;
  committedValuesNewestFirst: number[];
  committedNewCount: number;
  timestamp: number;
  note: string;
  preprocessedPreviewUrl?: string;
}

const LS_KEY_ROI_PROFILES = 'quantlab_roi_profiles_v1';

export const DEFAULT_ROI_PROFILES: RoiProfile[] = [
  {
    id: 'preset_inferno_roulette',
    name: 'Inferno Roulette (Faixa Direita)',
    game: 'roulette',
    roi: { xPct: 0.73, yPct: 0.65, wPct: 0.25, hPct: 0.065 },
    expectedCells: 10,
    newestOnLeft: true,
    updatedAt: 1,
  },
  {
    id: 'preset_roulette_top',
    name: 'Roleta Padrão (Faixa Topo)',
    game: 'roulette',
    roi: { xPct: 0.08, yPct: 0.03, wPct: 0.84, hPct: 0.08 },
    expectedCells: 12,
    newestOnLeft: true,
    updatedAt: 1,
  },
  {
    id: 'preset_aviator_kwanzabet',
    name: 'Aviator Kwanzabet (Faixa Superior)',
    game: 'aviator',
    roi: { xPct: 0.24, yPct: 0.35, wPct: 0.56, hPct: 0.06 },
    expectedCells: 14,
    newestOnLeft: true,
    updatedAt: 1,
  },
];

export function loadRoiProfiles(): RoiProfile[] {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_ROI_PROFILES;
    const raw = localStorage.getItem(LS_KEY_ROI_PROFILES);
    if (!raw) return DEFAULT_ROI_PROFILES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ROI_PROFILES;
    return parsed;
  } catch {
    return DEFAULT_ROI_PROFILES;
  }
}

export function saveRoiProfiles(profiles: RoiProfile[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY_ROI_PROFILES, JSON.stringify(profiles));
  } catch {
    // ignore storage errors
  }
}

export function classifyRouletteCellRgb(r: number, g: number, b: number): RouletteColor {
  if (g > r + 22 && g > b + 20 && g > 75) return 'green';
  if (r > g + 30 && r > b + 28 && r > 90) return 'red';
  return 'black';
}

export function classifyAviatorCellRgb(
  r: number,
  g: number,
  b: number
): 'blue' | 'purple' | 'pink' | 'unknown' {
  // Aviator Spribe badges/text: azul (#38bdf8), roxo (#913ef8), rosa/magenta (#c017b4/#e879f9)
  if (r > 135 && b > 125 && g < r * 0.72) {
    return r > b + 18 ? 'pink' : 'purple';
  }
  if (b > r + 25 && b > 120) {
    return 'blue';
  }
  if (r > 165 && g > 110 && b < 95) {
    return 'pink'; // dourado / destaque
  }
  return 'unknown';
}

export function validateRouletteCellToken(
  rawText: string,
  detectedColor: RouletteColor,
  confidencePct: number
): { accepted: boolean; value: number | null; expectedColor: string; rejectReason?: string } {
  const cleaned = rawText.trim().replace(/\s+/g, '');
  if (!cleaned) {
    return { accepted: false, value: null, expectedColor: '-', rejectReason: 'Célula vazia' };
  }
  if (/[xX×.]/.test(cleaned)) {
    return {
      accepted: false,
      value: null,
      expectedColor: '-',
      rejectReason: 'Token com "x"/decimal (multiplicador relâmpago ignorado)',
    };
  }
  const digits = cleaned.replace(/[^0-9]/g, '');
  if (!digits || digits.length > 2) {
    return { accepted: false, value: null, expectedColor: '-', rejectReason: `Texto inválido (${cleaned})` };
  }
  const num = Number(digits);
  if (!isValidRouletteNumber(num)) {
    return { accepted: false, value: null, expectedColor: '-', rejectReason: `Fora de 0–36 (${num})` };
  }
  const expectedColor = getRouletteColor(num);
  // Validação cromática estrita: elimina confusão 18 (vermelho) vs 13 (preto), 100x, etc.
  if (expectedColor !== detectedColor) {
    return {
      accepted: false,
      value: null,
      expectedColor,
      rejectReason: `Cor divergente: leu ${num} (${expectedColor}), mas pixel é ${detectedColor}`,
    };
  }
  if (confidencePct < 38) {
    return {
      accepted: false,
      value: null,
      expectedColor,
      rejectReason: `Confiança baixa (${confidencePct.toFixed(0)}%)`,
    };
  }
  return { accepted: true, value: num, expectedColor };
}

export function validateAviatorCellToken(
  rawText: string,
  detectedColor: 'blue' | 'purple' | 'pink' | 'unknown',
  confidencePct: number
): { accepted: boolean; value: number | null; expectedColor: string; rejectReason?: string } {
  const cleaned = rawText.trim().replace(',', '.').replace(/[^0-9.xX]/g, '');
  const match = cleaned.match(/^(\d{1,5}(?:\.\d{1,2})?)[xX]?$/);
  if (!match) {
    return {
      accepted: false,
      value: null,
      expectedColor: '-',
      rejectReason: `Formato não decimal (${rawText.trim() || 'vazio'})`,
    };
  }
  const val = Math.round(Number(match[1]) * 100) / 100;
  if (!isValidAviatorValue(val)) {
    return {
      accepted: false,
      value: null,
      expectedColor: '-',
      rejectReason: `Multiplicador fora de 1.00–10000 (${val})`,
    };
  }

  const expectedColor = getAviatorPillColorTier(val);
  // Verifica contradições cromáticas óbvias (ex.: ponto decimal perdido em célula azul dando > 10x)
  if (detectedColor !== 'unknown') {
    if (detectedColor === 'blue' && val >= 2.0) {
      return {
        accepted: false,
        value: null,
        expectedColor,
        rejectReason: `Cor azul contradiz ${val.toFixed(2)}x (esperado <2.00x)`,
      };
    }
    if (detectedColor === 'pink' && val < 5.0) {
      return {
        accepted: false,
        value: null,
        expectedColor,
        rejectReason: `Cor rosa contradiz ${val.toFixed(2)}x`,
      };
    }
  }
  if (confidencePct < 35) {
    return {
      accepted: false,
      value: null,
      expectedColor,
      rejectReason: `Confiança baixa (${confidencePct.toFixed(0)}%)`,
    };
  }
  return { accepted: true, value: val, expectedColor };
}

/**
 * Reconcilia nova faixa lida (mais recente em index 0) com histórico existente,
 * exigindo deslocamento coerente para não duplicar leituras.
 */
export function reconcileCoherentStrip(
  existingNewestFirst: number[],
  incomingNewestFirst: number[]
): { nextHistory: number[]; newCommitted: number[] } {
  if (incomingNewestFirst.length === 0) {
    return { nextHistory: existingNewestFirst, newCommitted: [] };
  }
  if (existingNewestFirst.length === 0) {
    return {
      nextHistory: incomingNewestFirst.slice(0, 500),
      newCommitted: incomingNewestFirst,
    };
  }

  const anchorLen = Math.min(3, existingNewestFirst.length, incomingNewestFirst.length);
  for (let shift = 0; shift <= Math.min(5, incomingNewestFirst.length - anchorLen); shift++) {
    let aligned = true;
    for (let k = 0; k < anchorLen; k++) {
      if (Math.abs(incomingNewestFirst[shift + k] - existingNewestFirst[k]) > 0.001) {
        aligned = false;
        break;
      }
    }
    if (aligned) {
      if (shift === 0) {
        return { nextHistory: existingNewestFirst, newCommitted: [] };
      }
      const newCommitted = incomingNewestFirst.slice(0, shift);
      return {
        nextHistory: [...newCommitted, ...existingNewestFirst].slice(0, 500),
        newCommitted,
      };
    }
  }

  // Fallback seguro para 1 nova entrada na ponta esquerda caso o histórico seja curto
  if (Math.abs(incomingNewestFirst[0] - existingNewestFirst[0]) > 0.001) {
    return {
      nextHistory: [incomingNewestFirst[0], ...existingNewestFirst].slice(0, 500),
      newCommitted: [incomingNewestFirst[0]],
    };
  }

  return { nextHistory: existingNewestFirst, newCommitted: [] };
}

/**
 * Estabilizador temporal: só confirma um novo conjunto de resultados após 2 leituras consecutivas idênticas.
 */
export class OcrTemporalStabilizer {
  private lastHeadSignature = '';
  private stableCount = 0;

  reset(): void {
    this.lastHeadSignature = '';
    this.stableCount = 0;
  }

  pushAndCheck(valuesNewestFirst: number[]): boolean {
    if (valuesNewestFirst.length === 0) {
      this.stableCount = 0;
      return false;
    }
    const sig = valuesNewestFirst
      .slice(0, 4)
      .map((v) => String(v))
      .join('|');
    if (sig === this.lastHeadSignature) {
      this.stableCount++;
    } else {
      this.lastHeadSignature = sig;
      this.stableCount = 1;
    }
    return this.stableCount >= 2;
  }
}

let sharedWorkerPromise: Promise<Worker> | null = null;

async function getSharedOcrWorker(): Promise<Worker> {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = createWorker('eng');
  }
  return sharedWorkerPromise;
}

function sampleDominantCellColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  game: 'roulette' | 'aviator'
): string {
  const data = ctx.getImageData(
    Math.max(0, Math.floor(x)),
    Math.max(0, Math.floor(y)),
    Math.max(1, Math.floor(w)),
    Math.max(1, Math.floor(h))
  ).data;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let coloredCount = 0;

  let bestChromaR = 0;
  let bestChromaG = 0;
  let bestChromaB = 0;
  let maxChroma = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);

    if (game === 'roulette') {
      // Na roleta o fundo da célula é vermelho/verde/preto (ignorar texto branco puro)
      if (luma < 210) {
        sumR += r;
        sumG += g;
        sumB += b;
        coloredCount++;
      }
    } else {
      // No Aviator as letras do multiplicador têm croma alto sobre fundo escuro
      if (chroma > maxChroma && luma > 45) {
        maxChroma = chroma;
        bestChromaR = r;
        bestChromaG = g;
        bestChromaB = b;
      }
    }
  }

  if (game === 'roulette') {
    if (coloredCount === 0) return 'black';
    return classifyRouletteCellRgb(sumR / coloredCount, sumG / coloredCount, sumB / coloredCount);
  }
  if (maxChroma < 24) return 'unknown';
  return classifyAviatorCellRgb(bestChromaR, bestChromaG, bestChromaB);
}

function preprocessCellCanvas(
  sourceCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  game: 'roulette' | 'aviator'
): HTMLCanvasElement {
  // Para Roleta, foca os 70% superiores da célula para evitar sub-badges relâmpago (50x/250x)
  const effectiveHeight = game === 'roulette' ? Math.max(8, Math.floor(sh * 0.7)) : sh;
  const scale = 2.5;
  const out = document.createElement('canvas');
  out.width = Math.max(24, Math.round(sw * scale) + 16);
  out.height = Math.max(24, Math.round(effectiveHeight * scale) + 16);

  const ctx = out.getContext('2d');
  if (!ctx) return out;

  // Borda branca ajuda muito o Tesseract em células individuais
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    sourceCanvas,
    sx,
    sy,
    sw,
    effectiveHeight,
    8,
    8,
    out.width - 16,
    out.height - 16
  );

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;

  // Encontra min/max luminância apenas na área útil para contraste adaptativo
  let minL = 255;
  let maxL = 0;
  const lumas = new Float32Array(out.width * out.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const px = p % out.width;
    const py = Math.floor(p / out.width);
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lumas[p] = l;
    if (px >= 8 && px < out.width - 8 && py >= 8 && py < out.height - 8) {
      if (l < minL) minL = l;
      if (l > maxL) maxL = l;
    }
  }

  const threshold = minL + (maxL - minL) * 0.54;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const px = p % out.width;
    const py = Math.floor(p / out.width);
    if (px < 8 || px >= out.width - 8 || py < 8 || py >= out.height - 8) {
      d[i] = d[i + 1] = d[i + 2] = 255;
      continue;
    }
    // Texto claro sobre fundo escuro -> inverte para texto preto (#000) em fundo branco (#FFF)
    const isInk = lumas[p] >= threshold;
    const val = isInk ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = val;
    d[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

function segmentRoiIntoCellRects(
  roiCanvas: HTMLCanvasElement,
  expectedCells: number
): Array<{ x: number; y: number; w: number; h: number }> {
  const ctx = roiCanvas.getContext('2d');
  if (!ctx || roiCanvas.width < 20 || roiCanvas.height < 8) return [];

  const w = roiCanvas.width;
  const h = roiCanvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;

  // Projeção vertical de energia para tentar encontrar fronteiras naturais entre células
  const colActivity = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 2; y < h - 2; y++) {
      const idx = (y * w + x) * 4;
      const l = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (l > 45) sum++;
    }
    colActivity[x] = sum / Math.max(1, h - 4);
  }

  const segments: Array<{ x: number; y: number; w: number; h: number }> = [];
  let inSeg = false;
  let segStart = 0;
  for (let x = 0; x < w; x++) {
    const active = colActivity[x] > 0.12;
    if (active && !inSeg) {
      inSeg = true;
      segStart = x;
    } else if (!active && inSeg) {
      inSeg = false;
      if (x - segStart >= 8) {
        segments.push({ x: segStart, y: 0, w: x - segStart, h });
      }
    }
  }
  if (inSeg && w - segStart >= 8) {
    segments.push({ x: segStart, y: 0, w: w - segStart, h });
  }

  // Se segmentação natural encontrar número razoável de células, usa-a; senão, divide uniformemente
  if (segments.length >= 3 && segments.length <= expectedCells + 6) {
    return segments;
  }

  const count = Math.max(4, Math.min(20, expectedCells));
  const cellW = w / count;
  return Array.from({ length: count }, (_, idx) => ({
    x: Math.floor(idx * cellW),
    y: 0,
    w: Math.max(8, Math.floor(cellW)),
    h,
  }));
}

export async function runHighPrecisionRoiOcr(params: {
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  profile: RoiProfile;
  stabilizer: OcrTemporalStabilizer;
  existingHistoryNewestFirst: number[];
}): Promise<OcrFrameResult> {
  const { source, profile, stabilizer, existingHistoryNewestFirst } = params;
  const now = Date.now();

  const srcW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
      ? source.naturalWidth
      : source.width;
  const srcH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
      ? source.naturalHeight
      : source.height;

  if (srcW < 40 || srcH < 40) {
    return {
      game: profile.game,
      valuesNewestFirst: [],
      overallConfidencePct: 0,
      cells: [],
      stabilized: false,
      committedValuesNewestFirst: [],
      committedNewCount: 0,
      timestamp: now,
      note: 'Quadro de vídeo/imagem ainda não disponível.',
    };
  }

  const rx = Math.max(0, Math.floor(profile.roi.xPct * srcW));
  const ry = Math.max(0, Math.floor(profile.roi.yPct * srcH));
  const rw = Math.max(24, Math.min(srcW - rx, Math.floor(profile.roi.wPct * srcW)));
  const rh = Math.max(14, Math.min(srcH - ry, Math.floor(profile.roi.hPct * srcH)));

  const roiCanvas = document.createElement('canvas');
  roiCanvas.width = rw;
  roiCanvas.height = rh;
  const roiCtx = roiCanvas.getContext('2d');
  if (!roiCtx) {
    return {
      game: profile.game,
      valuesNewestFirst: [],
      overallConfidencePct: 0,
      cells: [],
      stabilized: false,
      committedValuesNewestFirst: [],
      committedNewCount: 0,
      timestamp: now,
      note: 'Falha ao inicializar contexto Canvas.',
    };
  }

  roiCtx.drawImage(source, rx, ry, rw, rh, 0, 0, rw, rh);
  const cellRects = segmentRoiIntoCellRects(roiCanvas, profile.expectedCells);

  const worker = await getSharedOcrWorker();
  await worker.setParameters({
    tessedit_char_whitelist: profile.game === 'roulette' ? '0123456789' : '0123456789.xX',
  });

  const diagnostics: OcrCellDiagnostic[] = [];
  const acceptedValues: number[] = [];
  let previewUrl: string | undefined;

  for (let i = 0; i < cellRects.length; i++) {
    const rect = cellRects[i];
    const detectedColor = sampleDominantCellColor(
      roiCtx,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      profile.game
    );
    const cellCanvas = preprocessCellCanvas(
      roiCanvas,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      profile.game
    );
    if (i === 0) previewUrl = cellCanvas.toDataURL('image/png');

    const { data } = await worker.recognize(cellCanvas);
    const rawText = (data.text ?? '').trim();
    const confidencePct = typeof data.confidence === 'number' ? data.confidence : 0;

    if (profile.game === 'roulette') {
      const valRes = validateRouletteCellToken(
        rawText,
        detectedColor as RouletteColor,
        confidencePct
      );
      diagnostics.push({
        index: i,
        rawText,
        parsedValue: valRes.value,
        detectedColor,
        expectedColor: valRes.expectedColor,
        confidencePct,
        accepted: valRes.accepted,
        rejectReason: valRes.rejectReason,
      });
      if (valRes.accepted && valRes.value !== null) {
        acceptedValues.push(valRes.value);
      }
    } else {
      const valRes = validateAviatorCellToken(
        rawText,
        detectedColor as 'blue' | 'purple' | 'pink' | 'unknown',
        confidencePct
      );
      diagnostics.push({
        index: i,
        rawText,
        parsedValue: valRes.value,
        detectedColor,
        expectedColor: valRes.expectedColor,
        confidencePct,
        accepted: valRes.accepted,
        rejectReason: valRes.rejectReason,
      });
      if (valRes.accepted && valRes.value !== null) {
        acceptedValues.push(valRes.value);
      }
    }
  }

  const orderedNewestFirst = profile.newestOnLeft ? acceptedValues : [...acceptedValues].reverse();
  const validCells = diagnostics.filter((c) => c.accepted);
  const overallConfidencePct =
    validCells.length > 0
      ? validCells.reduce((acc, c) => acc + c.confidencePct, 0) / validCells.length
      : 0;

  const stabilized = stabilizer.pushAndCheck(orderedNewestFirst);
  let committedValuesNewestFirst: number[] = [];
  let committedNewCount = 0;

  if (stabilized && orderedNewestFirst.length > 0) {
    const rec = reconcileCoherentStrip(existingHistoryNewestFirst, orderedNewestFirst);
    committedValuesNewestFirst = rec.newCommitted;
    committedNewCount = rec.newCommitted.length;
  }

  const note =
    orderedNewestFirst.length === 0
      ? 'Nenhuma célula validada nesta ROI. Ajuste a caixa sobre a faixa de histórico.'
      : stabilized
      ? committedNewCount > 0
        ? `Confirmado (${committedNewCount} nova(s) rodada(s) estabilizada(s)).`
        : 'Leitura estabilizada (sem novas rodadas desde a última captura).'
      : 'Aguardando 2.ª leitura consecutiva idêntica para confirmar estabilidade...';

  return {
    game: profile.game,
    valuesNewestFirst: orderedNewestFirst,
    overallConfidencePct,
    cells: diagnostics,
    stabilized,
    committedValuesNewestFirst,
    committedNewCount,
    timestamp: now,
    note,
    preprocessedPreviewUrl: previewUrl,
  };
}
