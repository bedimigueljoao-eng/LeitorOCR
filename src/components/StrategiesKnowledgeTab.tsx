import React, { useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Crosshair,
  Download,
  Eye,
  Play,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Square,
  TrendingUp,
} from 'lucide-react';
import {
  BankrollPolicyConfig,
  buildPureObservation,
  computeMasterBet,
  DISCLAIMER_TEXT,
  evaluateStrategySignals,
  HOUSE_EDGE_KNOWLEDGE_TABLE,
  runBankrollSimulation,
  SessionBetEntry,
  UnifiedGameKey,
  VirtualSimConfig,
} from '../modules/strategy/masterBetEngine';
import type { BacBoRoundRecord } from '../modules/bacbo';
import type { AviatorRoundRecord } from '../modules/aviator';
import {
  BacBoScanMode,
  BrowserScanner,
  HsvColorProfileConfig,
  OcrDebugOverlayEvent,
  RoiRectConfig,
} from '../plugins/browserScanner';

type SubTab = 'strategies' | 'knowledge' | 'calibration';

interface StrategiesKnowledgeTabProps {
  activeGameDefault: UnifiedGameKey;
  rouletteSpinsNewestFirst: number[];
  bacboRounds: BacBoRoundRecord[];
  aviatorRounds: AviatorRoundRecord[];
  isAndroidApk: boolean;
  activeSite: string;
  onChangeSite: (site: string) => void;
  bacboScanMode: BacBoScanMode;
  onChangeBacBoScanMode: (mode: BacBoScanMode) => void;
  debugOverlayEnabled: boolean;
  onToggleDebugOverlay: (enabled: boolean) => void;
  latestDebugOverlay: OcrDebugOverlayEvent | null;
  captureRunning: boolean;
  captureIntervalMs: number;
  onStartUnifiedCapture: (game: UnifiedGameKey) => void;
  onStopUnifiedCapture: () => void;
  onChangeCaptureInterval: (ms: number) => void;
  bankrollPolicy: BankrollPolicyConfig;
  onUpdateBankrollPolicy: (cfg: BankrollPolicyConfig) => void;
  sessionLedger: SessionBetEntry[];
  onRecordSessionBet: (entry: SessionBetEntry) => void;
  onResetSessionLedger: () => void;
}

const SITE_OPTIONS = ['kwanzabet', 'creedroomz', 'evolution', 'spribe'] as const;

export const StrategiesKnowledgeTab: React.FC<StrategiesKnowledgeTabProps> = ({
  activeGameDefault,
  rouletteSpinsNewestFirst,
  bacboRounds,
  aviatorRounds,
  isAndroidApk,
  activeSite,
  onChangeSite,
  bacboScanMode,
  onChangeBacBoScanMode,
  debugOverlayEnabled,
  onToggleDebugOverlay,
  latestDebugOverlay,
  captureRunning,
  captureIntervalMs,
  onStartUnifiedCapture,
  onStopUnifiedCapture,
  onChangeCaptureInterval,
  bankrollPolicy,
  onUpdateBankrollPolicy,
  sessionLedger,
  onRecordSessionBet,
  onResetSessionLedger,
}) => {
  const [subTab, setSubTab] = useState<SubTab>('strategies');
  const [selectedGame, setSelectedGame] = useState<UnifiedGameKey>(activeGameDefault);
  const [obsWindow, setObsWindow] = useState<number>(80);

  // Calibração ROI & HSV state
  const [roiDraft, setRoiDraft] = useState<RoiRectConfig>(() => {
    if (selectedGame === 'bacbo') return { leftRatio: 0, topRatio: 0.34, widthRatio: 1, heightRatio: 0.4 };
    if (selectedGame === 'aviator') return { leftRatio: 0, topRatio: 0.14, widthRatio: 1, heightRatio: 0.34 };
    return { leftRatio: 0, topRatio: 0.04, widthRatio: 1, heightRatio: 0.08 };
  });
  const [hsvProfile, setHsvProfile] = useState<HsvColorProfileConfig | null>(null);
  const [calibFeedback, setCalibFeedback] = useState<string | null>(null);
  const [sampleRgbLabel, setSampleRgbLabel] = useState<'RED' | 'GREEN' | 'BLACK' | 'P' | 'B' | 'T'>('RED');
  const [sampleHex, setSampleHex] = useState<string>('#B91C1C');
  const [dbCsvPreview, setDbCsvPreview] = useState<string | null>(null);

  // Simulador virtual
  const [simCfg, setSimCfg] = useState<VirtualSimConfig>({
    game: activeGameDefault,
    rounds: 250,
    startingBalanceAoa: 1000,
    baseStakeAoa: 20,
    strategy: 'flat_low_edge',
    seed: 101,
  });
  const [simSeedCounter, setSimSeedCounter] = useState<number>(101);

  const ocrConfidencePct = useMemo(() => {
    if (latestDebugOverlay && latestDebugOverlay.gameMode === selectedGame && latestDebugOverlay.confidence > 0) {
      return Math.round(latestDebugOverlay.confidence * 100);
    }
    return 88;
  }, [latestDebugOverlay, selectedGame]);

  const observation = useMemo(
    () =>
      buildPureObservation({
        game: selectedGame,
        rouletteNewestFirst: rouletteSpinsNewestFirst,
        bacboRounds,
        aviatorRounds,
        windowSize: obsWindow,
      }),
    [selectedGame, rouletteSpinsNewestFirst, bacboRounds, aviatorRounds, obsWindow]
  );

  const signals = useMemo(
    () =>
      evaluateStrategySignals({
        game: selectedGame,
        rouletteNewestFirst: rouletteSpinsNewestFirst,
        bacboRounds,
        aviatorRounds,
        ocrConfidencePct,
      }),
    [selectedGame, rouletteSpinsNewestFirst, bacboRounds, aviatorRounds, ocrConfidencePct]
  );

  const masterBet = useMemo(
    () =>
      computeMasterBet({
        game: selectedGame,
        signals,
        bankroll: bankrollPolicy,
        ocrConfidencePct,
      }),
    [selectedGame, signals, bankrollPolicy, ocrConfidencePct]
  );

  const simResult = useMemo(
    () => runBankrollSimulation({ ...simCfg, seed: simSeedCounter }),
    [simCfg, simSeedCounter]
  );

  const sessionPnlAoa = bankrollPolicy.currentBalanceAoa - bankrollPolicy.initialBalanceAoa;
  const sessionPnlPct =
    bankrollPolicy.initialBalanceAoa > 0
      ? (sessionPnlAoa / bankrollPolicy.initialBalanceAoa) * 100
      : 0;

  const handleLogQuickOutcome = (action: 'followed' | 'skipped', won: boolean) => {
    const stake = action === 'skipped' ? 0 : Math.max(1, masterBet.suggestedStakeAoa || 10);
    const pnl = action === 'skipped' ? 0 : won ? stake : -stake;
    const nextBalance = Math.max(0, Number((bankrollPolicy.currentBalanceAoa + pnl).toFixed(2)));
    onRecordSessionBet({
      id: `bet-${Date.now()}`,
      timestamp: Date.now(),
      game: selectedGame,
      site: activeSite,
      suggestedMarket: masterBet.market,
      suggestedDirection: masterBet.direction,
      suggestedStakeAoa: masterBet.suggestedStakeAoa,
      userAction: action,
      realStakeAoa: stake,
      won,
      pnlAoa: pnl,
      balanceAfterAoa: nextBalance,
    });
    onUpdateBankrollPolicy({
      ...bankrollPolicy,
      currentBalanceAoa: nextBalance,
    });
  };

  const handleLoadNativeRoiAndHsv = async () => {
    if (!isAndroidApk) {
      setCalibFeedback('Perfil visual simulado na web. No APK Android sincroniza diretamente com SharedPreferences.');
      return;
    }
    try {
      const rect = await BrowserScanner.getRoiRect({ game: selectedGame, site: activeSite });
      setRoiDraft(rect);
      const hsv = await BrowserScanner.getHsvProfile({ site: activeSite });
      setHsvProfile(hsv);
      setCalibFeedback(`ROI e perfil HSV de "${activeSite}" carregados.`);
    } catch {
      setCalibFeedback('Não foi possível ler o perfil nativo.');
    }
  };

  const handleSaveNativeRoi = async () => {
    if (!isAndroidApk) {
      setCalibFeedback(`ROI gravada localmente (${selectedGame} · ${activeSite}).`);
      return;
    }
    await BrowserScanner.saveRoiRect({
      game: selectedGame,
      site: activeSite,
      ...roiDraft,
    });
    setCalibFeedback(`ROI de "${activeSite}" (${selectedGame}) guardada no serviço de captura.`);
  };

  const handleCalibrateSampleHex = async () => {
    const clean = sampleHex.replace('#', '');
    if (clean.length !== 6) return;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!isAndroidApk) {
      setCalibFeedback(`Amostra ${sampleRgbLabel} RGB(${r},${g},${b}) registada para ${activeSite}.`);
      return;
    }
    const updated = await BrowserScanner.calibrateHsvProfile({
      site: activeSite,
      samples: [{ label: sampleRgbLabel, r, g, b }],
    });
    setHsvProfile(updated);
    setCalibFeedback(`Perfil HSV "${activeSite}" atualizado (${updated.calibratedSamplesCount} amostras).`);
  };

  const handleExportCsv = async () => {
    if (isAndroidApk) {
      try {
        const res = await BrowserScanner.exportDbCsv({ game: selectedGame });
        setDbCsvPreview(res.csv);
        const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `roletavision_${selectedGame}_${activeSite}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      } catch {
        // Fallback para exportação Web abaixo
      }
    }

    const lines: string[] = [];
    if (selectedGame === 'roulette') {
      lines.push('index,number,color');
      rouletteSpinsNewestFirst.forEach((n, idx) => {
        lines.push(`${idx + 1},${n},european`);
      });
    } else if (selectedGame === 'bacbo') {
      lines.push('round,timestamp,outcome,player_total,banker_total,source');
      bacboRounds.forEach((r) => {
        lines.push(`${r.roundNumber},${new Date(r.timestamp).toISOString()},${r.outcome},${r.playerTotal ?? ''},${r.bankerTotal ?? ''},${r.source}`);
      });
    } else {
      lines.push('round,timestamp,multiplier,color_tier,source');
      aviatorRounds.forEach((r) => {
        lines.push(`${r.roundNumber},${new Date(r.timestamp).toISOString()},${r.multiplier.toFixed(2)},${r.colorTier},${r.source}`);
      });
    }
    const csv = lines.join('\n');
    setDbCsvPreview(csv);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roletavision_${selectedGame}_web.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Curva SVG do simulador virtual
  const simSvgPoints = useMemo(() => {
    const curve = simResult.balanceCurve;
    if (curve.length < 2) return '';
    const min = Math.min(...curve);
    const max = Math.max(...curve);
    const span = Math.max(1, max - min);
    return curve
      .map((val, idx) => {
        const x = (idx / (curve.length - 1)) * 560;
        const y = 130 - ((val - min) / span) * 114;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [simResult.balanceCurve]);

  return (
    <div className="space-y-6">
      {/* Cabeçalho e Seletores Unificados */}
      <section className="rounded-xl border border-slate-800 bg-[#131924] p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Motor Estratégico &amp; Captura Unificada</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-200">
                Site: {activeSite}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-emerald-400">
                OCR {ocrConfidencePct}%
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-100">
              Estratégias, Aposta Mestra e Calibração
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor de Jogo */}
            <div className="inline-flex rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5">
              {(
                [
                  { id: 'roulette', label: 'Roleta' },
                  { id: 'bacbo', label: 'Bac Bo' },
                  { id: 'aviator', label: 'Aviator' },
                ] as const
              ).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setSelectedGame(g.id);
                    setSimCfg((prev) => ({ ...prev, game: g.id }));
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedGame === g.id
                      ? 'bg-slate-800 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Sub-Abas */}
            <div className="inline-flex rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5">
              {(
                [
                  { id: 'strategies', label: 'Estratégias & Banca', icon: TrendingUp },
                  { id: 'knowledge', label: 'Conhecimento / Treino', icon: BookOpen },
                  { id: 'calibration', label: 'Calibração ROI & HSV', icon: Sliders },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSubTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      subTab === tab.id
                        ? 'bg-emerald-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {subTab === 'strategies' && (
        <div className="space-y-6">
          {/* 1. Aposta Mestra + Gestão de Banca */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#131924] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-slate-400">
                      Aposta Mestra · Base Amostral n={masterBet.sampleSize} · Vantagem da Casa {masterBet.houseEdgePct.toFixed(2)}%
                    </div>
                    <h2 className="text-lg font-semibold text-slate-100 mt-0.5">
                      {masterBet.action === 'APOSTAR'
                        ? `${masterBet.market} — ${masterBet.direction}`
                        : `AGUARDAR — ${masterBet.market}`}
                    </h2>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div
                      className={`text-2xl font-bold ${
                        masterBet.score >= 70
                          ? 'text-emerald-400'
                          : masterBet.score >= 42
                          ? 'text-amber-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {masterBet.score}/100
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Confiança {masterBet.confidenceTier} · Stake {masterBet.suggestedStakeAoa.toFixed(2)} AOA
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{masterBet.rationale}</p>

                {masterBet.bankrollBlockedReason && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-200">
                    <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{masterBet.bankrollBlockedReason}</span>
                  </div>
                )}

                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 text-[11px] text-amber-200/90">
                  {masterBet.disclaimer}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
                <span className="text-xs text-slate-400">Registar resultado da ronda na sessão:</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleLogQuickOutcome('followed', true)}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Segui e Ganhei
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLogQuickOutcome('followed', false)}
                    className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Segui e Perdi
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLogQuickOutcome('skipped', false)}
                    className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Ignorei
                  </button>
                </div>
              </div>
            </div>

            {/* Gestão de Banca Unificada */}
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-100">Gestão de Banca Real</h2>
                <span
                  className={`font-mono text-xs font-bold tabular-nums ${
                    sessionPnlAoa >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {sessionPnlAoa >= 0 ? '+' : ''}
                  {sessionPnlAoa.toFixed(2)} AOA ({sessionPnlPct >= 0 ? '+' : ''}
                  {sessionPnlPct.toFixed(1)}%)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Banca Inicial (AOA)</label>
                  <input
                    type="number"
                    min={10}
                    value={bankrollPolicy.initialBalanceAoa}
                    onChange={(e) =>
                      onUpdateBankrollPolicy({
                        ...bankrollPolicy,
                        initialBalanceAoa: Math.max(10, Number(e.target.value)),
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Saldo Atual (AOA)</label>
                  <input
                    type="number"
                    min={0}
                    value={bankrollPolicy.currentBalanceAoa}
                    onChange={(e) =>
                      onUpdateBankrollPolicy({
                        ...bankrollPolicy,
                        currentBalanceAoa: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Unidade Base (%)</label>
                  <input
                    type="number"
                    step={0.5}
                    min={0.5}
                    max={10}
                    value={bankrollPolicy.unitPct}
                    onChange={(e) =>
                      onUpdateBankrollPolicy({
                        ...bankrollPolicy,
                        unitPct: Math.max(0.5, Math.min(10, Number(e.target.value))),
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Stop-Loss %</label>
                    <input
                      type="number"
                      min={5}
                      max={80}
                      value={bankrollPolicy.dailyStopLossPct}
                      onChange={(e) =>
                        onUpdateBankrollPolicy({
                          ...bankrollPolicy,
                          dailyStopLossPct: Math.max(5, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-2 font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Stop-Win %</label>
                    <input
                      type="number"
                      min={5}
                      max={200}
                      value={bankrollPolicy.dailyStopWinPct}
                      onChange={(e) =>
                        onUpdateBankrollPolicy({
                          ...bankrollPolicy,
                          dailyStopWinPct: Math.max(5, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-2 font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                <span className="text-slate-400">
                  {sessionLedger.length} entradas registadas na sessão
                </span>
                <button
                  type="button"
                  onClick={onResetSessionLedger}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reiniciar Sessão</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. Observação Pura (50–100 rodadas) + Sinais Ranqueados */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    01. Observação Pura (Sem Previsões)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Contagens reais, atrasos e sequências das últimas {observation.sampleSize} rodadas
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5 text-xs">
                  {[50, 80, 100].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setObsWindow(w)}
                      className={`px-2.5 py-1 rounded-md font-mono cursor-pointer ${
                        obsWindow === w ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              {observation.metrics.length === 0 ? (
                <p className="text-xs text-slate-500 py-6">
                  Sem dados capturados ainda para este jogo. Capture rodadas ou insira resultados manualmente.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-3 font-medium">Métrica</th>
                        <th className="py-2 px-2 font-medium text-right">Qtd</th>
                        <th className="py-2 px-2 font-medium text-right">Obs %</th>
                        <th className="py-2 px-2 font-medium text-right">Base %</th>
                        <th className="py-2 px-2 font-medium text-right">Atraso</th>
                        <th className="py-2 pl-2 font-medium text-right">Máx Seq</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                      {observation.metrics.map((m) => (
                        <tr key={m.label} className="hover:bg-slate-800/30">
                          <td className="py-2 pr-3 font-sans font-medium text-slate-200">{m.label}</td>
                          <td className="py-2 px-2 text-right text-slate-300">{m.count}</td>
                          <td className="py-2 px-2 text-right text-slate-100">{m.pct.toFixed(1)}%</td>
                          <td className="py-2 px-2 text-right text-slate-500">{m.expectedPct.toFixed(1)}%</td>
                          <td className="py-2 px-2 text-right text-amber-300">{m.currentDelay}</td>
                          <td className="py-2 pl-2 text-right text-slate-400">{m.maxStreak}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 2. Sinais com Score 0–100 */}
            <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  02. Sinais Ranqueados (Score 0–100)
                </h2>
                <p className="text-xs text-slate-400">
                  Combina atraso recente, frequência na amostra e vantagem matemática da casa
                </p>
              </div>

              {signals.length === 0 ? (
                <p className="text-xs text-slate-500 py-6">
                  Aguardando histórico mínimo para calcular sinais.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {signals.map((sig) => (
                    <div key={sig.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm text-slate-100">
                          {sig.market} · <span className="text-emerald-400">{sig.direction}</span>
                        </div>
                        <div className="font-mono text-xs tabular-nums shrink-0">
                          <span
                            className={
                              sig.score >= 70
                                ? 'text-emerald-400 font-bold'
                                : sig.score >= 42
                                ? 'text-amber-300 font-bold'
                                : 'text-slate-400'
                            }
                          >
                            {sig.score}/100 ({sig.confidenceTier})
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-slate-400">{sig.statisticalBasis}</div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        Amostra n={sig.sampleSize} · Vantagem casa {sig.houseEdgePct.toFixed(2)}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* 3. Histórico Real vs Sugestão */}
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-100">
              Histórico da Sessão (Sugestão da App vs Decisão Real)
            </h2>
            {sessionLedger.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nenhuma entrada registada ainda nesta sessão. Use os botões acima no cartão Aposta Mestra.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-3 font-medium">Hora</th>
                      <th className="py-2 px-2 font-medium">Jogo / Site</th>
                      <th className="py-2 px-2 font-medium">Sugestão</th>
                      <th className="py-2 px-2 font-medium">Decisão</th>
                      <th className="py-2 px-2 font-medium text-right">Stake Real</th>
                      <th className="py-2 pl-2 font-medium text-right">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {sessionLedger.slice(0, 15).map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-3 text-slate-400">
                          {new Date(row.timestamp).toLocaleTimeString('pt-PT', { hour12: false })}
                        </td>
                        <td className="py-2 px-2 font-sans text-slate-200">
                          {row.game} · {row.site}
                        </td>
                        <td className="py-2 px-2 font-sans text-slate-300">{row.suggestedDirection}</td>
                        <td className="py-2 px-2 font-sans text-slate-400">
                          {row.userAction === 'followed' ? 'Seguiu' : 'Ignorou'}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-200">
                          {row.realStakeAoa.toFixed(2)} AOA
                        </td>
                        <td
                          className={`py-2 pl-2 text-right font-semibold ${
                            row.pnlAoa > 0
                              ? 'text-emerald-400'
                              : row.pnlAoa < 0
                              ? 'text-red-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {row.pnlAoa > 0 ? '+' : ''}
                          {row.pnlAoa.toFixed(2)} AOA
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {subTab === 'knowledge' && (
        <div className="space-y-6">
          {/* Tabela Matemática de Probabilidades e Vantagem da Casa */}
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Probabilidades Reais e Vantagem da Casa (House Edge)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Conhecer o custo matemático de cada mercado evita apostas de alto prejuízo a longo prazo.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">Jogo</th>
                    <th className="py-2 px-3 font-medium">Mercado</th>
                    <th className="py-2 px-3 font-medium text-right">Prob. Real</th>
                    <th className="py-2 px-3 font-medium text-right">Pagamento</th>
                    <th className="py-2 px-3 font-medium text-right">Vantagem Casa</th>
                    <th className="py-2 pl-3 font-medium">Nota Técnica</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {HOUSE_EDGE_KNOWLEDGE_TABLE.map((row) => (
                    <tr key={`${row.game}-${row.market}`} className="hover:bg-slate-800/30">
                      <td className="py-2.5 pr-3 font-medium text-slate-100 whitespace-nowrap">{row.game}</td>
                      <td className="py-2.5 px-3 text-slate-200">{row.market}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">{row.winProbPct}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">{row.payout}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-amber-300">
                        {row.houseEdgePct}
                      </td>
                      <td className="py-2.5 pl-3 text-slate-400">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Falácia do Apostador + Simulador de Banca Virtual */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-100">
                Padrões Observáveis vs Imprevisibilidade (RNG)
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Cada giro na roleta, lançamento de dados no Bac Bo ou ronda no Aviator é{' '}
                <strong className="text-slate-100">estatisticamente independente</strong>. Mesmo após
                8 vermelhos seguidos, a probabilidade de vermelho no próximo giro europeu continua a
                ser exatamente <span className="font-mono text-emerald-400">18/37 (48.65%)</span> —
                presumir que uma cor &ldquo;tem de sair agora&rdquo; é a{' '}
                <strong className="text-amber-300">Falácia do Apostador</strong>.
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                O papel da análise quantitativa aqui é <strong className="text-slate-100">gerir risco</strong>:
                medir volatilidade atual, evitar sessões erráticas, optar por mercados de menor house
                edge (ex.: 1.21% no Player/Banker vs 12.1% no Tie) e aplicar limites estritos de
                Stop-Loss/Stop-Win.
              </p>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 text-[11px] text-amber-200/90">
                {DISCLAIMER_TEXT}
              </div>
            </div>

            <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Simulador de Banca Virtual (Sem Risco Real)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Teste estratégias ao longo de centenas de rondas com RNG real
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSimSeedCounter((s) => s + 17)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Nova Simulação</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Jogo</label>
                  <select
                    value={simCfg.game}
                    onChange={(e) => setSimCfg((p) => ({ ...p, game: e.target.value as UnifiedGameKey }))}
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 text-slate-100"
                  >
                    <option value="roulette">Roleta (2.70%)</option>
                    <option value="bacbo">Bac Bo P/B (1.21%)</option>
                    <option value="aviator">Aviator 1.5x (3.00%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Estratégia</label>
                  <select
                    value={simCfg.strategy}
                    onChange={(e) =>
                      setSimCfg((p) => ({
                        ...p,
                        strategy: e.target.value as VirtualSimConfig['strategy'],
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 text-slate-100"
                  >
                    <option value="flat_low_edge">Fixa (Baixo Edge)</option>
                    <option value="selective_delay">Seletiva (Menos Entradas)</option>
                    <option value="martingale_capped">Martingale (Teto 8x)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Rondas</label>
                  <input
                    type="number"
                    min={50}
                    max={1000}
                    step={50}
                    value={simCfg.rounds}
                    onChange={(e) => setSimCfg((p) => ({ ...p, rounds: Number(e.target.value) || 200 }))}
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Stake Base (AOA)</label>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={simCfg.baseStakeAoa}
                    onChange={(e) => setSimCfg((p) => ({ ...p, baseStakeAoa: Number(e.target.value) || 20 }))}
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 font-mono text-slate-100"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <svg viewBox="0 0 560 140" className="w-full h-32">
                  <polyline
                    fill="none"
                    stroke={simResult.netPnlAoa >= 0 ? '#10B981' : '#F59E0B'}
                    strokeWidth="2.2"
                    points={simSvgPoints}
                  />
                </svg>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs tabular-nums">
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] font-sans text-slate-400">Saldo Final</div>
                  <div className="font-bold text-slate-100 mt-0.5">{simResult.endingBalanceAoa} AOA</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] font-sans text-slate-400">Lucro / Prejuízo</div>
                  <div className={`font-bold mt-0.5 ${simResult.netPnlAoa >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {simResult.netPnlAoa >= 0 ? '+' : ''}
                    {simResult.netPnlAoa} AOA
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] font-sans text-slate-400">Drawdown Máx</div>
                  <div className="font-bold text-amber-300 mt-0.5">-{simResult.maxDrawdownPct}%</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] font-sans text-slate-400">Taxa de Acerto</div>
                  <div className="font-bold text-slate-200 mt-0.5">{simResult.hitRatePct}%</div>
                </div>
              </div>
              <p className="text-xs text-slate-400">{simResult.takeaway}</p>
            </div>
          </div>
        </div>
      )}

      {subTab === 'calibration' && (
        <div className="space-y-6">
          {/* Pipeline Unificado de Captura em Background + Modo Bac Bo */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Captura Unificada em Segundo Plano (Android)
                  </h2>
                  <p className="text-xs text-slate-400">
                    MediaProjection + filtro de mudança na ROI (dHash) + SQLite local
                  </p>
                </div>
                <span className="font-mono text-xs text-slate-300 tabular-nums">
                  {captureRunning ? 'ATIVA' : 'PARADA'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Perfil do Site / Casa</label>
                  <select
                    value={activeSite}
                    onChange={(e) => onChangeSite(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100"
                  >
                    {SITE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Intervalo OCR ({captureIntervalMs} ms)
                  </label>
                  <input
                    type="range"
                    min={350}
                    max={1500}
                    step={50}
                    value={captureIntervalMs}
                    onChange={(e) => onChangeCaptureInterval(Number(e.target.value))}
                    className="w-full accent-emerald-500 mt-2"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-400 mb-1.5">Modo de Leitura do Bac Bo</div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'auto', label: 'Automático' },
                      { id: 'blocks', label: 'Modo Blocos' },
                      { id: 'bead_plate', label: 'Modo Bead Plate' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onChangeBacBoScanMode(m.id)}
                      className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        bacboScanMode === m.id
                          ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                          : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                {!captureRunning ? (
                  <button
                    type="button"
                    onClick={() => onStartUnifiedCapture(selectedGame)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    <span>Iniciar Captura ({selectedGame})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onStopUnifiedCapture}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3.5 w-3.5" />
                    <span>Parar Captura</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onToggleDebugOverlay(!debugOverlayEnabled)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    debugOverlayEnabled
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-slate-700 bg-[#0B0F17] text-slate-300'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{debugOverlayEnabled ? 'Debug Visual: ON' : 'Debug Visual: OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Exportar CSV ({selectedGame})</span>
                </button>
              </div>

              {calibFeedback && (
                <div className="flex items-center gap-2 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{calibFeedback}</span>
                </div>
              )}
            </section>

            {/* Calibração Exata ROI (X/Y/W/H) + Calibrador HSV por Site */}
            <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Calibração ROI &amp; Perfil de Cor HSV ({activeSite})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Ajuste fino de região e calibração cromática de 8–12 giros por site
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLoadNativeRoiAndHsv}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  <span>Carregar</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Esquerda X</span>
                    <span>{Math.round(roiDraft.leftRatio * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={70}
                    value={Math.round(roiDraft.leftRatio * 100)}
                    onChange={(e) => setRoiDraft((p) => ({ ...p, leftRatio: Number(e.target.value) / 100 }))}
                    className="w-full accent-emerald-500"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Topo Y</span>
                    <span>{Math.round(roiDraft.topRatio * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={85}
                    value={Math.round(roiDraft.topRatio * 100)}
                    onChange={(e) => setRoiDraft((p) => ({ ...p, topRatio: Number(e.target.value) / 100 }))}
                    className="w-full accent-emerald-500"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Largura W</span>
                    <span>{Math.round(roiDraft.widthRatio * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={100}
                    value={Math.round(roiDraft.widthRatio * 100)}
                    onChange={(e) => setRoiDraft((p) => ({ ...p, widthRatio: Number(e.target.value) / 100 }))}
                    className="w-full accent-emerald-500"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-slate-400 mb-1">
                    <span>Altura H</span>
                    <span>{Math.round(roiDraft.heightRatio * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={60}
                    value={Math.round(roiDraft.heightRatio * 100)}
                    onChange={(e) => setRoiDraft((p) => ({ ...p, heightRatio: Number(e.target.value) / 100 }))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveNativeRoi}
                  className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 cursor-pointer"
                >
                  Guardar ROI ({selectedGame} · {activeSite})
                </button>
              </div>

              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="text-xs font-medium text-slate-300">
                  Calibrador HSV Manual / Amostra
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={sampleRgbLabel}
                    onChange={(e) => setSampleRgbLabel(e.target.value as typeof sampleRgbLabel)}
                    className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
                  >
                    <option value="RED">Roleta Vermelho</option>
                    <option value="GREEN">Roleta Zero (Verde)</option>
                    <option value="BLACK">Roleta Preto</option>
                    <option value="P">Bac Bo Player (Azul)</option>
                    <option value="B">Bac Bo Banker (Vermelho)</option>
                    <option value="T">Bac Bo Tie (Ouro/Verde)</option>
                  </select>
                  <input
                    type="color"
                    value={sampleHex}
                    onChange={(e) => setSampleHex(e.target.value)}
                    className="h-8 w-10 rounded border border-slate-700 bg-[#0B0F17] cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={handleCalibrateSampleHex}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    Adicionar Amostra HSV
                  </button>
                </div>
                {hsvProfile && (
                  <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Verde H[{hsvProfile.greenHueMin.toFixed(0)}–{hsvProfile.greenHueMax.toFixed(0)}] ·
                    Vermelho H[0–{hsvProfile.redHueLowMax.toFixed(0)}/{hsvProfile.redHueHighMin.toFixed(0)}–360] ·
                    Amostras: {hsvProfile.calibratedSamplesCount}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Caixas de Debug Visual OCR + Preview CSV */}
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-100">
                Inspeção Visual do OCR (Caixas Detetadas)
              </h2>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {latestDebugOverlay
                  ? `${latestDebugOverlay.gameMode} (${latestDebugOverlay.resolvedMode}) · Conf ${(
                      latestDebugOverlay.confidence * 100
                    ).toFixed(0)}% · ${latestDebugOverlay.boxes.length} caixas`
                  : 'Ative Debug Visual e execute leitura no Android'}
              </span>
            </div>

            {latestDebugOverlay && latestDebugOverlay.boxes.length > 0 ? (
              <div className="space-y-3">
                <div className="relative h-36 w-full rounded-lg border border-slate-800 bg-[#0B0F17] overflow-hidden">
                  {latestDebugOverlay.boxes.map((b, i) => (
                    <div
                      key={`${b.text}-${i}`}
                      style={{
                        left: `${b.leftRatio * 100}%`,
                        top: `${b.topRatio * 100}%`,
                        width: `${Math.max(2, (b.rightRatio - b.leftRatio) * 100)}%`,
                        height: `${Math.max(8, (b.bottomRatio - b.topRatio) * 100)}%`,
                      }}
                      className={`absolute border text-[10px] font-mono px-1 ${
                        b.accepted
                          ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                          : 'border-amber-400 bg-amber-500/15 text-amber-200'
                      }`}
                    >
                      {b.text} ({b.colorLabel})
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Nenhuma caixa de debug recebida ainda. Ligue &ldquo;Debug Visual: ON&rdquo; durante a leitura no telemóvel.
              </p>
            )}

            {dbCsvPreview && (
              <div className="pt-2">
                <div className="text-xs text-slate-400 mb-1">Pré-visualização CSV exportado:</div>
                <pre className="max-h-40 overflow-auto rounded-lg border border-slate-800 bg-[#0B0F17] p-3 font-mono text-[11px] text-slate-300">
                  {dbCsvPreview}
                </pre>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
