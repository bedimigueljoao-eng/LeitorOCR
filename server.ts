import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '12mb' }));

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

app.post('/api/analyze-screenshot', async (req, res) => {
  if (!ai) {
    res.status(503).json({
      error: 'GEMINI_API_KEY não configurada no servidor.',
    });
    return;
  }

  const { imageBase64, mimeType } = req.body as {
    imageBase64?: string;
    mimeType?: string;
  };

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    res.status(400).json({ error: 'Imagem em base64 é obrigatória.' });
    return;
  }

  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const resolvedMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: resolvedMime,
              data: cleanBase64,
            },
          },
          {
            text:
              'Analise esta captura de tela de roleta online (ex: Creedroomz / Kwanzabet). ' +
              'Leia a faixa horizontal de resultados recentes no topo da mesa, exatamente da ESQUERDA (mais recente) para a DIREITA (mais antigo). ' +
              'Extraia apenas números válidos de roleta europeia (0 a 36). ' +
              'Extraia também o saldo visível em AOA (se houver), o status do botão Aurum (ON/OFF se visível) e o identificador do provedor/mesa.',
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            numbersNewestFirst: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
              description: 'Números da faixa superior da esquerda para a direita (0 a 36).',
            },
            balanceAoa: {
              type: Type.NUMBER,
              description: 'Saldo atual da banca visível na tela em AOA, ou null.',
            },
            providerLabel: {
              type: Type.STRING,
              description: 'Nome do provedor ou número da mesa visível no rodapé.',
            },
            aurumActive: {
              type: Type.BOOLEAN,
              description: 'Se o modo Aurum está ligado (true) ou desligado (false).',
            },
            notes: {
              type: Type.STRING,
              description: 'Resumo curto em português sobre a leitura realizada.',
            },
          },
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);
    const numbers = Array.isArray(parsed.numbersNewestFirst)
      ? parsed.numbersNewestFirst.filter(
          (n: unknown): n is number =>
            typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 36
        )
      : [];

    res.json({
      numbersNewestFirst: numbers,
      balanceAoa: typeof parsed.balanceAoa === 'number' ? parsed.balanceAoa : null,
      providerLabel: typeof parsed.providerLabel === 'string' ? parsed.providerLabel : 'Creedroomz',
      aurumActive: Boolean(parsed.aurumActive),
      notes: typeof parsed.notes === 'string' ? parsed.notes : 'Leitura concluída.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao processar imagem.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/analyze-aviator-ai', async (req, res) => {
  if (!ai) {
    res.status(503).json({
      error: 'GEMINI_API_KEY não configurada no servidor.',
    });
    return;
  }

  const body = req.body as {
    totalRounds?: unknown;
    recentMultipliers?: unknown;
    question?: unknown;
    localSummary?: unknown;
    postPeakSummary?: unknown;
    regimeSummary?: unknown;
    strategiesSummary?: unknown;
  };

  const totalRounds = typeof body.totalRounds === 'number' ? body.totalRounds : 0;
  const recentMultipliers = Array.isArray(body.recentMultipliers)
    ? body.recentMultipliers.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1).slice(-40)
    : [];
  const question =
    typeof body.question === 'string' && body.question.trim().length > 0
      ? body.question.trim().slice(0, 400)
      : 'Analise se após multiplicadores altos estão a sair números baixos, como estão os picos e qual a postura mais segura para a banca.';
  const localSummary = typeof body.localSummary === 'string' ? body.localSummary.slice(0, 1200) : '';
  const postPeakSummary = typeof body.postPeakSummary === 'string' ? body.postPeakSummary.slice(0, 1500) : '';
  const regimeSummary = typeof body.regimeSummary === 'string' ? body.regimeSummary.slice(0, 800) : '';
  const strategiesSummary = typeof body.strategiesSummary === 'string' ? body.strategiesSummary.slice(0, 1200) : '';

  if (totalRounds < 5 || recentMultipliers.length < 5) {
    res.status(400).json({
      error: 'Registe pelo menos 5 rodadas antes de solicitar análise da IA.',
    });
    return;
  }

  try {
    const prompt = [
      'Você é um analista quantitativo rigoroso de dados de Aviator em português.',
      'REGRAS INVIOLÁVEIS:',
      '1. Analise APENAS os números reais fornecidos abaixo. Nunca invente resultados.',
      '2. Seja 100% honesto matematicamente: jogos Provably Fair / RNG têm rodadas independentes; mesmo após picos altos (>=10x, >=25x, >=50x), nunca garanta previsão exata nem lucro.',
      '3. Nunca recomende Martingale (dobrar aposta após perda). Priorize gestão conservadora de banca e limites de parada.',
      '4. Responda de forma objetiva, clara e prática (máx. 4 parágrafos curtos ou tópicos).',
      '',
      `TOTAL DE RODADAS NA BASE: ${totalRounds}`,
      `ÚLTIMOS MULTIPLICADORES (cronológico até o mais recente): ${recentMultipliers.map((m) => `${m.toFixed(2)}x`).join(', ')}`,
      `RESUMO LOCAL: ${localSummary}`,
      `DADOS PÓS-PICO (APÓS >=5x, >=10x, >=25x): ${postPeakSummary}`,
      `REGIME ATUAL: ${regimeSummary}`,
      `DESEMPENHO ESTRATÉGIAS: ${strategiesSummary}`,
      '',
      `PERGUNTA DO UTILIZADOR: ${question}`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
    });

    const answer = (response.text ?? '').trim();
    if (!answer) {
      res.status(502).json({ error: 'Resposta vazia do modelo Gemini.' });
      return;
    }

    res.json({
      answer,
      model: 'gemini-4-hydrogen',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar Gemini AI.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/analyze-quant-ai', async (req, res) => {
  if (!ai) {
    res.status(503).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
    return;
  }

  const body = req.body as {
    game?: unknown;
    sampleSize?: unknown;
    unpredictabilityPct?: unknown;
    decisionHeadline?: unknown;
    regimeReasons?: unknown;
    topStrategiesSummary?: unknown;
    recentValues?: unknown;
  };

  const game = body.game === 'roulette' ? 'Roleta Europeia' : 'Aviator';
  const sampleSize = typeof body.sampleSize === 'number' ? body.sampleSize : 0;
  const unpredictabilityPct = typeof body.unpredictabilityPct === 'number' ? body.unpredictabilityPct : 100;
  const decisionHeadline = typeof body.decisionHeadline === 'string' ? body.decisionHeadline.slice(0, 200) : '';
  const regimeReasons = Array.isArray(body.regimeReasons)
    ? body.regimeReasons.filter((r): r is string => typeof r === 'string').slice(0, 6).join(' | ')
    : '';
  const topStrategiesSummary =
    typeof body.topStrategiesSummary === 'string' ? body.topStrategiesSummary.slice(0, 1200) : '';
  const recentValues = Array.isArray(body.recentValues)
    ? body.recentValues.slice(0, 25).join(', ')
    : '';

  if (sampleSize < 5) {
    res.status(400).json({ error: 'Registe pelo menos 5 rodadas para análise quantitativa.' });
    return;
  }

  try {
    const prompt = [
      'Você é o Analista Quantitativo do QuantLab Pro.',
      'Responda em português objetivo (máx. 3 parágrafos curtos).',
      'Nunca prometa previsão garantida nem sugira Martingale; respeite o semáforo de imprevisibilidade.',
      `JOGO: ${game}`,
      `AMOSTRA (n): ${sampleSize}`,
      `ÍNDICE DE IMPREVISIBILIDADE: ${unpredictabilityPct}%`,
      `DECISÃO DO MOTOR: ${decisionHeadline}`,
      `MOTIVOS DO REGIME: ${regimeReasons}`,
      `ÚLTIMOS RESULTADOS (mais recente à esquerda): ${recentValues}`,
      `ESTRATÉGIAS VALIDADAS OOS: ${topStrategiesSummary}`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
    });

    const answer = (response.text ?? '').trim();
    if (!answer) {
      res.status(502).json({ error: 'Resposta vazia do modelo Gemini.' });
      return;
    }

    res.json({ answer, model: 'gemini-4-hydrogen' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar Gemini AI.';
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RoletaVision Studio server running on http://localhost:${PORT}`);
  });
}

startServer();
