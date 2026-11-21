import React, { useEffect, useMemo, useState } from 'react';
import {
  RotateCcw,
  Plus,
  CheckCircle2,
  XCircle,
  Globe,
  Crosshair,
  RefreshCw,
  ArrowUpDown,
} from 'lucide-react';
import {
  analyzeSpins,
  getRouletteColor,
  INITIAL_SCREENSHOT_SPINS,
  StrategyProfile,
} from './utils/rouletteEngine';
import { EuropeanWheel } from './components/EuropeanWheel';
import { CreedroomzBoard } from './components/CreedroomzBoard';
import { ScreenshotScannerTab } from './components/ScreenshotScannerTab';
import { AndroidBuilderTab } from './components/AndroidBuilderTab';
import { BrowserScanner, isNativeAndroidApp } from './plugins/browserScanner';

type ActiveTab = 'analyzer' | 'scanner' | 'board' | 'android';

const STORAGE_KEY_SESSION_SPINS = 'roletavision_session_spins_v2';
const STORAGE_KEY_LEARNED_BACKUP = 'roletavision_learned_backup_v2';
const STORAGE_KEY_BANKROLL = 'roletavision_bankroll_v1';
const SPLIT_PRESETS = [0.56, 0.45, 0.66] as const;

function reconcileScannerSpins(
  prevSession: number[],
  prevBackup: number[],
  incoming: number[],
  isFullStrip: boolean
): { nextSession: number[]; nextBackup: number[] } {
  if (incoming.length === 0) {
    return { nextSession: prevSession, nextBackup: prevBackup };
  }

  if (!isFullStrip) {
    // Novos giros em tempo real: entram na sessão atual para avaliar OK/X + %
    return {
      nextSession: [...incoming, ...prevSession].slice(0, 500),
      nextBackup: prevBackup,
    };
  }

  // Faixa completa detectada ao abrir mesa ou trocar de mesa:
  // Verifica se já está alinhada com o histórico atual (sessão + backup)
  const combined = [...prevSession, ...prevBackup];
  if (combined.length >= 3) {
    for (let shift = 0; shift <= Math.min(4, incoming.length - 3); shift++) {
      if (
        incoming[shift] === combined[0] &&
        incoming[shift + 1] === combined[1] &&
        incoming[shift + 2] === combined[2]
      ) {
        if (shift === 0) {
          return { nextSession: prevSession, nextBackup: prevBackup };
        }
        // Só o que é novo antes de combined[0] entra na sessão
        return {
          nextSession: [...incoming.slice(0, shift), ...prevSession].slice(0, 500),
          nextBackup: prevBackup,
        };
      }
    }
  }

  // Primeira leitura da mesa (ou troca de mesa): alimenta o contexto/aprendizagem
  // sem gerar % falsa de acerto na sessão atual (sessão continua virgem 0%)
  const mergedBackup = [...incoming, ...prevBackup.filter((_, idx) => idx >= incoming.length)].slice(
    0,
    2000
  );
  return {
    nextSession: prevSession,
    nextBackup: prevBackup.length === 0 ? incoming.slice(0, 2000) : mergedBackup,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');
  const isAndroidApk = isNativeAndroidApp();
  const [nativeBrowserOpen, setNativeBrowserOpen] = useState(false);
  const [splitPresetIdx, setSplitPresetIdx] = useState(0);
  const [browserUrlInput, setBrowserUrlInput] = useState('https://www.kwanzabet.ao');
  const [browserNotice, setBrowserNotice] = useState<string | null>(null);
  const [scanStatusHint, setScanStatusHint] = useState<string | null>(null);

  const [spinMemory, setSpinMemory] = useState<{ session: number[]; backup: number[] }>(() => {
    let session: number[] = [];
    let backup: number[] = [];
    try {
      const savedSess = localStorage.getItem(STORAGE_KEY_SESSION_SPINS);
      if (savedSess) {
        const parsed = JSON.parse(savedSess);
        if (Array.isArray(parsed)) session = parsed;
      }
      const savedBack = localStorage.getItem(STORAGE_KEY_LEARNED_BACKUP);
      if (savedBack) {
        const parsed = JSON.parse(savedBack);
        if (Array.isArray(parsed)) backup = parsed;
      }
    } catch {
      // ignore storage errors
    }
    return { session, backup };
  });

  const sessionSpins = spinMemory.session;
  const learnedBackupSpins = spinMemory.backup;

  const [bankrollAoa, setBankrollAoa] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BANKROLL);
      if (saved) {
        const val = Number(saved);
        if (!Number.isNaN(val) && val > 0) return val;
      }
    } catch {
      // ignore storage errors
    }
    return 238.39;
  });

  const [unitStakeAoa, setUnitStakeAoa] = useState<number>(10);
  const [profile, setProfile] = useState<StrategyProfile>('neighbors');
  const [manualInput, setManualInput] = useState<string>('');
  const [roiTopPct, setRoiTopPct] = useState<number>(12);
  const [roiHeightPct, setRoiHeightPct] = useState<number>(7);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SESSION_SPINS, JSON.stringify(spinMemory.session));
      localStorage.setItem(STORAGE_KEY_LEARNED_BACKUP, JSON.stringify(spinMemory.backup));
    } catch {
      // ignore storage errors
    }
  }, [spinMemory]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_BANKROLL, String(bankrollAoa));
    } catch {
      // ignore storage errors
    }
  }, [bankrollAoa]);

  // Conecta ao navegador nativo integrado no APK Android (Capacitor Plugin)
  useEffect(() => {
    if (!isAndroidApk) return;

    let mounted = true;
    const setupListeners = async () => {
      const spinSub = await BrowserScanner.addListener('spinsDetected', (event) => {
        if (!mounted || !Array.isArray(event.numbersNewestFirst)) return;
        const incoming = event.numbersNewestFirst.filter(
          (n) => typeof n === 'number' && n >= 0 && n <= 36
        );
        if (incoming.length === 0) return;

        setScanStatusHint(`Faixa lida: ${incoming.slice(0, 6).join(', ')}`);
        setSpinMemory((prev) => {
          const res = reconcileScannerSpins(
            prev.session,
            prev.backup,
            incoming,
            Boolean(event.isFullStrip)
          );
          return { session: res.nextSession, backup: res.nextBackup };
        });
      });

      const visSub = await BrowserScanner.addListener(
        'browserVisibilityChanged',
        (event) => {
          if (mounted) {
            setNativeBrowserOpen(Boolean(event.visible));
          }
        }
      );

      const feedbackSub = await BrowserScanner.addListener('scanFeedback', (event) => {
        if (!mounted) return;
        if (event.count > 0) {
          setScanStatusHint(`Leitura ativa (${event.count} números via ${event.mode || 'ocr'})`);
        } else {
          setScanStatusHint(
            'Nenhum número detetado. Abra a roleta e toque em Mira se precisar alinhar.'
          );
        }
      });

      return () => {
        void spinSub.remove();
        void visSub.remove();
        void feedbackSub.remove();
      };
    };

    const cleanupPromise = setupListeners();
    return () => {
      mounted = false;
      void cleanupPromise.then((fn) => fn && fn());
    };
  }, [isAndroidApk]);

  const combinedSpins = useMemo(
    () => [...sessionSpins, ...learnedBackupSpins].slice(0, 2000),
    [sessionSpins, learnedBackupSpins]
  );

  const analysis = useMemo(
    () => analyzeSpins(sessionSpins, profile, bankrollAoa, unitStakeAoa, learnedBackupSpins),
    [sessionSpins, profile, bankrollAoa, unitStakeAoa, learnedBackupSpins]
  );

  const handleOpenIntegratedBrowser = async () => {
    setBrowserNotice(null);
    if (!isAndroidApk) {
      setBrowserNotice(
        'O navegador integrado abre dentro do aplicativo instalado no Android (RoletaVision.apk). Aqui na pré-visualização web, use a aba Leitor de Tela ou gere o APK na aba App Android.'
      );
      return;
    }

    if (nativeBrowserOpen) {
      await BrowserScanner.closeBrowser();
    } else {
      await BrowserScanner.openBrowser({ url: browserUrlInput });
    }
  };

  const handleToggleAndroidCalibration = async () => {
    if (!isAndroidApk) return;
    await BrowserScanner.toggleCalibration();
  };

  const handleCycleSplitRatio = async () => {
    if (!isAndroidApk) return;
    const nextIdx = (splitPresetIdx + 1) % SPLIT_PRESETS.length;
    setSplitPresetIdx(nextIdx);
    await BrowserScanner.setSplitRatio({ browserWeight: SPLIT_PRESETS[nextIdx] });
  };

  const handleManualBrowserScan = async () => {
    if (!isAndroidApk) return;
    setScanStatusHint('A ler faixa do navegador...');
    await BrowserScanner.scanNow();
  };

  const handleRegisterSpin = (num: number) => {
    if (num < 0 || num > 36 || !Number.isInteger(num)) return;
    setSpinMemory((prev) => ({
      session: [num, ...prev.session].slice(0, 500),
      backup: prev.backup,
    }));
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(manualInput.trim());
    if (!Number.isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 36) {
      handleRegisterSpin(num);
      setManualInput('');
    }
  };

  const handleApplyScannedResults = (
    numbersNewestFirst: number[],
    detectedBalance: number | null
  ) => {
    if (numbersNewestFirst.length > 0) {
      setSpinMemory((prev) => {
        const res = reconcileScannerSpins(prev.session, prev.backup, numbersNewestFirst, true);
        return { session: res.nextSession, backup: res.nextBackup };
      });
    }
    if (detectedBalance !== null && detectedBalance >= 0) {
      setBankrollAoa(detectedBalance);
    }
  };

  const handleLoadSample = () => {
    setSpinMemory({ session: [], backup: INITIAL_SCREENSHOT_SPINS });
    setBankrollAoa(238.39);
  };

  // Zera estatísticas do momento (0% / 0/0), mas guarda os giros no Backup de Maturidade!
  const handleResetMomentKeepBackup = () => {
    setSpinMemory((prev) => {
      if (prev.session.length === 0) return prev;
      return {
        session: [],
        backup: [...prev.session, ...prev.backup].slice(0, 2000),
      };
    });
  };

  const handleResetAllVirgin = () => {
    setSpinMemory({ session: [], backup: [] });
  };

  const { fieldSuggestions, accuracy } = analysis;

  const lastRoundMap = useMemo(() => {
    const map = new Map<
      string,
      { predicted: string; actual: string; hit: boolean }
    >();
    if (accuracy.lastRound) {
      for (const m of accuracy.lastRound.markets) {
        map.set(m.market, m);
      }
    }
    return map;
  }, [accuracy.lastRound]);

  const marketRateMap = useMemo(() => {
    const map = new Map<
      string,
      { hits: number; attempts: number; ratePct: number; expectedRandomPct: number }
    >();
    for (const m of accuracy.byMarket) {
      map.set(m.market, m);
    }
    return map;
  }, [accuracy.byMarket]);

  // Modo integrado quando o navegador Kwanzabet está aberto em cima no APK
  if (nativeBrowserOpen) {
    const hasTableData = combinedSpins.length > 0;
    const compactOptions = [
      {
        marketKey: 'Vermelho / Preto',
        shortTitle: 'Cor (Vermelho / Preto)',
        suggestion: hasTableData ? `APOSTAR: ${fieldSuggestions.color}` : 'Aguardando mesa...',
        accent: !hasTableData
          ? 'text-slate-500'
          : fieldSuggestions.color === 'Vermelho'
          ? 'text-red-300'
          : 'text-slate-100',
      },
      {
        marketKey: 'Par / Ímpar',
        shortTitle: 'Paridade (Par / Ímpar)',
        suggestion: hasTableData ? `APOSTAR: ${fieldSuggestions.parity}` : 'Aguardando mesa...',
        accent: hasTableData ? 'text-slate-100' : 'text-slate-500',
      },
      {
        marketKey: '1–18 / 19–36',
        shortTitle: 'Força (1–18 / 19–36)',
        suggestion: hasTableData ? `APOSTAR: ${fieldSuggestions.half}` : 'Aguardando mesa...',
        accent: hasTableData ? 'text-slate-100' : 'text-slate-500',
      },
      {
        marketKey: 'Dúzias (Blocos)',
        shortTitle: 'Bloco / Dúzia',
        suggestion: hasTableData
          ? `APOSTAR: ${fieldSuggestions.dozenLabel}`
          : 'Aguardando mesa...',
        accent: hasTableData ? 'text-amber-300' : 'text-slate-500',
      },
      {
        marketKey: 'Colunas (2to1)',
        shortTitle: 'Coluna (2to1)',
        suggestion: hasTableData
          ? `APOSTAR: ${fieldSuggestions.columnLabel}`
          : 'Aguardando mesa...',
        accent: hasTableData ? 'text-amber-300' : 'text-slate-500',
      },
      {
        marketKey: 'Setor da Roda',
        shortTitle: 'Setor da Roda',
        suggestion: hasTableData
          ? `APOSTAR: ${analysis.recommendedSector.name}`
          : 'Aguardando mesa...',
        accent: hasTableData ? 'text-emerald-300' : 'text-slate-500',
      },
      {
        marketKey: 'Vizinhos (±2)',
        shortTitle: hasTableData
          ? `Vizinhos (±2 · Âncora ${fieldSuggestions.anchorNumber})`
          : 'Vizinhos (±2)',
        suggestion: hasTableData
          ? `APOSTAR: ${fieldSuggestions.neighbors.join(' · ')}`
          : 'Aguardando mesa...',
        accent: hasTableData ? 'text-emerald-400 font-mono' : 'text-slate-500',
      },
    ];

    const splitLabel =
      splitPresetIdx === 0 ? 'Tela 56%' : splitPresetIdx === 1 ? 'Tela 45%' : 'Tela 66%';

    return (
      <div className="h-screen overflow-y-auto bg-[#0B0F17] text-slate-100 p-2.5 space-y-2">
        {/* Cabeçalho compacto com controles + resumo virgem ou ao vivo */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            {accuracy.lastRound ? (
              <>
                <span
                  className={`inline-flex h-6 min-w-[26px] px-1 items-center justify-center rounded border font-mono text-xs font-bold text-white tabular-nums ${
                    accuracy.lastRound.actualColor === 'green'
                      ? 'bg-emerald-700 border-emerald-500'
                      : accuracy.lastRound.actualColor === 'red'
                      ? 'bg-[#B91C1C] border-red-700'
                      : 'bg-[#181C24] border-slate-600'
                  }`}
                >
                  {accuracy.lastRound.actualNumber}
                </span>
                <div className="text-[11px] leading-tight">
                  <div className="text-slate-200 font-medium">
                    Último: {accuracy.lastRound.hitsCount}/{accuracy.lastRound.totalMarkets} acertos
                  </div>
                  <div className="font-mono text-[10px] text-emerald-400 tabular-nums">
                    Sessão: {accuracy.overallRatePct.toFixed(1)}% ({accuracy.totalHits}/{accuracy.totalAttempts})
                  </div>
                </div>
              </>
            ) : (
              <div className="text-[11px] leading-tight">
                <div className="text-slate-200 font-medium">
                  Sessão Virgem: 0.0% (0/0)
                </div>
                <div className="text-[10px] text-slate-400">
                  {scanStatusHint ||
                    (hasTableData
                      ? `Mesa lida (${combinedSpins.length} giros). Aguardando 1ª jogada.`
                      : 'Abra a roleta em cima ou toque em Ler / Mira.')}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleManualBrowserScan}
              title="Ler faixa agora"
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-200"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Ler</span>
            </button>
            <button
              type="button"
              onClick={handleResetMomentKeepBackup}
              title="Zerar estatísticas do momento mantendo aprendizagem"
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-200"
            >
              Zerar 0%
            </button>
            <button
              type="button"
              onClick={handleCycleSplitRatio}
              title="Ajustar tamanho do navegador"
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-200"
            >
              <ArrowUpDown className="h-3 w-3" />
              <span>{splitLabel}</span>
            </button>
            <button
              type="button"
              onClick={handleToggleAndroidCalibration}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-200"
            >
              <Crosshair className="h-3 w-3" />
              <span>Mira</span>
            </button>
            <button
              type="button"
              onClick={handleOpenIntegratedBrowser}
              className="rounded-md bg-amber-400 px-2 py-1 text-[10px] font-semibold text-slate-950"
            >
              Painel
            </button>
          </div>
        </div>

        {/* Faixa de histórico lida */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {combinedSpins.length === 0 ? (
            <span className="text-[11px] text-amber-300">
              Nenhum número lido ainda — abra a mesa da roleta acima ou toque em Mira para alinhar a caixa verde.
            </span>
          ) : (
            combinedSpins.slice(0, 16).map((num, idx) => {
              const col = getRouletteColor(num);
              const bg =
                col === 'green'
                  ? 'bg-emerald-700 border-emerald-500'
                  : col === 'red'
                  ? 'bg-[#A61B26] border-red-800'
                  : 'bg-[#181C24] border-slate-700';
              return (
                <span
                  key={`${num}-${idx}`}
                  className={`inline-flex h-6 min-w-[26px] px-1 items-center justify-center rounded border font-mono text-[11px] font-bold text-white tabular-nums shrink-0 ${bg} ${
                    idx === 0 ? 'ring-1 ring-amber-400' : ''
                  }`}
                >
                  {num}
                </span>
              );
            })
          )}
        </div>

        {/* Todas as opções de apostas visíveis por completo + OK/X + % de acerto */}
        <div className="grid grid-cols-2 gap-1.5">
          {compactOptions.map((opt, idx) => {
            const lastEval = lastRoundMap.get(opt.marketKey);
            const rateStat = marketRateMap.get(opt.marketKey);
            const hasAttempts = Boolean(rateStat && rateStat.attempts > 0);
            const ratePct = rateStat ? rateStat.ratePct : 0;
            const aboveBase =
              hasAttempts && rateStat!.ratePct >= rateStat!.expectedRandomPct;
            const isFullWidth = idx === compactOptions.length - 1;

            return (
              <div
                key={opt.marketKey}
                className={`rounded-lg border border-slate-800 bg-[#131924] p-2 ${
                  isFullWidth ? 'col-span-2' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium text-slate-400">
                    {opt.shortTitle}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {lastEval && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          lastEval.hit
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {lastEval.hit ? 'OK' : 'X'}
                      </span>
                    )}
                    <span
                      className={`font-mono text-[10px] font-bold tabular-nums ${
                        !hasAttempts
                          ? 'text-slate-500'
                          : aboveBase
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {hasAttempts ? `${ratePct.toFixed(0)}%` : '0%'}
                    </span>
                  </div>
                </div>

                <div className={`mt-1 text-xs font-bold leading-snug ${opt.accent}`}>
                  {opt.suggestion}
                </div>

                {lastEval && rateStat && (
                  <div className="mt-0.5 text-[9px] text-slate-400 leading-tight">
                    Ant: {lastEval.predicted} · Saiu: {lastEval.actual} ({rateStat.hits}/{rateStat.attempts})
                  </div>
                )}
              </div>
            );
          })}

          {/* Números diretos sugeridos completos + Stake */}
          <div className="col-span-2 rounded-lg border border-slate-800 bg-[#131924] p-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-medium text-slate-400">
                Números Diretos Sugeridos (Fichas)
              </span>
              <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">
                {analysis.suggestedChips.length > 0
                  ? `${analysis.totalRoundStakeAoa.toFixed(0)} AOA (${analysis.suggestedChips.length}×${analysis.stakePerUnitAoa})`
                  : '0 AOA'}
              </span>
            </div>
            {analysis.suggestedChips.length === 0 ? (
              <div className="text-[11px] text-slate-500">
                Aguardando leitura da faixa ou 1º giro para sugerir fichas.
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                {analysis.suggestedChips.map((chip) => {
                  const col = getRouletteColor(chip);
                  const chipBg =
                    col === 'green'
                      ? 'bg-emerald-700 border-emerald-500'
                      : col === 'red'
                      ? 'bg-[#B91C1C] border-red-700'
                      : 'bg-[#181C24] border-slate-600';
                  return (
                    <span
                      key={chip}
                      className={`inline-flex h-6 min-w-[26px] px-1.5 items-center justify-center rounded border font-mono text-[11px] font-bold text-white tabular-nums ${chipBg}`}
                    >
                      {chip}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Bar Contract: exatamente 3 zonas separadas por gap-8 */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0B0F17]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 h-16">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('analyzer');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            RoletaVision
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {[
              { id: 'analyzer', label: 'Analisador' },
              { id: 'scanner', label: 'Leitor de Tela' },
              { id: 'board', label: 'Mesa e Roda' },
              { id: 'android', label: 'App Android' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id as ActiveTab)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === item.id
                    ? 'border-amber-400 text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleOpenIntegratedBrowser}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>Abrir Navegador</span>
            </button>
          </div>
        </div>

        <div className="flex md:hidden border-t border-slate-800/80 px-2 overflow-x-auto">
          {[
            { id: 'analyzer', label: 'Analisador' },
            { id: 'scanner', label: 'Leitor' },
            { id: 'board', label: 'Mesa' },
            { id: 'android', label: 'APK' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as ActiveTab)}
              className={`flex-1 py-2.5 px-3 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === item.id
                  ? 'border-amber-400 text-slate-100'
                  : 'border-transparent text-slate-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-6 space-y-6">
        {browserNotice && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span>{browserNotice}</span>
            <button
              type="button"
              onClick={() => setBrowserNotice(null)}
              className="text-amber-300 underline shrink-0 self-start sm:self-center cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Barra de Acesso Direto ao Navegador Integrado */}
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-4 sm:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Navegador Integrado com Leitura Automática (1 Telefone)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isAndroidApk
                  ? 'Abra a Kwanzabet dentro do app em tela dividida para ler os resultados em tempo real.'
                  : 'No APK Android, o botão abaixo abre a Kwanzabet na parte superior enquanto as sugestões ficam fixas embaixo.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={browserUrlInput}
                onChange={(e) => setBrowserUrlInput(e.target.value)}
                aria-label="Endereço do site da roleta"
                className="w-full sm:w-64 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleOpenIntegratedBrowser}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>Entrar</span>
              </button>
            </div>
          </div>
        </section>

        {/* Faixa de Histórico Sincronizada + Backup de Aprendizagem */}
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Sessão Atual: {sessionSpins.length} jogadas</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-emerald-400">
                  Backup Aprendizagem: {learnedBackupSpins.length} giros
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-200">
                  Banca {bankrollAoa.toFixed(2)} AOA
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-amber-300">
                  Acerto Sessão: {accuracy.overallRatePct.toFixed(1)}% ({accuracy.totalHits}/{accuracy.totalAttempts})
                </span>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-100">
                Sugestões de Aposta e Taxa de Acerto Real
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={handleManualSubmit} className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="0–36"
                  aria-label="Registrar número manualmente"
                  className="w-20 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Giro</span>
                </button>
              </form>

              <button
                type="button"
                onClick={handleResetMomentKeepBackup}
                title="Zera o placar de acertos (%) para começar uma nova sessão mantendo o backup de aprendizagem"
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Zerar Momento (Manter Backup)</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSample}
                title="Carregar giros de exemplo apenas na base da mesa (placar continua 0%)"
                className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Simular Mesa
              </button>

              <button
                type="button"
                onClick={handleResetAllVirgin}
                className="rounded-lg border border-slate-800 px-3 py-2 text-xs font-medium text-slate-400 hover:text-red-300 hover:border-red-900/60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Zerar Tudo
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1.5 overflow-x-auto pb-1">
            {combinedSpins.length === 0 ? (
              <span className="text-xs text-slate-400 py-1">
                Estado virgem (0% de acerto). Abra o navegador na Kwanzabet ou registre os números da mesa para iniciar.
              </span>
            ) : (
              combinedSpins.slice(0, 24).map((num, idx) => {
                const col = getRouletteColor(num);
                const bg =
                  col === 'green'
                    ? 'bg-emerald-700 border-emerald-500'
                    : col === 'red'
                    ? 'bg-[#A61B26] border-red-800/80'
                    : 'bg-[#181C24] border-slate-700';
                return (
                  <span
                    key={`${num}-${idx}`}
                    className={`inline-flex h-8 min-w-[32px] px-1.5 items-center justify-center rounded border font-mono text-xs font-bold text-white tabular-nums shrink-0 ${bg} ${
                      idx === 0 ? 'ring-2 ring-amber-400' : ''
                    }`}
                  >
                    {num}
                  </span>
                );
              })
            )}
          </div>
        </section>

        {activeTab === 'analyzer' && (
          <div className="space-y-6">
            <section className="rounded-xl border border-slate-800 bg-[#131924] p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Onde Apostar Agora (Todas as Opções da Mesa)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {combinedSpins.length > 0
                      ? 'Escolha um ou mais campos abaixo conforme a leitura atual e acompanhe OK / X + % de cada opção.'
                      : 'Aguardando leitura da mesa ou 1º giro para liberar as sugestões de aposta.'}
                  </p>
                </div>
                <div className="font-mono text-xs text-emerald-400 tabular-nums">
                  {analysis.suggestedChips.length > 0
                    ? `${analysis.totalRoundStakeAoa.toFixed(0)} AOA sugeridos (${analysis.suggestedChips.length} fichas × ${analysis.stakePerUnitAoa} AOA)`
                    : '0 AOA'}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    marketKey: 'Vermelho / Preto',
                    title: 'Cor (Vermelho / Preto)',
                    value:
                      combinedSpins.length > 0
                        ? `APOSTAR: ${fieldSuggestions.color}`
                        : 'Aguardando leitura...',
                    reason:
                      combinedSpins.length > 0
                        ? fieldSuggestions.colorReason
                        : 'Sem giros lidos ainda',
                    swatch:
                      combinedSpins.length === 0
                        ? undefined
                        : fieldSuggestions.color === 'Vermelho'
                        ? 'bg-[#B91C1C]'
                        : 'bg-slate-900 border border-slate-600',
                    valueClass:
                      combinedSpins.length > 0
                        ? 'text-base font-bold text-slate-100'
                        : 'text-sm text-slate-500',
                  },
                  {
                    marketKey: 'Par / Ímpar',
                    title: 'Paridade (Par / Ímpar)',
                    value:
                      combinedSpins.length > 0
                        ? `APOSTAR: ${fieldSuggestions.parity}`
                        : 'Aguardando leitura...',
                    reason:
                      combinedSpins.length > 0
                        ? fieldSuggestions.parityReason
                        : 'Sem giros lidos ainda',
                    valueClass:
                      combinedSpins.length > 0
                        ? 'text-base font-bold text-slate-100'
                        : 'text-sm text-slate-500',
                  },
                  {
                    marketKey: '1–18 / 19–36',
                    title: 'Força / Metade (1–18 / 19–36)',
                    value:
                      combinedSpins.length > 0
                        ? `APOSTAR: ${fieldSuggestions.half}`
                        : 'Aguardando leitura...',
                    reason:
                      combinedSpins.length > 0
                        ? fieldSuggestions.halfReason
                        : 'Sem giros lidos ainda',
                    valueClass:
                      combinedSpins.length > 0
                        ? 'text-base font-bold text-slate-100'
                        : 'text-sm text-slate-500',
                  },
                  {
                    marketKey: 'Dúzias (Blocos)',
                    title: 'Bloco / Dúzia',
                    value:
                      combinedSpins.length > 0
                        ? `APOSTAR: ${fieldSuggestions.dozenLabel}`
                        : 'Aguardando leitura...',
                    reason:
                      combinedSpins.length > 0
                        ? fieldSuggestions.dozenReason
                        : 'Sem giros lidos ainda',
                    valueClass:
                      combinedSpins.length > 0
                        ? 'text-base font-bold text-amber-300'
                        : 'text-sm text-slate-500',
                  },
                  {
                    marketKey: 'Colunas (2to1)',
                    title: 'Coluna (2to1)',
                    value:
                      combinedSpins.length > 0
                        ? `APOSTAR: ${fieldSuggestions.columnLabel}`
                        : 'Aguardando leitura...',
                    reason:
                      combinedSpins.length > 0
                        ? fieldSuggestions.columnReason
                        : 'Sem giros lidos ainda',
                    valueClass:
                      combinedSpins.length > 0
                        ? 'text-base font-bold text-amber-300'
                        : 'text-sm text-slate-500',
                  },
                  {
                    marketKey: 'Vizinhos (±2)',
                    title:
                      combinedSpins.length > 0
                        ? `Vizinhos (±2) · Âncora ${fieldSuggestions.anchorNumber}`
                        : 'Vizinhos (±2)',
                    value:
                      combinedSpins.length > 0
                        ? `APOSTAR: ${fieldSuggestions.neighbors.join(' · ')}`
                        : 'Aguardando leitura...',
                    reason:
                      combinedSpins.length > 0
                        ? `Setor: ${fieldSuggestions.sectorName}`
                        : 'Sem giros lidos ainda',
                    valueClass:
                      combinedSpins.length > 0
                        ? 'font-mono text-base font-bold text-emerald-400 tabular-nums'
                        : 'text-sm text-slate-500',
                  },
                  {
                    marketKey: 'Setor da Roda',
                    title: 'Setor Físico da Roda',
                    value:
                      combinedSpins.length > 0
                        ? `APOSTAR: ${analysis.recommendedSector.name}`
                        : 'Aguardando leitura...',
                    reason:
                      combinedSpins.length > 0
                        ? `${analysis.recommendedSector.hitRatePct.toFixed(0)}% nos últimos 20 giros`
                        : 'Sem giros lidos ainda',
                    valueClass:
                      combinedSpins.length > 0
                        ? 'text-base font-bold text-emerald-300'
                        : 'text-sm text-slate-500',
                  },
                ].map((card) => {
                  const lastEval = lastRoundMap.get(card.marketKey);
                  const rateStat = marketRateMap.get(card.marketKey);
                  const hasAttempts = Boolean(rateStat && rateStat.attempts > 0);
                  const aboveBase =
                    hasAttempts && rateStat!.ratePct >= rateStat!.expectedRandomPct;
                  return (
                    <div
                      key={card.marketKey}
                      className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-slate-400">{card.title}</div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {lastEval && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                lastEval.hit
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}
                            >
                              {lastEval.hit ? 'OK' : 'X'}
                            </span>
                          )}
                          {rateStat && (
                            <span
                              className={`font-mono text-[11px] font-bold tabular-nums ${
                                !hasAttempts
                                  ? 'text-slate-500'
                                  : aboveBase
                                  ? 'text-emerald-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {hasAttempts ? `${rateStat.ratePct.toFixed(1)}%` : '0.0%'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        {card.swatch && (
                          <span className={`inline-block h-3 w-3 rounded-sm ${card.swatch}`} />
                        )}
                        <span className={card.valueClass}>{card.value}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{card.reason}</div>
                    </div>
                  );
                })}

                <div className="sm:col-span-2 rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400">
                      Números Diretos Sugeridos (Fichas Completas)
                    </span>
                    <span className="font-mono text-xs text-emerald-400 tabular-nums">
                      {analysis.coveragePct.toFixed(1)}% da roda
                    </span>
                  </div>
                  {analysis.suggestedChips.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-500">
                      Aguardando leitura da faixa ou 1º giro para exibir as fichas diretas.
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {analysis.suggestedChips.map((chip) => {
                        const col = getRouletteColor(chip);
                        const chipBg =
                          col === 'green'
                            ? 'bg-emerald-700 border-emerald-500'
                            : col === 'red'
                            ? 'bg-[#B91C1C] border-red-700'
                            : 'bg-[#181C24] border-slate-600';
                        return (
                          <span
                            key={chip}
                            className={`inline-flex h-7 min-w-[30px] px-1.5 items-center justify-center rounded border font-mono text-xs font-bold text-white tabular-nums ${chipBg}`}
                          >
                            {chip}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Nível de Acerto da Plataforma
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {accuracy.levelLabel} · {accuracy.evaluatedRounds} rodadas verificadas
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-2xl font-bold text-emerald-400 tabular-nums">
                      {accuracy.overallRatePct.toFixed(1)}%
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {accuracy.totalHits}/{accuracy.totalAttempts} previsões acertadas
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-3 font-medium">Campo de Aposta</th>
                        <th className="py-2 px-3 font-medium text-right">Acertos</th>
                        <th className="py-2 px-3 font-medium text-right">Taxa Real</th>
                        <th className="py-2 pl-3 font-medium text-right">Base Roleta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {accuracy.byMarket.map((m) => {
                        const aboveBase = m.attempts > 0 && m.ratePct >= m.expectedRandomPct;
                        return (
                          <tr key={m.market} className="hover:bg-slate-800/30">
                            <td className="py-2.5 pr-3 font-medium text-slate-200">
                              {m.market}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                              {m.hits}/{m.attempts}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                                m.attempts === 0
                                  ? 'text-slate-500'
                                  : aboveBase
                                  ? 'text-emerald-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {m.ratePct.toFixed(1)}%
                            </td>
                            <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-500">
                              {m.expectedRandomPct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Última Rodada Verificada
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Comparação entre sugestão ativa e resultado real
                    </p>
                  </div>
                  {accuracy.lastRound && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Saiu:</span>
                      <span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded border font-mono text-sm font-bold text-white tabular-nums ${
                          accuracy.lastRound.actualColor === 'green'
                            ? 'bg-emerald-700 border-emerald-500'
                            : accuracy.lastRound.actualColor === 'red'
                            ? 'bg-[#B91C1C] border-red-700'
                            : 'bg-[#181C24] border-slate-600'
                        }`}
                      >
                        {accuracy.lastRound.actualNumber}
                      </span>
                    </div>
                  )}
                </div>

                {!accuracy.lastRound ? (
                  <p className="text-xs text-slate-500 py-6">
                    Adicione pelo menos 2 giros para comparar previsão vs resultado.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800/70">
                    {accuracy.lastRound.markets.map((ev) => {
                      const rateStat = marketRateMap.get(ev.market);
                      return (
                        <div
                          key={ev.market}
                          className="py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-slate-200">{ev.market}</div>
                            <div className="text-slate-400">
                              Sugestão: <span className="text-slate-200">{ev.predicted}</span> · Saiu:{' '}
                              <span className="text-slate-200">{ev.actual}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {rateStat && (
                              <span className="font-mono text-[11px] font-semibold text-amber-300 tabular-nums">
                                {rateStat.ratePct.toFixed(0)}%
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                ev.hit ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {ev.hit ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
                              )}
                              <span>{ev.hit ? 'OK' : 'X'}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Roda Europeia e Vizinhos
                  </h2>
                  <div className="flex items-center gap-1 p-1 bg-[#0B0F17] rounded-lg border border-slate-800">
                    {[
                      { id: 'neighbors', label: 'Vizinhos' },
                      { id: 'sectors', label: 'Setores' },
                      { id: 'balanced', label: 'Misto' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProfile(p.id as StrategyProfile)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          profile === p.id
                            ? 'bg-slate-800 text-amber-300'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <EuropeanWheel
                  lastNumber={analysis.lastNumber}
                  suggestedNumbers={analysis.suggestedChips}
                  hotNumbers={analysis.hotNumbers.map((x) => x.number)}
                  onSelectNumber={handleRegisterSpin}
                />
              </div>

              <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#131924] p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Mesa Creedroomz (Toque para Testar)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Campos e números destacados conforme sugestão atual
                  </p>
                </div>

                <CreedroomzBoard
                  lastNumber={analysis.lastNumber}
                  suggestedChips={analysis.suggestedChips}
                  fieldSuggestions={fieldSuggestions}
                  onRegisterSpin={handleRegisterSpin}
                />
              </div>

              <div className="lg:col-span-3 space-y-5">
                <div className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Parâmetros em AOA
                  </h2>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Banca atual (AOA)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={1}
                      value={bankrollAoa}
                      onChange={(e) => setBankrollAoa(Math.max(1, Number(e.target.value)))}
                      className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Valor base por ficha (AOA)
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[5, 10, 25, 50].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setUnitStakeAoa(v)}
                          className={`rounded-lg border py-1.5 font-mono text-xs font-medium cursor-pointer transition-colors ${
                            unitStakeAoa === v
                              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                              : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    Histórico Recente de Acertos
                  </h3>
                  {accuracy.recentRounds.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Registre mais um giro para iniciar a avaliação por rodada.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800/70 text-xs">
                      {accuracy.recentRounds.slice(0, 6).map((r) => (
                        <div
                          key={r.spinIndex}
                          className="py-2 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded font-mono text-[11px] font-bold text-white ${
                                r.actualColor === 'green'
                                  ? 'bg-emerald-700'
                                  : r.actualColor === 'red'
                                  ? 'bg-[#B91C1C]'
                                  : 'bg-[#181C24] border border-slate-700'
                              }`}
                            >
                              {r.actualNumber}
                            </span>
                            <span className="text-slate-300">
                              {r.markets[0]?.hit ? 'Cor OK' : 'Cor X'} ·{' '}
                              {r.markets[1]?.hit ? 'Par/Ímp OK' : 'Par/Ímp X'}
                            </span>
                          </div>
                          <span className="font-mono tabular-nums text-emerald-400">
                            {r.hitsCount}/{r.totalMarkets}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'scanner' && (
          <ScreenshotScannerTab
            roiTopPct={roiTopPct}
            roiHeightPct={roiHeightPct}
            onChangeRoiTop={setRoiTopPct}
            onChangeRoiHeight={setRoiHeightPct}
            onApplyScannedResults={(nums, bal) => {
              handleApplyScannedResults(nums, bal);
            }}
          />
        )}

        {activeTab === 'board' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="rounded-xl border border-slate-800 bg-[#131924] p-6">
              <h2 className="text-base font-semibold text-slate-100 mb-4">
                Roda Física Completa (37 Números)
              </h2>
              <EuropeanWheel
                lastNumber={analysis.lastNumber}
                suggestedNumbers={analysis.suggestedChips}
                hotNumbers={analysis.hotNumbers.map((x) => x.number)}
                onSelectNumber={handleRegisterSpin}
              />
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#131924] p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Painel Vertical Creedroomz
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Toque nos números abaixo para simular e acompanhar a taxa de acerto em tempo real
                </p>
              </div>
              <CreedroomzBoard
                lastNumber={analysis.lastNumber}
                suggestedChips={analysis.suggestedChips}
                fieldSuggestions={fieldSuggestions}
                onRegisterSpin={handleRegisterSpin}
              />
            </div>
          </div>
        )}

        {activeTab === 'android' && (
          <AndroidBuilderTab roiTopPct={roiTopPct} roiHeightPct={roiHeightPct} />
        )}
      </main>
    </div>
  );
}
