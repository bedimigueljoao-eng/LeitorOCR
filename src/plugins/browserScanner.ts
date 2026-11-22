import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';

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
}

export interface BacBoDetectedEvent {
  itemsNewestFirst: BacBoCellEvent[];
  isFullPlate: boolean;
}

export interface BrowserScannerPlugin {
  openBrowser(options?: { url?: string }): Promise<void>;
  closeBrowser(): Promise<void>;
  setSplitRatio(options: { browserWeight: number }): Promise<void>;
  toggleCalibration(): Promise<void>;
  setAutoScan(options: { enabled: boolean }): Promise<void>;
  scanNow(): Promise<void>;
  setGameMode(options: { mode: 'roulette' | 'bacbo' }): Promise<void>;
  addListener(
    eventName: 'spinsDetected',
    listenerFunc: (event: SpinsDetectedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'bacboDetected',
    listenerFunc: (event: BacBoDetectedEvent) => void
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
