package com.roletavision.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
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
            item.put("colorFallback", cell.colorFallback);
            arr.put(item);
        }
        JSObject payload = new JSObject();
        payload.put("itemsNewestFirst", arr);
        payload.put("isFullPlate", isFullPlate);
        instance.notifyListeners("bacboDetected", payload);
    }

    public static void emitAviator(
            double liveMultiplier,
            boolean isCrashedColor,
            List<Double> historyNewestFirst,
            boolean isFullStrip,
            float ocrConfidence,
            String source
    ) {
        if (instance == null) return;
        JSArray arr = new JSArray();
        if (historyNewestFirst != null) {
            for (Double mult : historyNewestFirst) {
                arr.put(mult);
            }
        }
        JSObject payload = new JSObject();
        payload.put("liveMultiplier", liveMultiplier);
        payload.put("isCrashedColor", isCrashedColor);
        payload.put("historyNewestFirst", arr);
        payload.put("isFullStrip", isFullStrip);
        payload.put("ocrConfidence", ocrConfidence);
        payload.put("source", source != null ? source : "integrated_browser");
        instance.notifyListeners("aviatorDetected", payload);
    }

    public static void emitAviatorCaptureStatus(
            boolean mediaProjectionActive,
            long captureIntervalMs,
            String permissionState,
            String error
    ) {
        if (instance == null) return;
        JSObject payload = new JSObject();
        payload.put("mediaProjectionActive", mediaProjectionActive);
        payload.put("captureIntervalMs", captureIntervalMs);
        payload.put("permissionState", permissionState != null ? permissionState : "idle");
        payload.put("error", error != null ? error : "");
        instance.notifyListeners("aviatorCaptureStatus", payload);
    }

    public static void emitCaptureStatus(
            boolean mediaProjectionActive,
            long captureIntervalMs,
            String gameMode,
            String siteKey,
            String permissionState,
            String error
    ) {
        emitAviatorCaptureStatus(mediaProjectionActive, captureIntervalMs, permissionState, error);
        if (instance == null) return;
        JSObject payload = new JSObject();
        payload.put("mediaProjectionActive", mediaProjectionActive);
        payload.put("captureIntervalMs", captureIntervalMs);
        payload.put("gameMode", gameMode != null ? gameMode : "roulette");
        payload.put("siteKey", siteKey != null ? siteKey : "kwanzabet");
        payload.put("permissionState", permissionState != null ? permissionState : "idle");
        payload.put("error", error != null ? error : "");
        instance.notifyListeners("captureStatus", payload);
    }

    public static void emitDebugOverlay(
            String gameMode,
            String resolvedMode,
            float confidence,
            List<ScreenScanner.OcrDebugBox> boxes
    ) {
        if (instance == null) return;
        JSArray arr = new JSArray();
        if (boxes != null) {
            for (ScreenScanner.OcrDebugBox b : boxes) {
                JSObject obj = new JSObject();
                obj.put("leftRatio", b.leftRatio);
                obj.put("topRatio", b.topRatio);
                obj.put("rightRatio", b.rightRatio);
                obj.put("bottomRatio", b.bottomRatio);
                obj.put("text", b.text);
                obj.put("colorLabel", b.colorLabel);
                obj.put("accepted", b.accepted);
                obj.put("reason", b.reason);
                arr.put(obj);
            }
        }
        JSObject payload = new JSObject();
        payload.put("gameMode", gameMode != null ? gameMode : "roulette");
        payload.put("resolvedMode", resolvedMode != null ? resolvedMode : "");
        payload.put("confidence", confidence);
        payload.put("timestampMs", System.currentTimeMillis());
        payload.put("boxes", arr);
        instance.notifyListeners("ocrDebugOverlay", payload);
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
        float ratio = call.getFloat("browserWeight", 0.56f);
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

    @PluginMethod
    public void setBacBoScanMode(PluginCall call) {
        String mode = call.getString("mode", RoiConfigStore.BACBO_MODE_AUTO);
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.setBacBoScanMode(mode);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void setSiteProfile(PluginCall call) {
        String site = call.getString("site", "kwanzabet");
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.setActiveSiteProfile(site);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void saveRoiRect(PluginCall call) {
        String game = call.getString("game", "roulette");
        String site = call.getString("site", "kwanzabet");
        float left = call.getFloat("leftRatio", 0f);
        float top = call.getFloat("topRatio", 0.04f);
        float width = call.getFloat("widthRatio", 1f);
        float height = call.getFloat("heightRatio", 0.08f);
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.saveRoiRectForSite(game, site, left, top, width, height);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void getRoiRect(PluginCall call) {
        String game = call.getString("game", "roulette");
        String site = call.getString("site", "kwanzabet");
        RoiConfigStore store = new RoiConfigStore(getContext());
        RoiConfigStore.RoiRect rect = store.getRoiRect(game, site);
        JSObject res = new JSObject();
        res.put("leftRatio", rect.leftRatio);
        res.put("topRatio", rect.topRatio);
        res.put("widthRatio", rect.widthRatio);
        res.put("heightRatio", rect.heightRatio);
        call.resolve(res);
    }

    @PluginMethod
    public void getHsvProfile(PluginCall call) {
        String site = call.getString("site", "kwanzabet");
        RoiConfigStore store = new RoiConfigStore(getContext());
        RoiConfigStore.HsvColorProfile profile = store.getHsvProfile(site);
        try {
            call.resolve(JSObject.fromJSONObject(profile.toJson()));
        } catch (Exception e) {
            call.reject("Failed to serialize HSV profile");
        }
    }

    @PluginMethod
    public void calibrateHsvProfile(PluginCall call) {
        String site = call.getString("site", "kwanzabet");
        JSArray arr = call.getArray("samples");
        List<RoiConfigStore.HsvSample> samples = new ArrayList<>();
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                String label = item.optString("label", "");
                if (item.has("r") && item.has("g") && item.has("b")) {
                    samples.add(RoiConfigStore.HsvSample.fromRgb(
                            label,
                            item.optInt("r", 0),
                            item.optInt("g", 0),
                            item.optInt("b", 0)
                    ));
                } else if (item.has("hue")) {
                    samples.add(new RoiConfigStore.HsvSample(
                            label,
                            (float) item.optDouble("hue", 0),
                            (float) item.optDouble("sat", 0.5),
                            (float) item.optDouble("val", 0.5)
                    ));
                }
            }
        }
        RoiConfigStore store = new RoiConfigStore(getContext());
        RoiConfigStore.HsvColorProfile updated = store.calibrateFromSamples(site, samples);
        try {
            call.resolve(JSObject.fromJSONObject(updated.toJson()));
        } catch (Exception e) {
            call.reject("Failed to calibrate HSV profile");
        }
    }

    @PluginMethod
    public void resetHsvProfile(PluginCall call) {
        String site = call.getString("site", "kwanzabet");
        RoiConfigStore store = new RoiConfigStore(getContext());
        store.resetHsvProfile(site);
        try {
            call.resolve(JSObject.fromJSONObject(store.getHsvProfile(site).toJson()));
        } catch (Exception e) {
            call.reject("Failed to reset HSV profile");
        }
    }

    @PluginMethod
    public void setDebugOverlay(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.setDebugOverlayEnabled(enabled);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void getDbHistory(PluginCall call) {
        String game = call.getString("game", "roulette");
        int limit = call.getInt("limit", 120);
        JSONArray rows = GameHistoryDb.getInstance(getContext()).queryRecent(game, limit);
        JSObject res = new JSObject();
        try {
            JSArray arr = new JSArray();
            for (int i = 0; i < rows.length(); i++) {
                arr.put(rows.get(i));
            }
            res.put("rows", arr);
            call.resolve(res);
        } catch (Exception e) {
            res.put("rows", new JSArray());
            call.resolve(res);
        }
    }

    @PluginMethod
    public void exportDbCsv(PluginCall call) {
        String game = call.getString("game", "roulette");
        String csv = GameHistoryDb.getInstance(getContext()).exportCsv(game);
        JSObject res = new JSObject();
        res.put("csv", csv);
        call.resolve(res);
    }

    @PluginMethod
    public void clearDbHistory(PluginCall call) {
        String game = call.getString("game", "roulette");
        GameHistoryDb.getInstance(getContext()).clearGame(game);
        call.resolve();
    }

    @PluginMethod
    public void startMediaProjection(PluginCall call) {
        int interval = call.getInt("intervalMs", 550);
        String gameMode = call.getString("gameMode", "");
        String siteKey = call.getString("siteKey", "");
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.requestUnifiedScreenCapturePermission(interval, gameMode, siteKey);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void stopMediaProjection(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.stopUnifiedScreenCaptureService();
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void setCaptureIntervalMs(PluginCall call) {
        int interval = call.getInt("intervalMs", 550);
        if (getActivity() instanceof MainActivity) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.updateUnifiedCaptureInterval(interval);
                call.resolve();
            });
        } else {
            call.reject("MainActivity unavailable");
        }
    }

    @PluginMethod
    public void getCaptureStatus(PluginCall call) {
        RoiConfigStore store = new RoiConfigStore(getContext());
        JSObject res = new JSObject();
        res.put("mediaProjectionActive", GameCaptureService.isServiceRunning());
        res.put("captureIntervalMs", GameCaptureService.getCurrentIntervalMs());
        res.put("gameMode", GameCaptureService.getActiveGameMode());
        res.put("siteKey", store.getActiveSite());
        res.put("bacBoScanMode", store.getBacBoScanMode());
        res.put("debugOverlayEnabled", store.isDebugOverlayEnabled());
        call.resolve(res);
    }
}
