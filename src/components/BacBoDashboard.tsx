import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FlaskConical,
  Layers,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  TrendingUp,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  BacBoEngineAnalysis,
  BacBoOutcome,
  BacBoRoundRecord,
  BacBoTestReport,
  BEAD_PLATE_ROWS,
  buildPreSessionBacBoRounds,
  createBackupPayload,
  exportRoundsToCsv,
  filterRounds,
  formatOutcomeLabel,
  getBacBoRoundCycleStatus,
  parseBacBoBatchSequence,
  parseBackupPayload,
  runAllBacBoTests,
  scanBacBoScreenshotImage,
} from '../modules/bacbo';

type BacBoSection =
  | 'live'
  | 'patterns'
  | 'strategies'
  | 'ties'
  | 'performance'
  | 'learning'
  | 'history';

interface BacBoDashboardProps {
  rounds: BacBoRoundRecord[];
  analysis: BacBoEngineAnalysis;
  roiTopPct: number;
  roiHeightPct: number;
  lastLiveResultAt?: number | null;
  cycleNowMs?: number;
  scanDebug: {
    lastReadTime: string;
    lastOutcomeLabel: string;
    lastReadMs: number | null;
    consecutiveFailures: number;
  };
  onAddRound: (input: {
    outcome?: BacBoOutcome | null;
    playerTotal?: number | null;
    bankerTotal?: number | null;
    winningTotal?: number | null;
    playerDice?: [number, number] | null;
    bankerDice?: [number, number] | null;
    source: 'ocr' | 'manual' | 'import';
  }) => { valid: boolean; reason?: string };
  onImportRounds: (restored: BacBoRoundRecord[], options?: { replace?: boolean }) => void;
  onResetAll: () => void;
  bacboScanMode?: 'auto' | 'blocks' | 'bead_plate';
  onChangeBacBoScanMode?: (mode: 'auto' | 'blocks' | 'bead_plate') => void;
}

function outcomeStyle(outcome: BacBoOutcome | 'NONE') {
  if (outcome === 'P') {
    return {
      bg: 'bg-blue-600 border-blue-400',
      soft: 'bg-blue-500/15 border-blue-500/40 text-blue-300',
      text: 'text-blue-400',
      bar: 'bg-blue-500',
    };
  }
  if (outcome === 'B') {
    return {
      bg: 'bg-[#B91C1C] border-red-400',
      soft: 'bg-red-500/15 border-red-500/40 text-red-300',
      text: 'text-red-400',
      bar: 'bg-red-500',
    };
  }
  if (outcome === 'T') {
    return {
      bg: 'bg-amber-600 border-amber-400',
      soft: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
      text: 'text-amber-300',
      bar: 'bg-amber-400',
    };
  }
  return {
    bg: 'bg-slate-800 border-slate-700',
    soft: 'bg-slate-800/70 border-slate-700 text-slate-300',
    text: 'text-slate-300',
    bar: 'bg-slate-600',
  };
}

export const BacBoDashboard: React.FC<BacBoDashboardProps> = ({
  rounds,
  analysis,
  roiTopPct,
  roiHeightPct,
  lastLiveResultAt = null,
  cycleNowMs,
  scanDebug,
  onAddRound,
  onImportRounds,
  onResetAll,
  bacboScanMode = 'auto',
  onChangeBacBoScanMode,
}) => {
  const [section, setSection] = useState<BacBoSection>('live');
  const [pTotalInput, setPTotalInput] = useState('');
  const [bTotalInput, setBTotalInput] = useState('');
  const [pDice1, setPDice1] = useState('');
  const [pDice2, setPDice2] = useState('');
  const [bDice1, setBDice1] = useState('');
  const [bDice2, setBDice2] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [ocrImageMsg, setOcrImageMsg] = useState<string | null>(null);
  const [testReport, setTestReport] = useState<BacBoTestReport | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Pré-carregamento de Mesa Anterior (Print Bead Plate + Sequência em Lote)
  const [showPreloadPanel, setShowPreloadPanel] = useState(false);
  const [preloadTab, setPreloadTab] = useState<'image' | 'batch'>('image');
  const [cropIsPlateOnly, setCropIsPlateOnly] = useState(true);
  const [isScanningPlateImage, setIsScanningPlateImage] = useState(false);
  const [stagedItems, setStagedItems] = useState<{ outcome: BacBoOutcome; total: number | null }[]>([]);
  const [stagedEngineInfo, setStagedEngineInfo] = useState<string | null>(null);
  const [batchInputText, setBatchInputText] = useState('');
  const [batchQuickTotal, setBatchQuickTotal] = useState('');
  const [selectedStageIdx, setSelectedStageIdx] = useState<number | null>(null);

  // Filtros do Histórico
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<BacBoOutcome | 'ALL'>('ALL');
  const [patternQuery, setPatternQuery] = useState('');

  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const handleQuickOutcome = (outcome: BacBoOutcome) => {
    setInputError(null);
    const pt = pTotalInput.trim() ? Number(pTotalInput.trim()) : null;
    const bt = bTotalInput.trim() ? Number(bTotalInput.trim()) : null;
    const wt =
      pt !== null && bt !== null
        ? outcome === 'P'
          ? pt
          : outcome === 'B'
          ? bt
          : pt
        : pt ?? bt ?? null;

    const pDice =
      pDice1.trim() && pDice2.trim()
        ? ([Number(pDice1), Number(pDice2)] as [number, number])
        : null;
    const bDice =
      bDice1.trim() && bDice2.trim()
        ? ([Number(bDice1), Number(bDice2)] as [number, number])
        : null;

    const res = onAddRound({
      outcome,
      playerTotal: pt,
      bankerTotal: bt,
      winningTotal: wt,
      playerDice: pDice,
      bankerDice: bDice,
      source: 'manual',
    });

    if (!res.valid) {
      setInputError(res.reason ?? 'Dados inválidos.');
      return;
    }

    setPTotalInput('');
    setBTotalInput('');
    setPDice1('');
    setPDice2('');
    setBDice1('');
    setBDice2('');
  };

  const handleTotalsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInputError(null);
    const pDice =
      pDice1.trim() && pDice2.trim()
        ? ([Number(pDice1), Number(pDice2)] as [number, number])
        : null;
    const bDice =
      bDice1.trim() && bDice2.trim()
        ? ([Number(bDice1), Number(bDice2)] as [number, number])
        : null;

    const pt = pDice ? pDice[0] + pDice[1] : pTotalInput.trim() ? Number(pTotalInput) : null;
    const bt = bDice ? bDice[0] + bDice[1] : bTotalInput.trim() ? Number(bTotalInput) : null;

    if (pt === null || bt === null) {
      setInputError('Informe os totais ou dados dos dois lados, ou toque nos botões Player / Banker / Tie.');
      return;
    }

    const res = onAddRound({
      playerTotal: pt,
      bankerTotal: bt,
      playerDice: pDice,
      bankerDice: bDice,
      source: 'manual',
    });
    if (!res.valid) {
      setInputError(res.reason ?? 'Totais inválidos.');
      return;
    }
    setPTotalInput('');
    setBTotalInput('');
    setPDice1('');
    setPDice2('');
    setBDice1('');
    setBDice2('');
  };

  const handleScanScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setShowPreloadPanel(true);
    setPreloadTab('image');
    setIsScanningPlateImage(true);
    setSelectedStageIdx(null);
    setOcrImageMsg('A analisar imagem da grelha Bead Plate...');
    try {
      const scanTop =
        (roiTopPct === 4 && roiHeightPct === 7) ||
        (roiTopPct === 40 && roiHeightPct === 36) ||
        (roiTopPct === 34 && roiHeightPct === 40)
          ? 64
          : roiTopPct;
      const scanHeight =
        (roiTopPct === 4 && roiHeightPct === 7) ||
        (roiTopPct === 40 && roiHeightPct === 36) ||
        (roiTopPct === 34 && roiHeightPct === 40)
          ? 24
          : roiHeightPct;
      const scan = await scanBacBoScreenshotImage(file, {
        fullImage: cropIsPlateOnly,
        roiTopPct: scanTop,
        roiHeightPct: scanHeight,
      });
      if (scan.cells.length === 0) {
        setStagedItems([]);
        setStagedEngineInfo(null);
        setOcrImageMsg(
          'Nenhuma bola azul/vermelha/dourada detetada. Tente alternar entre "Recorte da Grelha" e "Print Completo".'
        );
        return;
      }
      const mapped = scan.cells.map((c) => ({ outcome: c.outcome, total: c.total }));
      setStagedItems(mapped);
      const pCnt = mapped.filter((m) => m.outcome === 'P').length;
      const bCnt = mapped.filter((m) => m.outcome === 'B').length;
      const tCnt = mapped.filter((m) => m.outcome === 'T').length;
      const engineLabel = scan.engine === 'ai-vision' ? 'Visão IA (Cores + Totais 2–12)' : 'Scanner HSV 2D Offline';
      setStagedEngineInfo(`${mapped.length} jogadas detetadas (${pCnt}P · ${bCnt}B · ${tCnt}T) · ${engineLabel}`);
      setOcrImageMsg(
        `Pré-visualização pronta: ${mapped.length} jogadas lidas na grelha. Confira abaixo e clique em "Iniciar Mesa".`
      );
    } catch {
      setOcrImageMsg('Falha ao processar a imagem selecionada.');
    } finally {
      setIsScanningPlateImage(false);
    }
  };

  const handleBatchTextChange = (text: string) => {
    setBatchInputText(text);
    const parsed = parseBacBoBatchSequence(text);
    setStagedItems(parsed.items);
    setSelectedStageIdx(null);
    if (parsed.items.length > 0) {
      const pCnt = parsed.items.filter((m) => m.outcome === 'P').length;
      const bCnt = parsed.items.filter((m) => m.outcome === 'B').length;
      const tCnt = parsed.items.filter((m) => m.outcome === 'T').length;
      const invMsg =
        parsed.invalidTokens.length > 0
          ? ` · Ignorados: ${parsed.invalidTokens.slice(0, 4).join(', ')}`
          : '';
      setStagedEngineInfo(`Lote manual: ${parsed.items.length} jogadas (${pCnt}P · ${bCnt}B · ${tCnt}T)${invMsg}`);
    } else {
      setStagedEngineInfo(null);
    }
  };

  const handleAppendQuickStaged = (outcome: BacBoOutcome) => {
    const trimmedTot = batchQuickTotal.trim();
    let validTot: number | null = null;
    if (trimmedTot) {
      const n = Number(trimmedTot);
      if (Number.isInteger(n) && n >= 2 && n <= 12) {
        validTot = n;
      }
    }
    const token = validTot !== null ? `${outcome}${validTot}` : outcome;
    const nextText = batchInputText.trim() ? `${batchInputText.trim()} ${token}` : token;
    setBatchInputText(nextText);
    const nextItems = [...stagedItems, { outcome, total: validTot }];
    setStagedItems(nextItems);
    setBatchQuickTotal('');
    const pCnt = nextItems.filter((m) => m.outcome === 'P').length;
    const bCnt = nextItems.filter((m) => m.outcome === 'B').length;
    const tCnt = nextItems.filter((m) => m.outcome === 'T').length;
    setStagedEngineInfo(`Sequência preparada: ${nextItems.length} jogadas (${pCnt}P · ${bCnt}B · ${tCnt}T)`);
  };

  const handleCycleStagedOutcome = (idx: number) => {
    setStagedItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const nextOut: BacBoOutcome =
          item.outcome === 'P' ? 'B' : item.outcome === 'B' ? 'T' : 'P';
        return { ...item, outcome: nextOut };
      })
    );
  };

  const handleUpdateStagedTotal = (idx: number, rawVal: string) => {
    const parsed = rawVal.trim() ? Number(rawVal.trim()) : null;
    const valid =
      parsed !== null && Number.isInteger(parsed) && parsed >= 2 && parsed <= 12 ? parsed : null;
    setStagedItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, total: valid } : item))
    );
  };

  const handleRemoveStagedCell = (idx: number) => {
    setStagedItems((prev) => prev.filter((_, i) => i !== idx));
    setSelectedStageIdx(null);
  };

  const handleApplyStagedTable = (mode: 'replace' | 'append') => {
    if (stagedItems.length === 0) return;
    const built = buildPreSessionBacBoRounds(stagedItems, rounds, mode);
    onImportRounds(built, { replace: mode === 'replace' });
    setShowPreloadPanel(false);
    setSelectedStageIdx(null);
    setOcrImageMsg(
      mode === 'replace'
        ? `Mesa carregada com ${stagedItems.length} jogadas anteriores! Análise, padrões e Aposta Mestra atualizados.`
        : `${stagedItems.length} jogadas adicionadas ao histórico (total: ${built.length}).`
    );
  };

  const handleRunLogicTests = () => {
    const report = runAllBacBoTests();
    setTestReport(report);
  };

  const handleDownloadBackupJson = () => {
    const payload = createBackupPayload(rounds);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bacbo_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const csv = exportRoundsToCsv(rounds);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bacbo_historico_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const restored = parseBackupPayload(text);
      onImportRounds(restored);
      setInputError(null);
      setOcrImageMsg(`Backup restaurado com ${restored.length} rodadas.`);
    } catch (err) {
      setInputError(err instanceof Error ? err.message : 'Erro ao restaurar backup.');
    }
  };

  const filteredHistory = useMemo(
    () =>
      filterRounds(rounds, {
        dateFrom,
        dateTo,
        outcomeFilter,
        patternQuery,
      })
        .slice()
        .reverse(),
    [rounds, dateFrom, dateTo, outcomeFilter, patternQuery]
  );

  const roundById = useMemo(() => {
    const map = new Map<string, BacBoRoundRecord>();
    for (const r of rounds) {
      map.set(r.id, r);
    }
    return map;
  }, [rounds]);

  // Monta colunas da grelha Bead Plate (6 linhas por coluna)
  const beadColumns = useMemo(() => {
    const cols: (typeof analysis.beadPlate)[] = [];
    const recentCells = analysis.beadPlate.slice(-96); // últimas 16 colunas (16x6=96)
    const offsetCol = recentCells.length > 0 ? recentCells[0].col : 0;
    for (const cell of recentCells) {
      const localCol = cell.col - offsetCol;
      if (!cols[localCol]) cols[localCol] = [];
      cols[localCol][cell.row] = cell;
    }
    return cols;
  }, [analysis.beadPlate]);

  const sugStyle = outcomeStyle(analysis.strategies.finalSuggestion);
  const { probabilities, strategies, streaks, ties, patterns, statistics, learning } = analysis;
  const roundCycle = getBacBoRoundCycleStatus(lastLiveResultAt, cycleNowMs ?? Date.now());

  return (
    <div className="space-y-5">
      {/* Cabeçalho Bac Bo + Botão TESTAR LÓGICA */}
      <section className="rounded-xl border border-slate-800 bg-[#131924] p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Rodadas armazenadas: {analysis.totalRounds}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-blue-300">
                P: {probabilities.observed.player.toFixed(1)}%
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-amber-300">
                T: {probabilities.observed.tie.toFixed(1)}%
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-red-300">
                B: {probabilities.observed.banker.toFixed(1)}%
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-emerald-400">
                Acerto Geral: {statistics.overall.hitRatePct.toFixed(1)}% ({statistics.overall.hits}/
                {statistics.overall.suggestions})
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-100">
              Bac Bo Intelligence Engine
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onChangeBacBoScanMode && (
              <div
                role="group"
                aria-label="Modo de leitura OCR do Bac Bo"
                className="inline-flex items-center rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5"
              >
                {(
                  [
                    { id: 'auto', label: 'OCR Auto' },
                    { id: 'blocks', label: 'Jogador vs Banca' },
                    { id: 'bead_plate', label: 'Bead Plate' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChangeBacBoScanMode(m.id)}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      bacboScanMode === m.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleRunLogicTests}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>TESTAR LÓGICA</span>
            </button>

            <input
              ref={screenshotInputRef}
              type="file"
              accept="image/*"
              onChange={handleScanScreenshot}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setShowPreloadPanel((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showPreloadPanel
                  ? 'border-blue-400 bg-blue-600 text-white'
                  : 'border-blue-500/50 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Carregar Mesa Anterior</span>
            </button>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-3 py-2 text-xs font-medium text-slate-400 hover:text-red-300 hover:border-red-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Zerar 0%</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onResetAll();
                    setConfirmReset(false);
                  }}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Confirmar Limpeza
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs text-slate-300 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sub-navegação das 7 secções do Bac Bo */}
        <div className="mt-4 flex items-center gap-1.5 overflow-x-auto border-t border-slate-800 pt-3">
          {[
            { id: 'live', label: '1. Análise ao Vivo' },
            { id: 'patterns', label: '2. Padrões Detetados' },
            { id: 'strategies', label: '3. Estratégias' },
            { id: 'ties', label: '4. Empates' },
            { id: 'performance', label: '5. Desempenho' },
            { id: 'learning', label: '6. Aprendizagem' },
            { id: 'history', label: '7. Histórico' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id as BacBoSection)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                section === tab.id
                  ? 'bg-slate-800 text-amber-300 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* Relatório Automático [ TESTAR LÓGICA ] */}
      {testReport && (
        <section className="rounded-xl border border-slate-700 bg-[#131924] p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Relatório de Testes Automáticos ({testReport.executedAt})
              </h2>
              <p className="text-xs text-slate-400">
                Aprovados: <span className="text-emerald-400 font-mono font-bold">{testReport.passed}</span> /{' '}
                {testReport.total} · Reprovados:{' '}
                <span className={testReport.failed > 0 ? 'text-red-400 font-mono font-bold' : 'text-slate-300 font-mono'}>
                  {testReport.failed}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTestReport(null)}
              className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
            >
              Fechar relatório
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {testReport.cases.map((tc) => (
              <div
                key={tc.name}
                className={`rounded-lg border p-3 text-xs ${
                  tc.passed
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-red-500/40 bg-red-500/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-semibold text-slate-100">
                  <span>{tc.name}</span>
                  {tc.passed ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      APROVADO
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-400">
                      <XCircle className="h-3.5 w-3.5" />
                      REPROVADO
                    </span>
                  )}
                </div>
                <p className="mt-1 text-slate-400 leading-relaxed">{tc.details}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {ocrImageMsg && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-xs text-blue-200 flex items-center justify-between gap-2">
          <span>{ocrImageMsg}</span>
          <button type="button" onClick={() => setOcrImageMsg(null)} className="underline cursor-pointer">
            OK
          </button>
        </div>
      )}

      {/* PAINEL: CARREGAR MESA ANTERIOR (PRÉ-SESSÃO) */}
      {showPreloadPanel && (
        <section className="rounded-xl border border-blue-500/40 bg-[#131924] p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Carregar Jogadas Anteriores da Mesa (Pré-Sessão)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Importe o histórico atual da mesa por print da grelha Bead Plate ou sequência em lote antes de iniciar o jogo ao vivo.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-800 bg-[#0B0F17] p-0.5">
                <button
                  type="button"
                  onClick={() => setPreloadTab('image')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                    preloadTab === 'image' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Print da Grelha
                </button>
                <button
                  type="button"
                  onClick={() => setPreloadTab('batch')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                    preloadTab === 'batch' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Sequência / Lote
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowPreloadPanel(false)}
                className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>

          {preloadTab === 'image' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCropIsPlateOnly(true)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                      cropIsPlateOnly
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Recorte direto da grelha (Recomendado)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropIsPlateOnly(false)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                      !cropIsPlateOnly
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                        : 'border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Print completo do ecrã
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Ordem lida automaticamente: coluna esquerda → direita, de cima para baixo (Azul = P, Vermelho = B, Dourado = Tie).
                </p>
              </div>

              <button
                type="button"
                disabled={isScanningPlateImage}
                onClick={() => screenshotInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{isScanningPlateImage ? 'A ler grelha...' : 'Escolher Print da Grelha'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={12}
                  value={batchQuickTotal}
                  onChange={(e) => setBatchQuickTotal(e.target.value)}
                  placeholder="Total (opcional 2–12)"
                  className="w-40 rounded-lg border border-slate-700 bg-[#131924] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleAppendQuickStaged('P')}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 cursor-pointer"
                >
                  +P
                </button>
                <button
                  type="button"
                  onClick={() => handleAppendQuickStaged('B')}
                  className="rounded-lg bg-[#B91C1C] px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600 cursor-pointer"
                >
                  +B
                </button>
                <button
                  type="button"
                  onClick={() => handleAppendQuickStaged('T')}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 cursor-pointer"
                >
                  +T
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (stagedItems.length > 0) {
                      setStagedItems((prev) => prev.slice(0, -1));
                    }
                  }}
                  className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Apagar Último
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBatchInputText('');
                    setStagedItems([]);
                    setStagedEngineInfo(null);
                  }}
                  className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 hover:text-red-300 cursor-pointer"
                >
                  Limpar
                </button>
              </div>
              <textarea
                rows={2}
                value={batchInputText}
                onChange={(e) => handleBatchTextChange(e.target.value)}
                placeholder="Ou cole a sequência do mais antigo ao mais recente. Ex: P7 B10 P9 B9 T7 P8 B5..."
                className="w-full rounded-lg border border-slate-700 bg-[#131924] px-3 py-2 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          {/* Pré-visualização interativa da grelha antes de aplicar */}
          {stagedItems.length > 0 && (
            <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-emerald-300">
                  {stagedEngineInfo ?? `${stagedItems.length} jogadas prontas para carregar`}
                </span>
                <span className="text-[11px] text-slate-400">
                  Toque numa bola para corrigir cor/número antes de guardar.
                </span>
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="inline-flex gap-1.5">
                  {Array.from({ length: Math.ceil(stagedItems.length / BEAD_PLATE_ROWS) }, (_, colIdx) => (
                    <div key={colIdx} className="grid grid-rows-6 gap-1.5">
                      {Array.from({ length: BEAD_PLATE_ROWS }, (_, rowIdx) => {
                        const itemIdx = colIdx * BEAD_PLATE_ROWS + rowIdx;
                        const item = stagedItems[itemIdx];
                        if (!item) {
                          return (
                            <span
                              key={rowIdx}
                              className="h-7 w-7 rounded-full border border-slate-800/60 bg-slate-950/50"
                            />
                          );
                        }
                        const st = outcomeStyle(item.outcome);
                        const isSel = selectedStageIdx === itemIdx;
                        return (
                          <button
                            key={itemIdx}
                            type="button"
                            onClick={() => setSelectedStageIdx(isSel ? null : itemIdx)}
                            title={`#${itemIdx + 1} · Clique para editar`}
                            className={`h-7 w-7 rounded-full border font-mono text-[11px] font-bold text-white cursor-pointer flex items-center justify-center ${st.bg} ${
                              isSel ? 'ring-2 ring-white scale-105' : ''
                            }`}
                          >
                            {item.total ?? item.outcome}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {selectedStageIdx !== null && stagedItems[selectedStageIdx] && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-[#131924] px-3 py-2 text-xs">
                  <span className="font-mono text-slate-300">Jogada #{selectedStageIdx + 1}:</span>
                  <button
                    type="button"
                    onClick={() => handleCycleStagedOutcome(selectedStageIdx)}
                    className="rounded border border-slate-600 bg-slate-800 px-2.5 py-1 font-semibold text-slate-100 hover:bg-slate-700 cursor-pointer"
                  >
                    Alternar Cor ({formatOutcomeLabel(stagedItems[selectedStageIdx].outcome)})
                  </button>
                  <input
                    type="number"
                    min={2}
                    max={12}
                    value={stagedItems[selectedStageIdx].total ?? ''}
                    onChange={(e) => handleUpdateStagedTotal(selectedStageIdx, e.target.value)}
                    placeholder="Nº 2–12"
                    className="w-20 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveStagedCell(selectedStageIdx)}
                    className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-red-300 hover:bg-red-500/20 cursor-pointer"
                  >
                    Remover Bola
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleApplyStagedTable('append')}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 cursor-pointer"
                >
                  Adicionar ao Histórico ({rounds.length} + {stagedItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyStagedTable('replace')}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  Iniciar Nova Mesa ({stagedItems.length} jogadas)
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* SECÇÃO 1: ANÁLISE AO VIVO */}
      {section === 'live' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Entrada de Resultados + Validação */}
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Registo e Leitura de Rodadas
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Ciclo Kwanzabet: 9s após resultado · 10–12s dados a girar.
                  </p>
                </div>
                <span
                  className={`rounded-md border px-2 py-1 font-mono text-[11px] font-semibold tabular-nums shrink-0 ${
                    roundCycle.phase === 'BETTING_WINDOW'
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                      : roundCycle.phase === 'ROLLING'
                      ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                      : 'border-slate-700 bg-[#0B0F17] text-slate-300'
                  }`}
                >
                  {roundCycle.label}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickOutcome('P')}
                  className="rounded-lg border border-blue-500/50 bg-blue-600/90 py-2.5 text-xs font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  + PLAYER
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickOutcome('T')}
                  className="rounded-lg border border-amber-400/50 bg-amber-600/90 py-2.5 text-xs font-bold text-white hover:bg-amber-500 transition-colors cursor-pointer"
                >
                  + TIE
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickOutcome('B')}
                  className="rounded-lg border border-red-400/50 bg-[#B91C1C] py-2.5 text-xs font-bold text-white hover:bg-red-600 transition-colors cursor-pointer"
                >
                  + BANKER
                </button>
              </div>

              <form onSubmit={handleTotalsSubmit} className="space-y-3 border-t border-slate-800 pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-blue-300 mb-1">Total Player (2–12)</label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={pTotalInput}
                      onChange={(e) => setPTotalInput(e.target.value)}
                      placeholder="Ex: 9"
                      className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-red-300 mb-1">Total Banker (2–12)</label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={bTotalInput}
                      onChange={(e) => setBTotalInput(e.target.value)}
                      placeholder="Ex: 7"
                      className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 shrink-0">Dados P:</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={pDice1}
                      onChange={(e) => setPDice1(e.target.value)}
                      placeholder="D1"
                      className="w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-xs text-slate-100"
                    />
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={pDice2}
                      onChange={(e) => setPDice2(e.target.value)}
                      placeholder="D2"
                      className="w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-xs text-slate-100"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 shrink-0">Dados B:</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={bDice1}
                      onChange={(e) => setBDice1(e.target.value)}
                      placeholder="D1"
                      className="w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-xs text-slate-100"
                    />
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={bDice2}
                      onChange={(e) => setBDice2(e.target.value)}
                      placeholder="D2"
                      className="w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                {inputError && (
                  <p className="text-xs text-red-400">{inputError}</p>
                )}

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Validar e Guardar por Totais/Dados</span>
                </button>
              </form>
            </div>

            {/* Grelha Bead Plate + Probabilidades Separadas */}
            <div className="lg:col-span-7 space-y-5">
              <div className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-100">
                    Nossa Tabela · Bead Plate (6 Linhas)
                  </h2>
                  <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                    <span className="text-emerald-400">✓ {statistics.overall.hits}</span>
                    <span className="text-red-400">✕ {statistics.overall.misses}</span>
                    <span className="text-slate-400">({rounds.length} rod.)</span>
                  </div>
                </div>

                {rounds.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400 space-y-3">
                    <p>
                      Nenhuma rodada registada ainda. Pode carregar o histórico completo da mesa anterior (print ou lote) antes de começar.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowPreloadPanel(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/50 bg-blue-500/15 px-3.5 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Carregar Mesa Anterior (Print / Lote)</span>
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto pb-1">
                    <div className="inline-flex gap-1.5">
                      {beadColumns.map((colCells, colIdx) => (
                        <div key={colIdx} className="grid grid-rows-6 gap-1.5">
                          {Array.from({ length: BEAD_PLATE_ROWS }, (_, rowIdx) => {
                            const cell = colCells?.[rowIdx];
                            if (!cell) {
                              return (
                                <span
                                  key={rowIdx}
                                  className="h-7 w-7 rounded-full border border-slate-800/70 bg-[#0B0F17]"
                                />
                              );
                            }
                            const st = outcomeStyle(cell.outcome);
                            const rec = roundById.get(cell.recordId);
                            const pred = rec?.predictionBefore;
                            const evaluated = pred && pred.suggestion !== 'NONE';
                            const isHit = evaluated ? pred.suggestion === cell.outcome : null;
                            const scoreTxt =
                              rec && rec.playerTotal !== null && rec.bankerTotal !== null
                                ? ` ${rec.playerTotal}×${rec.bankerTotal}`
                                : cell.winningTotal
                                ? ` (${cell.winningTotal})`
                                : '';
                            const evalTxt =
                              isHit !== null && pred
                                ? ` · Nossa: ${formatOutcomeLabel(pred.suggestion)} (${
                                    isHit ? 'ACERTOU' : 'ERRO NOSSO'
                                  })`
                                : '';
                            return (
                              <span
                                key={cell.recordId}
                                title={`Rodada #${cell.roundNumber} · ${formatOutcomeLabel(
                                  cell.outcome
                                )}${scoreTxt}${evalTxt}`}
                                className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[11px] font-bold text-white tabular-nums ${st.bg}`}
                              >
                                {cell.winningTotal ?? cell.outcome}
                                {isHit !== null && (
                                  <span
                                    className={`absolute -top-1 -right-1 inline-flex h-3 w-3 items-center justify-center rounded-full text-[8px] font-black leading-none ring-1 ring-[#131924] ${
                                      isHit
                                        ? 'bg-emerald-400 text-slate-950'
                                        : 'bg-slate-950 text-red-400 border border-red-400'
                                    }`}
                                  >
                                    {isHit ? '✓' : '✕'}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sistema de Probabilidades (Referência vs Observada vs Modelo vs Confiança) */}
              <div className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-100">
                    Sistema de Percentagens Estatísticas
                  </h2>
                  <span className="font-mono text-xs font-semibold text-amber-300">
                    Confiança: {probabilities.statisticalConfidence}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{probabilities.sampleQualityNote}</p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 space-y-1">
                    <div className="text-slate-400">Probabilidade de Referência</div>
                    <div className="font-mono tabular-nums text-blue-300">
                      PLAYER: {probabilities.reference.player.toFixed(1)}%
                    </div>
                    <div className="font-mono tabular-nums text-amber-300">
                      TIE: {probabilities.reference.tie.toFixed(1)}%
                    </div>
                    <div className="font-mono tabular-nums text-red-300">
                      BANKER: {probabilities.reference.banker.toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 space-y-1">
                    <div className="text-slate-400">Frequência Observada</div>
                    <div className="font-mono tabular-nums text-blue-300">
                      PLAYER: {probabilities.observed.player.toFixed(1)}%
                    </div>
                    <div className="font-mono tabular-nums text-amber-300">
                      TIE: {probabilities.observed.tie.toFixed(1)}%
                    </div>
                    <div className="font-mono tabular-nums text-red-300">
                      BANKER: {probabilities.observed.banker.toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 space-y-1">
                    <div className="text-slate-400">Estimativa do Modelo</div>
                    <div className="font-mono font-bold tabular-nums text-blue-400">
                      PLAYER: {probabilities.modelEstimate.player.toFixed(1)}%
                    </div>
                    <div className="font-mono font-bold tabular-nums text-amber-300">
                      TIE: {probabilities.modelEstimate.tie.toFixed(1)}%
                    </div>
                    <div className="font-mono font-bold tabular-nums text-red-400">
                      BANKER: {probabilities.modelEstimate.banker.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECÇÃO 2: PADRÕES DETETADOS */}
      {section === 'patterns' && (
        <div className="space-y-5">
          {/* A. Corridas / Streaks */}
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-100">
                A. Corridas / Streaks (Player, Banker, Tie)
              </h2>
              <span className="text-xs text-slate-400">
                Corrida atual:{' '}
                <strong className="text-slate-100">
                  {streaks.currentSide
                    ? `${streaks.currentLength}x ${formatOutcomeLabel(streaks.currentSide)}`
                    : 'Nenhuma'}
                </strong>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['P', 'B', 'T'] as BacBoOutcome[]).map((side) => {
                const s = streaks.bySide[side];
                const st = outcomeStyle(side);
                return (
                  <div key={side} className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${st.text}`}>{s.label}</span>
                      <span className="font-mono text-xs text-slate-400 tabular-nums">
                        Máx: {s.maxHistoricalStreak}x · Atual: {s.currentStreak}x
                      </span>
                    </div>
                    <div className="divide-y divide-slate-800/70 text-xs">
                      {s.byLength.map((b) => (
                        <div key={b.label} className="py-1.5 flex items-center justify-between gap-2">
                          <span className="font-mono text-slate-300">{b.label}</span>
                          <span className="font-mono text-slate-400 tabular-nums">
                            {b.occurrences}x ({b.endedCount} fim)
                          </span>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            P:{b.followedBy.P} B:{b.followedBy.B} T:{b.followedBy.T}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* B. Padrões Alternados & Descobertos */}
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-100">
              B. Padrões Alternados e Blocos Descobertos (2 a 5 resultados)
            </h2>
            {patterns.discoveredPatterns.length === 0 ? (
              <p className="text-xs text-slate-400">
                Registe pelo menos 4 rodadas para iniciar a descoberta automática de padrões reais.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-3 font-medium">Padrão</th>
                      <th className="py-2 px-3 font-medium">Sequência</th>
                      <th className="py-2 px-3 font-medium text-right">Ocorrências</th>
                      <th className="py-2 px-3 font-medium text-right">% Repetição</th>
                      <th className="py-2 px-3 font-medium text-right">Última</th>
                      <th className="py-2 px-3 font-medium">Continuação Freq.</th>
                      <th className="py-2 pl-3 font-medium text-right">Confiança</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {patterns.discoveredPatterns.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 pr-3 font-medium text-slate-200">{p.name}</td>
                        <td className="py-2 px-3 font-mono text-amber-300">{p.sequence}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{p.occurrences}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {p.repeatRatePct.toFixed(1)}%
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                          {p.lastOccurrenceRound ? `#${p.lastOccurrenceRound}` : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-300">
                          {p.sampleSufficient && p.mostFrequentNext
                            ? `${formatOutcomeLabel(p.mostFrequentNext)} (P:${p.nextCounts.P} B:${p.nextCounts.B} T:${p.nextCounts.T})`
                            : 'Amostra insuficiente'}
                        </td>
                        <td className="py-2 pl-3 text-right font-mono text-slate-300">
                          {p.confidenceLabel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* C. Padrões de Linha e Coluna + D. Padrões de Totais */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-100">
                C. Padrões de Linha e Coluna (Bead Plate)
              </h2>
              <div className="space-y-2 text-xs">
                {patterns.rowPatterns.map((rp) => (
                  <div
                    key={rp.rowOrCol}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2"
                  >
                    <span className="font-semibold text-slate-200">{rp.rowOrCol}</span>
                    <span className="text-slate-400">{rp.description}</span>
                    <span className="font-mono text-slate-300 tabular-nums">n={rp.sampleCount}</span>
                  </div>
                ))}
                {patterns.colPatterns.map((cp) => (
                  <div
                    key={cp.rowOrCol}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2"
                  >
                    <span className="font-semibold text-slate-200">{cp.rowOrCol}</span>
                    <span className="text-slate-400">{cp.description}</span>
                    <span className="font-mono text-slate-300 tabular-nums">n={cp.sampleCount}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-100">
                D. Padrões de Totais (2–12)
              </h2>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-slate-400">Total 2 / Total 12</div>
                  <div className="mt-1 font-mono text-sm font-bold text-slate-100 tabular-nums">
                    2: {patterns.totals.total2Count}x · 12: {patterns.totals.total12Count}x
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-slate-400">Consecutivos Iguais / Dif. Média</div>
                  <div className="mt-1 font-mono text-sm font-bold text-slate-100 tabular-nums">
                    {patterns.totals.consecutiveEqualTotals}x ·{' '}
                    {patterns.totals.avgAbsDiff !== null
                      ? `${patterns.totals.avgAbsDiff.toFixed(1)} pts`
                      : '—'}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-300 space-y-1">
                <div>
                  Mais frequentes:{' '}
                  <span className="font-mono text-emerald-400">
                    {patterns.totals.mostFrequentTotals.length > 0
                      ? patterns.totals.mostFrequentTotals
                          .map((x) => `${x.total} (${x.count}x)`)
                          .join(', ')
                      : 'Sem totais registados'}
                  </span>
                </div>
                <div>
                  Menos frequentes:{' '}
                  <span className="font-mono text-slate-400">
                    {patterns.totals.leastFrequentTotals
                      .map((x) => `${x.total} (${x.count}x)`)
                      .join(', ')}
                  </span>
                </div>
              </div>

              {patterns.totals.alerts.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {patterns.totals.alerts.map((al) => (
                    <div
                      key={al}
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200"
                    >
                      {al}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* SECÇÃO 3: ESTRATÉGIAS */}
      {section === 'strategies' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Motor de Estratégias (9 Estratégias Comparadas)
              </h2>
              <p className="text-xs text-slate-400">
                Estratégias concordantes agora: {strategies.agreeingCount} de {strategies.totalStrategies} ·
                Melhor histórica: {strategies.bestStrategyName ?? 'Em recolha (mín. 5 amostras)'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {strategies.strategies.map((s) => {
              const sigStyle = outcomeStyle(s.currentSignal.suggestion);
              return (
                <div
                  key={s.id}
                  className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-100">{s.name}</div>
                    <span
                      className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded border ${sigStyle.soft}`}
                    >
                      {s.currentSignal.active
                        ? formatOutcomeLabel(s.currentSignal.suggestion)
                        : 'INATIVA'}
                    </span>
                  </div>
                  <p className="text-slate-400">{s.description}</p>
                  <div className="text-[11px] text-slate-500">
                    Condição: {s.activationConditions}
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Estado atual: {s.currentSignal.reason}
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-800 pt-2 font-mono tabular-nums">
                    <span className="text-slate-400">
                      Amostras: {s.suggestionsCount} ({s.hits}V / {s.misses}D)
                    </span>
                    <span
                      className={
                        s.suggestionsCount === 0
                          ? 'text-slate-500'
                          : s.hitRatePct >= 48
                          ? 'text-emerald-400 font-bold'
                          : 'text-amber-300 font-bold'
                      }
                    >
                      {s.hitRatePct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Melhores: {s.bestSequences.length > 0 ? s.bestSequences.join(', ') : '—'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Piores: {s.worstSequences.length > 0 ? s.worstSequences.join(', ') : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SECÇÃO 4: EMPATES */}
      {section === 'ties' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-100">
                Módulo Inteligente de Empates (Geral + Totais 2 a 12)
              </h2>
              <span className="font-mono text-xs text-amber-300 tabular-nums">
                Base teórica (2d6 vs 2d6): {ties.theoreticalTieRatePct.toFixed(2)}%
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Último Empate</div>
                <div className="mt-1 font-mono text-lg font-bold text-amber-300 tabular-nums">
                  {ties.roundsSinceLastTie} rod.
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Freq. Histórica</div>
                <div className="mt-1 font-mono text-lg font-bold text-slate-100 tabular-nums">
                  {ties.observedTieRatePct.toFixed(1)}% ({ties.totalTies}/{ties.totalRounds})
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Intervalo Médio / Máx</div>
                <div className="mt-1 font-mono text-lg font-bold text-slate-100 tabular-nums">
                  {ties.meanInterval !== null ? ties.meanInterval.toFixed(1) : '—'} / {ties.maxInterval}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Janelas (50 / 100 / 500)</div>
                <div className="mt-1 font-mono text-sm font-bold text-slate-100 tabular-nums">
                  {ties.last50TiePct.toFixed(1)}% / {ties.last100TiePct.toFixed(1)}% /{' '}
                  {ties.last500TiePct.toFixed(1)}%
                </div>
              </div>
            </div>

            {ties.alerts.length > 0 && (
              <div className="space-y-2">
                {ties.alerts.map((a) => (
                  <div
                    key={a.code}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 flex items-start gap-2"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-300" />
                    <div>
                      <div className="font-bold">{a.title}</div>
                      <div className="text-amber-100/80">{a.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-slate-400 border-t border-slate-800 pt-3">
              {ties.independenceNote}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">Tipo de Empate</th>
                    <th className="py-2 px-3 font-medium text-right">Ocorrências</th>
                    <th className="py-2 px-3 font-medium text-right">Obs. %</th>
                    <th className="py-2 pl-3 font-medium text-right">Teórico (2d6) %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {ties.byTotal.map((row) => (
                    <tr key={row.total}>
                      <td className="py-2 pr-3 font-medium text-amber-300">
                        Empate com Total {row.total}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{row.count}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {row.observedPct.toFixed(2)}%
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-slate-400">
                        {row.theoreticalPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* SECÇÃO 5: DESEMPENHO */}
      {section === 'performance' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
            <h2 className="text-base font-semibold text-slate-100">
              Estatísticas Rigorosas de Acertos e Erros
            </h2>

            {/* Desempenho Geral */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {[statistics.overall, statistics.last50, statistics.last100].map((b) => (
                <div key={b.label} className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                  <div className="text-slate-400">{b.label}</div>
                  <div className="mt-1 font-mono text-xl font-bold text-emerald-400 tabular-nums">
                    {b.hitRatePct.toFixed(1)}%
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {b.hits} acertos · {b.misses} erros ({b.suggestions} amostras)
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Regra de Contagem</div>
                <div className="mt-1 text-[11px] text-slate-300 leading-relaxed">
                  SEM SUGESTÃO não conta como erro. Empate tratado como resultado independente.
                </div>
              </div>
            </div>

            {/* Por Opção P / B / T + Gráfico visual de Barras */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-100">Desempenho por Opção</h3>
                {(['P', 'B', 'T'] as BacBoOutcome[]).map((opt) => {
                  const st = statistics.byOption[opt];
                  const col = outcomeStyle(opt);
                  return (
                    <div key={opt} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between font-mono tabular-nums">
                        <span className={col.text}>{st.label}</span>
                        <span>
                          {st.hitRatePct.toFixed(1)}% ({st.hits}/{st.suggestions})
                        </span>
                      </div>
                      <div className="h-2 w-full rounded bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full ${col.bar}`}
                          style={{ width: `${Math.min(100, st.hitRatePct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-100">Desempenho por Corrida</h3>
                <div className="space-y-1.5 text-xs font-mono tabular-nums">
                  {[
                    statistics.byStreakSide.duringBankerRun,
                    statistics.byStreakSide.duringPlayerRun,
                    statistics.byStreakLength.len2,
                    statistics.byStreakLength.len3,
                    statistics.byStreakLength.len4,
                    statistics.byStreakLength.len5Plus,
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="font-sans text-slate-300">{item.label}</span>
                      <span className="text-slate-200">
                        {item.hitRatePct.toFixed(1)}% ({item.hits}/{item.suggestions})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Por Estratégia e Por Padrão */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-slate-100">Desempenho por Estratégia</h3>
                {statistics.byStrategy.map((s) => (
                  <div key={s.label} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">{s.label}</span>
                      <span className="font-mono tabular-nums text-slate-200">
                        {s.hitRatePct.toFixed(1)}% ({s.hits}/{s.suggestions})
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${s.hitRatePct >= 48 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                        style={{ width: `${Math.min(100, s.hitRatePct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-2.5">
                <h3 className="text-sm font-semibold text-slate-100">Desempenho por Padrão</h3>
                {statistics.byPattern.map((p) => (
                  <div key={p.label} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">{p.label}</span>
                      <span className="font-mono tabular-nums text-slate-200">
                        {p.hitRatePct.toFixed(1)}% ({p.hits}/{p.suggestions})
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${Math.min(100, p.hitRatePct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* SECÇÃO 6: APRENDIZAGEM */}
      {section === 'learning' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Aprendizagem Contínua e Validação Fora da Amostra
              </h2>
              <p className="text-xs text-slate-400">
                Compara janela móvel das últimas 50 sugestões, histórico geral e validação out-of-sample (30% recentes).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Janela Móvel (Últimas 50 Sugestões)</div>
              <div className="mt-1 font-mono text-lg font-bold text-emerald-400 tabular-nums">
                {learning.rolling50HitRatePct.toFixed(1)}% ({learning.rolling50Samples} am.)
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Histórico Geral Desde o Início</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-100 tabular-nums">
                {learning.overallHitRatePct.toFixed(1)}% ({learning.overallSamples} am.)
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="text-slate-400">Validação Out-of-Sample (30%)</div>
              <div className="mt-1 font-mono text-lg font-bold text-amber-300 tabular-nums">
                {learning.outOfSampleHitRatePct.toFixed(1)}% ({learning.outOfSampleSamples} am.)
              </div>
            </div>
          </div>

          {learning.overfitWarning && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
              {learning.overfitWarning}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {learning.periods.map((per) => (
              <div key={per.label} className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
                <div className="font-semibold text-slate-200">{per.label}</div>
                <div className="mt-1 font-mono text-slate-300 tabular-nums">
                  {per.hitRatePct.toFixed(1)}% ({per.hits}/{per.suggestionsCount} sugestões em{' '}
                  {per.roundsCount} rod.)
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-1.5">
              <div className="font-semibold text-emerald-400">Estratégias Validadas em Destaque</div>
              {learning.topValidatedStrategies.length > 0 ? (
                learning.topValidatedStrategies.map((name) => (
                  <div key={name} className="text-slate-300">
                    {name}
                  </div>
                ))
              ) : (
                <div className="text-slate-500">Aguardando amostra suficiente (mín. 8 sugestões).</div>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-4 space-y-1.5">
              <div className="font-semibold text-red-400">Estratégias com Perda de Eficácia</div>
              {learning.degradingStrategies.length > 0 ? (
                learning.degradingStrategies.map((name) => (
                  <div key={name} className="text-slate-300">
                    {name}
                  </div>
                ))
              ) : (
                <div className="text-slate-500">Nenhuma degradação crítica detetada.</div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-100">
              Novos Modelos Dinâmicos Testados (Treino 70% vs Validação 30%)
            </h3>
            {learning.dynamicModels.length === 0 ? (
              <p className="text-xs text-slate-500">
                Mínimo de 24 rodadas necessárias para testar combinações dinâmicas fora da amostra.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-3 font-medium">Padrão</th>
                      <th className="py-2 px-3 font-medium">Próximo Previsto</th>
                      <th className="py-2 px-3 font-medium text-right">Treino</th>
                      <th className="py-2 px-3 font-medium text-right">Validação</th>
                      <th className="py-2 pl-3 font-medium text-right">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {learning.dynamicModels.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2 pr-3 font-mono text-slate-200">{m.pattern}</td>
                        <td className="py-2 px-3 font-semibold text-amber-300">
                          {formatOutcomeLabel(m.predictedNext)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {m.trainHitRatePct.toFixed(1)}% (n={m.trainSupport})
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {m.validationHitRatePct.toFixed(1)}% (n={m.validationSupport})
                        </td>
                        <td className="py-2 pl-3 text-right font-mono">
                          {m.beatsBaseline ? 'SUPERIOR À BASE' : 'EM TESTE'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* SECÇÃO 7: HISTÓRICO E BASE DE DADOS */}
      {section === 'history' && (
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Histórico Persistente e Base de Dados Local
              </h2>
              <p className="text-xs text-slate-400">
                Armazenamento offline automático (IndexedDB + espelho local). Filtre, exporte ou restaure.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadBackupJson}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Backup JSON</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Database className="h-3.5 w-3.5" />
                <span>Exportar CSV</span>
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleRestoreBackup}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Restaurar</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Data inicial"
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-slate-200"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Data final"
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-slate-200"
            />
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value as BacBoOutcome | 'ALL')}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-slate-200"
            >
              <option value="ALL">Todos os Resultados</option>
              <option value="P">Player (P)</option>
              <option value="B">Banker (B)</option>
              <option value="T">Tie (T)</option>
            </select>
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={patternQuery}
                onChange={(e) => setPatternQuery(e.target.value)}
                placeholder="Pesquisar padrão (ex: B-P-B)"
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] pl-8 pr-3 py-1.5 text-slate-200"
              />
            </div>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#131924]">
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 px-3 font-medium">Data/Hora</th>
                  <th className="py-2 px-3 font-medium">Resultado</th>
                  <th className="py-2 px-3 font-medium">Totais (P/B)</th>
                  <th className="py-2 px-3 font-medium">Sugestão Ant.</th>
                  <th className="py-2 px-3 font-medium">Acerto</th>
                  <th className="py-2 pl-3 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      Nenhum registo encontrado para os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.slice(0, 200).map((r) => {
                    const sug = r.predictionBefore?.suggestion ?? 'NONE';
                    const isHit = sug !== 'NONE' && sug === r.outcome;
                    const st = outcomeStyle(r.outcome);
                    return (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 font-mono tabular-nums text-slate-400">
                          {r.roundNumber}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-300 tabular-nums">
                          {new Date(r.timestamp).toLocaleString('pt-PT')}
                        </td>
                        <td className="py-2 px-3 font-bold">
                          <span className={st.text}>
                            {formatOutcomeLabel(r.outcome)}
                            {r.winningTotal ? ` (${r.winningTotal})` : ''}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-300">
                          {r.playerTotal !== null || r.bankerTotal !== null
                            ? `${r.playerTotal ?? '—'} / ${r.bankerTotal ?? '—'}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-300">
                          {formatOutcomeLabel(sug)}
                        </td>
                        <td className="py-2 px-3 font-mono">
                          {sug === 'NONE' ? (
                            <span className="text-slate-500">N/A</span>
                          ) : isHit ? (
                            <span className="text-emerald-400 font-bold">OK</span>
                          ) : (
                            <span className="text-red-400 font-bold">X</span>
                          )}
                        </td>
                        <td className="py-2 pl-3 uppercase text-[10px] text-slate-400">{r.source}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 7. PAINEL DE DESEMPENHO PERMANENTE NA PARTE INFERIOR DA ABA BAC BO */}
      <section className="rounded-xl border border-slate-700 bg-[#131924] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Painel de Desempenho Permanente</div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-slate-300">SUGESTÃO ATUAL:</span>
              <span
                className={`rounded-lg border px-3 py-1 font-display text-base font-bold ${sugStyle.soft}`}
              >
                {formatOutcomeLabel(strategies.finalSuggestion)}
              </span>
              <span className="text-xs font-mono text-amber-300">
                Estado: {strategies.statusLabel}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center font-mono tabular-nums">
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
              <div className="text-[10px] text-blue-300">PLAYER</div>
              <div className="text-sm font-bold text-blue-400">
                {probabilities.modelEstimate.player.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <div className="text-[10px] text-amber-300">TIE</div>
              <div className="text-sm font-bold text-amber-300">
                {probabilities.modelEstimate.tie.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <div className="text-[10px] text-red-300">BANKER</div>
              <div className="text-sm font-bold text-red-400">
                {probabilities.modelEstimate.banker.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1.5">
            <div className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span>Motivos da Análise</span>
            </div>
            <ul className="space-y-1 text-slate-300 list-disc pl-4">
              {strategies.reasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
              <div className="text-slate-400 flex items-center gap-1">
                <Layers className="h-3 w-3" />
                <span>Padrão atual</span>
              </div>
              <div className="mt-0.5 font-medium text-slate-100">
                {patterns.activePatternSummary}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
              <div className="text-slate-400 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                <span>Corrida atual</span>
              </div>
              <div className="mt-0.5 font-medium text-slate-100">
                {streaks.currentSide
                  ? `${streaks.currentLength}x ${formatOutcomeLabel(streaks.currentSide)}`
                  : 'Nenhuma'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
              <div className="text-slate-400 flex items-center gap-1">
                <Activity className="h-3 w-3" />
                <span>Último empate</span>
              </div>
              <div className="mt-0.5 font-mono text-amber-300 tabular-nums">
                {ties.totalTies > 0
                  ? `há ${ties.roundsSinceLastTie} rodadas`
                  : `sem empates (${rounds.length} rod.)`}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-2.5">
              <div className="text-slate-400">Estratégias</div>
              <div className="mt-0.5 font-mono text-slate-100 tabular-nums">
                Ativas: {strategies.activeCount} · Concordantes: {strategies.agreeingCount}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5 text-[11px] font-mono text-slate-400 tabular-nums">
          <div>
            Últimos resultados:{' '}
            {rounds.length > 0
              ? rounds
                  .slice(-8)
                  .reverse()
                  .map((r) => `${r.outcome}${r.winningTotal ? `(${r.winningTotal})` : ''}`)
                  .join(', ')
              : 'Nenhum'}
          </div>
          <div>
            OCR Bac Bo: {scanDebug.lastReadTime} · {scanDebug.lastOutcomeLabel} ·{' '}
            {scanDebug.lastReadMs !== null ? `${scanDebug.lastReadMs}ms` : '--'}
          </div>
        </div>
      </section>
    </div>
  );
};
