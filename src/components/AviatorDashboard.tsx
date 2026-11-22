import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Database,
  Download,
  FlaskConical,
  Layers,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
  Sliders,
  Sparkles,
  Square,
  Target,
  Upload,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  analyzeAviatorScreenshotImage,
  answerAviatorQuestionLocally,
  AviatorAutoBetConfig,
  AviatorAutoBetState,
  AviatorBankrollConfig,
  AviatorBankrollState,
  AviatorCaptureStatus,
  AviatorCashOutConfig,
  AviatorCashOutState,
  AviatorCategory,
  AviatorEngineAnalysis,
  AviatorLiveState,
  AviatorRoundRecord,
  AviatorScreenshotScanResult,
  AviatorStrategyId,
  AviatorTestReport,
  createAviatorBackupPayload,
  exportAviatorRoundsToCsv,
  filterAviatorRounds,
  formatCategoryLabel,
  getAllAviatorStrategyDefinitions,
  KWANZABET_API_CAPABILITY_NOTICE,
  LearningWindowKey,
  parseAviatorBackupPayload,
  parseAviatorHistoryText,
  runAllAviatorTests,
} from '../modules/aviator';

type AviatorSection =
  | 'live'
  | 'history'
  | 'patterns'
  | 'strategies'
  | 'learning'
  | 'bankroll'
  | 'autobet'
  | 'cashout'
  | 'statistics'
  | 'settings';

interface AviatorDashboardProps {
  rounds: AviatorRoundRecord[];
  analysis: AviatorEngineAnalysis;
  liveState: AviatorLiveState;
  captureStatus: AviatorCaptureStatus;
  bankrollCfg: AviatorBankrollConfig;
  bankrollState: AviatorBankrollState;
  autoBetCfg: AviatorAutoBetConfig;
  autoBetState: AviatorAutoBetState;
  cashOutCfg: AviatorCashOutConfig;
  cashOutState: AviatorCashOutState;
  selectedWindow: LearningWindowKey;
  isAndroidApk: boolean;
  scanDebug: {
    lastReadTime: string;
    lastMultiplierLabel: string;
    lastReadMs: number | null;
    consecutiveFailures: number;
  };
  onAddMultiplier: (multiplier: number, source: AviatorRoundRecord['source']) => { valid: boolean; reason?: string };
  onBulkAddMultipliers: (multipliersNewestFirst: number[]) => number;
  onImportRounds: (restored: AviatorRoundRecord[]) => void;
  onResetAll: () => void;
  onUpdateBankrollCfg: (cfg: AviatorBankrollConfig) => void;
  onResetBankrollSession: () => void;
  onToggleBankrollPause: () => void;
  onUpdateAutoBetCfg: (cfg: AviatorAutoBetConfig) => void;
  onConfirmManualTicket: (confirm: boolean) => void;
  onUpdateCashOutCfg: (cfg: AviatorCashOutConfig) => void;
  onSelectLearningWindow: (w: LearningWindowKey) => void;
  onSaveLearningSnapshot: () => void;
  onStartMediaProjection: () => void;
  onStopMediaProjection: () => void;
  onChangeCaptureInterval: (ms: number) => void;
}

export function multiplierBadgeClass(mult: number): string {
  if (mult >= 10.0) {
    return 'bg-fuchsia-600/25 border-fuchsia-400/70 text-fuchsia-200';
  }
  if (mult >= 2.0) {
    return 'bg-purple-600/25 border-purple-400/70 text-purple-200';
  }
  return 'bg-sky-600/25 border-sky-400/70 text-sky-200';
}

export const AviatorDashboard: React.FC<AviatorDashboardProps> = ({
  rounds,
  analysis,
  liveState,
  captureStatus,
  bankrollCfg,
  bankrollState,
  autoBetCfg,
  autoBetState,
  cashOutCfg,
  cashOutState,
  selectedWindow,
  isAndroidApk,
  scanDebug,
  onAddMultiplier,
  onBulkAddMultipliers,
  onImportRounds,
  onResetAll,
  onUpdateBankrollCfg,
  onResetBankrollSession,
  onToggleBankrollPause,
  onUpdateAutoBetCfg,
  onConfirmManualTicket,
  onUpdateCashOutCfg,
  onSelectLearningWindow,
  onSaveLearningSnapshot,
  onStartMediaProjection,
  onStopMediaProjection,
  onChangeCaptureInterval,
}) => {
  const [section, setSection] = useState<AviatorSection>('live');
  const [manualInput, setManualInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [testReport, setTestReport] = useState<AviatorTestReport | null>(null);
  const [screenshotScan, setScreenshotScan] = useState<AviatorScreenshotScanResult | null>(null);

  // Estado do Analista IA (Híbrido: Gemini Gratuito + IA Estatística Local Offline)
  const [aiQuestion, setAiQuestion] = useState(
    'Quando sai um número muito alto (>=10x), a seguir vêm números baixos?'
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<{
    answer: string;
    sourceLabel: string;
  } | null>(null);

  // Filtros do Histórico (B)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AviatorCategory | 'ALL'>('ALL');
  const [minMultFilter, setMinMultFilter] = useState('');
  const [strategyFilter, setStrategyFilter] = useState('');

  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const filteredHistory = useMemo(
    () =>
      filterAviatorRounds(rounds, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        category: categoryFilter,
        minMultiplier: minMultFilter ? Number(minMultFilter) : null,
        strategyQuery: strategyFilter,
      })
        .slice()
        .reverse(),
    [rounds, dateFrom, dateTo, categoryFilter, minMultFilter, strategyFilter]
  );

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInputError(null);
    const cleaned = manualInput.trim().replace(',', '.').replace(/[xX×]$/, '');
    const val = Number(cleaned);
    if (!cleaned || Number.isNaN(val)) {
      setInputError('Introduza um multiplicador válido >= 1.00 (ex: 1.39 ou 4.58).');
      return;
    }
    const res = onAddMultiplier(val, 'manual');
    if (!res.valid) {
      setInputError(res.reason ?? 'Valor inválido.');
      return;
    }
    setManualInput('');
  };

  const handleBulkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBulkNotice(null);
    const parsed = parseAviatorHistoryText(bulkInput);
    if (parsed.multipliers.length === 0) {
      setBulkNotice('Nenhum multiplicador válido encontrado (ex: 1.38x 1.10x 48.92x).');
      return;
    }
    const count = onBulkAddMultipliers(parsed.multipliers);
    setBulkNotice(`${count} multiplicador(es) registado(s) com sucesso.`);
    setBulkInput('');
  };

  const handleScreenshotChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await analyzeAviatorScreenshotImage(file);
    setScreenshotScan(res);
    e.target.value = '';
  };

  const handleExportCsv = () => {
    const csv = exportAviatorRoundsToCsv(rounds);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aviator-historico-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const payload = createAviatorBackupPayload(rounds);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aviator-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseAviatorBackupPayload(text);
      if (parsed.valid) {
        onImportRounds(parsed.rounds);
        setBulkNotice(`Backup restaurado: ${parsed.rounds.length} rodadas.`);
      } else {
        setInputError(parsed.error ?? 'Falha ao importar JSON.');
      }
    } finally {
      e.target.value = '';
    }
  };

  const handleAskAi = async (customQuestion?: string) => {
    const q = (customQuestion ?? aiQuestion).trim();
    if (customQuestion) setAiQuestion(customQuestion);

    if (rounds.length < 5) {
      setAiResponse({
        answer: `Registe pelo menos 5 rodadas (atual: ${rounds.length}) para a IA analisar os dados reais.`,
        sourceLabel: 'IA Estatística Local',
      });
      return;
    }

    setAiLoading(true);
    const localFallbackAnswer = answerAviatorQuestionLocally(rounds, analysis.ai, q);

    // No APK offline (https://localhost sem porta de servidor Node), usa direto a IA Local para resposta instantânea
    const isOfflineApkOrigin =
      isAndroidApk &&
      (window.location.hostname === 'localhost' || window.location.protocol === 'capacitor:');

    if (isOfflineApkOrigin) {
      setAiResponse({
        answer: localFallbackAnswer,
        sourceLabel: 'IA Estatística Local (APK Offline · 100% Gratuito)',
      });
      setAiLoading(false);
      return;
    }

    try {
      const postPeakSummary = analysis.ai.postPeakBuckets
        .map((b) => {
          const h1 = b.horizons[0];
          const h3 = b.horizons[1];
          return `${b.label}: ${b.totalOccurrences}x | Próx.1: ${h1.under150Pct.toFixed(1)}% <1.5x (delta ${
            h1.under150DeltaPct >= 0 ? '+' : ''
          }${h1.under150DeltaPct.toFixed(1)}pp, z=${h1.zScoreUnder150.toFixed(2)}) | Próx.3: ${h3.under150Pct.toFixed(
            1
          )}% <1.5x`;
        })
        .join(' ; ');

      const strategiesSummary = analysis.strategies.rankingByRoi
        .slice(0, 4)
        .map((s) => `${s.name}: acerto ${s.hitRatePct.toFixed(1)}%, ROI ${s.simulatedRoiPct.toFixed(1)}%`)
        .join(' | ');

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 7000);
      const res = await fetch('/api/analyze-aviator-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          totalRounds: rounds.length,
          recentMultipliers: rounds.slice(-40).map((r) => r.multiplier),
          question: q,
          localSummary: analysis.ai.localNarrativeSummary,
          postPeakSummary,
          regimeSummary: `${analysis.ai.regime.regimeLabel} (Cautela ${analysis.ai.regime.cautionScore}/100) - ${analysis.ai.regime.recommendedAction}`,
          strategiesSummary,
        }),
      });
      window.clearTimeout(timeout);

      if (!res.ok) {
        setAiResponse({
          answer: localFallbackAnswer,
          sourceLabel: 'IA Estatística Local (Modo Offline Automático)',
        });
        return;
      }

      const data = (await res.json()) as { answer?: string; model?: string };
      if (data.answer && data.answer.trim().length > 0) {
        setAiResponse({
          answer: data.answer.trim(),
          sourceLabel: `Gemini AI (${data.model ?? 'gemini-4-hydrogen'} · Gratuito)`,
        });
      } else {
        setAiResponse({
          answer: localFallbackAnswer,
          sourceLabel: 'IA Estatística Local (Fallback)',
        });
      }
    } catch {
      setAiResponse({
        answer: localFallbackAnswer,
        sourceLabel: 'IA Estatística Local (Offline · 100% Gratuito)',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const sections: Array<{ id: AviatorSection; label: string; icon: React.ReactNode }> = [
    { id: 'live', label: 'A. Ao Vivo', icon: <Activity className="h-3.5 w-3.5" /> },
    { id: 'history', label: 'B. Histórico', icon: <Database className="h-3.5 w-3.5" /> },
    { id: 'patterns', label: 'C. Padrões', icon: <Layers className="h-3.5 w-3.5" /> },
    { id: 'strategies', label: 'D. Estratégias', icon: <Target className="h-3.5 w-3.5" /> },
    { id: 'learning', label: 'E. IA & Pós-Pico', icon: <Brain className="h-3.5 w-3.5" /> },
    { id: 'bankroll', label: 'F. Banca', icon: <Wallet className="h-3.5 w-3.5" /> },
    { id: 'autobet', label: 'G. Auto Bet', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'cashout', label: 'H. Cash Out', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
    { id: 'statistics', label: 'I. Estatísticas', icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { id: 'settings', label: 'J. Config.', icon: <Sliders className="h-3.5 w-3.5" /> },
  ];

  const activeSug = analysis.strategies.activeSnapshot;
  const allDefs = getAllAviatorStrategyDefinitions();

  return (
    <div className="space-y-5">
      {/* Banner de Alerta Cash Out em Tempo Real */}
      {cashOutState.alertActiveNow && cashOutState.alertMessage && (
        <div className="rounded-xl border border-amber-400 bg-amber-500/15 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-200 text-xs font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>{cashOutState.alertMessage}</span>
          </div>
          <span className="font-mono text-xs font-bold text-amber-300 tabular-nums">
            {liveState.currentMultiplier?.toFixed(2)}x
          </span>
        </div>
      )}

      {/* Confirmação Explícita Pendente (Modo Preparação Manual) */}
      {autoBetState.pendingManualTicket && (
        <div className="rounded-xl border border-blue-500/60 bg-blue-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs">
            <div className="font-semibold text-blue-300">
              Preparação Manual Pendente · Rodada #{autoBetState.pendingManualTicket.roundNumber}
            </div>
            <div className="text-slate-300">
              Estratégia: <strong>{autoBetState.pendingManualTicket.strategyName}</strong> · Valor:{' '}
              <strong className="font-mono">{autoBetState.pendingManualTicket.stakeAoa.toFixed(0)} AOA</strong> · Alvo:{' '}
              <strong className="font-mono">{autoBetState.pendingManualTicket.targetCashout.toFixed(2)}x</strong>
            </div>
            <div className="text-[11px] text-slate-400">
              O aplicativo não executa cliques automáticos na Kwanzabet. Confirme apenas se colocou manualmente.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onConfirmManualTicket(true)}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
            >
              Confirmar Entrada Manual
            </button>
            <button
              type="button"
              onClick={() => onConfirmManualTicket(false)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Cabeçalho Principal Aviator + Botão TESTAR LÓGICA + Zerar 0% */}
      <section className="rounded-xl border border-slate-800 bg-[#131924] p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-red-400">AVIATOR INTELLIGENCE</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{rounds.length} rodadas registadas</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-emerald-400">
                Acerto Sugestões: {analysis.statistics.suggestionHitRatePct.toFixed(1)}% (
                {analysis.statistics.suggestionHits}/{analysis.statistics.evaluatedSuggestions})
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-amber-300">
                Banca: {bankrollState.currentBalanceAoa.toFixed(2)} AOA
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-100">
              Monitorização, Padrões Estatísticos & Gestão de Risco
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTestReport(runAllAviatorTests())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-400/15 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-400/25 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>TESTAR LÓGICA</span>
            </button>

            {confirmReset ? (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/10 px-2 py-1">
                <span className="text-[11px] text-red-200">Confirmar limpeza total?</span>
                <button
                  type="button"
                  onClick={() => {
                    onResetAll();
                    setConfirmReset(false);
                  }}
                  className="rounded bg-red-600 px-2 py-1 text-[11px] font-bold text-white cursor-pointer"
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 cursor-pointer"
                >
                  Não
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-300 hover:text-red-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Zerar 0%</span>
              </button>
            )}
          </div>
        </div>

        {/* Faixa Recente de Multiplicadores Colorida (estilo Spribe Aviator: mais recente à esquerda) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {rounds.length === 0 ? (
            <span className="text-xs text-slate-400 py-1">
              Estado virgem (0.0%). Abra o navegador integrado, ative a captura de ecrã Android ou registe multiplicadores abaixo.
            </span>
          ) : (
            rounds
              .slice(-24)
              .reverse()
              .map((r, idx) => (
                <span
                  key={r.id}
                  title={`#${r.roundNumber} · ${r.timeLabel} · ${r.source}`}
                  className={`inline-flex h-7 min-w-[52px] px-2 items-center justify-center rounded border font-mono text-xs font-bold tabular-nums shrink-0 ${multiplierBadgeClass(
                    r.multiplier
                  )} ${idx === 0 ? 'ring-2 ring-amber-400' : ''}`}
                >
                  {r.multiplier.toFixed(2)}x
                </span>
              ))
          )}
        </div>

        {/* Sub-navegação das Secções A–J */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-800/80">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                section === s.id
                  ? 'bg-red-600 text-white'
                  : 'bg-[#0B0F17] border border-slate-800 text-slate-400 hover:text-slate-100'
              }`}
            >
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Relatório do Botão TESTAR LÓGICA */}
      {testReport && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {testReport.allPassed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400" />
              )}
              <span className="text-sm font-semibold text-slate-100">
                Auditoria Automatizada (TESTAR LÓGICA): {testReport.passedCount}/{testReport.totalCount} aprovados
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {testReport.cases.map((tc) => (
              <div
                key={tc.name}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  tc.passed
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-slate-200'
                    : 'border-red-500/40 bg-red-500/10 text-red-200'
                }`}
              >
                <div className="font-semibold flex items-center justify-between gap-2">
                  <span>{tc.name}</span>
                  <span className={tc.passed ? 'text-emerald-400' : 'text-red-400'}>
                    {tc.passed ? 'OK' : 'ERRO'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">{tc.details}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ==================== A. MONITORIZAÇÃO AO VIVO ==================== */}
      {section === 'live' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-5">
            <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    A. Monitorização em Tempo Real
                  </h2>
                  <p className="text-xs text-slate-400">
                    Estado da rodada, deteção de crash (vermelho) e captura autorizada
                  </p>
                </div>
                <span
                  className={`rounded-md px-2.5 py-1 font-mono text-xs font-bold ${
                    liveState.phase === 'FLYING'
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                      : liveState.phase === 'CRASHED'
                      ? 'bg-red-500/15 text-red-300 border border-red-500/40'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  {liveState.phase === 'FLYING'
                    ? 'A VOAR'
                    : liveState.phase === 'CRASHED'
                    ? 'CRASH'
                    : 'AGUARDANDO'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-[11px] text-slate-400">Multiplicador Atual</div>
                  <div
                    className={`mt-1 text-xl font-bold ${
                      liveState.isCrashedColor ? 'text-red-400' : 'text-slate-100'
                    }`}
                  >
                    {liveState.currentMultiplier !== null
                      ? `${liveState.currentMultiplier.toFixed(2)}x`
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-[11px] text-slate-400">Último Crash</div>
                  <div className="mt-1 text-xl font-bold text-amber-300">
                    {rounds.length > 0
                      ? `${rounds[rounds.length - 1].multiplier.toFixed(2)}x`
                      : '--'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-[11px] text-slate-400">Seq. Baixos (&lt;1.5x)</div>
                  <div className="mt-1 text-xl font-bold text-sky-300">
                    {analysis.patterns.currentLowStreak}x
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-[11px] text-slate-400">Sem Rosa (&gt;=10x)</div>
                  <div className="mt-1 text-xl font-bold text-fuchsia-300">
                    {analysis.patterns.roundsSinceAbove10x} rod.
                  </div>
                </div>
              </div>

              {/* Sugestão Ativa */}
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-400">
                    Leitura da Estratégia Selecionada ({activeSug.strategyName})
                  </span>
                  <span className="font-mono text-xs text-amber-300">
                    Score: {activeSug.confidencePct.toFixed(0)}/100
                  </span>
                </div>
                <div
                  className={`text-base font-bold ${
                    activeSug.shouldEnter ? 'text-emerald-400' : 'text-slate-300'
                  }`}
                >
                  {activeSug.shouldEnter && activeSug.targetMultiplier
                    ? `ALVO SUGERIDO: ${activeSug.targetMultiplier.toFixed(2)}x (Entrada Estatística)`
                    : 'AGUARDAR PRÓXIMA JANELA'}
                </div>
                <p className="text-xs text-slate-400">{activeSug.reason}</p>
              </div>

              {/* Cartão Resumo IA: Regime & Alerta Pós-Pico */}
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>IA Estatística: {analysis.ai.regime.regimeLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-300">
                      Cautela: {analysis.ai.regime.cautionScore}/100
                    </span>
                    <button
                      type="button"
                      onClick={() => setSection('learning')}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-slate-800 cursor-pointer"
                    >
                      Abrir Painel IA
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">{analysis.ai.localNarrativeSummary}</p>
              </div>

              {/* Captura de Ecrã Android (MediaProjection Externa) */}
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      Captura Externa Autorizada (Chrome / Outro Navegador)
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {isAndroidApk
                        ? 'Solicita permissão explícita do Android (MediaProjection + Notificação) para ler a tela externa em tempo real.'
                        : 'No navegador integrado do APK a leitura já é direta. A captura externa MediaProjection funciona no APK Android instalado.'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {captureStatus.mediaProjectionActive ? (
                      <button
                        type="button"
                        onClick={onStopMediaProjection}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer"
                      >
                        <Square className="h-3.5 w-3.5" />
                        <span>Parar Captura</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onStartMediaProjection}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>Iniciar Captura Ecrã</span>
                      </button>
                    )}
                  </div>
                </div>
                {captureStatus.lastError && (
                  <div className="text-[11px] text-amber-300">{captureStatus.lastError}</div>
                )}
              </div>
            </section>
          </div>

          {/* Entrada Manual, Faixa Colada e Teste Screenshot */}
          <div className="lg:col-span-5 space-y-5">
            <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-100">
                Registo Manual & Importação Rápida
              </h3>
              <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Ex: 1.39 ou 48.92x"
                  className="flex-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Registar</span>
                </button>
              </form>
              {inputError && <div className="text-xs text-red-400">{inputError}</div>}

              <form onSubmit={handleBulkSubmit} className="space-y-2 pt-2 border-t border-slate-800">
                <label className="block text-xs text-slate-400">
                  Colar sequência da faixa (mais recente primeiro, ex: 1.38x 1.10x 1.60x 48.92x)
                </label>
                <textarea
                  rows={2}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  placeholder="1.38x 1.10x 1.60x 1.27x 3.20x 4.58x 48.92x"
                  className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
                >
                  Importar Sequência para Análise
                </button>
                {bulkNotice && <div className="text-xs text-emerald-400">{bulkNotice}</div>}
              </form>

              <div className="pt-2 border-t border-slate-800 space-y-2">
                <input
                  ref={screenshotInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleScreenshotChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => screenshotInputRef.current?.click()}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Verificar Screenshot do Aviator</span>
                </button>
                {screenshotScan && (
                  <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5 text-[11px] text-slate-300 space-y-1">
                    <div>{screenshotScan.note}</div>
                    <div className="font-mono text-slate-400">
                      Pílulas estimadas · Azul: {screenshotScan.detectedColorCounts.blue} · Roxo:{' '}
                      {screenshotScan.detectedColorCounts.purple} · Rosa:{' '}
                      {screenshotScan.detectedColorCounts.pink} · Crash vermelho:{' '}
                      {screenshotScan.liveCrashRedDetected ? 'Sim' : 'Não'}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ==================== B. HISTÓRICO DE MULTIPLICADORES ==================== */}
      {section === 'history' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                B. Histórico Completo & Exportação
              </h2>
              <p className="text-xs text-slate-400">
                Filtre por data, categoria, multiplicador mínimo ou estratégia e faça backup seguro
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Backup JSON</span>
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportJson}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Restaurar JSON</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as AviatorCategory | 'ALL')}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="ALL">Todas categorias</option>
              <option value="under_1_50">&lt; 1.50x</option>
              <option value="1_50_to_2_00">1.50x – 2.00x</option>
              <option value="2_00_to_3_00">2.00x – 3.00x</option>
              <option value="3_00_to_5_00">3.00x – 5.00x</option>
              <option value="5_00_to_10_00">5.00x – 10.00x</option>
              <option value="over_10_00">&gt; 10.00x</option>
            </select>
            <input
              type="number"
              step="0.1"
              value={minMultFilter}
              onChange={(e) => setMinMultFilter(e.target.value)}
              placeholder="Mínimo (ex: 2.0)"
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-200"
            />
            <input
              type="text"
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              placeholder="Filtrar estratégia..."
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 px-3">Hora</th>
                  <th className="py-2 px-3">Multiplicador</th>
                  <th className="py-2 px-3">Categoria</th>
                  <th className="py-2 px-3">Origem</th>
                  <th className="py-2 pl-3">Sugestão Antes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredHistory.slice(0, 120).map((r) => {
                  const pred = r.predictionBefore;
                  const evaluated = pred && pred.shouldEnter && pred.targetMultiplier !== null;
                  const hit = evaluated && r.multiplier >= pred!.targetMultiplier!;
                  return (
                    <tr key={r.id} className="hover:bg-slate-800/20">
                      <td className="py-2 pr-3 font-mono text-slate-400">#{r.roundNumber}</td>
                      <td className="py-2 px-3 font-mono text-slate-300">{r.timeLabel}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 font-mono font-bold tabular-nums ${multiplierBadgeClass(
                            r.multiplier
                          )}`}
                        >
                          {r.multiplier.toFixed(2)}x
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-300">{formatCategoryLabel(r.category)}</td>
                      <td className="py-2 px-3 text-slate-400">{r.source}</td>
                      <td className="py-2 pl-3">
                        {evaluated ? (
                          <span className={hit ? 'text-emerald-400' : 'text-red-400'}>
                            {pred!.strategyName} ({pred!.targetMultiplier!.toFixed(2)}x) ·{' '}
                            {hit ? 'OK' : 'X'}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      Nenhuma rodada encontrada para os filtros aplicados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== C. PADRÕES IDENTIFICADOS ==================== */}
      {section === 'patterns' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              C. Motor de Padrões Descobertos
            </h2>
            <p className="text-xs text-amber-300 mt-1">{analysis.patterns.disclaimer}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {analysis.patterns.discovered.map((p) => (
              <div
                key={p.id}
                className={`rounded-lg border p-4 space-y-2 ${
                  p.activeNow
                    ? 'border-amber-400/60 bg-amber-500/10'
                    : 'border-slate-800 bg-[#0B0F17]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">{p.title}</span>
                  <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-300">
                    {p.confidence}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{p.description}</p>
                <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums pt-1">
                  <div>
                    <span className="text-slate-500 block">Ocorrências</span>
                    <span className="text-slate-200 font-semibold">
                      {p.occurrences} ({p.frequencyPct.toFixed(1)}%)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Próx. &gt;=2x</span>
                    <span className="text-purple-300 font-semibold">
                      {p.nextAbove200Pct.toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Média Seg.</span>
                    <span className="text-emerald-300 font-semibold">
                      {p.nextAvgMultiplier.toFixed(2)}x
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">{p.warning}</div>
              </div>
            ))}
            {analysis.patterns.discovered.length === 0 && (
              <div className="col-span-2 py-6 text-center text-xs text-slate-500">
                Registe pelo menos 4 rodadas para descobrir ocorrências de sequências, repetições e intervalos.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== D. ESTRATÉGIAS & BACKTESTING ==================== */}
      {section === 'strategies' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              D. Comparador das 7 Estratégias (Backtesting Simulado)
            </h2>
            <p className="text-xs text-slate-400">
              Avaliação sobre histórico real sem Martingale (aposta fixa simulada de{' '}
              {bankrollCfg.baseStakeAoa.toFixed(0)} AOA por entrada)
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3">Estratégia</th>
                  <th className="py-2 px-2 text-right">Alvo</th>
                  <th className="py-2 px-2 text-right">Entradas</th>
                  <th className="py-2 px-2 text-right">Acerto</th>
                  <th className="py-2 px-2 text-right">P&amp;L Sim.</th>
                  <th className="py-2 px-2 text-right">ROI</th>
                  <th className="py-2 px-2 text-right">25 Rec.</th>
                  <th className="py-2 pl-2 text-right">Sinal Agora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {analysis.strategies.rankingByRoi.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/20">
                    <td className="py-2.5 pr-3 font-sans">
                      <div className="font-semibold text-slate-100">{s.name}</div>
                      <div className="text-[11px] text-slate-400">{s.description}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right text-amber-300">{s.targetMultiplier.toFixed(2)}x</td>
                    <td className="py-2.5 px-2 text-right text-slate-300">
                      {s.hits}/{s.evaluatedEntries}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-200">{s.hitRatePct.toFixed(1)}%</td>
                    <td
                      className={`py-2.5 px-2 text-right font-semibold ${
                        s.simulatedNetPnlAoa >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {s.simulatedNetPnlAoa >= 0 ? '+' : ''}
                      {s.simulatedNetPnlAoa.toFixed(0)} AOA
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right ${
                        s.simulatedRoiPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {s.simulatedRoiPct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-300">
                      {s.recent25HitRatePct.toFixed(0)}%
                    </td>
                    <td className="py-2.5 pl-2 text-right font-sans">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          s.currentSignal.active
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {s.currentSignal.active ? 'ATIVO' : 'AGUARDA'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== E. IA, PÓS-PICO & APRENDIZAGEM ==================== */}
      {section === 'learning' && (
        <div className="space-y-5">
          {/* Painel Analista IA (Pós-Pico + Regime + Perguntar aos Dados) */}
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <span>E. IA Quantitativa · Analisador Pós-Pico &amp; Sequências</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Mede nos teus dados reais se números muito altos (ex: &gt;=10x, &gt;=25x) trazem números baixos a seguir — 100% gratuito no APK e na Web.
                </p>
              </div>
              <span
                className={`rounded-md border px-2.5 py-1 font-mono text-xs font-bold shrink-0 ${
                  analysis.ai.regime.regime === 'FRIO_CRISE'
                    ? 'border-red-500/50 bg-red-500/15 text-red-300'
                    : analysis.ai.regime.regime === 'VOLATIL_PICOS'
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : analysis.ai.regime.regime === 'NORMAL'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300'
                }`}
              >
                Cautela IA: {analysis.ai.regime.cautionScore}/100
              </span>
            </div>

            {/* Regime Atual & Resumo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="md:col-span-2 rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5 space-y-1.5">
                <div className="font-semibold text-amber-300">{analysis.ai.regime.regimeLabel}</div>
                <p className="text-slate-300 leading-relaxed">{analysis.ai.localNarrativeSummary}</p>
                <p className="text-[11px] text-slate-400">{analysis.ai.regime.recommendedAction}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5 space-y-1.5 font-mono tabular-nums">
                <div className="font-sans text-[11px] text-slate-400">Baseline Global ({rounds.length} rod.)</div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Baixos (&lt;1.50x):</span>
                  <span className="text-sky-300 font-bold">{analysis.ai.baselineUnder150Pct.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Acima &gt;=2.00x:</span>
                  <span className="text-purple-300 font-bold">{analysis.ai.baselineAbove200Pct.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">15 rec. &lt;1.50x:</span>
                  <span className="text-amber-300 font-bold">{analysis.ai.regime.recent15LowPct.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Índice Volat.:</span>
                  <span className="text-slate-200 font-bold">{analysis.ai.regime.volatilityIndex.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Tabela Pós-Pico */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-200">
                Teste Empírico Pós-Pico: O que saiu logo após um número muito alto?
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-sans">
                      <th className="py-2 pr-3">Faixa de Pico</th>
                      <th className="py-2 px-2 text-right">Ocorr.</th>
                      <th className="py-2 px-2 text-right">1ª Rod. &lt;1.5x</th>
                      <th className="py-2 px-2 text-right">Desvio vs Normal</th>
                      <th className="py-2 px-2 text-right">Próx. 3 &lt;1.5x</th>
                      <th className="py-2 px-2 text-right">Próx. 5 &lt;1.5x</th>
                      <th className="py-2 pl-2 font-sans">Conclusão Estatística (1ª Rod.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {analysis.ai.postPeakBuckets.map((b) => {
                      const h1 = b.horizons[0];
                      const h3 = b.horizons[1];
                      const h5 = b.horizons[2];
                      return (
                        <tr key={b.threshold} className={b.activeJustHappened ? 'bg-amber-500/10' : ''}>
                          <td className="py-2 pr-3 font-sans text-slate-100">
                            <span className="font-semibold">{b.label}</span>
                            {b.activeJustHappened && (
                              <span className="ml-1.5 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                                AGORA
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-300">{b.totalOccurrences}</td>
                          <td className="py-2 px-2 text-right text-sky-300">
                            {h1.evaluatedRounds > 0 ? `${h1.under150Pct.toFixed(1)}%` : '--'}
                          </td>
                          <td
                            className={`py-2 px-2 text-right font-semibold ${
                              h1.evaluatedRounds === 0
                                ? 'text-slate-500'
                                : h1.under150DeltaPct > 6
                                ? 'text-red-400'
                                : h1.under150DeltaPct < -6
                                ? 'text-emerald-400'
                                : 'text-slate-300'
                            }`}
                          >
                            {h1.evaluatedRounds > 0
                              ? `${h1.under150DeltaPct >= 0 ? '+' : ''}${h1.under150DeltaPct.toFixed(1)}pp (z=${h1.zScoreUnder150.toFixed(1)})`
                              : '--'}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-300">
                            {h3.evaluatedRounds > 0 ? `${h3.under150Pct.toFixed(1)}%` : '--'}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-300">
                            {h5.evaluatedRounds > 0 ? `${h5.under150Pct.toFixed(1)}%` : '--'}
                          </td>
                          <td className="py-2 pl-2 font-sans text-[11px] text-slate-300">{h1.verdictLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Intervalos de Pico + Matriz Markov */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2.5">
                <div className="text-xs font-semibold text-slate-200">
                  Sequências &amp; Espaçamento Entre Picos
                </div>
                <div className="space-y-2 text-xs font-mono tabular-nums">
                  {analysis.ai.peakIntervals.map((pi) => (
                    <div key={pi.threshold} className="rounded border border-slate-800/80 p-2.5 space-y-1">
                      <div className="font-sans font-semibold text-fuchsia-300 flex justify-between">
                        <span>{pi.label}</span>
                        <span>{pi.count}x registados</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[11px] text-slate-300">
                        <div>Mín: {pi.minGap !== null ? `${pi.minGap}r` : '--'}</div>
                        <div>Mediana: {pi.medianGap !== null ? `${pi.medianGap.toFixed(0)}r` : '--'}</div>
                        <div>Máx: {pi.maxGap !== null ? `${pi.maxGap}r` : '--'}</div>
                        <div>Atual: {pi.currentGap}r</div>
                      </div>
                      <div className="font-sans text-[11px] text-slate-400">
                        Cluster (outro pico dentro de 3 rodadas):{' '}
                        <strong className="font-mono text-amber-300">{pi.clusterRatePct.toFixed(1)}%</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2.5">
                <div className="text-xs font-semibold text-slate-200">
                  Matriz de Transição (Cadeia de Markov · Próxima Rodada)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-sans">
                        <th className="py-1.5 pr-2">Estado Atual</th>
                        <th className="py-1.5 px-1.5 text-right">&lt;1.5x</th>
                        <th className="py-1.5 px-1.5 text-right">1.5–2x</th>
                        <th className="py-1.5 px-1.5 text-right">2–5x</th>
                        <th className="py-1.5 px-1.5 text-right">&gt;=5x</th>
                        <th className="py-1.5 pl-1.5 text-right">Média Seg.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {analysis.ai.markovRows.map((row) => {
                        const isCur = analysis.ai.currentMarkovState === row.fromState;
                        const ge5 = row.probsPct['5_00_to_10_00'] + row.probsPct.over_10_00;
                        return (
                          <tr key={row.fromState} className={isCur ? 'bg-blue-500/15' : ''}>
                            <td className="py-1.5 pr-2 font-sans text-slate-200">
                              {row.fromLabel}
                              {isCur && <span className="ml-1 text-[10px] text-blue-300 font-bold">(ATUAL)</span>}
                            </td>
                            <td className="py-1.5 px-1.5 text-right text-sky-300">
                              {row.sampleCount > 0 ? `${row.probsPct.under_1_50.toFixed(0)}%` : '--'}
                            </td>
                            <td className="py-1.5 px-1.5 text-right text-slate-300">
                              {row.sampleCount > 0 ? `${row.probsPct['1_50_to_2_00'].toFixed(0)}%` : '--'}
                            </td>
                            <td className="py-1.5 px-1.5 text-right text-purple-300">
                              {row.sampleCount > 0 ? `${row.probsPct['2_00_to_5_00'].toFixed(0)}%` : '--'}
                            </td>
                            <td className="py-1.5 px-1.5 text-right text-fuchsia-300">
                              {row.sampleCount > 0 ? `${ge5.toFixed(0)}%` : '--'}
                            </td>
                            <td className="py-1.5 pl-1.5 text-right text-emerald-300">
                              {row.sampleCount > 0 ? `${row.nextAvgMultiplier.toFixed(2)}x` : '--'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Pergunte ao Analista IA (Gemini Gratuito na Web + IA Estatística Local Offline no APK) */}
            <div className="rounded-lg border border-blue-500/30 bg-[#0B0F17] p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5" />
                  <span>Analista IA dos Teus Dados (Gemini Gratuito + Motor Local APK)</span>
                </div>
                <span className="text-[11px] text-slate-400">
                  Zero configurações externas: funciona direto no APK (Local) e no Servidor Web (Gemini)
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  'Quando sai >=10x vêm números baixos a seguir?',
                  'Como estão os intervalos e clusters de pico?',
                  'Qual a transição provável do estado atual (Markov)?',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleAskAi(preset)}
                    disabled={aiLoading}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-blue-500/60 hover:text-white cursor-pointer disabled:opacity-50"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={aiQuestion}
                  onChange={(e) => setAiQuestion(e.target.value)}
                  placeholder="Pergunte sobre picos, números baixos após >=10x, ou risco..."
                  className="flex-1 rounded-lg border border-slate-700 bg-[#131924] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleAskAi()}
                  disabled={aiLoading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{aiLoading ? 'A analisar...' : 'Analisar com IA'}</span>
                </button>
              </div>

              {aiResponse && (
                <div className="rounded-lg border border-slate-800 bg-[#131924] p-3.5 space-y-1.5">
                  <div className="text-[11px] font-mono text-amber-300">{aiResponse.sourceLabel}</div>
                  <div className="text-xs text-slate-200 whitespace-pre-line leading-relaxed">
                    {aiResponse.answer}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Tabela de Validação Cruzada & Prevenção de Overfitting */}
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Aprendizagem Contínua &amp; Prevenção de Sobreajuste
                </h2>
                <p className="text-xs text-slate-400">{analysis.learning.recommendationNote}</p>
              </div>
              <button
                type="button"
                onClick={onSaveLearningSnapshot}
                className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer shrink-0"
              >
                Guardar Avaliação Atual
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['50', '100', '500', '1000', 'all'] as LearningWindowKey[]).map((wk) => (
                <button
                  key={wk}
                  type="button"
                  onClick={() => onSelectLearningWindow(wk)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer ${
                    selectedWindow === wk
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#0B0F17] border border-slate-800 text-slate-400'
                  }`}
                >
                  {wk === 'all' ? 'Todo Histórico' : `Últimas ${wk}`}
                </button>
              ))}
              <span className="ml-auto font-mono text-xs text-slate-300">
                Risco Overfitting:{' '}
                <strong
                  className={
                    analysis.learning.overfittingRisk === 'ELEVADO'
                      ? 'text-red-400'
                      : analysis.learning.overfittingRisk === 'MODERADO'
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                  }
                >
                  {analysis.learning.overfittingRisk}
                </strong>
              </span>
            </div>

            {analysis.learning.degradationWarning && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                {analysis.learning.degradationWarning}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-sans">
                    <th className="py-2 pr-3">Janela</th>
                    <th className="py-2 px-2 text-right">Amostra</th>
                    <th className="py-2 px-2">Melhor no Treino (70%)</th>
                    <th className="py-2 px-2 text-right">Treino</th>
                    <th className="py-2 px-2 text-right">Validação (30%)</th>
                    <th className="py-2 pl-2 text-right">ROI Validação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {analysis.learning.windows.map((w) => (
                    <tr key={w.windowKey}>
                      <td className="py-2 pr-3 font-sans text-slate-200">{w.label}</td>
                      <td className="py-2 px-2 text-right text-slate-300">{w.sampleSize}</td>
                      <td className="py-2 px-2 font-sans text-slate-300">{w.bestStrategyName}</td>
                      <td className="py-2 px-2 text-right text-slate-200">{w.trainHitRatePct.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-right text-slate-200">
                        {w.validationHitRatePct.toFixed(1)}%
                      </td>
                      <td
                        className={`py-2 pl-2 text-right font-semibold ${
                          w.validationRoiPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {w.validationRoiPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ==================== F. GESTÃO DE BANCA ==================== */}
      {section === 'bankroll' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-100">
                F. Estado da Banca & Proteção
              </h2>
              <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                ANTI-MARTINGALE ATIVO
              </span>
            </div>

            {analysis.bankrollStatus.blocked && (
              <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-200 space-y-1">
                <div className="font-bold">ENTRADAS BLOQUEADAS PELOS LIMITES DE SEGURANÇA:</div>
                {analysis.bankrollStatus.reasons.map((r, i) => (
                  <div key={i}>• {r}</div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-[11px] text-slate-400">Saldo Atual</div>
                <div className="text-lg font-bold text-slate-100">
                  {bankrollState.currentBalanceAoa.toFixed(2)} AOA
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-[11px] text-slate-400">Lucro / Prejuízo Líquido</div>
                <div
                  className={`text-lg font-bold ${
                    bankrollState.netPnlAoa >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {bankrollState.netPnlAoa >= 0 ? '+' : ''}
                  {bankrollState.netPnlAoa.toFixed(2)} AOA
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-[11px] text-slate-400">Total Apostado / Recuperado</div>
                <div className="text-xs font-semibold text-slate-200 mt-1">
                  {bankrollState.totalStakedAoa.toFixed(0)} / {bankrollState.totalRecoveredAoa.toFixed(0)} AOA
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-[11px] text-slate-400">Máx. Perdas Seguidas</div>
                <div className="text-xs font-semibold text-amber-300 mt-1">
                  {bankrollState.maxConsecutiveLosses} (Atual: {bankrollState.currentConsecutiveLosses})
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onToggleBankrollPause}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 cursor-pointer"
              >
                <PauseCircle className="h-3.5 w-3.5" />
                <span>{bankrollState.pausedUntilNextSession ? 'Retomar Sessão' : 'Pausar Sessão'}</span>
              </button>
              <button
                type="button"
                onClick={onResetBankrollSession}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reiniciar Sessão da Banca</span>
              </button>
            </div>
          </section>

          <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Limites Obrigatórios de Risco (Sem Martingale)
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                { key: 'initialBalanceAoa', label: 'Banca Inicial (AOA)' },
                { key: 'baseStakeAoa', label: 'Aposta Fixa Máxima (AOA)' },
                { key: 'sessionMaxLossAoa', label: 'Perda Máx. Sessão (AOA)' },
                { key: 'dailyMaxLossAoa', label: 'Perda Máx. Diária (AOA)' },
                { key: 'weeklyMaxLossAoa', label: 'Perda Máx. Semanal (AOA)' },
                { key: 'winTargetAoa', label: 'Meta de Lucro (AOA)' },
                { key: 'pauseAfterConsecutiveLosses', label: 'Pausa após N perdas' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-slate-400 mb-1">{field.label}</label>
                  <input
                    type="number"
                    min={1}
                    value={bankrollCfg[field.key as keyof AviatorBankrollConfig] as number}
                    onChange={(e) =>
                      onUpdateBankrollCfg({
                        ...bankrollCfg,
                        [field.key]: Math.max(1, Number(e.target.value) || 1),
                        strictNoMartingale: true,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ==================== G. AUTO BET MANAGER ==================== */}
      {section === 'autobet' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 p-3 text-xs text-blue-200">
            <strong>Transparência Técnica:</strong> {KWANZABET_API_CAPABILITY_NOTICE}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Modo de Operação</label>
              <select
                value={autoBetCfg.enabled ? autoBetCfg.mode : 'off'}
                onChange={(e) => {
                  const val = e.target.value as AviatorAutoBetConfig['mode'];
                  onUpdateAutoBetCfg({
                    ...autoBetCfg,
                    enabled: val !== 'off',
                    mode: val,
                  });
                }}
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100"
              >
                <option value="off">Desativado</option>
                <option value="simulation">Modo 1: Simulação Local</option>
                <option value="manual_prepared">Modo 2: Preparação Manual (Com Confirmação)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Estratégia Vinculada</label>
              <select
                value={autoBetCfg.strategyId}
                onChange={(e) =>
                  onUpdateAutoBetCfg({
                    ...autoBetCfg,
                    strategyId: e.target.value as AviatorStrategyId,
                  })
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100"
              >
                {allDefs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Valor Fixo (máx. {bankrollCfg.baseStakeAoa} AOA)</label>
              <input
                type="number"
                min={1}
                max={bankrollCfg.baseStakeAoa}
                value={autoBetCfg.stakeAoa}
                onChange={(e) =>
                  onUpdateAutoBetCfg({
                    ...autoBetCfg,
                    stakeAoa: Math.min(bankrollCfg.baseStakeAoa, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Confiança Mínima (%)</label>
              <input
                type="number"
                min={20}
                max={95}
                value={autoBetCfg.minConfidencePct}
                onChange={(e) =>
                  onUpdateAutoBetCfg({
                    ...autoBetCfg,
                    minConfidencePct: Math.max(20, Math.min(95, Number(e.target.value) || 50)),
                  })
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Máx. Entradas na Sessão</label>
              <input
                type="number"
                min={1}
                max={100}
                value={autoBetCfg.maxBetsPerSession}
                onChange={(e) =>
                  onUpdateAutoBetCfg({
                    ...autoBetCfg,
                    maxBetsPerSession: Math.max(1, Number(e.target.value) || 10),
                  })
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Horário Permitido (Início–Fim)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={autoBetCfg.activeHourStart}
                  onChange={(e) =>
                    onUpdateAutoBetCfg({
                      ...autoBetCfg,
                      activeHourStart: Math.max(0, Math.min(23, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-1/2 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 font-mono text-slate-100"
                />
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={autoBetCfg.activeHourEnd}
                  onChange={(e) =>
                    onUpdateAutoBetCfg({
                      ...autoBetCfg,
                      activeHourEnd: Math.max(0, Math.min(23, Number(e.target.value) || 23)),
                    })
                  }
                  className="w-1/2 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-2 font-mono text-slate-100"
                />
              </div>
            </div>
          </div>

          {autoBetState.lastBlockReason && (
            <div className="text-xs text-amber-300">Bloqueio atual: {autoBetState.lastBlockReason}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-2">Rodada</th>
                  <th className="py-2 px-2">Modo</th>
                  <th className="py-2 px-2 text-right">Stake</th>
                  <th className="py-2 px-2 text-right">Alvo</th>
                  <th className="py-2 px-2 text-right">Crash</th>
                  <th className="py-2 px-2">Estado</th>
                  <th className="py-2 pl-2 text-right">Líquido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {autoBetState.operations.slice(0, 20).map((op) => (
                  <tr key={op.id}>
                    <td className="py-2 pr-2">#{op.roundNumber}</td>
                    <td className="py-2 px-2 font-sans">{op.mode}</td>
                    <td className="py-2 px-2 text-right">{op.stakeAoa.toFixed(0)}</td>
                    <td className="py-2 px-2 text-right">{op.targetCashout.toFixed(2)}x</td>
                    <td className="py-2 px-2 text-right">
                      {op.actualCrash ? `${op.actualCrash.toFixed(2)}x` : '--'}
                    </td>
                    <td className="py-2 px-2 font-sans">{op.status}</td>
                    <td
                      className={`py-2 pl-2 text-right ${
                        op.netAoa >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {op.netAoa >= 0 ? '+' : ''}
                      {op.netAoa.toFixed(0)}
                    </td>
                  </tr>
                ))}
                {autoBetState.operations.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center font-sans text-slate-500">
                      Nenhuma operação simulada ou manual registada nesta sessão.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== H. CASH OUT MANAGER ==================== */}
      {section === 'cashout' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-100">
            H. Gestor & Monitorização de Cash Out
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cashOutCfg.enabled}
                onChange={(e) => onUpdateCashOutCfg({ ...cashOutCfg, enabled: e.target.checked })}
              />
              <span>Ativar Monitorização de Alvo ao Vivo</span>
            </label>
            <div>
              <label className="block text-slate-400 mb-1">Multiplicador Alvo (x)</label>
              <input
                type="number"
                step="0.05"
                min={1.05}
                max={100}
                value={cashOutCfg.targetMultiplier}
                onChange={(e) =>
                  onUpdateCashOutCfg({
                    ...cashOutCfg,
                    targetMultiplier: Math.max(1.05, Number(e.target.value) || 1.5),
                  })
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Máx. Tentativas na Sessão</label>
              <input
                type="number"
                min={1}
                max={100}
                value={cashOutCfg.maxAttemptsPerSession}
                onChange={(e) =>
                  onUpdateCashOutCfg({
                    ...cashOutCfg,
                    maxAttemptsPerSession: Math.max(1, Number(e.target.value) || 15),
                  })
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 font-mono text-xs tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Tentativas</div>
              <div className="text-lg font-bold text-slate-100">{cashOutState.attemptsCount}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Alvos Atingidos</div>
              <div className="text-lg font-bold text-emerald-400">{cashOutState.reachedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Crashes Antes</div>
              <div className="text-lg font-bold text-red-400">{cashOutState.missedCount}</div>
            </div>
          </div>

          <div className="divide-y divide-slate-800/70 text-xs">
            {cashOutState.operations.slice(0, 12).map((op) => (
              <div key={op.id} className="py-2 flex items-center justify-between gap-2">
                <span className="text-slate-300">{op.note}</span>
                <span className="font-mono text-slate-400 shrink-0">
                  {op.liveMultiplierAtEvent.toFixed(2)}x
                </span>
              </div>
            ))}
            {cashOutState.operations.length === 0 && (
              <div className="py-4 text-center text-slate-500">
                Sem eventos de monitorização de Cash Out ainda.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== I. ESTATÍSTICAS & DESEMPENHO ==================== */}
      {section === 'statistics' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-100">
            I. Estatísticas Gerais, Recentes & Distribuição por Categorias
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-xs tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Média Geral</div>
              <div className="text-lg font-bold text-slate-100">
                {analysis.statistics.overallAvgMultiplier.toFixed(2)}x
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Mediana</div>
              <div className="text-lg font-bold text-amber-300">
                {analysis.statistics.overallMedianMultiplier.toFixed(2)}x
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Média 20 Rec.</div>
              <div className="text-lg font-bold text-sky-300">
                {analysis.statistics.recent20AvgMultiplier.toFixed(2)}x
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Taxa &gt;= 2.00x</div>
              <div className="text-lg font-bold text-purple-300">
                {analysis.statistics.above2xPct.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Máximo Visto</div>
              <div className="text-lg font-bold text-fuchsia-300">
                {analysis.statistics.overallMaxMultiplier.toFixed(2)}x
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {(
              [
                'under_1_50',
                '1_50_to_2_00',
                '2_00_to_3_00',
                '3_00_to_5_00',
                '5_00_to_10_00',
                'over_10_00',
              ] as AviatorCategory[]
            ).map((cat) => {
              const count = analysis.statistics.categoryCounts[cat];
              const pct = analysis.statistics.categoryPcts[cat];
              return (
                <div key={cat} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span className="font-sans text-slate-300">{formatCategoryLabel(cat)}</span>
                    <span className="text-slate-400">
                      {count} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#0B0F17] overflow-hidden">
                    <div
                      className="h-full bg-red-500 transition-all"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ==================== J. CONFIGURAÇÕES ==================== */}
      {section === 'settings' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-100">
            J. Configurações de Captura, Bateria & Telemetria
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2">
              <div className="font-semibold text-slate-200">
                Intervalo de Leitura OCR ({captureStatus.captureIntervalMs} ms)
              </div>
              <input
                type="range"
                min={350}
                max={2000}
                step={50}
                value={captureStatus.captureIntervalMs}
                onChange={(e) => onChangeCaptureInterval(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>350ms (Rápido)</span>
                <span>550ms (Padrão)</span>
                <span>2000ms (Economia bateria)</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-1 font-mono text-[11px] text-slate-300">
              <div>Última leitura: {scanDebug.lastReadTime}</div>
              <div>Último multiplicador: {scanDebug.lastMultiplierLabel}</div>
              <div>Latência OCR: {scanDebug.lastReadMs !== null ? `${scanDebug.lastReadMs}ms` : '--'}</div>
              <div>MediaProjection externa: {captureStatus.mediaProjectionActive ? 'ATIVA' : 'INATIVA'}</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
