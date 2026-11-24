import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Crosshair,
  FlaskConical,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Square,
  Target,
  Trash2,
  Upload,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  analyzeQuantAviator,
  analyzeQuantRoulette,
  buildQuantAnalystDecision,
  DEFAULT_QUANT_STRATEGIES,
  DEFAULT_ROI_PROFILES,
  detectMarketRegime,
  evaluateContinuousLearning,
  evolveTopStrategies,
  loadQuantStrategies,
  loadRoiProfiles,
  OcrFrameResult,
  OcrTemporalStabilizer,
  QuantBankrollPolicy,
  QuantStrategyDefinition,
  QuantStrategyRuleType,
  RoiBox,
  RoiProfile,
  runHighPrecisionRoiOcr,
  runQuantLabTests,
  saveQuantStrategies,
  saveRoiProfiles,
} from '../engine';

interface QuantLabDesktopProps {
  onSyncRouletteSpins?: (spinsNewestFirst: number[]) => void;
  onSyncAviatorMultipliers?: (multipliersNewestFirst: number[]) => void;
}

const LS_KEY_QUANT_ROULETTE = 'quantlab_roulette_history_v1';
const LS_KEY_QUANT_AVIATOR = 'quantlab_aviator_history_v1';

function loadNumHistory(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(0, 500)
      : [];
  } catch {
    return [];
  }
}

export const QuantLabDesktop: React.FC<QuantLabDesktopProps> = ({
  onSyncRouletteSpins,
  onSyncAviatorMultipliers,
}) => {
  const [game, setGame] = useState<'roulette' | 'aviator'>('roulette');
  const [rouletteHistory, setRouletteHistory] = useState<number[]>(() =>
    loadNumHistory(LS_KEY_QUANT_ROULETTE)
  );
  const [aviatorHistory, setAviatorHistory] = useState<number[]>(() =>
    loadNumHistory(LS_KEY_QUANT_AVIATOR)
  );

  // Perfis de ROI & Estratégias
  const [roiProfiles, setRoiProfiles] = useState<RoiProfile[]>(() => loadRoiProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    () => loadRoiProfiles()[0]?.id ?? DEFAULT_ROI_PROFILES[0].id
  );
  const [newProfileName, setNewProfileName] = useState('');
  const [strategies, setStrategies] = useState<QuantStrategyDefinition[]>(() =>
    loadQuantStrategies()
  );

  // Parâmetros de Risco & Imprevisibilidade
  const [unpredictabilityThreshold, setUnpredictabilityThreshold] = useState(60);
  const [bankroll, setBankroll] = useState<QuantBankrollPolicy>({
    initialBalanceAoa: 2500,
    currentBalanceAoa: 2500,
    baseStakeAoa: 100,
    stopLossAoa: 500,
    stopWinAoa: 800,
    pauseAfterConsecutiveLosses: 3,
    consecutiveLosses: 0,
    sessionPnlAoa: 0,
  });

  // Captura de Ecrã / Imagem & Calibração de ROI
  const [captureActive, setCaptureActive] = useState(false);
  const [autoOcrLoop, setAutoOcrLoop] = useState(false);
  const [ocrIntervalMs, setOcrIntervalMs] = useState(1400);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [staticImageUrl, setStaticImageUrl] = useState<string>(
    '/assets/aistudio/image_6cf11545.png'
  );
  const [lastOcrResult, setLastOcrResult] = useState<OcrFrameResult | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);

  // Inputs manuais e edição
  const [manualSingleInput, setManualSingleInput] = useState('');
  const [bulkPasteInput, setBulkPasteInput] = useState('');
  const [inputNotice, setInputNotice] = useState<string | null>(null);

  // Criador de Estratégia Customizada
  const [newStratName, setNewStratName] = useState('');
  const [newStratRule, setNewStratRule] = useState<QuantStrategyRuleType>('roulette_absence');
  const [newStratParamA, setNewStratParamA] = useState('5');
  const [newStratParamB, setNewStratParamB] = useState('1.55');
  const [evolutionBanner, setEvolutionBanner] = useState<string | null>(null);

  // Diagnóstico Gemini IA & Auditoria de Testes
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [testReport, setTestReport] = useState<ReturnType<typeof runQuantLabTests> | null>(null);

  // Refs para vídeo, imagem, overlay ROI e estabilizador
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stabilizerRef = useRef<OcrTemporalStabilizer>(new OcrTemporalStabilizer());
  const dragModeRef = useRef<
    | null
    | { type: 'draw'; startX: number; startY: number }
    | { type: 'move'; startX: number; startY: number; orig: RoiBox }
    | { type: 'resize'; startX: number; startY: number; orig: RoiBox }
  >(null);

  const activeHistory = game === 'roulette' ? rouletteHistory : aviatorHistory;
  const activeHistoryRef = useRef<number[]>(activeHistory);
  activeHistoryRef.current = activeHistory;

  const activeProfile = useMemo(() => {
    const exact = roiProfiles.find((p) => p.id === selectedProfileId && p.game === game);
    if (exact) return exact;
    return roiProfiles.find((p) => p.game === game) ?? DEFAULT_ROI_PROFILES[0];
  }, [roiProfiles, selectedProfileId, game]);

  const activeRoi = activeProfile.roi;

  // Persistência local
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_QUANT_ROULETTE, JSON.stringify(rouletteHistory.slice(0, 500)));
    } catch {
      // ignore
    }
  }, [rouletteHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_QUANT_AVIATOR, JSON.stringify(aviatorHistory.slice(0, 500)));
    } catch {
      // ignore
    }
  }, [aviatorHistory]);

  useEffect(() => {
    saveRoiProfiles(roiProfiles);
  }, [roiProfiles]);

  useEffect(() => {
    saveQuantStrategies(strategies);
  }, [strategies]);

  // Limpar stream ao desmontar
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Ao trocar de jogo, atualiza preset default de regra e imagem exemplo
  const handleSwitchGame = (nextGame: 'roulette' | 'aviator') => {
    setGame(nextGame);
    stabilizerRef.current.reset();
    setLastOcrResult(null);
    setAiNarrative(null);
    setEvolutionBanner(null);
    const matchedProfile = roiProfiles.find((p) => p.game === nextGame);
    if (matchedProfile) setSelectedProfileId(matchedProfile.id);
    if (nextGame === 'roulette') {
      setNewStratRule('roulette_absence');
      setNewStratParamA('5');
      if (staticImageUrl.includes('image_2f76b6dc')) {
        setStaticImageUrl('/assets/aistudio/image_6cf11545.png');
      }
    } else {
      setNewStratRule('aviator_post_low_recovery');
      setNewStratParamA('2');
      setNewStratParamB('1.55');
      if (staticImageUrl.includes('image_6cf11545')) {
        setStaticImageUrl('/assets/aistudio/image_2f76b6dc.png');
      }
    }
  };

  // Motores Quantitativos
  const rouletteReport = useMemo(
    () => analyzeQuantRoulette(rouletteHistory),
    [rouletteHistory]
  );
  const aviatorReport = useMemo(
    () => analyzeQuantAviator(aviatorHistory),
    [aviatorHistory]
  );
  const regimeReport = useMemo(
    () =>
      detectMarketRegime({
        game,
        valuesNewestFirst: activeHistory,
        thresholdPct: unpredictabilityThreshold,
        minSampleSize: 12,
      }),
    [game, activeHistory, unpredictabilityThreshold]
  );
  const learningReport = useMemo(
    () =>
      evaluateContinuousLearning({
        game,
        historyNewestFirst: activeHistory,
        strategies,
        stakeAoa: bankroll.baseStakeAoa,
      }),
    [game, activeHistory, strategies, bankroll.baseStakeAoa]
  );
  const analystDecision = useMemo(
    () =>
      buildQuantAnalystDecision({
        game,
        regime: regimeReport,
        learning: learningReport,
        bankroll,
      }),
    [game, regimeReport, learningReport, bankroll]
  );

  // ==================== CAPTURA DE ECRÃ (getDisplayMedia) ====================
  const startScreenCapture = async () => {
    setCaptureError(null);
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setCaptureError(
        'Screen Capture API (getDisplayMedia) não disponível neste contexto. Use navegador Desktop (Chrome/Edge) ou carregue um print.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      setCaptureActive(true);
      stabilizerRef.current.reset();

      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          stopScreenCapture();
        };
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCaptureError('Captura cancelada ou permissão negada pelo navegador.');
      setCaptureActive(false);
    }
  };

  const stopScreenCapture = () => {
    setAutoOcrLoop(false);
    setCaptureActive(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const commitDetectedValues = (newValuesNewestFirst: number[]) => {
    if (newValuesNewestFirst.length === 0) return;
    if (game === 'roulette') {
      setRouletteHistory((prev) => {
        const next = [...newValuesNewestFirst, ...prev].slice(0, 500);
        onSyncRouletteSpins?.(next);
        return next;
      });
    } else {
      setAviatorHistory((prev) => {
        const next = [...newValuesNewestFirst, ...prev].slice(0, 500);
        onSyncAviatorMultipliers?.(next);
        return next;
      });
    }
  };

  const runSingleOcrPass = async () => {
    if (ocrBusy) return;
    const source = captureActive ? videoRef.current : imgRef.current;
    if (!source) return;
    setOcrBusy(true);
    try {
      const res = await runHighPrecisionRoiOcr({
        source,
        profile: activeProfile,
        stabilizer: stabilizerRef.current,
        existingHistoryNewestFirst: activeHistoryRef.current,
      });
      setLastOcrResult(res);
      if (res.committedNewCount > 0) {
        commitDetectedValues(res.committedValuesNewestFirst);
      }
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Erro ao executar OCR.');
    } finally {
      setOcrBusy(false);
    }
  };

  useEffect(() => {
    if (!autoOcrLoop) return;
    const id = window.setInterval(() => {
      void runSingleOcrPass();
    }, ocrIntervalMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOcrLoop, ocrIntervalMs, captureActive, activeProfile, game]);

  // ==================== CALIBRAÇÃO INTERATIVA DE ROI ====================
  const updateActiveRoi = (nextRoi: RoiBox) => {
    const clamped: RoiBox = {
      xPct: Math.max(0, Math.min(0.95, nextRoi.xPct)),
      yPct: Math.max(0, Math.min(0.95, nextRoi.yPct)),
      wPct: Math.max(0.05, Math.min(1 - nextRoi.xPct, nextRoi.wPct)),
      hPct: Math.max(0.03, Math.min(1 - nextRoi.yPct, nextRoi.hPct)),
    };
    setRoiProfiles((prev) =>
      prev.map((p) =>
        p.id === activeProfile.id ? { ...p, roi: clamped, updatedAt: Date.now() } : p
      )
    );
  };

  const getRelCoords = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const { x, y } = getRelCoords(e.clientX, e.clientY);
    dragModeRef.current = { type: 'draw', startX: x, startY: y };
  };

  const handleBoxMoveMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const { x, y } = getRelCoords(e.clientX, e.clientY);
    dragModeRef.current = { type: 'move', startX: x, startY: y, orig: { ...activeRoi } };
  };

  const handleBoxResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const { x, y } = getRelCoords(e.clientX, e.clientY);
    dragModeRef.current = { type: 'resize', startX: x, startY: y, orig: { ...activeRoi } };
  };

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragModeRef.current;
    if (!drag) return;
    const { x, y } = getRelCoords(e.clientX, e.clientY);
    if (drag.type === 'draw') {
      const xPct = Math.min(drag.startX, x);
      const yPct = Math.min(drag.startY, y);
      const wPct = Math.max(0.05, Math.abs(x - drag.startX));
      const hPct = Math.max(0.03, Math.abs(y - drag.startY));
      updateActiveRoi({ xPct, yPct, wPct, hPct });
    } else if (drag.type === 'move') {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      updateActiveRoi({
        xPct: Math.max(0, Math.min(1 - drag.orig.wPct, drag.orig.xPct + dx)),
        yPct: Math.max(0, Math.min(1 - drag.orig.hPct, drag.orig.yPct + dy)),
        wPct: drag.orig.wPct,
        hPct: drag.orig.hPct,
      });
    } else if (drag.type === 'resize') {
      const wPct = Math.max(0.05, Math.min(1 - drag.orig.xPct, drag.orig.wPct + (x - drag.startX)));
      const hPct = Math.max(0.03, Math.min(1 - drag.orig.yPct, drag.orig.hPct + (y - drag.startY)));
      updateActiveRoi({ ...drag.orig, wPct, hPct });
    }
  };

  const handleStageMouseUp = () => {
    dragModeRef.current = null;
  };

  const handleSaveNewProfile = () => {
    const cleanName = newProfileName.trim();
    if (!cleanName) return;
    const created: RoiProfile = {
      id: `roi_${Date.now()}`,
      name: cleanName,
      game,
      roi: { ...activeRoi },
      expectedCells: activeProfile.expectedCells,
      newestOnLeft: activeProfile.newestOnLeft,
      updatedAt: Date.now(),
    };
    setRoiProfiles((prev) => [created, ...prev]);
    setSelectedProfileId(created.id);
    setNewProfileName('');
  };

  // ==================== INPUT MANUAL / UPLOAD PRINT / COLAR 500 RODADAS ====================
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopScreenCapture();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setStaticImageUrl(reader.result);
        stabilizerRef.current.reset();
        setLastOcrResult(null);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleAddSingleValue = (e: React.FormEvent) => {
    e.preventDefault();
    setInputNotice(null);
    const cleaned = manualSingleInput.trim().replace(',', '.').replace(/[xX×]$/, '');
    const val = Number(cleaned);
    if (game === 'roulette') {
      if (!cleaned || !Number.isInteger(val) || val < 0 || val > 36) {
        setInputNotice('Introduza um número inteiro válido da roleta (0 a 36).');
        return;
      }
      commitDetectedValues([val]);
      setManualSingleInput('');
      setInputNotice(`Número ${val} registado no topo do histórico.`);
    } else {
      if (!cleaned || Number.isNaN(val) || val < 1 || val > 10000) {
        setInputNotice('Introduza um multiplicador Aviator válido (>= 1.00).');
        return;
      }
      const rounded = Math.round(val * 100) / 100;
      commitDetectedValues([rounded]);
      setManualSingleInput('');
      setInputNotice(`Multiplicador ${rounded.toFixed(2)}x registado.`);
    }
  };

  const handleBulkPasteImport = (e: React.FormEvent) => {
    e.preventDefault();
    setInputNotice(null);
    const tokens = bulkPasteInput
      .replace(/,/g, '.')
      .split(/[\s;|]+/)
      .map((t) => t.trim().replace(/[xX×]$/, ''))
      .filter(Boolean);

    if (game === 'roulette') {
      const valid = tokens
        .map((t) => Number(t))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 36)
        .slice(0, 500);
      if (valid.length === 0) {
        setInputNotice('Nenhum número de roleta (0–36) encontrado no texto.');
        return;
      }
      commitDetectedValues(valid);
      setBulkPasteInput('');
      setInputNotice(`${valid.length} giros importados para análise.`);
    } else {
      const valid = tokens
        .map((t) => Math.round(Number(t) * 100) / 100)
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 10000)
        .slice(0, 500);
      if (valid.length === 0) {
        setInputNotice('Nenhum multiplicador Aviator (>= 1.00) encontrado.');
        return;
      }
      commitDetectedValues(valid);
      setBulkPasteInput('');
      setInputNotice(`${valid.length} voos importados para análise.`);
    }
  };

  // ==================== ESTRATÉGIAS & EVOLUÇÃO ====================
  const handleCreateStrategy = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newStratName.trim() || `Estratégia ${strategies.length + 1}`;
    const pA = Number(newStratParamA) || 3;
    const pB = Number(newStratParamB.replace(',', '.')) || 1.55;

    const params: QuantStrategyDefinition['params'] =
      newStratRule === 'roulette_absence'
        ? { minDelay: Math.max(2, Math.round(pA)) }
        : newStratRule === 'roulette_streak_break' || newStratRule === 'roulette_streak_follow'
        ? { minStreak: Math.max(2, Math.round(pA)) }
        : newStratRule === 'roulette_sector_confluence'
        ? { windowSize: Math.max(10, Math.round(pA)), minConcentrationPct: Math.max(35, Math.min(80, pB)) }
        : newStratRule === 'aviator_conservative_stable'
        ? { lookbackNoInstant: Math.max(2, Math.round(pA)), targetMultiplier: Math.max(1.15, pB) }
        : newStratRule === 'aviator_post_low_recovery'
        ? { minStreak: Math.max(2, Math.round(pA)), lowThreshold: 1.5, targetMultiplier: Math.max(1.2, pB) }
        : newStratRule === 'aviator_window_frequency'
        ? { windowSize: Math.max(10, Math.round(pA)), minHitRatePct: 52, targetMultiplier: Math.max(1.2, pB) }
        : { windowSize: 8, minPurpleCount: Math.max(3, Math.round(pA)), targetMultiplier: Math.max(1.5, pB) };

    const created: QuantStrategyDefinition = {
      id: `custom_${Date.now()}`,
      name: label,
      game,
      enabled: true,
      isCustom: true,
      isEvolved: false,
      ruleType: newStratRule,
      params,
      description: `Estratégia personalizada (${newStratRule}) criada no QuantLab.`,
    };
    setStrategies((prev) => [created, ...prev]);
    setNewStratName('');
  };

  const handleRunEvolution = () => {
    const evo = evolveTopStrategies({
      game,
      historyNewestFirst: activeHistory,
      existingStrategies: strategies,
      stakeAoa: bankroll.baseStakeAoa,
    });
    if (evo.promoted.length > 0) {
      setStrategies((prev) => [...evo.promoted, ...prev]);
    }
    setEvolutionBanner(evo.summaryNote);
  };

  // ==================== ANALISTA IA (GEMINI GRATUITO) ====================
  const handleAskGeminiQuant = async () => {
    if (activeHistory.length < 5) {
      setAiNarrative('Registe pelo menos 5 rodadas para gerar análise quantitativa.');
      return;
    }
    setAiBusy(true);
    try {
      const topStrats = learningReport.evaluations
        .slice(0, 4)
        .map(
          (e) =>
            `${e.strategy.name}: Consistência ${e.consistencyScore}/100, OOS ${e.outOfSampleHitRatePct.toFixed(
              1
            )}% (${e.outOfSampleEntries} entr.), ROI ${e.outOfSampleRoiPct.toFixed(1)}%, DD máx ${e.overall.maxDrawdownPct.toFixed(
              1
            )}%`
        )
        .join(' | ');

      const res = await fetch('/api/analyze-quant-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game,
          sampleSize: activeHistory.length,
          unpredictabilityPct: regimeReport.unpredictabilityPct,
          decisionHeadline: analystDecision.headline,
          regimeReasons: regimeReport.reasons,
          topStrategiesSummary: topStrats,
          recentValues: activeHistory.slice(0, 25),
        }),
      });

      if (!res.ok) {
        setAiNarrative(
          `${analystDecision.headline}\n${analystDecision.statisticalJustification}\n${analystDecision.disclaimer}`
        );
        return;
      }

      const data = (await res.json()) as { answer?: string };
      setAiNarrative(
        data.answer ??
          `${analystDecision.headline}\n${analystDecision.statisticalJustification}`
      );
    } catch {
      setAiNarrative(
        `${analystDecision.headline}\n${analystDecision.statisticalJustification}\n${analystDecision.disclaimer}`
      );
    } finally {
      setAiBusy(false);
    }
  };

  // Simulação / registo manual na Banca
  const handleRecordBankrollOutcome = (won: boolean, payoutMult = 2.0) => {
    const delta = won ? bankroll.baseStakeAoa * (payoutMult - 1) : -bankroll.baseStakeAoa;
    setBankroll((prev) => ({
      ...prev,
      currentBalanceAoa: Math.max(0, prev.currentBalanceAoa + delta),
      sessionPnlAoa: prev.sessionPnlAoa + delta,
      consecutiveLosses: won ? 0 : prev.consecutiveLosses + 1,
    }));
  };

  return (
    <div className="space-y-6">
      {/* Barra Superior QuantLab Pro: Escopo Dual + Auditoria + Limpar */}
      <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-amber-400">QuantLab Pro Desktop</span>
              <span aria-hidden="true">·</span>
              <span>OCR de Alta Precisão</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Amostra: {activeHistory.length} rodadas</span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-100">
              Leitura de Ecrã em Tempo Real, Deteção de Imprevisibilidade &amp; Aprendizagem Contínua
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5">
              <button
                type="button"
                onClick={() => handleSwitchGame('roulette')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                  game === 'roulette'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Roleta Europeia (0–36)
              </button>
              <button
                type="button"
                onClick={() => handleSwitchGame('aviator')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                  game === 'aviator'
                    ? 'bg-red-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Aviator
              </button>
            </div>

            <button
              type="button"
              onClick={() => setTestReport(runQuantLabTests())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-amber-300 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>Testar Motores</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (game === 'roulette') setRouletteHistory([]);
                else setAviatorHistory([]);
                stabilizerRef.current.reset();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-300 hover:text-red-300 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Zerar Sessão</span>
            </button>
          </div>
        </div>

        {/* Faixa de histórico atual */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-800/80">
          {activeHistory.length === 0 ? (
            <span className="text-xs text-slate-400 py-1">
              Sem rodadas na sessão. Inicie a captura de ecrã, corra o OCR num print ou cole resultados abaixo.
            </span>
          ) : (
            activeHistory.slice(0, 26).map((val, idx) => (
              <span
                key={`${val}-${idx}`}
                className={`inline-flex h-7 min-w-[34px] px-2 items-center justify-center rounded border font-mono text-xs font-bold tabular-nums shrink-0 ${
                  game === 'roulette'
                    ? val === 0
                      ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-300'
                      : [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(val)
                      ? 'bg-red-600/25 border-red-500/60 text-red-200'
                      : 'bg-slate-800 border-slate-600 text-slate-100'
                    : val >= 10
                    ? 'bg-fuchsia-600/25 border-fuchsia-400/70 text-fuchsia-200'
                    : val >= 2
                    ? 'bg-purple-600/25 border-purple-400/70 text-purple-200'
                    : 'bg-sky-600/25 border-sky-400/70 text-sky-200'
                } ${idx === 0 ? 'ring-2 ring-amber-400' : ''}`}
              >
                {game === 'roulette' ? val : `${val.toFixed(2)}x`}
              </span>
            ))
          )}
        </div>
      </section>

      {/* Auditoria dos 6 testes automatizados */}
      {testReport && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              {testReport.allPassed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400" />
              )}
              <span>
                Auditoria QuantLab Pro: {testReport.passedCount}/{testReport.totalCount} módulos aprovados
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTestReport(null)}
              className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Fechar
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {testReport.cases.map((tc) => (
              <div
                key={tc.name}
                className={`rounded-lg border p-3 text-xs ${
                  tc.passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/10'
                }`}
              >
                <div className="font-semibold text-slate-100 flex justify-between gap-2">
                  <span>{tc.name}</span>
                  <span className={tc.passed ? 'text-emerald-400' : 'text-red-400'}>
                    {tc.passed ? 'OK' : 'ERRO'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{tc.details}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* BLOCO 1 & 2: TERMÓMETRO DE IMPREVISIBILIDADE + MELHOR SUGESTÃO ATUAL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <section
          className={`lg:col-span-5 rounded-xl border p-5 space-y-4 ${
            regimeReport.blockEntries
              ? 'border-red-500/60 bg-red-950/20'
              : regimeReport.regimeStatus === 'CAUTELA'
              ? 'border-amber-500/50 bg-amber-950/15'
              : 'border-emerald-500/40 bg-[#131924]'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <ShieldAlert
                className={`h-4 w-4 ${
                  regimeReport.blockEntries
                    ? 'text-red-400'
                    : regimeReport.regimeStatus === 'CAUTELA'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              />
              <span>Termómetro de Imprevisibilidade</span>
            </div>
            <span className="font-mono text-lg font-bold tabular-nums text-slate-100">
              {regimeReport.unpredictabilityPct}%
            </span>
          </div>

          <div className="h-2.5 w-full rounded-full bg-[#0B0F17] overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all ${
                regimeReport.blockEntries
                  ? 'bg-red-500'
                  : regimeReport.regimeStatus === 'CAUTELA'
                  ? 'bg-amber-400'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, regimeReport.unpredictabilityPct)}%` }}
            />
          </div>

          <div
            className={`text-sm font-bold ${
              regimeReport.blockEntries
                ? 'text-red-300'
                : regimeReport.regimeStatus === 'CAUTELA'
                ? 'text-amber-300'
                : 'text-emerald-300'
            }`}
          >
            {regimeReport.bannerText}
          </div>

          <ul className="space-y-1 text-xs text-slate-300">
            {regimeReport.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>

          <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Limiar máximo de bloqueio ({unpredictabilityThreshold}%)</span>
              <span className="font-mono tabular-nums">
                Janelas 20/50/100:{' '}
                {regimeReport.windows.map((w) => `${w.unpredictabilityPct}%`).join(' / ') || '--'}
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={85}
              value={unpredictabilityThreshold}
              onChange={(e) => setUnpredictabilityThreshold(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </section>

        {/* Semáforo de Decisão & Analista IA Quant */}
        <section className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#131924] p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Target className="h-4 w-4 text-amber-400" />
                <span>Semáforo de Decisão &amp; Analista Quant</span>
              </div>
              <span
                className={`rounded-md px-3 py-1 font-mono text-xs font-bold ${
                  analystDecision.decision === 'ENTRAR'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                    : 'bg-red-500/20 text-red-300 border border-red-500/50'
                }`}
              >
                {analystDecision.decision === 'ENTRAR'
                  ? `ENTRAR · ${analystDecision.confidencePct}% CONFIANÇA`
                  : 'NÃO APOSTAR / AGUARDAR'}
              </span>
            </div>

            <div className="text-lg font-semibold text-slate-100">{analystDecision.headline}</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {analystDecision.statisticalJustification}
            </p>

            <div className="grid grid-cols-3 gap-3 pt-1 font-mono text-xs tabular-nums">
              <div className="border-t border-slate-800 pt-2">
                <div className="font-sans text-[11px] text-slate-400">Estratégia Autora</div>
                <div className="font-sans font-semibold text-slate-200 truncate">
                  {analystDecision.authorStrategyName}
                </div>
              </div>
              <div className="border-t border-slate-800 pt-2">
                <div className="font-sans text-[11px] text-slate-400">Acerto Validado OOS</div>
                <div className="font-bold text-amber-300">
                  {analystDecision.validatedHitRatePct.toFixed(1)}%
                </div>
              </div>
              <div className="border-t border-slate-800 pt-2">
                <div className="font-sans text-[11px] text-slate-400">Amostra Analisada</div>
                <div className="font-bold text-slate-100">n = {analystDecision.sampleSize}</div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-[11px] text-slate-400">{analystDecision.disclaimer}</span>
            <button
              type="button"
              onClick={handleAskGeminiQuant}
              disabled={aiBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{aiBusy ? 'A analisar...' : 'Resumo Analista IA'}</span>
            </button>
          </div>

          {aiNarrative && (
            <div className="rounded-lg border border-blue-500/30 bg-[#0B0F17] p-3.5 text-xs text-slate-200 whitespace-pre-line leading-relaxed">
              {aiNarrative}
            </div>
          )}
        </section>
      </div>

      {/* BLOCO 3: MONITOR DE CAPTURA DE ECRÃ + CALIBRAÇÃO DE ROI + LOG OCR */}
      <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Monitor className="h-4 w-4 text-emerald-400" />
              <span>Monitor de Captura de Ecrã (`getDisplayMedia`) &amp; Calibração de ROI</span>
            </h2>
            <p className="text-xs text-slate-400">
              Capture a janela do outro navegador ou carregue um print. Arraste sobre a imagem para desenhar, mover ou redimensionar a caixa ROI.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {captureActive ? (
              <button
                type="button"
                onClick={stopScreenCapture}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="h-3.5 w-3.5" />
                <span>Parar Captura</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={startScreenCapture}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5" />
                <span>Capturar Janela / Ecrã</span>
              </button>
            )}

            <button
              type="button"
              onClick={runSingleOcrPass}
              disabled={ocrBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/25 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Crosshair className="h-3.5 w-3.5" />
              <span>{ocrBusy ? 'A ler ROI...' : 'Ler ROI Agora'}</span>
            </button>

            <button
              type="button"
              onClick={() => setAutoOcrLoop((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                autoOcrLoop
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-700 bg-[#0B0F17] text-slate-300'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>{autoOcrLoop ? 'Auto OCR: ATIVO' : 'Ativar Loop OCR'}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Print</span>
            </button>
          </div>
        </div>

        {captureError && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {captureError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Área de Vídeo/Imagem com Overlay Interativo de ROI */}
          <div className="lg:col-span-8 space-y-3">
            <div
              ref={stageRef}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onMouseLeave={handleStageMouseUp}
              className="relative w-full aspect-video rounded-lg border border-slate-800 bg-black overflow-hidden select-none cursor-crosshair"
            >
              <video
                ref={videoRef}
                muted
                playsInline
                className={`w-full h-full object-contain pointer-events-none ${
                  captureActive ? 'block' : 'hidden'
                }`}
              />
              {!captureActive && (
                <img
                  ref={imgRef}
                  src={staticImageUrl}
                  alt="Pré-visualização do ecrã para calibração de ROI"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain pointer-events-none"
                />
              )}

              {/* Caixa ROI Interativa (Arrastável e Redimensionável) */}
              <div
                onMouseDown={handleBoxMoveMouseDown}
                style={{
                  left: `${activeRoi.xPct * 100}%`,
                  top: `${activeRoi.yPct * 100}%`,
                  width: `${activeRoi.wPct * 100}%`,
                  height: `${activeRoi.hPct * 100}%`,
                }}
                className="absolute border-2 border-amber-400 bg-amber-400/15 cursor-move"
              >
                <div className="bg-amber-400 text-slate-950 font-mono text-[10px] font-bold px-1.5 py-0.5 inline-block">
                  ROI: {activeProfile.name}
                </div>
                <div
                  onMouseDown={handleBoxResizeMouseDown}
                  title="Arrastar para redimensionar ROI"
                  className="absolute right-0 bottom-0 w-3.5 h-3.5 bg-amber-400 cursor-nwse-resize"
                />
              </div>
            </div>

            {/* Controles rápidos de perfil ROI e amostras visuais */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={activeProfile.id}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-200"
              >
                {roiProfiles
                  .filter((p) => p.game === game)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.expectedCells} células)
                    </option>
                  ))}
              </select>

              <label className="inline-flex items-center gap-1.5 text-slate-400">
                <span>Células:</span>
                <input
                  type="number"
                  min={4}
                  max={20}
                  value={activeProfile.expectedCells}
                  onChange={(e) => {
                    const n = Math.max(4, Math.min(20, Number(e.target.value) || 10));
                    setRoiProfiles((prev) =>
                      prev.map((p) => (p.id === activeProfile.id ? { ...p, expectedCells: n } : p))
                    );
                  }}
                  className="w-14 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-slate-100"
                />
              </label>

              <label className="inline-flex items-center gap-1.5 text-slate-400">
                <span>Intervalo:</span>
                <select
                  value={ocrIntervalMs}
                  onChange={(e) => setOcrIntervalMs(Number(e.target.value))}
                  className="rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-slate-100"
                >
                  <option value={900}>900ms</option>
                  <option value={1400}>1400ms</option>
                  <option value={2200}>2200ms</option>
                </select>
              </label>

              <div className="flex items-center gap-1 ml-auto">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Nome da casa/mesa..."
                  className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-100 w-36"
                />
                <button
                  type="button"
                  onClick={handleSaveNewProfile}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Guardar ROI</span>
                </button>
              </div>
            </div>
          </div>

          {/* Log do OCR em Tempo Real & Correção Manual Instantânea */}
          <div className="lg:col-span-4 space-y-3">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">Diagnóstico do Pipeline OCR</span>
                <span className="font-mono text-amber-300 tabular-nums">
                  Confiança: {lastOcrResult ? `${lastOcrResult.overallConfidencePct.toFixed(0)}%` : '--'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {lastOcrResult?.note ?? 'Pronto para leitura de ROI com validação por domínio e cor.'}
              </p>

              {lastOcrResult?.preprocessedPreviewUrl && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span>1.ª Célula Pré-processada:</span>
                  <img
                    src={lastOcrResult.preprocessedPreviewUrl}
                    alt="Célula binarizada para Tesseract"
                    className="h-7 rounded border border-slate-700 bg-white"
                  />
                </div>
              )}

              <div className="max-h-40 overflow-y-auto divide-y divide-slate-800/80 text-[11px] font-mono tabular-nums">
                {lastOcrResult?.cells.map((c) => (
                  <div key={c.index} className="py-1 flex items-center justify-between gap-2">
                    <span className={c.accepted ? 'text-emerald-300' : 'text-red-300'}>
                      #{c.index + 1} "{c.rawText || '-'}" ({c.detectedColor})
                    </span>
                    <span className="text-slate-400 truncate">
                      {c.accepted
                        ? `OK -> ${c.parsedValue} (${c.confidencePct.toFixed(0)}%)`
                        : c.rejectReason}
                    </span>
                  </div>
                ))}
                {!lastOcrResult && (
                  <div className="py-3 text-center font-sans text-slate-500">
                    Execute "Ler ROI Agora" para inspecionar cada célula e filtro cromático.
                  </div>
                )}
              </div>
            </div>

            {/* Correção Manual / Colagem de até 500 rodadas */}
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5 space-y-2.5">
              <div className="text-xs font-semibold text-slate-200">
                Correção Manual &amp; Importação (até 500 rodadas)
              </div>
              <form onSubmit={handleAddSingleValue} className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualSingleInput}
                  onChange={(e) => setManualSingleInput(e.target.value)}
                  placeholder={game === 'roulette' ? 'Número 0–36 (ex: 18)' : 'Mult. >=1.00 (ex: 6.36)'}
                  className="flex-1 rounded-lg border border-slate-700 bg-[#131924] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Inserir</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (game === 'roulette') setRouletteHistory((p) => p.slice(1));
                    else setAviatorHistory((p) => p.slice(1));
                  }}
                  title="Remover último resultado registado"
                  className="rounded-lg border border-slate-700 bg-[#131924] px-2 py-1.5 text-xs text-slate-300 hover:text-red-300 cursor-pointer"
                >
                  Desfazer
                </button>
              </form>

              <form onSubmit={handleBulkPasteImport} className="space-y-1.5">
                <textarea
                  rows={2}
                  value={bulkPasteInput}
                  onChange={(e) => setBulkPasteInput(e.target.value)}
                  placeholder={
                    game === 'roulette'
                      ? 'Colar sequência (mais recente à esquerda): 27 34 16 32 10 18 0 28 13 19'
                      : 'Colar sequência: 3.57x 11.43x 1.28x 1.33x 2.21x 19.12x 1.40x'
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#131924] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
                <button
                  type="submit"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
                >
                  Importar Histórico para Análise
                </button>
              </form>
              {inputNotice && <div className="text-[11px] text-emerald-400">{inputNotice}</div>}
            </div>
          </div>
        </div>
      </section>

      {/* BLOCO 4: ESTATÍSTICAS QUANTITATIVAS DO MODO ATIVO (ROLETA OU AVIATOR) */}
      <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-sky-400" />
          <span>
            {game === 'roulette'
              ? 'Análise Estatística Roleta Europeia (Setores, Atrasos & Vizinhos ±2)'
              : 'Análise Estatística Aviator (5 Faixas, Streaks & Gaps Roxo/Rosa)'}
          </span>
        </h2>

        {game === 'roulette' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 text-xs">
            <div className="space-y-2">
              <div className="font-semibold text-slate-300">Apostas Externas &amp; Atrasos</div>
              <div className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {[
                  rouletteReport.colors.red,
                  rouletteReport.colors.black,
                  rouletteReport.colors.green,
                  rouletteReport.parity.even,
                  rouletteReport.parity.odd,
                  rouletteReport.halves.low,
                  rouletteReport.halves.high,
                ].map((g) => (
                  <div key={g.id} className="py-1.5 flex items-center justify-between">
                    <span className="font-sans text-slate-300">{g.label}</span>
                    <span className="text-slate-200">
                      {g.pct.toFixed(1)}% · Atraso {g.currentDelay} (máx {g.maxDelay})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-300">Dúzias &amp; Colunas</div>
              <div className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {[...rouletteReport.dozens, ...rouletteReport.columns].map((g) => (
                  <div key={g.id} className="py-1.5 flex items-center justify-between">
                    <span className="font-sans text-slate-300">{g.label}</span>
                    <span className="text-slate-200">
                      {g.pct.toFixed(1)}% · Atraso {g.currentDelay} (máx {g.maxDelay})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="font-semibold text-slate-300">Setores Físicos da Roda &amp; Vizinhos ±2</div>
              <div className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {rouletteReport.sectors.map((s) => (
                  <div key={s.id} className="py-1.5 flex items-center justify-between">
                    <span className="font-sans text-slate-200">{s.label}</span>
                    <span className={s.deltaPct >= 0 ? 'text-emerald-300' : 'text-slate-400'}>
                      {s.pct.toFixed(1)}% ({s.deltaPct >= 0 ? '+' : ''}
                      {s.deltaPct.toFixed(1)}pp)
                    </span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 pt-2 space-y-1 text-xs">
                <div className="text-slate-400">
                  Âncora calculada:{' '}
                  <strong className="font-mono text-amber-300">{rouletteReport.recommendedAnchor}</strong> · Vizinhos ±2:{' '}
                  <strong className="font-mono text-slate-100">
                    {rouletteReport.neighborsPlusMinus2.join(', ')}
                  </strong>
                </div>
                <div className="text-slate-400">
                  Quentes: {rouletteReport.hotNumbers.map((h) => `${h.number}(${h.count}×)`).join(' · ')}
                </div>
                <div className="text-slate-400">
                  Frios (atraso): {rouletteReport.coldNumbers.map((c) => `${c.number}(${c.currentDelay}r)`).join(' · ')}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
            <div className="space-y-2">
              <div className="font-semibold text-slate-300">Distribuição por Faixas</div>
              {aviatorReport.bands.map((b) => (
                <div key={b.key} className="space-y-1">
                  <div className="flex justify-between font-mono tabular-nums">
                    <span className={`font-sans font-medium ${b.colorClass}`}>{b.label}</span>
                    <span className="text-slate-300">
                      {b.count} ({b.pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#0B0F17] overflow-hidden">
                    <div
                      className="h-full bg-red-500"
                      style={{ width: `${Math.min(100, b.pct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
              <div className="border-t border-slate-800 pt-2">
                <div className="font-sans text-slate-400">Média 10 / 20 / Geral</div>
                <div className="text-sm font-bold text-slate-100 mt-0.5">
                  {aviatorReport.movingAvg10.toFixed(2)}x / {aviatorReport.movingAvg20.toFixed(2)}x /{' '}
                  {aviatorReport.overallAvg.toFixed(2)}x
                </div>
              </div>
              <div className="border-t border-slate-800 pt-2">
                <div className="font-sans text-slate-400">Mediana / Desvio Padrão 20</div>
                <div className="text-sm font-bold text-amber-300 mt-0.5">
                  {aviatorReport.medianAll.toFixed(2)}x / σ {aviatorReport.recent20StdDev.toFixed(2)}
                </div>
              </div>
              <div className="border-t border-slate-800 pt-2">
                <div className="font-sans text-slate-400">Sequência Baixa (&lt;2x / &lt;1.5x)</div>
                <div className="text-sm font-bold text-sky-300 mt-0.5">
                  {aviatorReport.lowUnder2StreakCurrent}x (máx {aviatorReport.lowUnder2StreakMax}) ·{' '}
                  {aviatorReport.lowUnder150StreakCurrent}x
                </div>
              </div>
              <div className="border-t border-slate-800 pt-2">
                <div className="font-sans text-slate-400">Gaps Roxo / Rosa</div>
                <div className="text-sm font-bold text-fuchsia-300 mt-0.5">
                  &gt;=2x: {aviatorReport.purpleGap.currentGap}r · &gt;=10x: {aviatorReport.pinkGap.currentGap}r
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* BLOCO 5: GESTOR DE ESTRATÉGIAS, APRENDIZAGEM OOS, EVOLUÇÃO & CONTROLO DE BANCA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-400" />
                <span>Estratégias, Aprendizagem Point-in-Time &amp; Motor de Evolução</span>
              </h2>
              <p className="text-xs text-slate-400">
                Avaliação estrita antes do resultado ocorrer (janelas 30 / 100 / 300) + mutação controlada.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunEvolution}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-purple-500 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Evoluir Estratégias (OOS)</span>
            </button>
          </div>

          {evolutionBanner && (
            <div className="rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs text-purple-200">
              {evolutionBanner}
            </div>
          )}

          {/* Tabela de Ranking OOS */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-sans">
                  <th className="py-2 pr-2">Ativa</th>
                  <th className="py-2 px-2">Estratégia</th>
                  <th className="py-2 px-2 text-right">Consist.</th>
                  <th className="py-2 px-2 text-right">Acerto OOS</th>
                  <th className="py-2 px-2 text-right">ROI Sim.</th>
                  <th className="py-2 px-2 text-right">Drawdown</th>
                  <th className="py-2 pl-2 text-right">Sinal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {strategies
                  .filter((s) => s.game === game)
                  .map((s) => {
                    const ev = learningReport.evaluations.find((e) => e.strategy.id === s.id);
                    return (
                      <tr key={s.id} className="hover:bg-slate-800/20">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={s.enabled}
                            onChange={() =>
                              setStrategies((prev) =>
                                prev.map((item) =>
                                  item.id === s.id ? { ...item, enabled: !item.enabled } : item
                                )
                              )
                            }
                          />
                        </td>
                        <td className="py-2 px-2 font-sans">
                          <div className="font-medium text-slate-100 flex items-center gap-1.5">
                            <span>{s.name}</span>
                            {s.isCustom && (
                              <button
                                type="button"
                                onClick={() =>
                                  setStrategies((prev) => prev.filter((item) => item.id !== s.id))
                                }
                                title="Remover estratégia customizada"
                                className="text-slate-500 hover:text-red-400 cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">{s.description}</div>
                        </td>
                        <td className="py-2 px-2 text-right text-amber-300 font-bold">
                          {ev ? `${ev.consistencyScore}/100` : '--'}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-200">
                          {ev ? `${ev.outOfSampleHitRatePct.toFixed(1)}% (${ev.outOfSampleEntries})` : '--'}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-semibold ${
                            (ev?.overall.roiPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {ev ? `${ev.overall.roiPct >= 0 ? '+' : ''}${ev.overall.roiPct.toFixed(1)}%` : '--'}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-300">
                          {ev ? `${ev.overall.maxDrawdownPct.toFixed(1)}%` : '--'}
                        </td>
                        <td className="py-2 pl-2 text-right font-sans">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              ev?.currentSignal.active
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {ev?.currentSignal.active ? ev.currentSignal.targetDescription : 'AGUARDA'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Criador de Nova Estratégia */}
          <form
            onSubmit={handleCreateStrategy}
            className="pt-3 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs"
          >
            <input
              type="text"
              value={newStratName}
              onChange={(e) => setNewStratName(e.target.value)}
              placeholder="Nome da nova estratégia..."
              className="sm:col-span-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 text-slate-100"
            />
            <select
              value={newStratRule}
              onChange={(e) => setNewStratRule(e.target.value as QuantStrategyRuleType)}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-2 text-slate-200"
            >
              {game === 'roulette' ? (
                <>
                  <option value="roulette_absence">Ausência Dúzia (Gatilho)</option>
                  <option value="roulette_streak_break">Quebra Sequência Cor</option>
                  <option value="roulette_streak_follow">Continuação Cor</option>
                  <option value="roulette_sector_confluence">Confluência Setor/Vizinhos</option>
                </>
              ) : (
                <>
                  <option value="aviator_post_low_recovery">Pós-Baixos &lt;1.5x</option>
                  <option value="aviator_conservative_stable">Estabilidade Sem &lt;1.1x</option>
                  <option value="aviator_window_frequency">Frequência Janela</option>
                  <option value="aviator_purple_cluster">Bloco Velas Roxas</option>
                </>
              )}
            </select>
            <input
              type="text"
              value={newStratParamA}
              onChange={(e) => setNewStratParamA(e.target.value)}
              placeholder={game === 'roulette' ? 'Gatilho (ex: 5)' : 'Seq./Janela (ex: 3)'}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 font-mono text-slate-100"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-400 px-3 py-2 font-semibold text-slate-950 hover:bg-amber-300 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Criar</span>
            </button>
          </form>
        </section>

        {/* Controlo Rigoroso de Banca (Stop-Loss / Stop-Win / Pausa N Perdas) */}
        <section className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-400" />
              <span>Controlo de Banca</span>
            </h2>
            <span className="font-mono text-xs text-slate-400">Sem Martingale</span>
          </div>

          {analystDecision.bankrollBlocked && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Pausa Obrigatória</span>
              </div>
              {analystDecision.bankrollBlockReasons.map((r, i) => (
                <div key={i}>• {r}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 font-mono text-xs tabular-nums">
            <div className="border-t border-slate-800 pt-2">
              <div className="font-sans text-[11px] text-slate-400">Saldo Sessão</div>
              <div className="text-base font-bold text-slate-100">
                {bankroll.currentBalanceAoa.toFixed(0)} AOA
              </div>
            </div>
            <div className="border-t border-slate-800 pt-2">
              <div className="font-sans text-[11px] text-slate-400">Resultado Líquido</div>
              <div
                className={`text-base font-bold ${
                  bankroll.sessionPnlAoa >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {bankroll.sessionPnlAoa >= 0 ? '+' : ''}
                {bankroll.sessionPnlAoa.toFixed(0)} AOA
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            {[
              { key: 'baseStakeAoa', label: 'Entrada Fixa (AOA)' },
              { key: 'stopLossAoa', label: 'Stop-Loss (AOA)' },
              { key: 'stopWinAoa', label: 'Stop-Win (AOA)' },
              { key: 'pauseAfterConsecutiveLosses', label: 'Pausa após N perdas' },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-slate-400 mb-1">{f.label}</label>
                <input
                  type="number"
                  min={1}
                  value={bankroll[f.key as keyof QuantBankrollPolicy] as number}
                  onChange={(e) =>
                    setBankroll((prev) => ({
                      ...prev,
                      [f.key]: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleRecordBankrollOutcome(true, game === 'roulette' ? 2 : 1.6)}
              className="flex-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
            >
              + Registar Acerto
            </button>
            <button
              type="button"
              onClick={() => handleRecordBankrollOutcome(false)}
              className="flex-1 rounded-lg bg-red-500/20 border border-red-500/40 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/30 cursor-pointer"
            >
              - Registar Perda
            </button>
            <button
              type="button"
              onClick={() =>
                setBankroll((prev) => ({
                  ...prev,
                  currentBalanceAoa: prev.initialBalanceAoa,
                  sessionPnlAoa: 0,
                  consecutiveLosses: 0,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Reiniciar Banca da Sessão
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
