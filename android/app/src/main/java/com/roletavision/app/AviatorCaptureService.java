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

public class AviatorCaptureService extends Service {

    public static final String ACTION_START = "com.roletavision.app.ACTION_START_AVIATOR_CAPTURE";
    public static final String ACTION_STOP = "com.roletavision.app.ACTION_STOP_AVIATOR_CAPTURE";
    public static final String ACTION_SET_INTERVAL = "com.roletavision.app.ACTION_SET_INTERVAL";
    public static final String ACTION_UPDATE_ROI = "com.roletavision.app.ACTION_UPDATE_ROI";

    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_INTERVAL_MS = "intervalMs";
    public static final String EXTRA_ROI_TOP = "roiTop";
    public static final String EXTRA_ROI_HEIGHT = "roiHeight";

    private static final String CHANNEL_ID = "aviator_capture_channel";
    private static final int NOTIFICATION_ID = 3042;

    private static volatile boolean running = false;
    private static volatile long captureIntervalMs = 550L;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ScreenScanner scanner = new ScreenScanner();

    private int captureWidth = 720;
    private int captureHeight = 1280;
    private int captureDpi = 320;
    private float roiTopRatio = 0.14f;
    private float roiHeightRatio = 0.34f;
    private volatile boolean processingFrame = false;
    private long lastProcessedAtMs = 0L;

    public static boolean isServiceRunning() {
        return running;
    }

    public static long getCurrentIntervalMs() {
        return captureIntervalMs;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        captureThread = new HandlerThread("AviatorCaptureThread");
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
            long interval = intent.getLongExtra(EXTRA_INTERVAL_MS, 550L);
            captureIntervalMs = Math.max(350L, Math.min(2000L, interval));
            BrowserScannerPlugin.emitAviatorCaptureStatus(running, captureIntervalMs, "granted", "");
            return START_STICKY;
        }

        if (ACTION_UPDATE_ROI.equals(action)) {
            roiTopRatio = intent.getFloatExtra(EXTRA_ROI_TOP, roiTopRatio);
            roiHeightRatio = intent.getFloatExtra(EXTRA_ROI_HEIGHT, roiHeightRatio);
            return START_STICKY;
        }

        if (ACTION_START.equals(action)) {
            long interval = intent.getLongExtra(EXTRA_INTERVAL_MS, 550L);
            captureIntervalMs = Math.max(350L, Math.min(2000L, interval));
            roiTopRatio = intent.getFloatExtra(EXTRA_ROI_TOP, 0.14f);
            roiHeightRatio = intent.getFloatExtra(EXTRA_ROI_HEIGHT, 0.34f);

            startAsForeground();

            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
            Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
            if (resultCode != Activity.RESULT_OK || resultData == null) {
                BrowserScannerPlugin.emitAviatorCaptureStatus(false, captureIntervalMs, "denied", "Permissão de captura não concedida.");
                stopSelfSafely();
                return START_NOT_STICKY;
            }

            startProjection(resultCode, resultData);
        }

        return START_STICKY;
    }

    private void startAsForeground() {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        int pendingFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openAppIntent, pendingFlags);

        Intent stopIntent = new Intent(this, AviatorCaptureService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1, stopIntent, pendingFlags);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("RoletaVision · Aviator Intelligence")
                .setContentText("Monitorização de ecrã autorizada ativa (OCR local)")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopPending)
                .build();

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

    private void startProjection(int resultCode, Intent resultData) {
        tearDownProjectionOnly();

        MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            BrowserScannerPlugin.emitAviatorCaptureStatus(false, captureIntervalMs, "denied", "MediaProjection indisponível.");
            stopSelfSafely();
            return;
        }

        mediaProjection = manager.getMediaProjection(resultCode, resultData);
        if (mediaProjection == null) {
            BrowserScannerPlugin.emitAviatorCaptureStatus(false, captureIntervalMs, "denied", "Falha ao iniciar MediaProjection.");
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

        // Redimensionamento eficiente para poupar CPU/bateria mantendo legibilidade OCR
        float scale = rawW > 720 ? 720f / rawW : 1f;
        captureWidth = Math.max(360, Math.round(rawW * scale));
        captureHeight = Math.max(640, Math.round(rawH * scale));

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(reader -> handleImageAvailable(reader), captureHandler);

        virtualDisplay = mediaProjection.createVirtualDisplay(
                "RoletaVisionAviatorCapture",
                captureWidth,
                captureHeight,
                captureDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                captureHandler
        );

        running = true;
        BrowserScannerPlugin.emitAviatorCaptureStatus(true, captureIntervalMs, "granted", "");
    }

    private void handleImageAvailable(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;

            long now = SystemClock.elapsedRealtime();
            if (processingFrame || (now - lastProcessedAtMs) < captureIntervalMs) {
                return;
            }

            Image.Plane[] planes = image.getPlanes();
            if (planes == null || planes.length == 0) return;

            ByteBuffer buffer = planes[0].getBuffer();
            buffer.rewind();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * captureWidth;
            int bitmapW = captureWidth + Math.max(0, rowPadding / Math.max(1, pixelStride));

            Bitmap croppedWidth;
            if (bitmapW == captureWidth || buffer.remaining() >= bitmapW * captureHeight * 4) {
                Bitmap fullBitmap = Bitmap.createBitmap(bitmapW, captureHeight, Bitmap.Config.ARGB_8888);
                fullBitmap.copyPixelsFromBuffer(buffer);
                croppedWidth = bitmapW != captureWidth
                        ? Bitmap.createBitmap(fullBitmap, 0, 0, captureWidth, captureHeight)
                        : fullBitmap;
                if (croppedWidth != fullBitmap) {
                    fullBitmap.recycle();
                }
            } else {
                // Copia linha a linha quando a última linha do buffer não inclui rowPadding
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
                croppedWidth = Bitmap.createBitmap(captureWidth, captureHeight, Bitmap.Config.ARGB_8888);
                croppedWidth.copyPixelsFromBuffer(ByteBuffer.wrap(cleanBytes));
            }

            processingFrame = true;
            lastProcessedAtMs = now;
            final long startMs = System.currentTimeMillis();

            scanner.scanAviatorFrame(
                    croppedWidth,
                    roiTopRatio,
                    roiHeightRatio,
                    (liveMultiplier, isCrashedColor, historyNewestFirst, confidence, ocrOk) -> {
                        croppedWidth.recycle();
                        processingFrame = false;

                        long elapsedMs = Math.max(1L, System.currentTimeMillis() - startMs);
                        BrowserScannerPlugin.emitScanTelemetry(
                                liveMultiplier >= 1.0 ? (int) Math.round(liveMultiplier * 100) : -1,
                                elapsedMs,
                                ocrOk,
                                ocrOk ? 0 : 1,
                                historyNewestFirst != null ? historyNewestFirst.size() : 0,
                                1
                        );

                        if (ocrOk) {
                            BrowserScannerPlugin.emitAviator(
                                    liveMultiplier,
                                    isCrashedColor,
                                    historyNewestFirst,
                                    historyNewestFirst != null && historyNewestFirst.size() >= 3,
                                    confidence,
                                    "media_projection"
                            );
                        }
                    }
            );
        } catch (Exception e) {
            processingFrame = false;
        } finally {
            if (image != null) {
                image.close();
            }
        }
    }

    private void tearDownProjectionOnly() {
        running = false;
        processingFrame = false;
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
        BrowserScannerPlugin.emitAviatorCaptureStatus(false, captureIntervalMs, "idle", "");
        stopForeground(true);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Monitorização Aviator",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Captura autorizada de ecrã para leitura estatística do Aviator");
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
