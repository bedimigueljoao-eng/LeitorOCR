import React, { useEffect, useRef, useState } from 'react';
import { ScanLine, Upload, CheckCircle2, AlertCircle, Camera, StopCircle } from 'lucide-react';
import { getRouletteColor } from '../utils/rouletteEngine';

interface ScreenshotScannerTabProps {
  roiTopPct: number;
  roiHeightPct: number;
  onChangeRoiTop: (val: number) => void;
  onChangeRoiHeight: (val: number) => void;
  onApplyScannedResults: (numbersNewestFirst: number[], balanceAoa: number | null) => void;
}

const DEFAULT_SAMPLE_IMAGE =
  '/assets/aistudio/Screenshot_20261121_141608_Chrome_93770943.jpg';

export const ScreenshotScannerTab: React.FC<ScreenshotScannerTabProps> = ({
  roiTopPct,
  roiHeightPct,
  onChangeRoiTop,
  onChangeRoiHeight,
  onApplyScannedResults,
}) => {
  const [mode, setMode] = useState<'image' | 'camera'>('image');
  const [previewUrl, setPreviewUrl] = useState<string>(DEFAULT_SAMPLE_IMAGE);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [autoCameraLoop, setAutoCameraLoop] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [scanResult, setScanResult] = useState<{
    numbersNewestFirst: number[];
    balanceAoa: number | null;
    providerLabel: string;
    aurumActive: boolean;
    notes: string;
  } | null>(null);

  const stopCamera = () => {
    setAutoCameraLoop(false);
    setCameraActive(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    setScanError(null);
    setMode('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setScanError(
        'Não foi possível acessar a câmera neste navegador. Verifique as permissões ou use o app Android nativo.'
      );
      setCameraActive(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCamera();
    setMode('image');
    setScanError(null);
    setScanResult(null);
    setMimeType(file.type || 'image/jpeg');

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewUrl(dataUrl);
      setImageBase64(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const sendToVisionApi = async (base64Payload: string, resolvedMime: string) => {
    setIsScanning(true);
    setScanError(null);
    try {
      const response = await fetch('/api/analyze-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64Payload,
          mimeType: resolvedMime,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Falha ao analisar imagem.');
      }

      setScanResult(data);
      if (Array.isArray(data.numbersNewestFirst) && data.numbersNewestFirst.length > 0) {
        onApplyScannedResults(data.numbersNewestFirst, data.balanceAoa);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Erro desconhecido na leitura.');
    } finally {
      setIsScanning(false);
    }
  };

  const runVisionScan = async () => {
    if (mode === 'camera' && videoRef.current && cameraActive) {
      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      await sendToVisionApi(dataUrl, 'image/jpeg');
      return;
    }

    let payloadBase64 = imageBase64;
    let resolvedMime = mimeType;

    if (!payloadBase64) {
      const resImg = await fetch(previewUrl);
      const blob = await resImg.blob();
      resolvedMime = blob.type || 'image/jpeg';
      payloadBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    }

    await sendToVisionApi(payloadBase64, resolvedMime);
  };

  useEffect(() => {
    if (!autoCameraLoop || !cameraActive || mode !== 'camera') return;
    const id = setInterval(() => {
      if (!isScanning) {
        void runVisionScan();
      }
    }, 4500);
    return () => clearInterval(id);
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Esquerda: Captura ou Camera 2o Aparelho com Mira */}
      <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Entrada Visual e Calibração
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Teste por print ou aponte a câmera (2º aparelho)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Câmera</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/70 bg-red-950/50 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-900/50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <StopCircle className="h-3.5 w-3.5" />
                <span>Parar</span>
              </button>
            )}

            <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0">
              <Upload className="h-3.5 w-3.5" />
              <span>Print</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div className="relative mx-auto max-w-[300px] overflow-hidden rounded-xl border border-slate-800 bg-black min-h-[220px] flex items-center justify-center">
          {mode === 'camera' ? (
            <video
              ref={videoRef}
              playsInline
              muted
              className="block w-full h-auto"
            />
          ) : (
            <img
              src={previewUrl}
              alt="Captura da roleta Kwanzabet Creedroomz"
              referrerPolicy="no-referrer"
              className="block w-full h-auto"
            />
          )}

          {/* Mira verde pontilhada */}
          <div
            style={{
              top: `${roiTopPct}%`,
              height: `${roiHeightPct}%`,
            }}
            className="pointer-events-none absolute left-1.5 right-1.5 rounded border-2 border-dashed border-emerald-400 bg-emerald-500/20 transition-all duration-150"
          />
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Posição vertical (Topo)</span>
              <span className="font-mono tabular-nums text-emerald-400">{roiTopPct}%</span>
            </div>
            <input
              type="range"
              min={5}
              max={45}
              value={roiTopPct}
              onChange={(e) => onChangeRoiTop(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Altura da faixa OCR</span>
              <span className="font-mono tabular-nums text-emerald-400">{roiHeightPct}%</span>
            </div>
            <input
              type="range"
              min={3}
              max={15}
              value={roiHeightPct}
              onChange={(e) => onChangeRoiHeight(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Direita: Leitura por Visao + Resultados Extraidos */}
      <div className="lg:col-span-7 space-y-5">
        <div className="rounded-xl border border-slate-800 bg-[#131924] p-6">
          <h2 className="text-lg font-semibold text-slate-100">
            Leitura Sem Trocar de Aba (12s por Rodada)
          </h2>
          <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
            Para acompanhar rodadas rápidas de 12 segundos sem perder tempo trocando de janela:
            no <strong className="text-slate-200">App Android (APK)</strong>, o navegador roda
            dentro do próprio aplicativo e lê a faixa a cada <strong className="text-emerald-400">1 segundo</strong>.
            Se preferir usar um <strong className="text-slate-200">segundo aparelho</strong> ou PC,
            ative a câmera ao lado para ler a tela automaticamente.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runVisionScan}
              disabled={isScanning}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ScanLine className="h-4 w-4" />
              <span>
                {isScanning
                  ? 'Analisando...'
                  : mode === 'camera'
                  ? 'Capturar Quadro da Câmera'
                  : 'Ler Print e Sincronizar Painel'}
              </span>
            </button>

            {mode === 'camera' && cameraActive && (
              <button
                type="button"
                onClick={() => setAutoCameraLoop((v) => !v)}
                className={`rounded-lg border px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  autoCameraLoop
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                    : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {autoCameraLoop ? 'Leitura Contínua: ATIVA (4.5s)' : 'Ativar Leitura Contínua'}
              </button>
            )}
          </div>

          {scanError && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-900/60 bg-red-950/40 p-3.5 text-xs text-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{scanError}</span>
            </div>
          )}

          {scanResult && (
            <div className="mt-5 border-t border-slate-800 pt-5 space-y-4">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>Leitura aplicada automaticamente ao analisador</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-xs text-slate-400">Saldo detectado</div>
                  <div className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums">
                    {scanResult.balanceAoa !== null
                      ? `${scanResult.balanceAoa.toFixed(2)} AOA`
                      : 'Não visível'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-xs text-slate-400">Provedor / Mesa</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-100 truncate">
                    {scanResult.providerLabel}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-xs text-slate-400">Modo Aurum</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-amber-300">
                    {scanResult.aurumActive ? 'Ativado' : 'Desligado (OFF)'}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-400 mb-2">
                  Sequência lida (mais recente à esquerda):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {scanResult.numbersNewestFirst.map((num, idx) => {
                    const col = getRouletteColor(num);
                    const cls =
                      col === 'green'
                        ? 'bg-emerald-700 border-emerald-500'
                        : col === 'red'
                        ? 'bg-[#B91C1C] border-red-800'
                        : 'bg-[#181C24] border-slate-700';
                    return (
                      <span
                        key={`${num}-${idx}`}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded border font-mono text-xs font-bold text-white tabular-nums ${cls} ${
                          idx === 0 ? 'ring-2 ring-amber-400' : ''
                        }`}
                      >
                        {num}
                      </span>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-slate-400">{scanResult.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
