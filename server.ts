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
