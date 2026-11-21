import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface SpinsDetectedEvent {
  numbersNewestFirst: number[];
  isFullStrip: boolean;
}

export interface BrowserVisibilityEvent {
  visible: boolean;
}

export interface BrowserScannerPlugin {
  openBrowser(options?: { url?: string }): Promise<void>;
  closeBrowser(): Promise<void>;
  setSplitRatio(options: { browserWeight: number }): Promise<void>;
  toggleCalibration(): Promise<void>;
  setAutoScan(options: { enabled: boolean }): Promise<void>;
  scanNow(): Promise<void>;
  addListener(
    eventName: 'spinsDetected',
    listenerFunc: (event: SpinsDetectedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'browserVisibilityChanged',
    listenerFunc: (event: BrowserVisibilityEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const BrowserScanner = registerPlugin<BrowserScannerPlugin>('BrowserScanner');

export function isNativeAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
