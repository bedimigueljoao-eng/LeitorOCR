package com.roletavision.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

@CapacitorPlugin(name = "BrowserScanner")
public class BrowserScannerPlugin extends Plugin {

    private static BrowserScannerPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    public static void emitSpins(List<Integer> numbersNewestFirst, boolean isFullStrip) {
        if (instance == null || numbersNewestFirst == null || numbersNewestFirst.isEmpty()) {
            return;
        }
        JSArray arr = new JSArray();
        for (Integer n : numbersNewestFirst) {
            arr.put(n);
        }
        JSObject payload = new JSObject();
        payload.put("numbersNewestFirst", arr);
        payload.put("isFullStrip", isFullStrip);
        instance.notifyListeners("spinsDetected", payload);
    }

    public static void emitBrowserVisibility(boolean visible) {
        if (instance == null) return;
        JSObject payload = new JSObject();
        payload.put("visible", visible);
        instance.notifyListeners("browserVisibilityChanged", payload);
    }

    public static void emitScanFeedback(int count, String mode) {
        if (instance == null) return;
        JSObject payload = new JSObject();
        payload.put("count", count);
        payload.put("mode", mode != null ? mode : "");
        instance.notifyListeners("scanFeedback", payload);
    }

    public static void emitScanTelemetry(
            int lastNumber,
            long elapsedMs,
            boolean ocrOk,
            int consecutiveFailures,
            int stripCount,
            int totalReads
    ) {
        if (instance == null) return;
        JSObject payload = new JSObject();
        payload.put("lastNumber", lastNumber);
        payload.put("elapsedMs", elapsedMs);
        payload.put("ocrOk", ocrOk);
        payload.put("consecutiveFailures", consecutiveFailures);
        payload.put("stripCount", stripCount);
        payload.put("totalReads", totalReads);
        instance.notifyListeners("scanTelemetry", payload);
    }

    public static void emitBacBo(List<ScreenScanner.BacBoCell> cellsNewestFirst, boolean isFullPlate) {
        if (instance == null || cellsNewestFirst == null || cellsNewestFirst.isEmpty()) {
            return;
        }
        JSArray arr = new JSArray();
        for (ScreenScanner.BacBoCell cell : cellsNewestFirst) {
            JSObject item = new JSObject();
            item.put("outcome", cell.outcome);
            item.put("total", cell.total);
            if (cell.playerTotal >= 2 && cell.playerTotal <= 12) {
                item.put("playerTotal", cell.playerTotal);
            }
            if (cell.bankerTotal >= 2 && cell.bankerTotal <= 12) {
                item.put("bankerTotal", cell.bankerTotal);
            }
            arr.put(item);
        }
        JSObject payload = new JSObject();
        payload.put("itemsNewestFirst", arr);
        payload.put("isFullPlate", isFullPlate);
        instance.notifyListeners("bacboDetected", payload);
    }

    @PluginMethod
    public void openBrowser(PluginCall call) {
        String url = call.getString("url", "");
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.openIntegratedBrowser(url);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void closeBrowser(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.closeIntegratedBrowser();
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void setSplitRatio(PluginCall call) {
        float ratio = call.getFloat("browserWeight", 0.68f);
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.setBrowserSplitWeight(ratio);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void toggleCalibration(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.toggleCalibrationOverlay();
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void setAutoScan(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.setAutoScanEnabled(enabled);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void scanNow(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.triggerImmediateScan();
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void setGameMode(PluginCall call) {
        String mode = call.getString("mode", "roulette");
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.setActiveGameMode(mode);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }
}
