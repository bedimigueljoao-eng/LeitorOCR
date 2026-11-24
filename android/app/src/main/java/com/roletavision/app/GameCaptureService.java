package com.roletavision.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;

import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Serviço foreground unificado para Roleta, Bac Bo e Aviator usando MediaProjection + ImageReader.
 * - Intervalo configurável (mínimo 350 ms, padrão 550 ms)
 * - Filtro de alteração na ROI (dHash 64-bit + luminância média) descartando frames iguais
 * - Fila de slot único com descarte de frames antigos (zero backlog)
 * - Notificação dinâmica com estado atual do jogo e último resultado
 * - Gravação automática em SQLite local (GameHistoryDb)
 */
public class GameCaptureService extends Service {

    public static final String ACTION_START = "com.roletavision.app.ACTION_START_GAME_CAPTURE";
    public static final String ACTION_STOP = "com.roletavision.app.ACTION_STOP_GAME_CAPTURE";
    public static final String ACTION_SET_INTERVAL = "com.roletavision.app.ACTION_SET_CAPTURE_INTERVAL";
    public static final String ACTION_SET_MODE = "com.roletavision.app.ACTION_SET_CAPTURE_MODE";
    public static final String ACTION_UPDATE_CONFIG = "com.roletavision.app.ACTION_UPDATE_CAPTURE_CONFIG";

    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_INTERVAL_MS = "intervalMs";
    public static final String EXTRA_GAME_MODE = "gameMode";
    public static final String EXTRA_SITE_KEY = "siteKey";

    private static final String CHANNEL_ID = "game_capture_channel";
    private static final int NOTIFICATION_ID = 3042;
    private static final long MIN_INTERVAL_MS = 350L;
    private static final long DEFAULT_INTERVAL_MS = 550L;
    private static final long MAX_INTERVAL_MS = 2000L;
    private static final long FORCE_HEARTBEAT_SCAN_MS = 3500L;
    private static final long NOTIFICATION_UPDATE_MIN_MS = 1200L;

    private static volatile boolean running = false;
    private static volatile long captureIntervalMs = DEFAULT_INTERVAL_MS;
    private static volatile String activeGameMode = RoiConfigStore.GAME_ROULETTE;
    private static volatile String activeSiteKey = "kwanzabet";

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ScreenScanner scanner = new ScreenScanner();

    private RoiConfigStore configStore;
    private GameHistoryDb historyDb;

    private int captureWidth = 720;
    private int captureHeight = 1280;
    private int captureDpi = 320;

    private final AtomicBoolean processingFrame = new AtomicBoolean(false);
    private Bitmap pendingBitmap = null;
    private final Object pendingLock = new Object();

    private long lastProcessedAtMs = 0L;
    private long lastFullScanAtMs = 0L;
    private ScreenScanner.RoiFrameSignature lastRoiSig = null;
    private int skippedUnchangedFrames = 0;
    private int totalReadTicks = 0;
    private int consecutiveFailures = 0;

    private long lastNotificationUpdateMs = 0L;
    private String lastNotificationStatus = "Captura ativa em segundo plano";

    // Deduplicação leve em memória para evitar gravar o mesmo resultado contínuo
    private Integer lastSavedRouletteHead = null;
    private String lastSavedBacBoSig = null;
    private Double lastSavedAviatorLive = null;
    private boolean wasAviatorFlying = false;

    public static boolean isServiceRunning() {
        return running;
    }

    public static long getCurrentIntervalMs() {
        return captureIntervalMs;
    }

    public static String getActiveGameMode() {
        return activeGameMode;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        configStore = new RoiConfigStore(this);
        historyDb = GameHistoryDb.getInstance(this);
        createNotificationChannel();
        captureThread = new HandlerThread("GameCaptureThread");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        if (ACTION_SET_INTERVAL.equals(action)) {
            long interval = intent.getLongExtra(EXTRA_INTERVAL_MS, DEFAULT_INTERVAL_MS);
            captureIntervalMs = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, interval));
            BrowserScannerPlugin.emitCaptureStatus(running, captureIntervalMs, activeGameMode, activeSiteKey, "granted", "");
            return START_STICKY;
        }

        if (ACTION_SET_MODE.equals(action) || ACTION_UPDATE_CONFIG.equals(action)) {
            String gm = intent.getStringExtra(EXTRA_GAME_MODE);
            if (gm != null) activeGameMode = RoiConfigStore.normalizeGame(gm);
            String site = intent.getStringExtra(EXTRA_SITE_KEY);
            if (site != null) activeSiteKey = RoiConfigStore.normalizeSite(site);
            lastRoiSig = null;
            updateNotification("A monitorizar " + formatGameTitle(activeGameMode) + " (" + activeSiteKey + ")…", true);
            BrowserScannerPlugin.emitCaptureStatus(running, captureIntervalMs, activeGameMode, activeSiteKey, running ? "granted" : "idle", "");
            return START_STICKY;
        }

        if (ACTION_START.equals(action)) {
            long interval = intent.getLongExtra(EXTRA_INTERVAL_MS, DEFAULT_INTERVAL_MS);
            captureIntervalMs = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, interval));
            String gm = intent.getStringExtra(EXTRA_GAME_MODE);
            activeGameMode = RoiConfigStore.normalizeGame(gm != null && !gm.isEmpty() ? gm : activeGameMode);
            String site = intent.getStringExtra(EXTRA_SITE_KEY);
            activeSiteKey = RoiConfigStore.normalizeSite(site != null ? site : configStore.getActiveSite());
            lastRoiSig = null;

            startAsForeground("A ler " + formatGameTitle(activeGameMode) + " (" + activeSiteKey + ")…");

            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
            Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
            if (resultCode != Activity.RESULT_OK || resultData == null) {
                BrowserScannerPlugin.emitCaptureStatus(false, captureIntervalMs, activeGameMode, activeSiteKey, "denied", "Permissão de captura não concedida.");
                stopSelfSafely();
                return START_NOT_STICKY;
            }
            startProjection(resultCode, resultData);
        }

        return START_STICKY;
    }

    private void startAsForeground(String statusText) {
        Notification notification = buildNotification(statusText);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(String statusText) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        int pendingFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openAppIntent, pendingFlags);

        Intent stopIntent = new Intent(this, GameCaptureService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1, stopIntent, pendingFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("RoletaVision · " + formatGameTitle(activeGameMode))
                .setContentText(statusText)
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopPending)
                .build();
    }

    private void updateNotification(String statusText, boolean force) {
        long now = SystemClock.elapsedRealtime();
        if (!force && (now - lastNotificationUpdateMs) < NOTIFICATION_UPDATE_MIN_MS && statusText.equals(lastNotificationStatus)) {
            return;
        }
        lastNotificationUpdateMs = now;
        lastNotificationStatus = statusText;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification(statusText));
        }
    }

    private void startProjection(int resultCode, Intent resultData) {
        tearDownProjectionOnly();

        MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            BrowserScannerPlugin.emitCaptureStatus(false, captureIntervalMs, activeGameMode, activeSiteKey, "denied", "MediaProjection indisponível.");
            stopSelfSafely();
            return;
        }

        mediaProjection = manager.getMediaProjection(resultCode, resultData);
        if (mediaProjection == null) {
            BrowserScannerPlugin.emitCaptureStatus(false, captureIntervalMs, activeGameMode, activeSiteKey, "denied", "Falha ao iniciar MediaProjection.");
            stopSelfSafely();
            return;
        }

        mediaProjection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                mainHandler.post(() -> stopSelfSafely());
            }
        }, mainHandler);

        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        if (wm != null && wm.getDefaultDisplay() != null) {
            wm.getDefaultDisplay().getRealMetrics(metrics);
        }
        int rawW = metrics.widthPixels > 0 ? metrics.widthPixels : 1080;
        int rawH = metrics.heightPixels > 0 ? metrics.heightPixels : 1920;
        captureDpi = metrics.densityDpi > 0 ? metrics.densityDpi : 320;

        float scale = rawW > 720 ? 720f / rawW : 1f;
        captureWidth = Math.max(360, Math.round(rawW * scale));
        captureHeight = Math.max(640, Math.round(rawH * scale));

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(this::handleImageAvailable, captureHandler);

        virtualDisplay = mediaProjection.createVirtualDisplay(
                "RoletaVisionUnifiedCapture",
                captureWidth,
                captureHeight,
                captureDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                captureHandler
        );

        running = true;
        BrowserScannerPlugin.emitCaptureStatus(true, captureIntervalMs, activeGameMode, activeSiteKey, "granted", "");
    }

    private void handleImageAvailable(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;

            long now = SystemClock.elapsedRealtime();
            if ((now - lastProcessedAtMs) < captureIntervalMs) {
                return;
            }

            Bitmap bitmap = imageToBitmap(image);
            if (bitmap == null) return;

            // Fila de slot único com descarte de frame antigo
            synchronized (pendingLock) {
                if (pendingBitmap != null && !pendingBitmap.isRecycled()) {
                    pendingBitmap.recycle();
                }
                pendingBitmap = bitmap;
            }

            drainNextFrameIfIdle();
        } catch (Exception ignored) {
        } finally {
            if (image != null) {
                image.close();
            }
        }
    }

    private void drainNextFrameIfIdle() {
        if (!processingFrame.compareAndSet(false, true)) {
            return;
        }
        Bitmap frame;
        synchronized (pendingLock) {
            frame = pendingBitmap;
            pendingBitmap = null;
        }
        if (frame == null || frame.isRecycled()) {
            processingFrame.set(false);
            return;
        }

        long now = SystemClock.elapsedRealtime();
        RoiConfigStore.RoiRect roi = configStore.getRoiRect(activeGameMode, activeSiteKey);
        ScreenScanner.RoiFrameSignature sig = ScreenScanner.computeRoiSignature(frame, roi);

        boolean changed = ScreenScanner.hasSignificantRoiChange(lastRoiSig, sig);
        boolean heartbeatDue = (now - lastFullScanAtMs) >= FORCE_HEARTBEAT_SCAN_MS;
        if (!changed && !heartbeatDue) {
            skippedUnchangedFrames++;
            frame.recycle();
            lastProcessedAtMs = now;
            processingFrame.set(false);
            return;
        }

        lastRoiSig = sig;
        lastProcessedAtMs = now;
        lastFullScanAtMs = now;

        dispatchOcrForGame(frame, roi, System.currentTimeMillis());
    }

    private void dispatchOcrForGame(
            Bitmap frame,
            RoiConfigStore.RoiRect roi,
            long scanStartMs
    ) {
        String site = activeSiteKey;
        RoiConfigStore.HsvColorProfile profile = configStore.getHsvProfile(site);
        boolean collectDebug = configStore.isDebugOverlayEnabled();

        if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
            String bbMode = configStore.getBacBoScanMode();
            scanner.scanBacBoFrame(frame, roi, bbMode, profile, collectDebug, (pTotal, bTotal, blocksVisible, plateCells, confidence, resolvedMode, debugBoxes, ocrOk) -> {
                frame.recycle();
                long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
                totalReadTicks++;

                boolean hasScore = pTotal >= 2 && bTotal >= 2;
                int stripSize = plateCells != null ? plateCells.size() : 0;
                boolean hasSignal = ocrOk && (hasScore || blocksVisible || stripSize >= 4);
                consecutiveFailures = hasSignal ? 0 : consecutiveFailures + 1;

                int headVal = hasScore ? Math.max(pTotal, bTotal) : (stripSize > 0 ? plateCells.get(0).total : -1);
                BrowserScannerPlugin.emitScanTelemetry(headVal, elapsedMs, hasSignal, consecutiveFailures, hasScore ? 2 : stripSize, totalReadTicks);
                if (collectDebug) {
                    BrowserScannerPlugin.emitDebugOverlay(activeGameMode, resolvedMode, confidence, debugBoxes);
                }

                if (hasScore) {
                    String outcome = pTotal > bTotal ? "P" : (bTotal > pTotal ? "B" : "T");
                    String sig = outcome + ":" + pTotal + "x" + bTotal;
                    if (!sig.equals(lastSavedBacBoSig)) {
                        lastSavedBacBoSig = sig;
                        historyDb.insertBacBoResult(System.currentTimeMillis(), site, outcome, pTotal, bTotal, resolvedMode, confidence, "media_projection");
                    }
                    ScreenScanner.BacBoCell cell = new ScreenScanner.BacBoCell(outcome, Math.max(pTotal, bTotal), 0, 0, 0);
                    cell.playerTotal = pTotal;
                    cell.bankerTotal = bTotal;
                    BrowserScannerPlugin.emitBacBo(Collections.singletonList(cell), false);
                    updateNotification("Bac Bo estável · JOGADOR " + pTotal + " × " + bTotal + " BANCA", false);
                } else if (stripSize >= 4) {
                    ScreenScanner.BacBoCell head = plateCells.get(0);
                    String sig = head.signature() + ":" + stripSize;
                    if (!sig.equals(lastSavedBacBoSig)) {
                        lastSavedBacBoSig = sig;
                        historyDb.insertBacBoResult(System.currentTimeMillis(), site, head.outcome, -1, -1, resolvedMode, confidence, "media_projection");
                    }
                    BrowserScannerPlugin.emitBacBo(plateCells, true);
                    updateNotification("Bac Bo Bead Plate · " + stripSize + " células lidas", false);
                } else {
                    updateNotification("A ler Bac Bo (" + resolvedMode + ")…", false);
                }

                finishFrameCycle();
            });
            return;
        }

        if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
            scanner.scanAviatorFrame(frame, roi, profile, collectDebug, (liveMult, isCrashedColor, historyNewestFirst, confidence, debugBoxes, ocrOk) -> {
                frame.recycle();
                long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
                totalReadTicks++;

                consecutiveFailures = ocrOk ? 0 : consecutiveFailures + 1;
                int stripCount = historyNewestFirst != null ? historyNewestFirst.size() : 0;
                int telemetryVal = liveMult >= 1.0 ? (int) Math.round(liveMult * 100) : -1;
                BrowserScannerPlugin.emitScanTelemetry(telemetryVal, elapsedMs, ocrOk, consecutiveFailures, stripCount, totalReadTicks);
                if (collectDebug) {
                    BrowserScannerPlugin.emitDebugOverlay(activeGameMode, "aviator", confidence, debugBoxes);
                }

                if (ocrOk) {
                    BrowserScannerPlugin.emitAviator(
                            liveMult,
                            isCrashedColor,
                            historyNewestFirst,
                            stripCount >= 3,
                            confidence,
                            "media_projection"
                    );
                    if (liveMult >= 1.0 && isCrashedColor) {
                        if (wasAviatorFlying || lastSavedAviatorLive == null || Math.abs(lastSavedAviatorLive - liveMult) > 0.01) {
                            historyDb.insertAviatorCrash(System.currentTimeMillis(), site, liveMult, true, confidence, "media_projection");
                            lastSavedAviatorLive = liveMult;
                            wasAviatorFlying = false;
                        }
                        updateNotification(String.format(Locale.US, "Aviator — último crash %.2fx", liveMult), false);
                    } else if (liveMult >= 1.0) {
                        wasAviatorFlying = true;
                        updateNotification(String.format(Locale.US, "Aviator a voar · %.2fx", liveMult), false);
                    } else if (stripCount > 0) {
                        updateNotification(String.format(Locale.US, "Aviator — último crash %.2fx", historyNewestFirst.get(0)), false);
                    }
                }
                finishFrameCycle();
            });
            return;
        }

        // Default: Roleta
        scanner.scanRouletteFrame(frame, roi, profile, collectDebug, (numbersNewestFirst, avgConfidence, timestampMs, debugBoxes, hsvSamples, ocrOk) -> {
            frame.recycle();
            long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
            totalReadTicks++;

            int stripCount = numbersNewestFirst != null ? numbersNewestFirst.size() : 0;
            boolean hasSignal = ocrOk && stripCount > 0;
            consecutiveFailures = hasSignal ? 0 : consecutiveFailures + 1;

            int head = hasSignal ? numbersNewestFirst.get(0) : -1;
            BrowserScannerPlugin.emitScanTelemetry(head, elapsedMs, hasSignal, consecutiveFailures, stripCount, totalReadTicks);
            if (collectDebug) {
                BrowserScannerPlugin.emitDebugOverlay(activeGameMode, "roulette", avgConfidence, debugBoxes);
            }

            if (stripCount >= 3) {
                if (lastSavedRouletteHead == null || !lastSavedRouletteHead.equals(head)) {
                    lastSavedRouletteHead = head;
                    historyDb.insertRouletteResult(timestampMs, site, numbersNewestFirst, avgConfidence, "media_projection");
                }
                BrowserScannerPlugin.emitSpins(numbersNewestFirst, true);
                updateNotification(String.format(Locale.US, "A ler Roleta… último: %d (conf %.0f%%)", head, avgConfidence * 100f), false);
            } else {
                updateNotification("A ler Roleta (" + site + ")…", false);
            }
            finishFrameCycle();
        });
    }

    private void finishFrameCycle() {
        processingFrame.set(false);
        boolean hasQueued;
        synchronized (pendingLock) {
            hasQueued = pendingBitmap != null && !pendingBitmap.isRecycled();
        }
        if (hasQueued && captureHandler != null) {
            captureHandler.post(this::drainNextFrameIfIdle);
        }
    }

    private Bitmap imageToBitmap(Image image) {
        Image.Plane[] planes = image.getPlanes();
        if (planes == null || planes.length == 0) return null;

        ByteBuffer buffer = planes[0].getBuffer();
        buffer.rewind();
        int pixelStride = planes[0].getPixelStride();
        int rowStride = planes[0].getRowStride();
        int rowPadding = rowStride - pixelStride * captureWidth;
        int bitmapW = captureWidth + Math.max(0, rowPadding / Math.max(1, pixelStride));

        if (bitmapW == captureWidth || buffer.remaining() >= bitmapW * captureHeight * 4) {
            Bitmap fullBitmap = Bitmap.createBitmap(bitmapW, captureHeight, Bitmap.Config.ARGB_8888);
            fullBitmap.copyPixelsFromBuffer(buffer);
            if (bitmapW != captureWidth) {
                Bitmap cropped = Bitmap.createBitmap(fullBitmap, 0, 0, captureWidth, captureHeight);
                fullBitmap.recycle();
                return cropped;
            }
            return fullBitmap;
        }

        byte[] cleanBytes = new byte[captureWidth * captureHeight * 4];
        byte[] rowBytes = new byte[captureWidth * 4];
        for (int y = 0; y < captureHeight; y++) {
            int pos = y * rowStride;
            if (pos + rowBytes.length <= buffer.limit()) {
                buffer.position(pos);
                buffer.get(rowBytes, 0, rowBytes.length);
                System.arraycopy(rowBytes, 0, cleanBytes, y * rowBytes.length, rowBytes.length);
            }
        }
        Bitmap out = Bitmap.createBitmap(captureWidth, captureHeight, Bitmap.Config.ARGB_8888);
        out.copyPixelsFromBuffer(ByteBuffer.wrap(cleanBytes));
        return out;
    }

    private String formatGameTitle(String mode) {
        if (RoiConfigStore.GAME_BACBO.equals(mode)) return "Bac Bo";
        if (RoiConfigStore.GAME_AVIATOR.equals(mode)) return "Aviator";
        return "Roleta";
    }

    private void tearDownProjectionOnly() {
        running = false;
        processingFrame.set(false);
        synchronized (pendingLock) {
            if (pendingBitmap != null && !pendingBitmap.isRecycled()) {
                pendingBitmap.recycle();
            }
            pendingBitmap = null;
        }
        if (virtualDisplay != null) {
            try {
                virtualDisplay.release();
            } catch (Exception ignored) {
            }
            virtualDisplay = null;
        }
        if (imageReader != null) {
            try {
                imageReader.setOnImageAvailableListener(null, null);
                imageReader.close();
            } catch (Exception ignored) {
            }
            imageReader = null;
        }
        if (mediaProjection != null) {
            try {
                mediaProjection.stop();
            } catch (Exception ignored) {
            }
            mediaProjection = null;
        }
    }

    private void stopSelfSafely() {
        tearDownProjectionOnly();
        BrowserScannerPlugin.emitCaptureStatus(false, captureIntervalMs, activeGameMode, activeSiteKey, "idle", "");
        stopForeground(true);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Monitorização RoletaVision",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Captura autorizada em tempo real para Roleta, Bac Bo e Aviator");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        tearDownProjectionOnly();
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
