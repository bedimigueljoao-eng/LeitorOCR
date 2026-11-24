import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';

export type NativeGameMode = 'roulette' | 'bacbo' | 'aviator';
export type BacBoScanMode = 'auto' | 'blocks' | 'bead_plate';
export type RoiSurfaceMode = 'split' | 'projection';

export interface RoiRectConfig {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
  surface?: RoiSurfaceMode;
}

export interface RouletteScannerConfig {
  site: string;
  newestOnLeft: boolean;
  multiplierMode: boolean;
}

export interface HsvColorProfileConfig {
  siteKey: string;
  greenHueMin: number;
  greenHueMax: number;
  greenMinSat: number;
  greenMinVal: number;
  redHueLowMax: number;
  redHueHighMin: number;
  redMinSat: number;
  redMinVal: number;
  blackMaxSat: number;
  blackMaxVal: number;
  blueHueMin: number;
  blueHueMax: number;
  blueMinSat: number;
  blueMinVal: number;
  goldHueMin: number;
  goldHueMax: number;
  goldMinSat: number;
  goldMinVal: number;
  calibratedSamplesCount: number;
}

export interface HsvCalibrationSample {
  label: 'GREEN' | 'RED' | 'BLACK' | 'P' | 'B' | 'T';
  r?: number;
  g?: number;
  b?: number;
  hue?: number;
  sat?: number;
  val?: number;
}

export interface OcrDebugBoxEvent {
  leftRatio: number;
  topRatio: number;
  rightRatio: number;
  bottomRatio: number;
  text: string;
  colorLabel: string;
  accepted: boolean;
  reason: string;
}

export interface OcrDebugOverlayEvent {
  gameMode: NativeGameMode;
  resolvedMode: string;
  confidence: number;
  timestampMs: number;
  boxes: OcrDebugBoxEvent[];
}

export interface SpinsDetectedEvent {
  numbersNewestFirst: number[];
  isFullStrip: boolean;
}

export interface BrowserVisibilityEvent {
  visible: boolean;
}

export interface ScanFeedbackEvent {
  count: number;
  mode: string;
}

export interface ScanTelemetryEvent {
  lastNumber: number;
  elapsedMs: number;
  ocrOk: boolean;
  consecutiveFailures: number;
  stripCount: number;
  totalReads: number;
}

export interface BacBoCellEvent {
  outcome: 'P' | 'B' | 'T';
  total: number; // 2..12 or -1 if unavailable
  playerTotal?: number;
  bankerTotal?: number;
  colorFallback?: boolean;
}

export interface BacBoDetectedEvent {
  itemsNewestFirst: BacBoCellEvent[];
  isFullPlate: boolean;
}

export interface AviatorDetectedEvent {
  liveMultiplier: number; // -1 if unavailable
  isCrashedColor: boolean;
  historyNewestFirst: number[];
  isFullStrip: boolean;
  ocrConfidence: number;
  source: 'integrated_browser' | 'media_projection';
}

export interface AviatorCaptureStatusEvent {
  mediaProjectionActive: boolean;
  captureIntervalMs: number;
  permissionState: 'idle' | 'pending' | 'granted' | 'denied';
  error?: string;
}

export interface UnifiedCaptureStatusEvent extends AviatorCaptureStatusEvent {
  gameMode: NativeGameMode;
  siteKey: string;
}

export interface BrowserScannerPlugin {
  openBrowser(options?: { url?: string }): Promise<void>;
  closeBrowser(): Promise<void>;
  setSplitRatio(options: { browserWeight: number }): Promise<void>;
  toggleCalibration(): Promise<void>;
  setAutoScan(options: { enabled: boolean }): Promise<void>;
  scanNow(): Promise<void>;
  setGameMode(options: { mode: NativeGameMode }): Promise<void>;
  setBacBoScanMode(options: { mode: BacBoScanMode }): Promise<void>;
  setSiteProfile(options: { site: string }): Promise<void>;
  saveRoiRect(options: {
    game: NativeGameMode;
    site: string;
    surface?: RoiSurfaceMode;
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
  }): Promise<void>;
  getRoiRect(options: {
    game: NativeGameMode;
    site: string;
    surface?: RoiSurfaceMode;
  }): Promise<RoiRectConfig>;
  getRouletteConfig(options: { site: string }): Promise<RouletteScannerConfig>;
  setRouletteConfig(options: {
    site: string;
    newestOnLeft?: boolean;
    multiplierMode?: boolean;
  }): Promise<RouletteScannerConfig>;
  getHsvProfile(options: { site: string }): Promise<HsvColorProfileConfig>;
  calibrateHsvProfile(options: {
    site: string;
    samples: HsvCalibrationSample[];
  }): Promise<HsvColorProfileConfig>;
  resetHsvProfile(options: { site: string }): Promise<HsvColorProfileConfig>;
  setDebugOverlay(options: { enabled: boolean }): Promise<void>;
  getDbHistory(options: { game: NativeGameMode; limit?: number }): Promise<{ rows: unknown[] }>;
  exportDbCsv(options: { game: NativeGameMode }): Promise<{ csv: string }>;
  clearDbHistory(options: { game: NativeGameMode }): Promise<void>;
  startMediaProjection(options?: {
    intervalMs?: number;
    gameMode?: NativeGameMode;
    siteKey?: string;
  }): Promise<void>;
  stopMediaProjection(): Promise<void>;
  setCaptureIntervalMs(options: { intervalMs: number }): Promise<void>;
  getCaptureStatus(): Promise<{
    mediaProjectionActive: boolean;
    captureIntervalMs: number;
    gameMode?: NativeGameMode;
    siteKey?: string;
    bacBoScanMode?: BacBoScanMode;
    debugOverlayEnabled?: boolean;
  }>;
  addListener(
    eventName: 'spinsDetected',
    listenerFunc: (event: SpinsDetectedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'bacboDetected',
    listenerFunc: (event: BacBoDetectedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'aviatorDetected',
    listenerFunc: (event: AviatorDetectedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'aviatorCaptureStatus',
    listenerFunc: (event: AviatorCaptureStatusEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'captureStatus',
    listenerFunc: (event: UnifiedCaptureStatusEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'ocrDebugOverlay',
    listenerFunc: (event: OcrDebugOverlayEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'browserVisibilityChanged',
    listenerFunc: (event: BrowserVisibilityEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'scanFeedback',
    listenerFunc: (event: ScanFeedbackEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'scanTelemetry',
    listenerFunc: (event: ScanTelemetryEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const BrowserScanner = registerPlugin<BrowserScannerPlugin>('BrowserScanner');

export function isNativeAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
