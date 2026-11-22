import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  RouletteAnalysis,
  StrategyProfile,
} from './utils/rouletteEngine';
import { EuropeanWheel } from './components/EuropeanWheel';
import { CreedroomzBoard } from './components/CreedroomzBoard';
import { ScreenshotScannerTab } from './components/ScreenshotScannerTab';
import { AndroidBuilderTab } from './components/AndroidBuilderTab';
import { BacBoDashboard } from './components/BacBoDashboard';
import { AviatorDashboard, multiplierBadgeClass } from './components/AviatorDashboard';
import { BrowserScanner, isNativeAndroidApp } from './plugins/browserScanner';
import {
  analyzeBacBoEngine,
  BEAD_PLATE_ROWS,
  clearAllRounds,
  formatOutcomeLabel,
  getBacBoRoundCycleStatus,
  loadRoundsFromIndexedDb,
  loadRoundsSync,
  processNativeBacBoDetection,
  saveRounds,
  validateAndBuildBacBoRound,
  BacBoBeadCell,
  BacBoEngineAnalysis,
  BacBoOutcome,
  BacBoRoundRecord,
} from './modules/bacbo';
import {
  analyzeAviatorEngine,
  AviatorAutoBetConfig,
  AviatorAutoBetState,
  AviatorBankrollConfig,
  AviatorBankrollState,
  AviatorCaptureStatus,
  AviatorCashOutConfig,
  AviatorCashOutState,
  AviatorEngineAnalysis,
  AviatorLearningSnapshot,
  AviatorLiveState,
  AviatorRoundRecord,
  buildAviatorRoundRecord,
  clearAllAviatorRounds,
  confirmManualTicketAction,
  createInitialAutoBetState,
  createInitialBankrollState,
  createInitialCashOutState,
  evaluateAutoBetOpportunity,
  evaluateLiveCashOutTarget,
  LearningWindowKey,
  loadAutoBetConfig,
  loadAviatorRoundsFromIndexedDb,
  loadAviatorRoundsSync,
  loadBankrollConfig,
  loadBankrollState,
  loadCashOutConfig,
  loadLearningSnapshots,
  loadSelectedLearningWindow,
  processLiveMultiplierTransition,
  reconcileAviatorStrip,
  recordCashOutOutcomeOnCrash,
  saveAutoBetConfig,
  saveAviatorRounds,
  saveBankrollConfig,
  saveBankrollState,
  saveCashOutConfig,
  saveLearningSnapshots,
  saveSelectedLearningWindow,
  settleActiveAutoBetOnCrash,
} from './modules/aviator';

type GameMode = 'roulette' | 'bacbo' | 'aviator';
type ActiveTab = 'analyzer' | 'scanner' | 'board' | 'android';

const STORAGE_KEY_SESSION_SPINS = 'roletavision_session_spins_v3';
const STORAGE_KEY_LEARNED_BACKUP = 'roletavision_learned_backup_v3';
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
  return {
    nextSession: prevSession,
    nextBackup: [...incoming, ...prevBackup].slice(0, 2000),
  };
}

export default function App() {
  const [gameMode, setGameMode] = useState<GameMode>('roulette');
  const gameModeRef = useRef<GameMode>('roulette');
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
  const [roiTopPct, setRoiTopPct] = useState<number>(4);
  const [roiHeightPct, setRoiHeightPct] = useState<number>(7);
  const [scanDebug, setScanDebug] = useState<{
    lastReadTime: string;
    lastReadNumber: number | null;
    lastReadMs: number | null;
    lastAttemptMs: number | null;
    consecutiveFailures: number;
  }>({
    lastReadTime: '--:--:--',
    lastReadNumber: null,
    lastReadMs: null,
    lastAttemptMs: null,
    consecutiveFailures: 0,
  });

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

  // ============================================================================
  // ESTADO & ENGINE DA ABA 2: BAC BO INTELLIGENCE ENGINE (100% independente)
  // ============================================================================
  const [bacboRounds, setBacboRounds] = useState<BacBoRoundRecord[]>(() => loadRoundsSync());
  const bacboLastProbsRef = useRef<{ player: number; tie: number; banker: number } | null>(null);
  const [bacboAnalysis, setBacboAnalysis] = useState<BacBoEngineAnalysis>(() =>
    analyzeBacBoEngine(loadRoundsSync(), null)
  );
  const bacboAnalysisRef = useRef<BacBoEngineAnalysis>(bacboAnalysis);
  const [bacboScanDebug, setBacboScanDebug] = useState<{
    lastReadTime: string;
    lastOutcomeLabel: string;
    lastReadMs: number | null;
    consecutiveFailures: number;
    ocrActive: boolean;
  }>({
    lastReadTime: '--:--:--',
    lastOutcomeLabel: '--',
    lastReadMs: null,
    consecutiveFailures: 0,
    ocrActive: false,
  });
  const [lastBacBoLiveResultAt, setLastBacBoLiveResultAt] = useState<number | null>(null);
  const [bacboCycleNowMs, setBacboCycleNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (gameMode !== 'bacbo' || lastBacBoLiveResultAt === null) return;
    if (Date.now() - lastBacBoLiveResultAt >= 23000) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setBacboCycleNowMs(now);
      if (now - lastBacBoLiveResultAt >= 23000) {
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [gameMode, lastBacBoLiveResultAt]);

  useEffect(() => {
    gameModeRef.current = gameMode;
    if (isAndroidApk) {
      void BrowserScanner.setGameMode({ mode: gameMode });
    }
  }, [gameMode, isAndroidApk]);

  // Hidratação assíncrona do IndexedDB na montagem
  useEffect(() => {
    let active = true;
    void loadRoundsFromIndexedDb().then((dbRounds) => {
      if (!active || dbRounds.length === 0) return;
      setBacboRounds((prev) => (dbRounds.length > prev.length ? dbRounds : prev));
    });
    return () => {
      active = false;
    };
  }, []);

  // Tarefa 2 (Bac Bo): Recálculo estatístico em segundo plano após gravação de nova rodada
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const next = analyzeBacBoEngine(bacboRounds, bacboLastProbsRef.current);
      bacboAnalysisRef.current = next;
      bacboLastProbsRef.current = {
        player: next.probabilities.modelEstimate.player,
        tie: next.probabilities.modelEstimate.tie,
        banker: next.probabilities.modelEstimate.banker,
      };
      setBacboAnalysis(next);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [bacboRounds]);

  // ============================================================================
  // ESTADO & ENGINE DA ABA 3: AVIATOR INTELLIGENCE (100% independente)
  // ============================================================================
  const [aviatorRounds, setAviatorRounds] = useState<AviatorRoundRecord[]>(() =>
    loadAviatorRoundsSync()
  );
  const aviatorRoundsRef = useRef<AviatorRoundRecord[]>(aviatorRounds);
  aviatorRoundsRef.current = aviatorRounds;

  const [aviatorBankrollCfg, setAviatorBankrollCfg] = useState<AviatorBankrollConfig>(() =>
    loadBankrollConfig()
  );
  const aviatorBankrollCfgRef = useRef(aviatorBankrollCfg);
  aviatorBankrollCfgRef.current = aviatorBankrollCfg;

  const [aviatorBankrollState, setAviatorBankrollState] = useState<AviatorBankrollState>(() =>
    loadBankrollState(loadBankrollConfig())
  );
  const aviatorBankrollStateRef = useRef(aviatorBankrollState);
  aviatorBankrollStateRef.current = aviatorBankrollState;

  const [aviatorAutoBetCfg, setAviatorAutoBetCfg] = useState<AviatorAutoBetConfig>(() =>
    loadAutoBetConfig()
  );
  const aviatorAutoBetCfgRef = useRef(aviatorAutoBetCfg);
  aviatorAutoBetCfgRef.current = aviatorAutoBetCfg;

  const [aviatorAutoBetState, setAviatorAutoBetState] = useState<AviatorAutoBetState>(() =>
    createInitialAutoBetState()
  );
  const aviatorAutoBetStateRef = useRef(aviatorAutoBetState);
  aviatorAutoBetStateRef.current = aviatorAutoBetState;

  const [aviatorCashOutCfg, setAviatorCashOutCfg] = useState<AviatorCashOutConfig>(() =>
    loadCashOutConfig()
  );
  const aviatorCashOutCfgRef = useRef(aviatorCashOutCfg);
  aviatorCashOutCfgRef.current = aviatorCashOutCfg;

  const [aviatorCashOutState, setAviatorCashOutState] = useState<AviatorCashOutState>(() =>
    createInitialCashOutState()
  );
  const aviatorCashOutStateRef = useRef(aviatorCashOutState);
  aviatorCashOutStateRef.current = aviatorCashOutState;

  const [aviatorLearningWindow, setAviatorLearningWindow] = useState<LearningWindowKey>(() =>
    loadSelectedLearningWindow()
  );
  const [aviatorSnapshots, setAviatorSnapshots] = useState<AviatorLearningSnapshot[]>(() =>
    loadLearningSnapshots()
  );

  const [aviatorLiveState, setAviatorLiveState] = useState<AviatorLiveState>({
    phase: 'WAITING',
    currentMultiplier: null,
    lastCrashMultiplier: null,
    isCrashedColor: false,
    roundStartedAt: null,
    lastUpdatedAt: null,
    ocrConfidence: 0,
    captureMode: 'integrated_browser',
    historyVisibleCount: 0,
  });
  const aviatorLiveStateRef = useRef(aviatorLiveState);
  aviatorLiveStateRef.current = aviatorLiveState;

  const [aviatorCaptureStatus, setAviatorCaptureStatus] = useState<AviatorCaptureStatus>({
    mediaProjectionActive: false,
    integratedBrowserOpen: false,
    captureIntervalMs: 550,
    lowPowerMode: false,
    permissionState: 'idle',
    lastError: null,
  });

  const [aviatorScanDebug, setAviatorScanDebug] = useState<{
    lastReadTime: string;
    lastMultiplierLabel: string;
    lastReadMs: number | null;
    consecutiveFailures: number;
  }>({
    lastReadTime: '--:--:--',
    lastMultiplierLabel: '--',
    lastReadMs: null,
    consecutiveFailures: 0,
  });

  const [aviatorAnalysis, setAviatorAnalysis] = useState<AviatorEngineAnalysis>(() =>
    analyzeAviatorEngine({
      rounds: loadAviatorRoundsSync(),
      bankrollCfg: loadBankrollConfig(),
      bankrollState: loadBankrollState(loadBankrollConfig()),
      selectedWindow: loadSelectedLearningWindow(),
      savedSnapshots: loadLearningSnapshots(),
    })
  );
  const aviatorAnalysisRef = useRef<AviatorEngineAnalysis>(aviatorAnalysis);
  aviatorAnalysisRef.current = aviatorAnalysis;

  useEffect(() => {
    let active = true;
    void loadAviatorRoundsFromIndexedDb().then((dbRounds) => {
      if (!active || dbRounds.length === 0) return;
      setAviatorRounds((prev) => (dbRounds.length > prev.length ? dbRounds : prev));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const next = analyzeAviatorEngine({
        rounds: aviatorRounds,
        bankrollCfg: aviatorBankrollCfg,
        bankrollState: aviatorBankrollState,
        selectedWindow: aviatorLearningWindow,
        savedSnapshots: aviatorSnapshots,
      });
      aviatorAnalysisRef.current = next;
      setAviatorAnalysis(next);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [
    aviatorRounds,
    aviatorBankrollCfg,
    aviatorBankrollState,
    aviatorLearningWindow,
    aviatorSnapshots,
  ]);

  // Tarefa 1 - LEITURA: apenas lê números a cada 500ms e guarda na lista sem calcular percentuais
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

      const bacboSub = await BrowserScanner.addListener('bacboDetected', (event) => {
        if (!mounted || !Array.isArray(event.itemsNewestFirst)) return;
        if (event.itemsNewestFirst.length === 0) return;

        const nowStr = new Date().toLocaleTimeString('pt-PT', { hour12: false });
        const snap = bacboAnalysisRef.current.currentSnapshot;

        setBacboRounds((prev) => {
          const intake = processNativeBacBoDetection(
            event.itemsNewestFirst,
            Boolean(event.isFullPlate),
            prev,
            snap
          );
          if (intake.newRecords.length === 0) {
            return prev;
          }
          const updated = [...prev, ...intake.newRecords];
          void saveRounds(updated);
          if (!event.isFullPlate || intake.newRecords.length === 1) {
            const ts = Date.now();
            setLastBacBoLiveResultAt(ts);
            setBacboCycleNowMs(ts);
          }
          setBacboScanDebug((dbg) => ({
            ...dbg,
            lastReadTime: nowStr,
            lastOutcomeLabel: intake.lastDetectedSummary,
            consecutiveFailures: 0,
          }));
          setScanStatusHint(`Bac Bo lido: ${intake.lastDetectedSummary}`);
          return updated;
        });
      });

      const aviatorSub = await BrowserScanner.addListener('aviatorDetected', (event) => {
        if (!mounted) return;
        const now = Date.now();
        const nowStr = new Date(now).toLocaleTimeString('pt-PT', { hour12: false });
        const incomingStrip = Array.isArray(event.historyNewestFirst)
          ? event.historyNewestFirst.filter((v) => typeof v === 'number' && v >= 1.0)
          : [];
        const liveVal =
          typeof event.liveMultiplier === 'number' && event.liveMultiplier >= 1.0
            ? event.liveMultiplier
            : null;
        const prevRounds = aviatorRoundsRef.current;
        const lastRec = prevRounds.length > 0 ? prevRounds[prevRounds.length - 1] : null;

        const transition = processLiveMultiplierTransition({
          prevState: aviatorLiveStateRef.current,
          liveMultiplier: liveVal,
          isCrashedColor: Boolean(event.isCrashedColor),
          ocrConfidence: event.ocrConfidence ?? 0.85,
          historyVisibleCount: incomingStrip.length,
          captureMode: event.source === 'media_projection' ? 'media_projection' : 'integrated_browser',
          now,
          lastRecordedMultiplier: lastRec ? lastRec.multiplier : null,
          lastRecordedTimestamp: lastRec ? lastRec.timestamp : null,
        });

        aviatorLiveStateRef.current = transition.nextState;
        setAviatorLiveState(transition.nextState);

        // Avalia alvo de Cash Out ao vivo quando o avião está a voar
        const nextCoLive = evaluateLiveCashOutTarget(
          aviatorCashOutCfgRef.current,
          aviatorCashOutStateRef.current,
          transition.nextState
        );
        if (nextCoLive !== aviatorCashOutStateRef.current) {
          aviatorCashOutStateRef.current = nextCoLive;
          setAviatorCashOutState(nextCoLive);
        }

        // Regista crash confirmado pelo canvas OU reconcilia faixa histórica superior
        let newlyCreated: AviatorRoundRecord[] = [];
        if (transition.confirmedCrashMultiplier !== null) {
          const built = buildAviatorRoundRecord({
            multiplier: transition.confirmedCrashMultiplier,
            existingRounds: prevRounds,
            source: 'ocr_live',
            ocrConfidence: event.ocrConfidence ?? 0.9,
            predictionBefore: aviatorAnalysisRef.current.strategies.activeSnapshot,
            timestamp: now,
          });
          if (built.valid && built.record) {
            newlyCreated = [built.record];
          }
        } else if (incomingStrip.length > 0) {
          newlyCreated = reconcileAviatorStrip({
            incomingNewestFirst: incomingStrip,
            isFullStrip: Boolean(event.isFullStrip),
            existingRounds: prevRounds,
            source: 'ocr_strip',
            ocrConfidence: event.ocrConfidence ?? 0.85,
            activePrediction: aviatorAnalysisRef.current.strategies.activeSnapshot,
          });
        }

        if (newlyCreated.length > 0) {
          const updated = [...prevRounds, ...newlyCreated];
          aviatorRoundsRef.current = updated;
          setAviatorRounds(updated);
          void saveAviatorRounds(updated);

          const crashMult = newlyCreated[newlyCreated.length - 1].multiplier;
          const settled = settleActiveAutoBetOnCrash({
            autoState: aviatorAutoBetStateRef.current,
            bankrollState: aviatorBankrollStateRef.current,
            crashMultiplier: crashMult,
          });
          aviatorAutoBetStateRef.current = settled.nextAutoState;
          aviatorBankrollStateRef.current = settled.nextBankrollState;
          setAviatorAutoBetState(settled.nextAutoState);
          setAviatorBankrollState(settled.nextBankrollState);
          saveBankrollState(settled.nextBankrollState);

          const coClosed = recordCashOutOutcomeOnCrash(
            aviatorCashOutCfgRef.current,
            aviatorCashOutStateRef.current,
            crashMult,
            aviatorAutoBetCfgRef.current.mode === 'simulation'
          );
          aviatorCashOutStateRef.current = coClosed;
          setAviatorCashOutState(coClosed);

          setAviatorScanDebug((prev) => ({
            ...prev,
            lastReadTime: nowStr,
            lastMultiplierLabel: `${crashMult.toFixed(2)}x`,
            consecutiveFailures: 0,
          }));
          setScanStatusHint(`Aviator lido: ${crashMult.toFixed(2)}x`);
        }
      });

      const aviatorCapSub = await BrowserScanner.addListener('aviatorCaptureStatus', (event) => {
        if (!mounted) return;
        setAviatorCaptureStatus((prev) => ({
          ...prev,
          mediaProjectionActive: Boolean(event.mediaProjectionActive),
          captureIntervalMs: event.captureIntervalMs || prev.captureIntervalMs,
          permissionState: event.permissionState || prev.permissionState,
          lastError: event.error ? event.error : null,
        }));
      });

      const telemetrySub = await BrowserScanner.addListener('scanTelemetry', (event) => {
        if (!mounted) return;
        const nowStr = new Date().toLocaleTimeString('pt-PT', { hour12: false });
        if (gameModeRef.current === 'bacbo') {
          setBacboScanDebug((prev) => ({
            ...prev,
            lastReadTime: event.ocrOk ? nowStr : prev.lastReadTime,
            lastReadMs: event.elapsedMs,
            consecutiveFailures: event.ocrOk ? 0 : event.consecutiveFailures,
            ocrActive: Boolean(event.ocrOk),
          }));
          return;
        }
        if (gameModeRef.current === 'aviator') {
          setAviatorScanDebug((prev) => ({
            ...prev,
            lastReadTime: event.ocrOk ? nowStr : prev.lastReadTime,
            lastMultiplierLabel:
              event.ocrOk && event.lastNumber >= 100
                ? `${(event.lastNumber / 100).toFixed(2)}x`
                : prev.lastMultiplierLabel,
            lastReadMs: event.elapsedMs,
            consecutiveFailures: event.ocrOk ? 0 : event.consecutiveFailures,
          }));
          return;
        }
        setScanDebug((prev) => {
          if (event.ocrOk && event.lastNumber >= 0) {
            return {
              lastReadTime: nowStr,
              lastReadNumber: event.lastNumber,
              lastReadMs: event.elapsedMs,
              lastAttemptMs: event.elapsedMs,
              consecutiveFailures: 0,
            };
          }
          return {
            ...prev,
            lastAttemptMs: event.elapsedMs,
            consecutiveFailures: event.consecutiveFailures,
          };
        });
      });

      const visSub = await BrowserScanner.addListener(
        'browserVisibilityChanged',
        (event) => {
          if (mounted) {
            setNativeBrowserOpen(Boolean(event.visible));
            setAviatorCaptureStatus((prev) => ({
              ...prev,
              integratedBrowserOpen: Boolean(event.visible),
            }));
          }
        }
      );

      const feedbackSub = await BrowserScanner.addListener('scanFeedback', (event) => {
        if (!mounted) return;
        if (event.count > 0) {
          setScanStatusHint(
            `Leitura ativa (${event.count} itens via ${event.mode || 'ocr'})`
          );
        } else {
          setScanStatusHint(
            gameModeRef.current === 'bacbo'
              ? 'Nenhum resultado Bac Bo detetado. Alinhe a Mira sobre os 3 blocos (JOGADOR | EMPATE | BANCA).'
              : gameModeRef.current === 'aviator'
              ? 'Nenhum multiplicador Aviator detetado. Alinhe a Mira sobre a faixa superior e o voo.'
              : 'Nenhum número detetado. Abra a roleta e toque em Mira se precisar alinhar.'
          );
        }
      });

      return () => {
        void spinSub.remove();
        void bacboSub.remove();
        void aviatorSub.remove();
        void aviatorCapSub.remove();
        void telemetrySub.remove();
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

  // Tarefa 2 - CÁLCULO: executa em segundo plano APÓS a leitura guardar o número (nunca trava o OCR)
  const [analysis, setAnalysis] = useState<RouletteAnalysis>(() =>
    analyzeSpins(spinMemory.session, profile, bankrollAoa, unitStakeAoa, spinMemory.backup)
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const next = analyzeSpins(
        spinMemory.session,
        profile,
        bankrollAoa,
        unitStakeAoa,
        spinMemory.backup
      );
      setAnalysis(next);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [spinMemory, profile, bankrollAoa, unitStakeAoa]);

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
    const nowStr = new Date().toLocaleTimeString('pt-PT', { hour12: false });
    setScanDebug((prev) => ({
      ...prev,
      lastReadTime: nowStr,
      lastReadNumber: num,
      lastReadMs: 0,
      consecutiveFailures: 0,
    }));
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

  // Handlers exclusivos da Aba 2: BAC BO
  const handleAddBacBoRound = (input: {
    outcome?: BacBoOutcome | null;
    playerTotal?: number | null;
    bankerTotal?: number | null;
    winningTotal?: number | null;
    playerDice?: [number, number] | null;
    bankerDice?: [number, number] | null;
    source: 'ocr' | 'manual' | 'import';
  }): { valid: boolean; reason?: string } => {
    const res = validateAndBuildBacBoRound(
      input,
      bacboRounds,
      bacboAnalysisRef.current.currentSnapshot
    );
    if (!res.valid || !res.record) {
      return { valid: false, reason: res.reason };
    }
    const updated = [...bacboRounds, res.record];
    setBacboRounds(updated);
    void saveRounds(updated);
    const ts = Date.now();
    setLastBacBoLiveResultAt(ts);
    setBacboCycleNowMs(ts);
    const nowStr = new Date().toLocaleTimeString('pt-PT', { hour12: false });
    const scoreTxt =
      res.record.playerTotal !== null && res.record.bankerTotal !== null
        ? ` ${res.record.playerTotal}×${res.record.bankerTotal}`
        : res.record.winningTotal !== null
        ? ` (${res.record.winningTotal})`
        : '';
    setBacboScanDebug((prev) => ({
      ...prev,
      lastReadTime: nowStr,
      lastOutcomeLabel: `${formatOutcomeLabel(res.record!.outcome)}${scoreTxt}`,
      lastReadMs: 0,
      consecutiveFailures: 0,
    }));
    return { valid: true };
  };

  const handleImportBacBoRounds = (restored: BacBoRoundRecord[]) => {
    setBacboRounds(restored);
    void saveRounds(restored);
  };

  const handleResetAllBacBo = () => {
    setBacboRounds([]);
    bacboLastProbsRef.current = null;
    setLastBacBoLiveResultAt(null);
    void clearAllRounds();
    setBacboScanDebug({
      lastReadTime: '--:--:--',
      lastOutcomeLabel: '--',
      lastReadMs: null,
      consecutiveFailures: 0,
      ocrActive: false,
    });
  };

  // Handlers exclusivos da Aba 3: AVIATOR INTELLIGENCE
  const handleAddAviatorMultiplier = (
    multiplier: number,
    source: AviatorRoundRecord['source']
  ): { valid: boolean; reason?: string } => {
    const res = buildAviatorRoundRecord({
      multiplier,
      existingRounds: aviatorRounds,
      source,
      predictionBefore: aviatorAnalysisRef.current.strategies.activeSnapshot,
    });
    if (!res.valid || !res.record) {
      return { valid: false, reason: res.reason };
    }
    const updated = [...aviatorRounds, res.record];
    setAviatorRounds(updated);
    void saveAviatorRounds(updated);

    const settled = settleActiveAutoBetOnCrash({
      autoState: aviatorAutoBetState,
      bankrollState: aviatorBankrollState,
      crashMultiplier: res.record.multiplier,
    });
    setAviatorAutoBetState(settled.nextAutoState);
    setAviatorBankrollState(settled.nextBankrollState);
    saveBankrollState(settled.nextBankrollState);

    const coClosed = recordCashOutOutcomeOnCrash(
      aviatorCashOutCfg,
      aviatorCashOutState,
      res.record.multiplier,
      aviatorAutoBetCfg.mode === 'simulation'
    );
    setAviatorCashOutState(coClosed);

    const nowStr = new Date().toLocaleTimeString('pt-PT', { hour12: false });
    setAviatorScanDebug((prev) => ({
      ...prev,
      lastReadTime: nowStr,
      lastMultiplierLabel: `${res.record!.multiplier.toFixed(2)}x`,
      lastReadMs: 0,
      consecutiveFailures: 0,
    }));

    // Avalia próxima entrada em Modo Simulação / Preparação Manual após atualização
    const nextEval = evaluateAutoBetOpportunity({
      autoCfg: aviatorAutoBetCfg,
      autoState: settled.nextAutoState,
      bankrollCfg: aviatorBankrollCfg,
      bankrollState: settled.nextBankrollState,
      strategyReport: aviatorAnalysisRef.current.strategies,
      nextRoundNumber: updated.length + 1,
    });
    setAviatorAutoBetState(nextEval.nextAutoState);

    return { valid: true };
  };

  const handleBulkAddAviator = (multipliersNewestFirst: number[]): number => {
    const created = reconcileAviatorStrip({
      incomingNewestFirst: multipliersNewestFirst,
      isFullStrip: false,
      existingRounds: aviatorRounds,
      source: 'import',
      ocrConfidence: 1,
    });
    if (created.length === 0) return 0;
    const updated = [...aviatorRounds, ...created];
    setAviatorRounds(updated);
    void saveAviatorRounds(updated);
    return created.length;
  };

  const handleImportAviatorRounds = (restored: AviatorRoundRecord[]) => {
    setAviatorRounds(restored);
    void saveAviatorRounds(restored);
  };

  const handleResetAllAviator = () => {
    setAviatorRounds([]);
    void clearAllAviatorRounds();
    const freshBank = createInitialBankrollState(aviatorBankrollCfg);
    setAviatorBankrollState(freshBank);
    saveBankrollState(freshBank);
    setAviatorAutoBetState(createInitialAutoBetState());
    setAviatorCashOutState(createInitialCashOutState());
    setAviatorScanDebug({
      lastReadTime: '--:--:--',
      lastMultiplierLabel: '--',
      lastReadMs: null,
      consecutiveFailures: 0,
    });
  };

  const handleUpdateAviatorBankrollCfg = (cfg: AviatorBankrollConfig) => {
    setAviatorBankrollCfg(cfg);
    saveBankrollConfig(cfg);
  };

  const handleResetAviatorBankrollSession = () => {
    const fresh = createInitialBankrollState(aviatorBankrollCfg);
    setAviatorBankrollState(fresh);
    saveBankrollState(fresh);
    setAviatorAutoBetState(createInitialAutoBetState());
    setAviatorCashOutState(createInitialCashOutState());
  };

  const handleToggleAviatorBankrollPause = () => {
    setAviatorBankrollState((prev) => {
      const next = { ...prev, pausedUntilNextSession: !prev.pausedUntilNextSession };
      saveBankrollState(next);
      return next;
    });
  };

  const handleUpdateAviatorAutoBetCfg = (cfg: AviatorAutoBetConfig) => {
    setAviatorAutoBetCfg(cfg);
    saveAutoBetConfig(cfg);
    if (cfg.enabled && cfg.mode !== 'off') {
      const nextEval = evaluateAutoBetOpportunity({
        autoCfg: cfg,
        autoState: aviatorAutoBetState,
        bankrollCfg: aviatorBankrollCfg,
        bankrollState: aviatorBankrollState,
        strategyReport: aviatorAnalysis.strategies,
        nextRoundNumber: aviatorRounds.length + 1,
      });
      setAviatorAutoBetState(nextEval.nextAutoState);
    }
  };

  const handleConfirmAviatorManualTicket = (confirm: boolean) => {
    setAviatorAutoBetState((prev) => confirmManualTicketAction(prev, confirm));
  };

  const handleUpdateAviatorCashOutCfg = (cfg: AviatorCashOutConfig) => {
    setAviatorCashOutCfg(cfg);
    saveCashOutConfig(cfg);
  };

  const handleSelectAviatorLearningWindow = (w: LearningWindowKey) => {
    setAviatorLearningWindow(w);
    saveSelectedLearningWindow(w);
  };

  const handleSaveAviatorSnapshot = () => {
    const win =
      aviatorAnalysis.learning.windows.find((w) => w.windowKey === aviatorLearningWindow) ??
      aviatorAnalysis.learning.windows[0];
    const snap: AviatorLearningSnapshot = {
      id: `snap-${Date.now()}`,
      timestamp: Date.now(),
      sampleSize: aviatorRounds.length,
      bestStrategyName: win.bestStrategyName,
      validationHitRatePct: win.validationHitRatePct,
      validationRoiPct: win.validationRoiPct,
    };
    const next = [...aviatorSnapshots, snap].slice(-30);
    setAviatorSnapshots(next);
    saveLearningSnapshots(next);
  };

  const handleStartAviatorMediaProjection = async () => {
    if (!isAndroidApk) {
      setAviatorCaptureStatus((prev) => ({
        ...prev,
        lastError: 'Captura externa MediaProjection disponível apenas no APK Android instalado.',
      }));
      return;
    }
    await BrowserScanner.startMediaProjection({
      intervalMs: aviatorCaptureStatus.captureIntervalMs,
    });
  };

  const handleStopAviatorMediaProjection = async () => {
    if (!isAndroidApk) return;
    await BrowserScanner.stopMediaProjection();
  };

  const handleChangeAviatorInterval = async (ms: number) => {
    setAviatorCaptureStatus((prev) => ({ ...prev, captureIntervalMs: ms }));
    if (isAndroidApk) {
      await BrowserScanner.setCaptureIntervalMs({ intervalMs: ms });
    }
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
    const splitLabel =
      splitPresetIdx === 0 ? 'Tela 56%' : splitPresetIdx === 1 ? 'Tela 45%' : 'Tela 66%';

    if (gameMode === 'bacbo') {
      const bbLastRound =
        bacboRounds.length > 0 ? bacboRounds[bacboRounds.length - 1] : null;
      const bbSuggestion = bacboAnalysis.strategies.finalSuggestion;
      const bbProbs = bacboAnalysis.probabilities;
      const bbLastEval = bbLastRound?.predictionBefore;
      const bbLastHit =
        bbLastRound && bbLastEval && bbLastEval.suggestion !== 'NONE'
          ? bbLastEval.suggestion === bbLastRound.outcome
          : null;

      const bbRoundMap = new Map<string, BacBoRoundRecord>();
      for (const r of bacboRounds) {
        bbRoundMap.set(r.id, r);
      }
      const recentCells = bacboAnalysis.beadPlate.slice(-60);
      const offsetCol = recentCells.length > 0 ? recentCells[0].col : 0;
      const bbCols: BacBoBeadCell[][] = [];
      for (const cell of recentCells) {
        const cIdx = cell.col - offsetCol;
        if (!bbCols[cIdx]) bbCols[cIdx] = [];
        bbCols[cIdx][cell.row] = cell;
      }
      const evaluatedRecent = bacboRounds
        .filter((r) => r.predictionBefore && r.predictionBefore.suggestion !== 'NONE')
        .slice(-3)
        .reverse();

      const colorNamePt = (o: BacBoOutcome) =>
        o === 'P' ? 'Azul' : o === 'B' ? 'Verm.' : 'Emp.';

      const bbPCount = bacboRounds.filter((r) => r.outcome === 'P').length;
      const bbTCount = bacboRounds.filter((r) => r.outcome === 'T').length;
      const bbBCount = bacboRounds.filter((r) => r.outcome === 'B').length;

      return (
        <div className="h-screen overflow-y-auto bg-[#0B0F17] text-slate-100 p-2 space-y-1.5">
          {/* Cabeçalho compacto Split-Screen com seletor [ROLETA] [BAC BO] */}
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setGameMode('roulette')}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-slate-400"
              >
                ROLETA
              </button>
              <button
                type="button"
                onClick={() => setGameMode('bacbo')}
                className="rounded border border-blue-500/60 bg-blue-600/20 px-2 py-0.5 text-[10px] font-bold text-blue-300"
              >
                BAC BO
              </button>
              <button
                type="button"
                onClick={() => setGameMode('aviator')}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-slate-400"
              >
                AVIATOR
              </button>
              {bbLastRound && (
                <span
                  className={`inline-flex h-5 min-w-[24px] px-1 items-center justify-center rounded border font-mono text-[10px] font-bold text-white ${
                    bbLastRound.outcome === 'P'
                      ? 'bg-blue-600 border-blue-400'
                      : bbLastRound.outcome === 'B'
                      ? 'bg-[#B91C1C] border-red-400'
                      : 'bg-amber-600 border-amber-400'
                  }`}
                >
                  {bbLastRound.winningTotal ?? bbLastRound.outcome}
                </span>
              )}
              {bbLastHit !== null && (
                <span
                  className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                    bbLastHit
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {bbLastHit ? 'OK' : 'ERRO'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleManualBrowserScan}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                <span>Ler</span>
              </button>
              <button
                type="button"
                onClick={handleCycleSplitRatio}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
              >
                <ArrowUpDown className="h-2.5 w-2.5" />
                <span>{splitLabel}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleAndroidCalibration}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
              >
                <Crosshair className="h-2.5 w-2.5" />
                <span>Mira</span>
              </button>
              <button
                type="button"
                onClick={handleOpenIntegratedBrowser}
                className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950"
              >
                Painel
              </button>
            </div>
          </div>

          {/* Painel ao Vivo Bac Bo */}
          <div className="rounded-md border border-slate-800 bg-[#131924] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-400">
                  Sugestão Atual · {bacboAnalysis.strategies.agreeingCount} de{' '}
                  {bacboAnalysis.strategies.totalStrategies} estratégias
                </div>
                <div
                  className={`text-sm font-bold ${
                    bbSuggestion === 'P'
                      ? 'text-blue-400'
                      : bbSuggestion === 'B'
                      ? 'text-red-400'
                      : bbSuggestion === 'T'
                      ? 'text-amber-300'
                      : 'text-slate-200'
                  }`}
                >
                  {bbSuggestion === 'NONE'
                    ? 'SEM SUGESTÃO'
                    : `APOSTAR: ${formatOutcomeLabel(bbSuggestion).toUpperCase()}`}
                </div>
              </div>
              <div className="text-right font-mono text-[10px] tabular-nums">
                <div className="text-emerald-400 font-semibold">
                  Acerto: {bacboAnalysis.statistics.overall.hitRatePct.toFixed(1)}% (
                  {bacboAnalysis.statistics.overall.hits}/{bacboAnalysis.statistics.overall.suggestions})
                </div>
                <div className="text-amber-300 text-[9px]">
                  {getBacBoRoundCycleStatus(lastBacBoLiveResultAt, bacboCycleNowMs).label} ·{' '}
                  {bacboAnalysis.probabilities.statisticalConfidence}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 font-mono text-[10px] tabular-nums">
              <div className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-1">
                <div className="text-[9px] text-blue-300">PLAYER</div>
                <div className="font-bold text-blue-200">
                  {bbProbs.observed.player.toFixed(1)}% ({bbPCount})
                </div>
              </div>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-1">
                <div className="text-[9px] text-amber-300">TIE</div>
                <div className="font-bold text-amber-200">
                  {bbProbs.observed.tie.toFixed(1)}% ({bbTCount})
                </div>
              </div>
              <div className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1">
                <div className="text-[9px] text-red-300">BANKER</div>
                <div className="font-bold text-red-200">
                  {bbProbs.observed.banker.toFixed(1)}% ({bbBCount})
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300">
              <div className="rounded border border-slate-800 bg-[#0B0F17] px-1.5 py-0.5 truncate">
                Corrida: {bacboAnalysis.currentSnapshot.streakLabel}
              </div>
              <div className="rounded border border-slate-800 bg-[#0B0F17] px-1.5 py-0.5 truncate">
                Sem Tie: {bacboAnalysis.ties.roundsSinceLastTie} rod.
              </div>
            </div>

            {bacboAnalysis.strategies.reasons.length > 0 && (
              <div className="text-[9px] text-slate-400 leading-snug space-y-0.5">
                {bacboAnalysis.strategies.reasons.slice(0, 2).map((reason, idx) => (
                  <div key={idx} className="truncate">
                    • {reason}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nossa Tabela (6 Linhas: Cor que Veio + Nosso Acerto/Erro) */}
          <div className="rounded-md border border-slate-800 bg-[#131924] p-2 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="font-semibold text-slate-200">Nossa Tabela</span>
                <span className="font-mono text-[9px] text-emerald-400 tabular-nums">
                  OK:{bacboAnalysis.statistics.overall.hits}
                </span>
                <span className="font-mono text-[9px] text-red-400 tabular-nums">
                  Erro:{bacboAnalysis.statistics.overall.misses}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleAddBacBoRound({ outcome: 'P', source: 'manual' })}
                  className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
                >
                  +P
                </button>
                <button
                  type="button"
                  onClick={() => handleAddBacBoRound({ outcome: 'T', source: 'manual' })}
                  className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
                >
                  +T
                </button>
                <button
                  type="button"
                  onClick={() => handleAddBacBoRound({ outcome: 'B', source: 'manual' })}
                  className="rounded bg-[#B91C1C] px-1.5 py-0.5 text-[10px] font-bold text-white"
                >
                  +B
                </button>
                <button
                  type="button"
                  onClick={handleResetAllBacBo}
                  title="Zerar percentuais e nossa tabela para 0%"
                  className="inline-flex items-center gap-0.5 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold text-slate-200 hover:text-red-300"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  <span>Zerar 0%</span>
                </button>
              </div>
            </div>

            {bacboRounds.length === 0 ? (
              <div className="rounded border border-dashed border-slate-800 px-2 py-2 text-[10px] text-amber-300 text-center">
                Aguardando leitura dos 3 blocos (JOGADOR | EMPATE | BANCA) ou toque +P / +T / +B.
              </div>
            ) : (
              <div className="overflow-x-auto pb-0.5">
                <div className="inline-flex gap-1">
                  {bbCols.map((colCells, colIdx) => (
                    <div key={colIdx} className="grid grid-rows-6 gap-0.5">
                      {Array.from({ length: BEAD_PLATE_ROWS }, (_, rowIdx) => {
                        const cell = colCells?.[rowIdx];
                        if (!cell) {
                          return (
                            <span
                              key={rowIdx}
                              className="h-5 w-5 rounded-full border border-slate-800/70 bg-[#0B0F17]"
                            />
                          );
                        }
                        const rec = bbRoundMap.get(cell.recordId);
                        const pred = rec?.predictionBefore;
                        const evaluated = pred && pred.suggestion !== 'NONE';
                        const isHit = evaluated ? pred.suggestion === cell.outcome : null;
                        const isLatest =
                          bbLastRound && bbLastRound.id === cell.recordId;
                        const cellBg =
                          cell.outcome === 'P'
                            ? 'bg-blue-600 border-blue-400'
                            : cell.outcome === 'B'
                            ? 'bg-[#B91C1C] border-red-400'
                            : 'bg-amber-600 border-amber-400';

                        return (
                          <span
                            key={cell.recordId}
                            className={`relative inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[9px] font-bold text-white tabular-nums ${cellBg} ${
                              isLatest ? 'ring-1 ring-white' : ''
                            }`}
                          >
                            {cell.winningTotal ?? cell.outcome}
                            {isHit !== null && (
                              <span
                                className={`absolute -top-1 -right-1 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full text-[7px] font-black leading-none ring-1 ring-[#0B0F17] ${
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

            {evaluatedRecent.length > 0 && (
              <div className="space-y-0.5 border-t border-slate-800/80 pt-1 text-[9px] font-mono tabular-nums">
                {evaluatedRecent.map((r) => {
                  const sug = r.predictionBefore!.suggestion as BacBoOutcome;
                  const hit = sug === r.outcome;
                  const score =
                    r.playerTotal !== null && r.bankerTotal !== null
                      ? ` ${r.playerTotal}×${r.bankerTotal}`
                      : r.winningTotal !== null
                      ? ` (${r.winningTotal})`
                      : '';
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 text-slate-300"
                    >
                      <span className="truncate">
                        #{r.roundNumber} Veio{' '}
                        <strong
                          className={
                            r.outcome === 'P'
                              ? 'text-blue-400'
                              : r.outcome === 'B'
                              ? 'text-red-400'
                              : 'text-amber-300'
                          }
                        >
                          {colorNamePt(r.outcome)}
                          {score}
                        </strong>{' '}
                        · Nossa: {formatOutcomeLabel(sug)}
                      </span>
                      <span
                        className={`shrink-0 font-bold ${
                          hit ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {hit ? 'OK ✓' : 'ERRO ✕'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-md border border-slate-800/80 bg-[#090D14] px-2 py-1 font-mono text-[9px] leading-snug text-slate-400 tabular-nums">
            Última leitura: {bacboScanDebug.lastReadTime} · {bacboScanDebug.lastOutcomeLabel} ·{' '}
            {bacboScanDebug.lastReadMs !== null ? `${bacboScanDebug.lastReadMs}ms` : '--'} ·{' '}
            Rodadas: {bacboRounds.length} ·{' '}
            <span className={bacboScanDebug.ocrActive ? 'text-emerald-400' : 'text-amber-300'}>
              {bacboScanDebug.ocrActive ? '3 Blocos detetados' : 'A procurar 3 blocos'}
            </span>
          </div>
        </div>
      );
    }

    if (gameMode === 'aviator') {
      const avLastRound =
        aviatorRounds.length > 0 ? aviatorRounds[aviatorRounds.length - 1] : null;
      const avSug = aviatorAnalysis.strategies.activeSnapshot;
      const avTopStrat = aviatorAnalysis.strategies.rankingByRoi[0];

      return (
        <div className="h-screen overflow-y-auto bg-[#0B0F17] text-slate-100 p-2 space-y-1.5">
          {/* Cabeçalho compacto Split-Screen com seletor [ROLETA] [BAC BO] [AVIATOR] */}
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setGameMode('roulette')}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-slate-400"
              >
                ROLETA
              </button>
              <button
                type="button"
                onClick={() => setGameMode('bacbo')}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-slate-400"
              >
                BAC BO
              </button>
              <button
                type="button"
                onClick={() => setGameMode('aviator')}
                className="rounded border border-red-500/70 bg-red-600/20 px-2 py-0.5 text-[10px] font-bold text-red-300"
              >
                AVIATOR
              </button>
              {avLastRound && (
                <span
                  className={`inline-flex h-5 px-1.5 items-center justify-center rounded border font-mono text-[10px] font-bold tabular-nums ${multiplierBadgeClass(
                    avLastRound.multiplier
                  )}`}
                >
                  {avLastRound.multiplier.toFixed(2)}x
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleManualBrowserScan}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                <span>Ler</span>
              </button>
              <button
                type="button"
                onClick={handleResetAllAviator}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                <span>Zerar 0%</span>
              </button>
              <button
                type="button"
                onClick={handleCycleSplitRatio}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
              >
                <ArrowUpDown className="h-2.5 w-2.5" />
                <span>{splitLabel}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleAndroidCalibration}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
              >
                <Crosshair className="h-2.5 w-2.5" />
                <span>Mira</span>
              </button>
              <button
                type="button"
                onClick={handleOpenIntegratedBrowser}
                className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950"
              >
                Painel
              </button>
            </div>
          </div>

          {aviatorCashOutState.alertActiveNow && aviatorCashOutState.alertMessage && (
            <div className="rounded border border-amber-400 bg-amber-500/20 px-2 py-1 text-[10px] font-bold text-amber-200">
              {aviatorCashOutState.alertMessage}
            </div>
          )}

          {/* Faixa Recente Aviator */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {aviatorRounds.length === 0 ? (
              <span className="text-[10px] text-amber-300">
                Aguardando leitura da faixa + multiplicador Aviator (use Mira se precisar ajustar).
              </span>
            ) : (
              aviatorRounds
                .slice(-12)
                .reverse()
                .map((r, idx) => (
                  <span
                    key={r.id}
                    className={`inline-flex h-5 px-1.5 items-center justify-center rounded border font-mono text-[10px] font-bold tabular-nums shrink-0 ${multiplierBadgeClass(
                      r.multiplier
                    )} ${idx === 0 ? 'ring-1 ring-amber-400' : ''}`}
                  >
                    {r.multiplier.toFixed(2)}x
                  </span>
                ))
            )}
          </div>

          {/* Cartão Principal Ao Vivo Aviator */}
          <div className="rounded-md border border-slate-800 bg-[#131924] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-400">
                  {avSug.strategyName} · Score {avSug.confidencePct.toFixed(0)}%
                </div>
                <div
                  className={`text-sm font-bold ${
                    avSug.shouldEnter ? 'text-emerald-400' : 'text-slate-200'
                  }`}
                >
                  {avSug.shouldEnter && avSug.targetMultiplier
                    ? `ALVO: ${avSug.targetMultiplier.toFixed(2)}x`
                    : 'AGUARDAR ENTRADA'}
                </div>
              </div>
              <div className="text-right font-mono text-[10px] tabular-nums">
                <div className="text-amber-300 font-bold">
                  Ao vivo:{' '}
                  {aviatorLiveState.currentMultiplier !== null
                    ? `${aviatorLiveState.currentMultiplier.toFixed(2)}x`
                    : '--'}{' '}
                  ({aviatorLiveState.phase === 'FLYING' ? 'VOAR' : aviatorLiveState.phase === 'CRASHED' ? 'CRASH' : 'ESP.'})
                </div>
                <div className="text-emerald-400">
                  Acerto: {aviatorAnalysis.statistics.suggestionHitRatePct.toFixed(1)}% (
                  {aviatorAnalysis.statistics.suggestionHits}/{aviatorAnalysis.statistics.evaluatedSuggestions})
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 font-mono text-[10px] tabular-nums">
              <div className="rounded border border-slate-800 bg-[#0B0F17] px-1.5 py-1">
                <div className="text-[9px] text-slate-400">Média 20</div>
                <div className="font-bold text-sky-300">
                  {aviatorAnalysis.statistics.recent20AvgMultiplier.toFixed(2)}x
                </div>
              </div>
              <div className="rounded border border-slate-800 bg-[#0B0F17] px-1.5 py-1">
                <div className="text-[9px] text-slate-400">Seq &lt;1.5x</div>
                <div className="font-bold text-amber-300">
                  {aviatorAnalysis.patterns.currentLowStreak}x
                </div>
              </div>
              <div className="rounded border border-slate-800 bg-[#0B0F17] px-1.5 py-1">
                <div className="text-[9px] text-slate-400">Banca</div>
                <div className="font-bold text-emerald-300">
                  {aviatorBankrollState.currentBalanceAoa.toFixed(0)}
                </div>
              </div>
            </div>

            <div className="text-[9px] text-slate-400 truncate">
              {avTopStrat
                ? `Melhor ROI: ${avTopStrat.name} (${avTopStrat.simulatedRoiPct.toFixed(1)}%) · ${avSug.reason}`
                : avSug.reason}
            </div>
          </div>

          <div className="rounded-md border border-slate-800/80 bg-[#090D14] px-2 py-1 font-mono text-[9px] leading-snug text-slate-400 tabular-nums">
            Última leitura: {aviatorScanDebug.lastReadTime} · {aviatorScanDebug.lastMultiplierLabel} ·{' '}
            {aviatorScanDebug.lastReadMs !== null ? `${aviatorScanDebug.lastReadMs}ms` : '--'} ·{' '}
            Rodadas: {aviatorRounds.length}
          </div>
        </div>
      );
    }

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

    return (
      <div className="h-screen overflow-y-auto bg-[#0B0F17] text-slate-100 p-2 space-y-1.5">
        {/* Cabeçalho compacto com controles + seletor [ROLETA] [BAC BO] */}
        <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => setGameMode('roulette')}
              className="rounded border border-amber-400/60 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300 shrink-0"
            >
              ROLETA
            </button>
            <button
              type="button"
              onClick={() => setGameMode('bacbo')}
              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-slate-400 shrink-0"
            >
              BAC BO
            </button>
            <button
              type="button"
              onClick={() => setGameMode('aviator')}
              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-slate-400 shrink-0"
            >
              AVIATOR
            </button>
            {accuracy.lastRound ? (
              <>
                <span
                  className={`inline-flex h-5 min-w-[24px] px-1 items-center justify-center rounded border font-mono text-[11px] font-bold text-white tabular-nums ${
                    accuracy.lastRound.actualColor === 'green'
                      ? 'bg-emerald-700 border-emerald-500'
                      : accuracy.lastRound.actualColor === 'red'
                      ? 'bg-[#B91C1C] border-red-700'
                      : 'bg-[#181C24] border-slate-600'
                  }`}
                >
                  {accuracy.lastRound.actualNumber}
                </span>
                <div className="text-[10px] leading-tight">
                  <div className="text-slate-200 font-medium">
                    Último: {accuracy.lastRound.hitsCount}/{accuracy.lastRound.totalMarkets} acertos
                  </div>
                  <div className="font-mono text-[10px] text-emerald-400 tabular-nums">
                    Sessão: {accuracy.overallRatePct.toFixed(1)}% ({accuracy.totalHits}/{accuracy.totalAttempts})
                  </div>
                  {combinedSpins.length < 50 && (
                    <div className="text-[9px] text-amber-300">
                      A recolher dados... {combinedSpins.length}/50
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-[10px] leading-tight">
                <div className="text-slate-200 font-medium">
                  Sessão Virgem: 0.0% (0/0)
                </div>
                <div className="text-[9px] text-amber-300">
                  {combinedSpins.length < 50
                    ? `A recolher dados... ${combinedSpins.length}/50`
                    : scanStatusHint ||
                      `Mesa lida (${combinedSpins.length} giros). Aguardando 1ª jogada.`}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleManualBrowserScan}
              title="Ler faixa agora"
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              <span>Ler</span>
            </button>
            <button
              type="button"
              onClick={handleResetMomentKeepBackup}
              title="Zerar estatísticas do momento mantendo aprendizagem"
              className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
            >
              Zerar 0%
            </button>
            <button
              type="button"
              onClick={handleCycleSplitRatio}
              title="Ajustar tamanho do navegador"
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
            >
              <ArrowUpDown className="h-2.5 w-2.5" />
              <span>{splitLabel}</span>
            </button>
            <button
              type="button"
              onClick={handleToggleAndroidCalibration}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200"
            >
              <Crosshair className="h-2.5 w-2.5" />
              <span>Mira</span>
            </button>
            <button
              type="button"
              onClick={handleOpenIntegratedBrowser}
              className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950"
            >
              Painel
            </button>
          </div>
        </div>

        {/* Faixa de histórico lida */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {combinedSpins.length === 0 ? (
            <span className="text-[10px] text-amber-300">
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
                  className={`inline-flex h-5 min-w-[22px] px-1 items-center justify-center rounded border font-mono text-[10px] font-bold text-white tabular-nums shrink-0 ${bg} ${
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
        <div className="grid grid-cols-2 gap-1">
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
                className={`rounded-md border border-slate-800 bg-[#131924] p-1.5 ${
                  isFullWidth ? 'col-span-2' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9px] font-medium text-slate-400 truncate">
                    {opt.shortTitle}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {lastEval && (
                      <span
                        className={`rounded px-1 py-0 text-[9px] font-bold ${
                          lastEval.hit
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {lastEval.hit ? 'OK' : 'X'}
                      </span>
                    )}
                    <span
                      className={`font-mono text-[9px] font-bold tabular-nums ${
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

                <div className={`mt-0.5 text-[11px] font-bold leading-tight ${opt.accent}`}>
                  {opt.suggestion}
                </div>

                {lastEval && rateStat && (
                  <div className="mt-0.5 text-[9px] text-slate-400 leading-tight truncate">
                    Ant: {lastEval.predicted} · Saiu: {lastEval.actual} ({rateStat.hits}/{rateStat.attempts})
                  </div>
                )}
              </div>
            );
          })}

          {/* Números diretos sugeridos completos + Stake */}
          <div className="col-span-2 rounded-md border border-slate-800 bg-[#131924] p-1.5">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="text-[9px] font-medium text-slate-400">
                Números Diretos Sugeridos (Fichas)
              </span>
              <span className="font-mono text-[9px] font-semibold text-emerald-400 tabular-nums">
                {analysis.suggestedChips.length > 0
                  ? `${analysis.totalRoundStakeAoa.toFixed(0)} AOA (${analysis.suggestedChips.length}×${analysis.stakePerUnitAoa})`
                  : '0 AOA'}
              </span>
            </div>
            {analysis.suggestedChips.length === 0 ? (
              <div className="text-[10px] text-slate-500">
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
                      className={`inline-flex h-5 min-w-[22px] px-1 items-center justify-center rounded border font-mono text-[10px] font-bold text-white tabular-nums ${chipBg}`}
                    >
                      {chip}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Log de Debug Visível por baixo (Tarefa 1 OCR 500ms) */}
        <div className="rounded-md border border-slate-800/80 bg-[#090D14] px-2 py-1 font-mono text-[9px] leading-snug text-slate-400 tabular-nums">
          <div>
            Última leitura: {scanDebug.lastReadTime} - Número:{' '}
            {scanDebug.lastReadNumber !== null ? scanDebug.lastReadNumber : '--'} - Tempo:{' '}
            {scanDebug.lastReadMs !== null ? `${scanDebug.lastReadMs}ms` : '--'}
            {scanDebug.consecutiveFailures > 0
              ? ` · OCR ativo (${scanDebug.lastAttemptMs ?? 500}ms)`
              : ''}
          </div>
          <div>
            Giros lidos: {sessionSpins.length} / {Math.max(5, sessionSpins.length)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Bar: Abas principais [ ROLETA ] [ BAC BO ] + navegação + Abrir Navegador */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0B0F17]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 h-16">
          <div className="flex items-center gap-3 sm:gap-5 min-w-0">
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

            {/* Três Abas Principais no Topo: [ ROLETA ] [ BAC BO ] [ AVIATOR ] */}
            <div
              role="tablist"
              aria-label="Selecionar jogo principal"
              className="inline-flex items-center rounded-lg border border-slate-800 bg-[#131924] p-0.5 shrink-0"
            >
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'roulette'}
                onClick={() => setGameMode('roulette')}
                className={`rounded-md px-3 py-1.5 text-xs font-bold tracking-wide transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'roulette'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                ROLETA
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'bacbo'}
                onClick={() => setGameMode('bacbo')}
                className={`rounded-md px-3 py-1.5 text-xs font-bold tracking-wide transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'bacbo'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                BAC BO
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'aviator'}
                onClick={() => setGameMode('aviator')}
                className={`rounded-md px-3 py-1.5 text-xs font-bold tracking-wide transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'aviator'
                    ? 'bg-red-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                AVIATOR
              </button>
            </div>
          </div>

          {gameMode === 'roulette' ? (
            <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
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
          ) : gameMode === 'bacbo' ? (
            <div className="hidden lg:flex items-center gap-3 text-xs text-slate-400 font-mono tabular-nums">
              <span className="text-blue-400 font-semibold">BAC BO INTELLIGENCE ENGINE</span>
              <span aria-hidden="true">·</span>
              <span>{bacboRounds.length} rodadas guardadas</span>
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-3 text-xs text-slate-400 font-mono tabular-nums">
              <span className="text-red-400 font-semibold">AVIATOR INTELLIGENCE</span>
              <span aria-hidden="true">·</span>
              <span>{aviatorRounds.length} rodadas guardadas</span>
            </div>
          )}

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleOpenIntegratedBrowser}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 sm:px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Abrir Navegador</span>
              <span className="sm:hidden">Navegador</span>
            </button>
          </div>
        </div>

        {gameMode === 'roulette' && (
          <div className="flex lg:hidden border-t border-slate-800/80 px-2 overflow-x-auto">
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
        )}
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
                  ? gameMode === 'bacbo'
                    ? 'Abra o Bac Bo na Kwanzabet em tela dividida para o OCR ler Player, Banker, Tie e a grelha em tempo real.'
                    : gameMode === 'aviator'
                    ? 'Abra o Aviator na Kwanzabet em tela dividida (ou inicie a Captura de Ecrã para ler no Chrome externo) para monitorizar em tempo real.'
                    : 'Abra a Kwanzabet dentro do app em tela dividida para ler os resultados em tempo real.'
                  : 'No APK Android, o botão abaixo abre a Kwanzabet na parte superior enquanto as sugestões ficam fixas embaixo.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={browserUrlInput}
                onChange={(e) => setBrowserUrlInput(e.target.value)}
                aria-label="Endereço do site do jogo"
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

        {gameMode === 'bacbo' ? (
          <BacBoDashboard
            rounds={bacboRounds}
            analysis={bacboAnalysis}
            roiTopPct={34}
            roiHeightPct={40}
            lastLiveResultAt={lastBacBoLiveResultAt}
            cycleNowMs={bacboCycleNowMs}
            scanDebug={bacboScanDebug}
            onAddRound={handleAddBacBoRound}
            onImportRounds={handleImportBacBoRounds}
            onResetAll={handleResetAllBacBo}
          />
        ) : gameMode === 'aviator' ? (
          <AviatorDashboard
            rounds={aviatorRounds}
            analysis={aviatorAnalysis}
            liveState={aviatorLiveState}
            captureStatus={aviatorCaptureStatus}
            bankrollCfg={aviatorBankrollCfg}
            bankrollState={aviatorBankrollState}
            autoBetCfg={aviatorAutoBetCfg}
            autoBetState={aviatorAutoBetState}
            cashOutCfg={aviatorCashOutCfg}
            cashOutState={aviatorCashOutState}
            selectedWindow={aviatorLearningWindow}
            isAndroidApk={isAndroidApk}
            scanDebug={aviatorScanDebug}
            onAddMultiplier={handleAddAviatorMultiplier}
            onBulkAddMultipliers={handleBulkAddAviator}
            onImportRounds={handleImportAviatorRounds}
            onResetAll={handleResetAllAviator}
            onUpdateBankrollCfg={handleUpdateAviatorBankrollCfg}
            onResetBankrollSession={handleResetAviatorBankrollSession}
            onToggleBankrollPause={handleToggleAviatorBankrollPause}
            onUpdateAutoBetCfg={handleUpdateAviatorAutoBetCfg}
            onConfirmManualTicket={handleConfirmAviatorManualTicket}
            onUpdateCashOutCfg={handleUpdateAviatorCashOutCfg}
            onSelectLearningWindow={handleSelectAviatorLearningWindow}
            onSaveLearningSnapshot={handleSaveAviatorSnapshot}
            onStartMediaProjection={handleStartAviatorMediaProjection}
            onStopMediaProjection={handleStopAviatorMediaProjection}
            onChangeCaptureInterval={handleChangeAviatorInterval}
          />
        ) : (
          <>
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
                    {combinedSpins.length === 0
                      ? 'A recolher dados... 0/50 · Abra o navegador ou registre um giro para iniciar.'
                      : combinedSpins.length < 50
                      ? `A recolher dados... ${combinedSpins.length}/50 · Sugestões ativas abaixo enquanto recolhe mais giros.`
                      : 'Escolha um ou mais campos abaixo conforme a leitura atual e acompanhe OK / X + % de cada opção.'}
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

        {/* Log de Debug Visível por baixo */}
        <footer className="rounded-lg border border-slate-800/80 bg-[#090D14] px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400 tabular-nums">
          <div>
            Última leitura: {scanDebug.lastReadTime} - Número:{' '}
            {scanDebug.lastReadNumber !== null ? scanDebug.lastReadNumber : '--'} - Tempo:{' '}
            {scanDebug.lastReadMs !== null ? `${scanDebug.lastReadMs}ms` : '--'}
            {scanDebug.consecutiveFailures > 0
              ? ` · OCR ativo (${scanDebug.lastAttemptMs ?? 500}ms)`
              : ''}
          </div>
          <div>
            Giros lidos: {sessionSpins.length} / {Math.max(5, sessionSpins.length)}
          </div>
        </footer>
          </>
        )}
      </main>
    </div>
  );
}
