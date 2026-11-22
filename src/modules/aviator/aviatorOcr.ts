import { isValidAviatorMultiplier, roundMultiplier2 } from './aviatorResultProcessor';

export interface ParsedAviatorTextResult {
  multipliers: number[];
  confidence: number;
}

/**
 * Extrai multiplicadores no formato Spribe Aviator ("1.39x", "48.92x", "1,39x", "2.00 X")
 * rejeitando números sem sufixo ou fora do intervalo válido [1.00, 100000].
 */
export function parseAviatorMultiplierToken(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/,/g, '.').replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,5}(?:\.\d{1,2})?)[xX×]$/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!isValidAviatorMultiplier(num)) return null;
  return roundMultiplier2(num);
}

export function parseAviatorHistoryText(rawText: string): ParsedAviatorTextResult {
  if (!rawText || !rawText.trim()) {
    return { multipliers: [], confidence: 0 };
  }
  const normalized = rawText.replace(/,/g, '.');
  const regex = /(\d{1,5}(?:\.\d{1,2})?)\s*[xX×]/g;
  const multipliers: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    const val = Number(match[1]);
    if (isValidAviatorMultiplier(val)) {
      multipliers.push(roundMultiplier2(val));
    }
  }

  // Também aceita lista manual separada por vírgula/espaço se todos parecerem decimais >= 1.00
  if (multipliers.length === 0) {
    const plainTokens = rawText.trim().split(/[\s,;|\n]+/);
    for (const tok of plainTokens) {
      const cleaned = tok.trim().replace(/[xX×]$/, '');
      if (/^\d{1,5}(?:\.\d{1,2})?$/.test(cleaned)) {
        const val = Number(cleaned);
        if (isValidAviatorMultiplier(val)) {
          multipliers.push(roundMultiplier2(val));
        }
      }
    }
  }

  return {
    multipliers,
    confidence: multipliers.length > 0 ? 0.9 : 0,
  };
}

export interface AviatorScreenshotScanResult {
  detectedColorCounts: { blue: number; purple: number; pink: number };
  isAviatorScreenLikely: boolean;
  liveCrashRedDetected: boolean;
  note: string;
}

/**
 * Scanner visual de screenshot (Canvas) no navegador Web/Preview para conferir:
 * - Presença da faixa superior colorida (azul / roxo / rosa) característica do Aviator
 * - Estado de voo ou crash vermelho no canvas central
 */
export async function analyzeAviatorScreenshotImage(
  file: File
): Promise<AviatorScreenshotScanResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Falha ao carregar imagem'));
      el.src = url;
    });

    const canvas = document.createElement('canvas');
    const maxW = 640;
    const scale = img.width > maxW ? maxW / img.width : 1;
    canvas.width = Math.max(40, Math.round(img.width * scale));
    canvas.height = Math.max(40, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        detectedColorCounts: { blue: 0, purple: 0, pink: 0 },
        isAviatorScreenLikely: false,
        liveCrashRedDetected: false,
        note: 'Canvas indisponível neste navegador.',
      };
    }

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 1. Analisa faixa superior (y = 14%..26%) para pílulas azul/roxo/rosa
    const stripY0 = Math.floor(canvas.height * 0.14);
    const stripY1 = Math.floor(canvas.height * 0.26);
    const stripData = ctx.getImageData(
      0,
      stripY0,
      canvas.width,
      Math.max(4, stripY1 - stripY0)
    ).data;

    let bluePx = 0;
    let purplePx = 0;
    let pinkPx = 0;
    for (let i = 0; i < stripData.length; i += 16) {
      const r = stripData[i];
      const g = stripData[i + 1];
      const b = stripData[i + 2];
      if (b > 130 && r < 95 && g >= 70 && g <= 190) bluePx++;
      else if (b > 130 && r > 90 && r < 180 && g < 95) purplePx++;
      else if (r > 155 && b > 100 && g < 90) pinkPx++;
    }

    // 2. Analisa área central (y = 26%..46%) para detectar cor vermelha de crash
    const liveY0 = Math.floor(canvas.height * 0.26);
    const liveY1 = Math.floor(canvas.height * 0.46);
    const liveData = ctx.getImageData(
      Math.floor(canvas.width * 0.2),
      liveY0,
      Math.floor(canvas.width * 0.6),
      Math.max(4, liveY1 - liveY0)
    ).data;

    let brightRedPx = 0;
    let whiteTextPx = 0;
    for (let i = 0; i < liveData.length; i += 16) {
      const r = liveData[i];
      const g = liveData[i + 1];
      const b = liveData[i + 2];
      if (r > 190 && g < 75 && b < 85) brightRedPx++;
      else if (r > 210 && g > 210 && b > 210) whiteTextPx++;
    }

    const detectedColorCounts = {
      blue: Math.round(bluePx / 4),
      purple: Math.round(purplePx / 4),
      pink: Math.round(pinkPx / 4),
    };
    const isAviatorScreenLikely =
      bluePx + purplePx + pinkPx >= 8 || whiteTextPx >= 20 || brightRedPx >= 20;

    return {
      detectedColorCounts,
      isAviatorScreenLikely,
      liveCrashRedDetected: brightRedPx > whiteTextPx * 0.9 && brightRedPx > 25,
      note: isAviatorScreenLikely
        ? 'Interface Aviator reconhecida na imagem. No APK Android o ML Kit lê os decimais exatos automaticamente; na Web cole ou introduza os multiplicadores detetados se desejar.'
        : 'Não foi possível confirmar a faixa do Aviator na imagem. Verifique se o topo com os multiplicadores está visível.',
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
