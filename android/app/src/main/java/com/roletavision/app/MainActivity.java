package com.roletavision.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private static final String DEFAULT_URL = "https://www.kwanzabet.ao";
    private static final long SPLIT_HEARTBEAT_SCAN_MS = 1100L;

    private LinearLayout browserPanel;
    private LinearLayout urlBar;
    private FrameLayout browserFrame;
    private WebView browserWebView;
    private ProgressBar browserProgressBar;
    private LinearLayout browserErrorBar;
    private TextView tvBrowserError;
    private EditText etUrl;
    private FrameLayout roiOverlay;
    private DebugBoxesView debugBoxesView;
    private LinearLayout calibrationBar;
    private LinearLayout roulettePresetRow;
    private LinearLayout bacboPresetRow;
    private TextView tvCalibTitle;
    private TextView tvCalibCoords;
    private TextView tvCalibStatus;
    private SeekBar seekRoiLeft;
    private SeekBar seekRoiTop;
    private SeekBar seekRoiWidth;
    private SeekBar seekRoiHeight;
    private Button btnScanToggle;
    private Button btnBacBoMode;
    private Button btnDebugToggle;
    private Button btnRouletteDir;
    private Button btnRouletteMult;

    private View capacitorWebView;
    private float browserSplitWeight = 0.56f;

    private final ScreenScanner scanner = new ScreenScanner();
    private final RouletteStripReconciler rouletteReconciler = new RouletteStripReconciler();
    private final BacBoReconciler bacBoReconciler = new BacBoReconciler();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private RoiConfigStore configStore;
    private GameHistoryDb historyDb;

    private boolean browserVisible = false;
    private boolean autoScanEnabled = true;
    private boolean isScanningFrame = false;
    private boolean hasLoadedInitialUrl = false;
    private boolean isSyncingCalibSliders = false;
    private long activeScanStartMs = 0L;
    private int consecutiveFailures = 0;
    private int totalReadTicks = 0;

    private float roiLeftRatio = 0.0f;
    private float roiTopRatio = 0.04f;
    private float roiWidthRatio = 1.0f;
    private float roiHeightRatio = 0.08f;
    private String activeGameMode = RoiConfigStore.GAME_ROULETTE;
    private String activeSiteKey = "kwanzabet";
    private String bacBoScanMode = RoiConfigStore.BACBO_MODE_AUTO;
    private boolean rouletteNewestOnLeft = true;
    private boolean rouletteMultiplierMode = false;
    private boolean debugOverlayEnabled = false;
    private int captureIntervalMs = 350;

    private ScreenScanner.RoiFrameSignature lastSplitRoiSig = null;
    private long lastSplitFullScanMs = 0L;
    private Double lastSplitAviatorCrashSaved = null;

    private SharedPreferences prefs;
    private ActivityResultLauncher<Intent> mediaProjectionLauncher;
    private ActivityResultLauncher<String> notificationPermissionLauncher;

    private final Runnable scanRunnable = new Runnable() {
        @Override
        public void run() {
            if (isScanningFrame && (System.currentTimeMillis() - activeScanStartMs) > 1500L) {
                isScanningFrame = false;
            }
            if (browserVisible && autoScanEnabled && !isScanningFrame) {
                captureAndAnalyzeBrowser(false);
            }
            long delay = Math.max(350L, captureIntervalMs);
            handler.postDelayed(this, delay);
        }
    };

    private static class DebugBoxesView extends View {
        private final Paint boxPaint = new Paint();
        private final Paint textPaint = new Paint();
        private final Paint bgPaint = new Paint();
        private List<ScreenScanner.OcrDebugBox> boxes = Collections.emptyList();
        private float roiL = 0f, roiT = 0f, roiW = 1f, roiH = 1f;

        DebugBoxesView(Context ctx) {
            super(ctx);
            boxPaint.setStyle(Paint.Style.STROKE);
            boxPaint.setStrokeWidth(3f);
            textPaint.setColor(Color.WHITE);
            textPaint.setTextSize(26f);
            textPaint.setFakeBoldText(true);
            bgPaint.setColor(Color.parseColor("#CC0B0F17"));
        }

        void updateBoxes(RoiConfigStore.RoiRect roi, List<ScreenScanner.OcrDebugBox> next) {
            this.roiL = roi.leftRatio;
            this.roiT = roi.topRatio;
            this.roiW = roi.widthRatio;
            this.roiH = roi.heightRatio;
            this.boxes = next != null ? next : Collections.emptyList();
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (boxes.isEmpty()) return;
            int w = getWidth();
            int h = getHeight();
            float baseL = w * roiL;
            float baseT = h * roiT;
            float spanW = w * roiW;
            float spanH = h * roiH;
            for (ScreenScanner.OcrDebugBox b : boxes) {
                float left = baseL + b.leftRatio * spanW;
                float top = baseT + b.topRatio * spanH;
                float right = baseL + b.rightRatio * spanW;
                float bottom = baseT + b.bottomRatio * spanH;
                boxPaint.setColor(b.accepted ? Color.parseColor("#10B981") : Color.parseColor("#F59E0B"));
                canvas.drawRect(left, top, right, bottom, boxPaint);
                String label = b.text + (b.colorLabel.isEmpty() ? "" : " [" + b.colorLabel + "]");
                canvas.drawRect(left, Math.max(0f, top - 28f), left + Math.max(70f, label.length() * 14f), top, bgPaint);
                canvas.drawText(label, left + 4f, Math.max(22f, top - 6f), textPaint);
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BrowserScannerPlugin.class);

        notificationPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> launchSystemScreenCapturePrompt()
        );

        mediaProjectionLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                        Intent svcIntent = new Intent(this, GameCaptureService.class);
                        svcIntent.setAction(GameCaptureService.ACTION_START);
                        svcIntent.putExtra(GameCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
                        svcIntent.putExtra(GameCaptureService.EXTRA_RESULT_DATA, result.getData());
                        svcIntent.putExtra(GameCaptureService.EXTRA_INTERVAL_MS, (long) captureIntervalMs);
                        svcIntent.putExtra(GameCaptureService.EXTRA_GAME_MODE, activeGameMode);
                        svcIntent.putExtra(GameCaptureService.EXTRA_SITE_KEY, activeSiteKey);
                        ContextCompat.startForegroundService(this, svcIntent);
                    } else {
                        BrowserScannerPlugin.emitCaptureStatus(
                                false,
                                captureIntervalMs,
                                activeGameMode,
                                activeSiteKey,
                                "denied",
                                "Captura de ecrã recusada pelo utilizador."
                        );
                    }
                }
        );

        super.onCreate(savedInstanceState);

        configStore = new RoiConfigStore(this);
        historyDb = GameHistoryDb.getInstance(this);
        prefs = getSharedPreferences(RoiConfigStore.PREFS_NAME, MODE_PRIVATE);

        activeSiteKey = configStore.getActiveSite();
        bacBoScanMode = configStore.getBacBoScanMode();
        debugOverlayEnabled = configStore.isDebugOverlayEnabled();
        rouletteNewestOnLeft = configStore.isRouletteNewestOnLeft(activeSiteKey);
        rouletteMultiplierMode = configStore.isRouletteMultiplierMode(activeSiteKey);
        loadRoiForCurrentMode();

        setupIntegratedBrowserSplitLayout();
    }

    private void loadRoiForCurrentMode() {
        if (configStore == null) return;
        RoiConfigStore.RoiRect rect = configStore.getRoiRect(activeGameMode, activeSiteKey, RoiConfigStore.SURFACE_SPLIT);
        roiLeftRatio = rect.leftRatio;
        roiTopRatio = rect.topRatio;
        roiWidthRatio = rect.widthRatio;
        roiHeightRatio = rect.heightRatio;
        rouletteNewestOnLeft = configStore.isRouletteNewestOnLeft(activeSiteKey);
        rouletteMultiplierMode = configStore.isRouletteMultiplierMode(activeSiteKey);
        syncCalibrationUiFromState();
    }

    @Override
    public void onResume() {
        super.onResume();
        isScanningFrame = false;
        handler.removeCallbacks(scanRunnable);
        handler.postDelayed(scanRunnable, 1000L);
    }

    @Override
    public void onPause() {
        super.onPause();
        handler.removeCallbacks(scanRunnable);
    }

    @Override
    public void onBackPressed() {
        if (browserVisible && browserWebView != null && browserWebView.canGoBack()) {
            browserWebView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupIntegratedBrowserSplitLayout() {
        capacitorWebView = this.bridge.getWebView();
        if (capacitorWebView == null || !(capacitorWebView.getParent() instanceof ViewGroup)) {
            return;
        }

        ViewGroup parent = (ViewGroup) capacitorWebView.getParent();
        ViewGroup.LayoutParams originalCapLp = capacitorWebView.getLayoutParams();
        parent.removeView(capacitorWebView);

        LinearLayout splitRoot = new LinearLayout(this);
        splitRoot.setOrientation(LinearLayout.VERTICAL);
        splitRoot.setBackgroundColor(Color.parseColor("#0B0F17"));
        splitRoot.setLayoutParams(originalCapLp != null ? originalCapLp : new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // 1. Painel Superior: Navegador Integrado Kwanzabet
        browserPanel = new LinearLayout(this);
        browserPanel.setOrientation(LinearLayout.VERTICAL);
        browserPanel.setBackgroundColor(Color.parseColor("#0B0F17"));
        browserPanel.setVisibility(View.GONE);
        browserPanel.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                browserSplitWeight
        ));

        // Barra compacta de URL + controles rapidos
        urlBar = new LinearLayout(this);
        urlBar.setOrientation(LinearLayout.HORIZONTAL);
        urlBar.setGravity(Gravity.CENTER_VERTICAL);
        urlBar.setBackgroundColor(Color.parseColor("#131924"));
        int pad4 = dp(4);
        urlBar.setPadding(pad4, pad4, pad4, pad4);
        urlBar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(44)
        ));

        Button btnBack = createBarButton("<", "#F1F5F9", "#1E293B");
        btnBack.setOnClickListener(v -> {
            if (browserWebView.canGoBack()) browserWebView.goBack();
        });

        Button btnReload = createBarButton("R", "#94A3B8", "#1E293B");
        btnReload.setOnClickListener(v -> browserWebView.reload());

        etUrl = new EditText(this);
        etUrl.setSingleLine(true);
        etUrl.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        etUrl.setImeOptions(EditorInfo.IME_ACTION_GO);
        etUrl.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        etUrl.setTextColor(Color.parseColor("#F1F5F9"));
        etUrl.setHintTextColor(Color.parseColor("#64748B"));
        etUrl.setHint(DEFAULT_URL);
        etUrl.setBackgroundColor(Color.parseColor("#0B0F17"));
        etUrl.setPadding(dp(8), dp(4), dp(8), dp(4));
        etUrl.setLayoutParams(new LinearLayout.LayoutParams(0, dp(34), 1f));
        String savedUrl = prefs.getString("last_url", DEFAULT_URL);
        etUrl.setText(savedUrl);
        etUrl.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigateBrowser(etUrl.getText().toString());
                return true;
            }
            return false;
        });

        Button btnGo = createBarButton("Ir", "#0B0F17", "#D4AF37");
        btnGo.setOnClickListener(v -> navigateBrowser(etUrl.getText().toString()));

        btnScanToggle = createBarButton("OCR ON", "#0B0F17", "#10B981");
        btnScanToggle.setOnClickListener(v -> setAutoScanEnabled(!autoScanEnabled));

        Button btnCalib = createBarButton("Mira", "#F1F5F9", "#1E293B");
        btnCalib.setOnClickListener(v -> toggleCalibrationOverlay());

        Button btnExternal = createBarButton("Chrome", "#93C5FD", "#1E293B");
        btnExternal.setOnClickListener(v -> openUrlInExternalBrowser(etUrl.getText().toString()));

        Button btnClose = createBarButton("X", "#FCA5A5", "#3F1D24");
        btnClose.setOnClickListener(v -> closeIntegratedBrowser());

        urlBar.addView(btnBack);
        urlBar.addView(btnReload);
        urlBar.addView(etUrl);
        urlBar.addView(btnGo);
        urlBar.addView(btnScanToggle);
        urlBar.addView(btnCalib);
        urlBar.addView(btnExternal);
        urlBar.addView(btnClose);

        // Area do WebView + Barra de progresso + Aviso de erro + Mira verde
        browserFrame = new FrameLayout(this);
        browserFrame.setBackgroundColor(Color.parseColor("#0B0F17"));
        browserFrame.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
        ));

        browserWebView = new WebView(this);
        browserWebView.setFocusable(true);
        browserWebView.setFocusableInTouchMode(true);
        browserWebView.setBackgroundColor(Color.parseColor("#0B0F17"));
        browserWebView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        browserWebView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        configureBrowserWebView(browserWebView);

        browserProgressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        browserProgressBar.setMax(100);
        browserProgressBar.setVisibility(View.GONE);
        browserProgressBar.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(3),
                Gravity.TOP
        ));

        browserErrorBar = new LinearLayout(this);
        browserErrorBar.setOrientation(LinearLayout.HORIZONTAL);
        browserErrorBar.setGravity(Gravity.CENTER_VERTICAL);
        browserErrorBar.setBackgroundColor(Color.parseColor("#EE1E293B"));
        browserErrorBar.setPadding(dp(10), dp(6), dp(10), dp(6));
        browserErrorBar.setVisibility(View.GONE);
        browserErrorBar.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
        ));

        tvBrowserError = new TextView(this);
        tvBrowserError.setTextColor(Color.parseColor("#FDE68A"));
        tvBrowserError.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tvBrowserError.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button btnRetryLoad = createBarButton("Recarregar", "#0B0F17", "#FBBF24");
        btnRetryLoad.setOnClickListener(v -> {
            browserErrorBar.setVisibility(View.GONE);
            navigateBrowser(etUrl.getText().toString());
        });
        Button btnOpenExtErr = createBarButton("Abrir Chrome", "#F1F5F9", "#0F172A");
        btnOpenExtErr.setOnClickListener(v -> openUrlInExternalBrowser(etUrl.getText().toString()));
        browserErrorBar.addView(tvBrowserError);
        browserErrorBar.addView(btnRetryLoad);
        browserErrorBar.addView(btnOpenExtErr);

        roiOverlay = buildInteractiveRoiOverlay();
        calibrationBar = buildCalibrationBar();
        calibrationBar.setVisibility(View.GONE);

        debugBoxesView = new DebugBoxesView(this);
        debugBoxesView.setVisibility(debugOverlayEnabled ? View.VISIBLE : View.GONE);
        debugBoxesView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        browserFrame.addView(browserWebView);
        browserFrame.addView(roiOverlay);
        browserFrame.addView(debugBoxesView);
        browserFrame.addView(browserProgressBar);
        browserFrame.addView(browserErrorBar);
        browserFrame.addView(calibrationBar);

        browserPanel.addView(urlBar);
        browserPanel.addView(browserFrame);

        // 2. Painel Inferior: WebView do Capacitor (UI React RoletaVision)
        capacitorWebView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        splitRoot.addView(browserPanel);
        splitRoot.addView(capacitorWebView);
        parent.addView(splitRoot);
        syncCalibrationUiFromState();
    }

    @SuppressLint("ClickableViewAccessibility")
    private FrameLayout buildInteractiveRoiOverlay() {
        FrameLayout box = new FrameLayout(this);
        GradientDrawable roiDrawable = new GradientDrawable();
        roiDrawable.setColor(Color.parseColor("#2410B981"));
        roiDrawable.setCornerRadius(dp(6));
        roiDrawable.setStroke(dp(2), Color.parseColor("#10B981"), dp(8), dp(4));
        box.setBackground(roiDrawable);
        box.setVisibility(View.GONE);
        box.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(40)
        ));

        // Alça visual no canto inferior direito para redimensionar W/H por toque
        View resizeGrip = new View(this);
        GradientDrawable gripDrawable = new GradientDrawable();
        gripDrawable.setColor(Color.parseColor("#F59E0B"));
        gripDrawable.setCornerRadius(dp(4));
        gripDrawable.setStroke(dp(1), Color.parseColor("#0B0F17"));
        resizeGrip.setBackground(gripDrawable);
        FrameLayout.LayoutParams gripLp = new FrameLayout.LayoutParams(dp(16), dp(16), Gravity.BOTTOM | Gravity.END);
        gripLp.setMargins(0, 0, dp(2), dp(2));
        resizeGrip.setLayoutParams(gripLp);
        box.addView(resizeGrip);

        box.setOnTouchListener(new View.OnTouchListener() {
            float startRawX;
            float startRawY;
            float initL;
            float initT;
            float initW;
            float initH;
            boolean resizing = false;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                int frameW = browserFrame != null ? browserFrame.getWidth() : 0;
                int frameH = browserFrame != null ? browserFrame.getHeight() : 0;
                if (frameW <= 0 || frameH <= 0) return false;

                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        startRawX = event.getRawX();
                        startRawY = event.getRawY();
                        initL = roiLeftRatio;
                        initT = roiTopRatio;
                        initW = roiWidthRatio;
                        initH = roiHeightRatio;
                        int hitZone = dp(34);
                        resizing = event.getX() >= (v.getWidth() - hitZone) && event.getY() >= (v.getHeight() - hitZone);
                        v.getParent().requestDisallowInterceptTouchEvent(true);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dxRatio = (event.getRawX() - startRawX) / frameW;
                        float dyRatio = (event.getRawY() - startRawY) / frameH;
                        if (resizing) {
                            roiWidthRatio = clampRatio(initW + dxRatio, 0.10f, 1.0f - roiLeftRatio);
                            roiHeightRatio = clampRatio(initH + dyRatio, 0.03f, 1.0f - roiTopRatio);
                        } else {
                            roiLeftRatio = clampRatio(initL + dxRatio, 0f, 1.0f - roiWidthRatio);
                            roiTopRatio = clampRatio(initT + dyRatio, 0f, 1.0f - roiHeightRatio);
                        }
                        lastSplitRoiSig = null;
                        updateRoiOverlayPosition();
                        syncCalibrationUiFromState();
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        v.getParent().requestDisallowInterceptTouchEvent(false);
                        return true;
                    default:
                        return false;
                }
            }
        });

        return box;
    }

    private LinearLayout buildCalibrationBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#F0131924"));
        bar.setPadding(dp(10), dp(8), dp(10), dp(8));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
        );
        bar.setLayoutParams(lp);

        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);

        tvCalibTitle = new TextView(this);
        tvCalibTitle.setText("Mira: arraste a caixa verde ou ajuste X / Y / W / H");
        tvCalibTitle.setTextColor(Color.parseColor("#F1F5F9"));
        tvCalibTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tvCalibTitle.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        tvCalibCoords = new TextView(this);
        tvCalibCoords.setTextColor(Color.parseColor("#34D399"));
        tvCalibCoords.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        headerRow.addView(tvCalibTitle);
        headerRow.addView(tvCalibCoords);

        // Linha 1: X (Esquerda) e Y (Topo)
        LinearLayout rowXY = new LinearLayout(this);
        rowXY.setOrientation(LinearLayout.HORIZONTAL);
        rowXY.setGravity(Gravity.CENTER_VERTICAL);
        rowXY.setPadding(0, dp(4), 0, 0);

        seekRoiLeft = new SeekBar(this);
        seekRoiLeft.setMax(85);
        seekRoiLeft.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (!fromUser || isSyncingCalibSliders) return;
                roiLeftRatio = clampRatio(progress / 100f, 0f, 0.90f);
                if (roiLeftRatio + roiWidthRatio > 1.0f) {
                    roiWidthRatio = Math.max(0.10f, 1.0f - roiLeftRatio);
                    syncCalibrationUiFromState();
                } else {
                    updateCalibCoordsLabel();
                }
                lastSplitRoiSig = null;
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        seekRoiTop = new SeekBar(this);
        seekRoiTop.setMax(92);
        seekRoiTop.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (!fromUser || isSyncingCalibSliders) return;
                roiTopRatio = clampRatio(progress / 100f, 0f, 0.94f);
                if (roiTopRatio + roiHeightRatio > 1.0f) {
                    roiHeightRatio = Math.max(0.03f, 1.0f - roiTopRatio);
                    syncCalibrationUiFromState();
                } else {
                    updateCalibCoordsLabel();
                }
                lastSplitRoiSig = null;
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        rowXY.addView(makeLabeledSliderCell("X", seekRoiLeft));
        rowXY.addView(makeLabeledSliderCell("Y", seekRoiTop));

        // Linha 2: W (Largura) e H (Altura)
        LinearLayout rowWH = new LinearLayout(this);
        rowWH.setOrientation(LinearLayout.HORIZONTAL);
        rowWH.setGravity(Gravity.CENTER_VERTICAL);
        rowWH.setPadding(0, dp(2), 0, 0);

        seekRoiWidth = new SeekBar(this);
        seekRoiWidth.setMax(100);
        seekRoiWidth.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (!fromUser || isSyncingCalibSliders) return;
                roiWidthRatio = clampRatio(Math.max(10, progress) / 100f, 0.10f, 1.0f - roiLeftRatio);
                lastSplitRoiSig = null;
                updateCalibCoordsLabel();
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        seekRoiHeight = new SeekBar(this);
        seekRoiHeight.setMax(60);
        seekRoiHeight.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (!fromUser || isSyncingCalibSliders) return;
                roiHeightRatio = clampRatio(Math.max(3, progress) / 100f, 0.03f, 1.0f - roiTopRatio);
                lastSplitRoiSig = null;
                updateCalibCoordsLabel();
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        rowWH.addView(makeLabeledSliderCell("W", seekRoiWidth));
        rowWH.addView(makeLabeledSliderCell("H", seekRoiHeight));

        // Linha 3 (Roleta): Presets rápidos + Direção + Modo Multiplicador
        roulettePresetRow = new LinearLayout(this);
        roulettePresetRow.setOrientation(LinearLayout.HORIZONTAL);
        roulettePresetRow.setPadding(0, dp(4), 0, 0);
        roulettePresetRow.setVisibility(RoiConfigStore.GAME_ROULETTE.equals(activeGameMode) ? View.VISIBLE : View.GONE);

        Button btnPresetTop = createBarButton("Topo", "#E2E8F0", "#1E293B");
        btnPresetTop.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 0.85f));
        btnPresetTop.setOnClickListener(v -> applyQuickRoiPreset(0f, 0.04f, 1.0f, 0.08f, "Preset Topo aplicado"));

        Button btnPresetInferno = createBarButton("Inf/Dir", "#E2E8F0", "#1E293B");
        btnPresetInferno.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 0.95f));
        btnPresetInferno.setOnClickListener(v -> applyQuickRoiPreset(0.68f, 0.63f, 0.31f, 0.10f, "Preset Inferno/Dir aplicado"));

        Button btnPresetBottom = createBarButton("Baixo", "#E2E8F0", "#1E293B");
        btnPresetBottom.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 0.85f));
        btnPresetBottom.setOnClickListener(v -> applyQuickRoiPreset(0.05f, 0.82f, 0.90f, 0.10f, "Preset Baixo aplicado"));

        btnRouletteDir = createBarButton(rouletteNewestOnLeft ? "Esq→Dir" : "Dir→Esq", "#93C5FD", "#1E293B");
        btnRouletteDir.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 1.05f));
        btnRouletteDir.setOnClickListener(v -> setRouletteScannerConfig(activeSiteKey, !rouletteNewestOnLeft, rouletteMultiplierMode));

        btnRouletteMult = createBarButton(rouletteMultiplierMode ? "Mult 50x" : "Normal", rouletteMultiplierMode ? "#FDE68A" : "#CBD5E1", "#1E293B");
        btnRouletteMult.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 0.95f));
        btnRouletteMult.setOnClickListener(v -> setRouletteScannerConfig(activeSiteKey, rouletteNewestOnLeft, !rouletteMultiplierMode));

        roulettePresetRow.addView(btnPresetTop);
        roulettePresetRow.addView(btnPresetInferno);
        roulettePresetRow.addView(btnPresetBottom);
        roulettePresetRow.addView(btnRouletteDir);
        roulettePresetRow.addView(btnRouletteMult);

        // Linha 3 (Bac Bo): Presets rápidos para Jogador vs Banca ou Grelha Bead Plate
        bacboPresetRow = new LinearLayout(this);
        bacboPresetRow.setOrientation(LinearLayout.HORIZONTAL);
        bacboPresetRow.setPadding(0, dp(4), 0, 0);
        bacboPresetRow.setVisibility(RoiConfigStore.GAME_BACBO.equals(activeGameMode) ? View.VISIBLE : View.GONE);

        Button btnBbPresetBlocks = createBarButton("Blocos P | B", "#DBEAFE", "#1E3A8A");
        btnBbPresetBlocks.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 1f));
        btnBbPresetBlocks.setOnClickListener(v -> {
            setBacBoScanMode(RoiConfigStore.BACBO_MODE_BLOCKS);
            applyQuickRoiPreset(0f, 0.32f, 1.0f, 0.38f, "Preset Jogador vs Banca aplicado");
        });

        Button btnBbPresetPlate = createBarButton("Grelha Bead Plate", "#FEF3C7", "#78350F");
        btnBbPresetPlate.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 1f));
        btnBbPresetPlate.setOnClickListener(v -> {
            setBacBoScanMode(RoiConfigStore.BACBO_MODE_BEAD_PLATE);
            applyQuickRoiPreset(0f, 0.64f, 1.0f, 0.24f, "Preset Bead Plate aplicado");
        });

        Button btnBbPresetAuto = createBarButton("Auto", "#E2E8F0", "#1E293B");
        btnBbPresetAuto.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 0.65f));
        btnBbPresetAuto.setOnClickListener(v -> {
            setBacBoScanMode(RoiConfigStore.BACBO_MODE_AUTO);
            if (tvCalibStatus != null) tvCalibStatus.setText("Modo Bac Bo Automático ativo");
        });

        bacboPresetRow.addView(btnBbPresetBlocks);
        bacboPresetRow.addView(btnBbPresetPlate);
        bacboPresetRow.addView(btnBbPresetAuto);

        tvCalibStatus = new TextView(this);
        tvCalibStatus.setText("Toque em Testar para conferir a leitura.");
        tvCalibStatus.setTextColor(Color.parseColor("#FBBF24"));
        tvCalibStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tvCalibStatus.setPadding(0, dp(4), 0, 0);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setPadding(0, dp(5), 0, 0);

        Button btnTest = createBarButton("Testar", "#F1F5F9", "#1E293B");
        btnTest.setLayoutParams(new LinearLayout.LayoutParams(0, dp(32), 1f));
        btnTest.setOnClickListener(v -> {
            tvCalibStatus.setText("Lendo faixa...");
            captureAndAnalyzeBrowser(true);
        });

        btnBacBoMode = createBarButton("Modo: " + formatBacBoModeLabel(bacBoScanMode), "#93C5FD", "#1E293B");
        btnBacBoMode.setLayoutParams(new LinearLayout.LayoutParams(0, dp(32), 1.15f));
        btnBacBoMode.setVisibility(RoiConfigStore.GAME_BACBO.equals(activeGameMode) ? View.VISIBLE : View.GONE);
        btnBacBoMode.setOnClickListener(v -> {
            String next = RoiConfigStore.BACBO_MODE_AUTO.equals(bacBoScanMode)
                    ? RoiConfigStore.BACBO_MODE_BLOCKS
                    : (RoiConfigStore.BACBO_MODE_BLOCKS.equals(bacBoScanMode)
                    ? RoiConfigStore.BACBO_MODE_BEAD_PLATE
                    : RoiConfigStore.BACBO_MODE_AUTO);
            setBacBoScanMode(next);
        });

        btnDebugToggle = createBarButton(debugOverlayEnabled ? "Debug ON" : "Debug OFF", "#F1F5F9", "#1E293B");
        btnDebugToggle.setLayoutParams(new LinearLayout.LayoutParams(0, dp(32), 0.9f));
        btnDebugToggle.setOnClickListener(v -> setDebugOverlayEnabled(!debugOverlayEnabled));

        Button btnDone = createBarButton("Confirmar", "#0B0F17", "#10B981");
        btnDone.setLayoutParams(new LinearLayout.LayoutParams(0, dp(32), 1f));
        btnDone.setOnClickListener(v -> {
            saveRoiRectForSite(activeGameMode, activeSiteKey, RoiConfigStore.SURFACE_SPLIT, roiLeftRatio, roiTopRatio, roiWidthRatio, roiHeightRatio);
            calibrationBar.setVisibility(View.GONE);
            roiOverlay.setVisibility(View.GONE);
        });

        btnRow.addView(btnTest);
        btnRow.addView(btnBacBoMode);
        btnRow.addView(btnDebugToggle);
        btnRow.addView(btnDone);

        bar.addView(headerRow);
        bar.addView(rowXY);
        bar.addView(rowWH);
        bar.addView(roulettePresetRow);
        bar.addView(bacboPresetRow);
        bar.addView(tvCalibStatus);
        bar.addView(btnRow);
        return bar;
    }

    private LinearLayout makeLabeledSliderCell(String label, SeekBar seekBar) {
        LinearLayout cell = new LinearLayout(this);
        cell.setOrientation(LinearLayout.HORIZONTAL);
        cell.setGravity(Gravity.CENTER_VERTICAL);
        cell.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextColor(Color.parseColor("#94A3B8"));
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        tv.setPadding(dp(2), 0, dp(2), 0);

        seekBar.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        cell.addView(tv);
        cell.addView(seekBar);
        return cell;
    }

    private void applyQuickRoiPreset(float left, float top, float width, float height, String msg) {
        roiLeftRatio = clampRatio(left, 0f, 0.90f);
        roiTopRatio = clampRatio(top, 0f, 0.94f);
        roiWidthRatio = clampRatio(width, 0.10f, 1.0f - roiLeftRatio);
        roiHeightRatio = clampRatio(height, 0.03f, 1.0f - roiTopRatio);
        lastSplitRoiSig = null;
        syncCalibrationUiFromState();
        updateRoiOverlayPosition();
        if (tvCalibStatus != null) tvCalibStatus.setText(msg + " — toque em Testar.");
    }

    private void syncCalibrationUiFromState() {
        isSyncingCalibSliders = true;
        try {
            if (seekRoiLeft != null) {
                seekRoiLeft.setProgress(Math.min(seekRoiLeft.getMax(), Math.round(roiLeftRatio * 100)));
            }
            if (seekRoiTop != null) {
                seekRoiTop.setProgress(Math.min(seekRoiTop.getMax(), Math.round(roiTopRatio * 100)));
            }
            if (seekRoiWidth != null) {
                seekRoiWidth.setProgress(Math.min(seekRoiWidth.getMax(), Math.round(roiWidthRatio * 100)));
            }
            if (seekRoiHeight != null) {
                seekRoiHeight.setProgress(Math.min(seekRoiHeight.getMax(), Math.round(roiHeightRatio * 100)));
            }
            if (btnRouletteDir != null) {
                btnRouletteDir.setText(rouletteNewestOnLeft ? "Esq→Dir" : "Dir→Esq");
            }
            if (btnRouletteMult != null) {
                btnRouletteMult.setText(rouletteMultiplierMode ? "Mult 50x" : "Normal");
                btnRouletteMult.setTextColor(Color.parseColor(rouletteMultiplierMode ? "#FDE68A" : "#CBD5E1"));
            }
            updateCalibCoordsLabel();
        } finally {
            isSyncingCalibSliders = false;
        }
    }

    private void updateCalibCoordsLabel() {
        if (tvCalibCoords == null) return;
        tvCalibCoords.setText(String.format(
                Locale.US,
                "X:%d%% Y:%d%% W:%d%% H:%d%%",
                Math.round(roiLeftRatio * 100),
                Math.round(roiTopRatio * 100),
                Math.round(roiWidthRatio * 100),
                Math.round(roiHeightRatio * 100)
        ));
    }

    private static float clampRatio(float v, float min, float max) {
        return Math.max(min, Math.min(max, v));
    }

    private String formatBacBoModeLabel(String mode) {
        if (RoiConfigStore.BACBO_MODE_BLOCKS.equals(mode)) return "J vs B";
        if (RoiConfigStore.BACBO_MODE_BEAD_PLATE.equals(mode)) return "Bead Plate";
        return "Auto";
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureBrowserWebView(WebView webView) {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setBlockNetworkImage(false);
        settings.setBlockNetworkLoads(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Remove flag '; wv' mantendo exatamente a versão real do Chromium do aparelho (evita bloqueio Cloudflare/branco)
        String defaultUa = settings.getUserAgentString();
        if (defaultUa != null && !defaultUa.isEmpty()) {
            String cleanUa = defaultUa
                    .replace("; wv)", ")")
                    .replace("Version/4.0 ", "");
            settings.setUserAgentString(cleanUa);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    String u = request.getUrl().toString();
                    if (u.startsWith("http://") || u.startsWith("https://")) {
                        if (request.isForMainFrame()) {
                            etUrl.setText(u);
                            prefs.edit().putString("last_url", u).apply();
                        }
                        return false;
                    }
                    // Evita ecrã branco ERR_UNKNOWN_URL_SCHEME para intent:// ou schemes externos
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (browserErrorBar != null) {
                    browserErrorBar.setVisibility(View.GONE);
                }
                if (browserProgressBar != null) {
                    browserProgressBar.setVisibility(View.VISIBLE);
                    browserProgressBar.setProgress(15);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (browserProgressBar != null) {
                    browserProgressBar.setVisibility(View.GONE);
                }
                CookieManager.getInstance().flush();
                if (url != null && !url.isEmpty() && (url.startsWith("http://") || url.startsWith("https://"))) {
                    etUrl.setText(url);
                }
                handler.postDelayed(() -> {
                    if (browserVisible && autoScanEnabled && !isScanningFrame) {
                        captureAndAnalyzeBrowser(false);
                    }
                }, 500L);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    if (browserProgressBar != null) browserProgressBar.setVisibility(View.GONE);
                    if (browserErrorBar != null && tvBrowserError != null) {
                        CharSequence desc = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && error != null
                                ? error.getDescription()
                                : "Falha ao carregar o site.";
                        tvBrowserError.setText("Erro na página: " + desc + " (pode abrir no Chrome + Captura)");
                        browserErrorBar.setVisibility(View.VISIBLE);
                    }
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (browserErrorBar != null && tvBrowserError != null) {
                    tvBrowserError.setText("Certificado SSL recusado pelo site. Use 'Abrir Chrome' + Captura.");
                    browserErrorBar.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (browserErrorBar != null && tvBrowserError != null) {
                    tvBrowserError.setText("Memória gráfica do navegador reiniciada. Toque em Recarregar.");
                    browserErrorBar.setVisibility(View.VISIBLE);
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                super.onProgressChanged(view, newProgress);
                if (browserProgressBar != null) {
                    browserProgressBar.setProgress(newProgress);
                    browserProgressBar.setVisibility(newProgress >= 95 ? View.GONE : View.VISIBLE);
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // Redireciona popups/novos separadores (ex: abrir mesa/jogo) para o mesmo WebView sem ecrã branco
                if (resultMsg != null && resultMsg.obj instanceof WebView.WebViewTransport) {
                    WebView tempWebView = new WebView(MainActivity.this);
                    tempWebView.setWebViewClient(new WebViewClient() {
                        @Override
                        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                            if (req != null && req.getUrl() != null) {
                                String target = req.getUrl().toString();
                                if (target.startsWith("http://") || target.startsWith("https://")) {
                                    navigateBrowser(target);
                                }
                            }
                            v.destroy();
                            return true;
                        }
                    });
                    WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                    transport.setWebView(tempWebView);
                    resultMsg.sendToTarget();
                    return true;
                }
                return false;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (request != null) {
                    request.grant(request.getResources());
                }
            }
        });
    }

    private void openUrlInExternalBrowser(String raw) {
        String url = raw != null ? raw.trim() : DEFAULT_URL;
        if (url.isEmpty()) url = DEFAULT_URL;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (Exception ignored) {
        }
    }

    public void openIntegratedBrowser(String requestedUrl) {
        if (browserPanel == null || browserWebView == null) return;
        browserVisible = true;
        browserPanel.setVisibility(View.VISIBLE);
        applySplitWeights();

        if (requestedUrl != null && !requestedUrl.trim().isEmpty()) {
            navigateBrowser(requestedUrl);
            hasLoadedInitialUrl = true;
        } else if (!hasLoadedInitialUrl) {
            String initial = prefs.getString("last_url", DEFAULT_URL);
            navigateBrowser(initial);
            hasLoadedInitialUrl = true;
        }
        BrowserScannerPlugin.emitBrowserVisibility(true);
    }

    public void closeIntegratedBrowser() {
        if (browserPanel == null) return;
        browserVisible = false;
        browserPanel.setVisibility(View.GONE);
        if (capacitorWebView != null) {
            capacitorWebView.setLayoutParams(new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            ));
        }
        BrowserScannerPlugin.emitBrowserVisibility(false);
    }

    public void setBrowserSplitWeight(float weight) {
        browserSplitWeight = Math.max(0.45f, Math.min(0.80f, weight));
        if (browserVisible) {
            applySplitWeights();
        }
    }

    private void applySplitWeights() {
        browserPanel.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                browserSplitWeight
        ));
        if (capacitorWebView != null) {
            capacitorWebView.setLayoutParams(new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    0,
                    1f - browserSplitWeight
            ));
        }
    }

    public void toggleCalibrationOverlay() {
        if (!browserVisible) {
            openIntegratedBrowser(null);
        }
        boolean show = calibrationBar.getVisibility() != View.VISIBLE;
        calibrationBar.setVisibility(show ? View.VISIBLE : View.GONE);
        roiOverlay.setVisibility(show ? View.VISIBLE : View.GONE);
        updateRoiOverlayPosition();
    }

    public void setAutoScanEnabled(boolean enabled) {
        autoScanEnabled = enabled;
        if (btnScanToggle != null) {
            btnScanToggle.setText(enabled ? "OCR ON" : "OCR OFF");
            btnScanToggle.setBackgroundColor(Color.parseColor(enabled ? "#10B981" : "#334155"));
            btnScanToggle.setTextColor(Color.parseColor(enabled ? "#0B0F17" : "#94A3B8"));
        }
    }

    public void setActiveGameMode(String mode) {
        this.activeGameMode = RoiConfigStore.normalizeGame(mode);
        this.isScanningFrame = false;
        this.lastSplitRoiSig = null;
        this.rouletteReconciler.reset();
        this.bacBoReconciler.reset();
        loadRoiForCurrentMode();

        if (seekRoiLeft != null) {
            seekRoiLeft.setMax(85);
        }
        if (seekRoiTop != null) {
            if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
                seekRoiTop.setMax(88);
            } else if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
                seekRoiTop.setMax(75);
            } else {
                seekRoiTop.setMax(92);
            }
        }
        if (seekRoiWidth != null) {
            seekRoiWidth.setMax(100);
        }
        if (seekRoiHeight != null) {
            if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
                seekRoiHeight.setMax(75);
            } else if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
                seekRoiHeight.setMax(55);
            } else {
                seekRoiHeight.setMax(45);
            }
        }
        syncCalibrationUiFromState();

        if (tvCalibTitle != null) {
            if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
                tvCalibTitle.setText("Mira Bac Bo: Jogador (esq.) e Banca (dir.) ou Bead Plate");
            } else if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
                tvCalibTitle.setText("Mira Aviator: faixa + multiplicador");
            } else {
                tvCalibTitle.setText("Mira Roleta: arraste ou ajuste X/Y/W/H");
            }
        }
        if (btnBacBoMode != null) {
            btnBacBoMode.setVisibility(RoiConfigStore.GAME_BACBO.equals(activeGameMode) ? View.VISIBLE : View.GONE);
        }
        if (roulettePresetRow != null) {
            roulettePresetRow.setVisibility(RoiConfigStore.GAME_ROULETTE.equals(activeGameMode) ? View.VISIBLE : View.GONE);
        }
        if (bacboPresetRow != null) {
            bacboPresetRow.setVisibility(RoiConfigStore.GAME_BACBO.equals(activeGameMode) ? View.VISIBLE : View.GONE);
        }
        updateRoiOverlayPosition();

        if (GameCaptureService.isServiceRunning()) {
            Intent updIntent = new Intent(this, GameCaptureService.class);
            updIntent.setAction(GameCaptureService.ACTION_SET_MODE);
            updIntent.putExtra(GameCaptureService.EXTRA_GAME_MODE, activeGameMode);
            updIntent.putExtra(GameCaptureService.EXTRA_SITE_KEY, activeSiteKey);
            startService(updIntent);
        }
    }

    public void setBacBoScanMode(String mode) {
        if (configStore != null) {
            configStore.setBacBoScanMode(mode);
            this.bacBoScanMode = configStore.getBacBoScanMode();
        } else {
            this.bacBoScanMode = mode;
        }
        this.lastSplitRoiSig = null;
        this.bacBoReconciler.reset();
        if (btnBacBoMode != null) {
            btnBacBoMode.setText("Modo: " + formatBacBoModeLabel(this.bacBoScanMode));
        }
        if (tvCalibStatus != null && RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
            tvCalibStatus.setText("Modo Bac Bo alterado para: " + formatBacBoModeLabel(this.bacBoScanMode));
        }
        if (GameCaptureService.isServiceRunning()) {
            Intent updIntent = new Intent(this, GameCaptureService.class);
            updIntent.setAction(GameCaptureService.ACTION_UPDATE_CONFIG);
            updIntent.putExtra(GameCaptureService.EXTRA_GAME_MODE, activeGameMode);
            updIntent.putExtra(GameCaptureService.EXTRA_SITE_KEY, activeSiteKey);
            startService(updIntent);
        }
    }

    public void setActiveSiteProfile(String site) {
        if (configStore != null) {
            configStore.setActiveSite(site);
            this.activeSiteKey = configStore.getActiveSite();
        } else {
            this.activeSiteKey = RoiConfigStore.normalizeSite(site);
        }
        this.lastSplitRoiSig = null;
        this.rouletteReconciler.reset();
        this.bacBoReconciler.reset();
        loadRoiForCurrentMode();
        updateRoiOverlayPosition();
        if (GameCaptureService.isServiceRunning()) {
            Intent updIntent = new Intent(this, GameCaptureService.class);
            updIntent.setAction(GameCaptureService.ACTION_UPDATE_CONFIG);
            updIntent.putExtra(GameCaptureService.EXTRA_GAME_MODE, activeGameMode);
            updIntent.putExtra(GameCaptureService.EXTRA_SITE_KEY, activeSiteKey);
            startService(updIntent);
        }
    }

    public void setRouletteScannerConfig(String site, boolean newestOnLeft, boolean multiplierMode) {
        String targetSite = RoiConfigStore.normalizeSite(site != null && !site.isEmpty() ? site : activeSiteKey);
        if (configStore != null) {
            configStore.setRouletteNewestOnLeft(targetSite, newestOnLeft);
            configStore.setRouletteMultiplierMode(targetSite, multiplierMode);
        }
        if (targetSite.equals(activeSiteKey)) {
            this.rouletteNewestOnLeft = newestOnLeft;
            this.rouletteMultiplierMode = multiplierMode;
            this.lastSplitRoiSig = null;
            this.rouletteReconciler.reset();
            syncCalibrationUiFromState();
            if (tvCalibStatus != null && RoiConfigStore.GAME_ROULETTE.equals(activeGameMode)) {
                tvCalibStatus.setText((newestOnLeft ? "Ordem: Esq→Dir" : "Ordem: Dir→Esq")
                        + " · " + (multiplierMode ? "Modo Multiplicador (50x)" : "Mesa Normal"));
            }
        }
        if (GameCaptureService.isServiceRunning()) {
            Intent updIntent = new Intent(this, GameCaptureService.class);
            updIntent.setAction(GameCaptureService.ACTION_UPDATE_CONFIG);
            updIntent.putExtra(GameCaptureService.EXTRA_GAME_MODE, activeGameMode);
            updIntent.putExtra(GameCaptureService.EXTRA_SITE_KEY, activeSiteKey);
            startService(updIntent);
        }
    }

    public void saveRoiRectForSite(String game, String site, float left, float top, float width, float height) {
        saveRoiRectForSite(game, site, RoiConfigStore.SURFACE_SPLIT, left, top, width, height);
    }

    public void saveRoiRectForSite(String game, String site, String surface, float left, float top, float width, float height) {
        String normSurface = RoiConfigStore.normalizeSurface(surface);
        RoiConfigStore.RoiRect rect = new RoiConfigStore.RoiRect(left, top, width, height);
        if (configStore != null) {
            configStore.saveRoiRect(game, site, normSurface, rect);
        }
        if (RoiConfigStore.SURFACE_SPLIT.equals(normSurface) && RoiConfigStore.normalizeGame(game).equals(activeGameMode)) {
            roiLeftRatio = rect.leftRatio;
            roiTopRatio = rect.topRatio;
            roiWidthRatio = rect.widthRatio;
            roiHeightRatio = rect.heightRatio;
            lastSplitRoiSig = null;
            syncCalibrationUiFromState();
            updateRoiOverlayPosition();
        }
        if (RoiConfigStore.SURFACE_PROJECTION.equals(normSurface) && GameCaptureService.isServiceRunning()) {
            Intent updIntent = new Intent(this, GameCaptureService.class);
            updIntent.setAction(GameCaptureService.ACTION_UPDATE_CONFIG);
            updIntent.putExtra(GameCaptureService.EXTRA_GAME_MODE, activeGameMode);
            updIntent.putExtra(GameCaptureService.EXTRA_SITE_KEY, activeSiteKey);
            startService(updIntent);
        }
    }

    public void setDebugOverlayEnabled(boolean enabled) {
        this.debugOverlayEnabled = enabled;
        if (configStore != null) {
            configStore.setDebugOverlayEnabled(enabled);
        }
        if (debugBoxesView != null) {
            debugBoxesView.setVisibility(enabled ? View.VISIBLE : View.GONE);
            if (!enabled) {
                debugBoxesView.updateBoxes(new RoiConfigStore.RoiRect(roiLeftRatio, roiTopRatio, roiWidthRatio, roiHeightRatio), Collections.emptyList());
            }
        }
        if (btnDebugToggle != null) {
            btnDebugToggle.setText(enabled ? "Debug ON" : "Debug OFF");
        }
    }

    public void requestUnifiedScreenCapturePermission(int intervalMs, String requestedGameMode, String requestedSite) {
        captureIntervalMs = Math.max(350, Math.min(2000, intervalMs));
        if (requestedGameMode != null && !requestedGameMode.isEmpty()) {
            setActiveGameMode(requestedGameMode);
        }
        if (requestedSite != null && !requestedSite.isEmpty()) {
            setActiveSiteProfile(requestedSite);
        }
        BrowserScannerPlugin.emitCaptureStatus(false, captureIntervalMs, activeGameMode, activeSiteKey, "pending", "");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
                return;
            }
        }
        launchSystemScreenCapturePrompt();
    }

    private void launchSystemScreenCapturePrompt() {
        MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null || mediaProjectionLauncher == null) {
            BrowserScannerPlugin.emitCaptureStatus(
                    false,
                    captureIntervalMs,
                    activeGameMode,
                    activeSiteKey,
                    "denied",
                    "MediaProjection indisponível neste dispositivo."
            );
            return;
        }
        mediaProjectionLauncher.launch(manager.createScreenCaptureIntent());
    }

    public void stopUnifiedScreenCaptureService() {
        Intent stopIntent = new Intent(this, GameCaptureService.class);
        stopIntent.setAction(GameCaptureService.ACTION_STOP);
        startService(stopIntent);
        BrowserScannerPlugin.emitCaptureStatus(false, captureIntervalMs, activeGameMode, activeSiteKey, "idle", "");
    }

    public void updateUnifiedCaptureInterval(int intervalMs) {
        captureIntervalMs = Math.max(350, Math.min(2000, intervalMs));
        if (GameCaptureService.isServiceRunning()) {
            Intent svcIntent = new Intent(this, GameCaptureService.class);
            svcIntent.setAction(GameCaptureService.ACTION_SET_INTERVAL);
            svcIntent.putExtra(GameCaptureService.EXTRA_INTERVAL_MS, (long) captureIntervalMs);
            startService(svcIntent);
        } else {
            BrowserScannerPlugin.emitCaptureStatus(false, captureIntervalMs, activeGameMode, activeSiteKey, "idle", "");
        }
    }

    public void triggerImmediateScan() {
        if (!browserVisible) return;
        lastSplitRoiSig = null;
        if (isScanningFrame) {
            handler.postDelayed(() -> {
                if (browserVisible && !isScanningFrame) {
                    captureAndAnalyzeBrowser(true);
                }
            }, 180L);
            return;
        }
        captureAndAnalyzeBrowser(true);
    }

    private void updateRoiOverlayPosition() {
        if (browserFrame == null || roiOverlay == null) return;
        int w = browserFrame.getWidth();
        int h = browserFrame.getHeight();
        if (h <= 0 || w <= 0) return;
        int targetLeft = Math.max(0, Math.round(w * roiLeftRatio));
        int targetTop = Math.max(0, Math.round(h * roiTopRatio));
        int targetW = Math.max(dp(28), Math.min(w - targetLeft, Math.round(w * roiWidthRatio)));
        int targetH = Math.max(dp(20), Math.min(h - targetTop, Math.round(h * roiHeightRatio)));

        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) roiOverlay.getLayoutParams();
        lp.leftMargin = targetLeft;
        lp.topMargin = targetTop;
        lp.width = targetW;
        lp.height = targetH;
        roiOverlay.setLayoutParams(lp);
    }

    private void navigateBrowser(String raw) {
        if (raw == null) return;
        String url = raw.trim();
        if (url.isEmpty()) return;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        etUrl.setText(url);
        prefs.edit().putString("last_url", url).apply();
        browserWebView.loadUrl(url);
    }

    private void captureAndAnalyzeBrowser(boolean showCalibrationFeedback) {
        int w = browserWebView.getWidth();
        int h = browserWebView.getHeight();
        if (w < 50 || h < 50) return;

        isScanningFrame = true;
        activeScanStartMs = System.currentTimeMillis();
        final boolean wasOverlayVisible = roiOverlay != null && roiOverlay.getVisibility() == View.VISIBLE;
        if (wasOverlayVisible) {
            roiOverlay.setVisibility(View.INVISIBLE);
            browserWebView.postDelayed(() ->
                    performPixelCopyCapture(true, showCalibrationFeedback, activeScanStartMs), 32L);
        } else {
            performPixelCopyCapture(false, showCalibrationFeedback, activeScanStartMs);
        }
    }

    private void performPixelCopyCapture(
            boolean restoreOverlay,
            boolean showCalibrationFeedback,
            long scanStartMs
    ) {
        int w = browserWebView.getWidth();
        int h = browserWebView.getHeight();
        if (w < 50 || h < 50) {
            if (restoreOverlay && roiOverlay != null) roiOverlay.setVisibility(View.VISIBLE);
            isScanningFrame = false;
            return;
        }

        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            int[] loc = new int[2];
            browserWebView.getLocationInWindow(loc);
            View decor = getWindow().getDecorView();
            int left = Math.max(0, loc[0]);
            int top = Math.max(0, loc[1]);
            int right = Math.min(decor.getWidth(), loc[0] + w);
            int bottom = Math.min(decor.getHeight(), loc[1] + h);

            if (right - left >= 50 && bottom - top >= 50) {
                Rect srcRect = new Rect(left, top, right, bottom);
                if (srcRect.width() != w || srcRect.height() != h) {
                    bitmap.recycle();
                    bitmap = Bitmap.createBitmap(srcRect.width(), srcRect.height(), Bitmap.Config.ARGB_8888);
                }
                final Bitmap targetBitmap = bitmap;
                try {
                    PixelCopy.request(getWindow(), srcRect, targetBitmap, copyResult -> {
                        if (restoreOverlay && roiOverlay != null) roiOverlay.setVisibility(View.VISIBLE);
                        if (copyResult == PixelCopy.SUCCESS) {
                            processCapturedBitmap(targetBitmap, showCalibrationFeedback, scanStartMs);
                        } else {
                            fallbackCanvasCapture(targetBitmap, showCalibrationFeedback, scanStartMs);
                        }
                    }, handler);
                    return;
                } catch (Exception e) {
                    if (restoreOverlay && roiOverlay != null) roiOverlay.setVisibility(View.VISIBLE);
                    fallbackCanvasCapture(targetBitmap, showCalibrationFeedback, scanStartMs);
                    return;
                }
            }
        }
        if (restoreOverlay && roiOverlay != null) roiOverlay.setVisibility(View.VISIBLE);
        fallbackCanvasCapture(bitmap, showCalibrationFeedback, scanStartMs);
    }

    private void fallbackCanvasCapture(
            Bitmap bitmap,
            boolean showCalibrationFeedback,
            long scanStartMs
    ) {
        try {
            Canvas canvas = new Canvas(bitmap);
            browserWebView.draw(canvas);
            processCapturedBitmap(bitmap, showCalibrationFeedback, scanStartMs);
        } catch (Exception e) {
            bitmap.recycle();
            isScanningFrame = false;
            consecutiveFailures++;
            totalReadTicks++;
            long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
            BrowserScannerPlugin.emitScanTelemetry(-1, elapsedMs, false, consecutiveFailures, 0, totalReadTicks);
        }
    }

    private void processCapturedBitmap(
            Bitmap bitmap,
            boolean showCalibrationFeedback,
            long scanStartMs
    ) {
        final RoiConfigStore.RoiRect activeRoi =
                new RoiConfigStore.RoiRect(roiLeftRatio, roiTopRatio, roiWidthRatio, roiHeightRatio);
        long nowMono = SystemClock.elapsedRealtime();
        ScreenScanner.RoiFrameSignature currSig = ScreenScanner.computeRoiSignature(bitmap, activeRoi);
        if (!showCalibrationFeedback
                && lastSplitRoiSig != null
                && !ScreenScanner.hasSignificantRoiChange(lastSplitRoiSig, currSig)
                && (nowMono - lastSplitFullScanMs) < SPLIT_HEARTBEAT_SCAN_MS) {
            bitmap.recycle();
            isScanningFrame = false;
            return;
        }
        lastSplitRoiSig = currSig;
        lastSplitFullScanMs = nowMono;

        final RoiConfigStore.HsvColorProfile hsvProfile =
                configStore != null
                        ? configStore.getHsvProfile(activeSiteKey)
                        : RoiConfigStore.HsvColorProfile.defaultForSite(activeSiteKey);

        if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
            processBacBoBitmap(bitmap, activeRoi, hsvProfile, showCalibrationFeedback, scanStartMs);
            return;
        }
        if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
            processAviatorBitmap(bitmap, activeRoi, hsvProfile, showCalibrationFeedback, scanStartMs);
            return;
        }
        scanner.scanRouletteFrame(bitmap, activeRoi, hsvProfile, rouletteNewestOnLeft, rouletteMultiplierMode, debugOverlayEnabled, (detectedNewestFirst, avgConfidence, timestampMs, debugBoxes, hsvSamples, ocrOk) -> {
            bitmap.recycle();
            isScanningFrame = false;

            long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
            totalReadTicks++;
            boolean hasNumbers = ocrOk && detectedNewestFirst != null && !detectedNewestFirst.isEmpty();
            if (hasNumbers) {
                consecutiveFailures = 0;
            } else {
                consecutiveFailures++;
            }

            int headNumber = hasNumbers ? detectedNewestFirst.get(0) : -1;
            int stripSize = detectedNewestFirst != null ? detectedNewestFirst.size() : 0;
            BrowserScannerPlugin.emitScanTelemetry(
                    headNumber,
                    elapsedMs,
                    hasNumbers,
                    consecutiveFailures,
                    stripSize,
                    totalReadTicks
            );

            if (debugOverlayEnabled) {
                if (debugBoxesView != null) {
                    debugBoxesView.updateBoxes(activeRoi, debugBoxes);
                }
                BrowserScannerPlugin.emitDebugOverlay(activeGameMode, "roulette", avgConfidence, debugBoxes);
            }

            if (showCalibrationFeedback) {
                BrowserScannerPlugin.emitScanFeedback(stripSize, "ocr");
            }

            if (showCalibrationFeedback && tvCalibStatus != null) {
                if (!hasNumbers) {
                    tvCalibStatus.setText("Nenhum lido. Arraste a caixa verde sobre os numeros.");
                } else {
                    tvCalibStatus.setText(String.format(Locale.US, "Lidos (conf %.0f%%): %s", avgConfidence * 100f, detectedNewestFirst.toString()));
                }
            }

            if (stripSize >= 3) {
                reconcileDetectedStrip(detectedNewestFirst, avgConfidence);
            }
        });
    }

    private void reconcileDetectedStrip(List<Integer> newStrip, float avgConfidence) {
        RouletteStripReconciler.ReconcileAction action = rouletteReconciler.reconcile(newStrip, avgConfidence);
        if (action.type == RouletteStripReconciler.ActionType.NEW_SPINS && !action.spinsToEmit.isEmpty()) {
            if (browserPanel != null) {
                browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            }
            if (historyDb != null) {
                historyDb.insertRouletteResult(System.currentTimeMillis(), activeSiteKey, action.spinsToEmit, avgConfidence, "integrated_browser");
            }
            BrowserScannerPlugin.emitSpins(action.spinsToEmit, false);
        } else if ((action.type == RouletteStripReconciler.ActionType.INITIAL_FULL_STRIP
                || action.type == RouletteStripReconciler.ActionType.TABLE_SWITCH_FULL_STRIP)
                && !action.spinsToEmit.isEmpty()) {
            if (historyDb != null) {
                historyDb.insertRouletteResult(System.currentTimeMillis(), activeSiteKey, action.spinsToEmit, avgConfidence, "integrated_browser");
            }
            BrowserScannerPlugin.emitSpins(action.spinsToEmit, true);
        }
    }

    // ==================== BAC BO RECONCILIATION (JOGADOR VS BANCA + BEAD PLATE) ====================

    private void processBacBoBitmap(
            Bitmap bitmap,
            RoiConfigStore.RoiRect roi,
            RoiConfigStore.HsvColorProfile hsvProfile,
            boolean showCalibrationFeedback,
            long scanStartMs
    ) {
        scanner.scanBacBoFrame(bitmap, roi, bacBoScanMode, hsvProfile, debugOverlayEnabled, (pTotal, bTotal, blocksVisible, plateCells, confidence, resolvedMode, debugBoxes, ocrOk) -> {
            bitmap.recycle();
            isScanningFrame = false;

            long nowMs = System.currentTimeMillis();
            long elapsedMs = Math.max(1L, nowMs - scanStartMs);
            totalReadTicks++;

            boolean hasScore = pTotal >= 2 && bTotal >= 2;
            int stripSize = plateCells != null ? plateCells.size() : 0;
            boolean hasSignal = ocrOk && (hasScore || blocksVisible || stripSize >= 4);
            if (hasSignal) {
                consecutiveFailures = 0;
            } else {
                consecutiveFailures++;
            }

            int headTotal = hasScore
                    ? Math.max(pTotal, bTotal)
                    : (stripSize > 0 ? plateCells.get(0).total : -1);

            BrowserScannerPlugin.emitScanTelemetry(
                    headTotal,
                    elapsedMs,
                    hasSignal,
                    consecutiveFailures,
                    hasScore ? 2 : stripSize,
                    totalReadTicks
            );

            if (debugOverlayEnabled) {
                if (debugBoxesView != null) {
                    debugBoxesView.updateBoxes(roi, debugBoxes);
                }
                BrowserScannerPlugin.emitDebugOverlay(activeGameMode, resolvedMode, confidence, debugBoxes);
            }

            if (showCalibrationFeedback) {
                BrowserScannerPlugin.emitScanFeedback(hasScore ? 2 : (blocksVisible ? 1 : stripSize), "bacbo-" + resolvedMode);
            }

            if (showCalibrationFeedback && tvCalibStatus != null) {
                if (hasScore) {
                    String winner = pTotal > bTotal ? "JOGADOR" : (bTotal > pTotal ? "BANCA" : "EMPATE");
                    tvCalibStatus.setText("Bac Bo: Jogador " + pTotal + " x " + bTotal + " Banca -> Maior: " + winner);
                } else if (blocksVisible) {
                    tvCalibStatus.setText("Bac Bo visível! Aguardar ambos os dados lançados...");
                } else if (stripSize >= 4) {
                    tvCalibStatus.setText("Bead Plate (" + formatBacBoModeLabel(resolvedMode) + "): " + stripSize + " células lidas.");
                } else {
                    tvCalibStatus.setText("Bac Bo: Alinhe a Mira sobre Jogador/Banca ou sobre a grelha Bead Plate.");
                }
            }

            if (RoiConfigStore.BACBO_MODE_BLOCKS.equals(resolvedMode) && (hasScore || blocksVisible)) {
                reconcileBacBoBlocks(pTotal, bTotal, confidence, nowMs);
            } else if (stripSize >= 4) {
                reconcileBacBoPlate(plateCells, confidence, nowMs);
            }
        });
    }

    private void reconcileBacBoBlocks(int pTotal, int bTotal, float confidence, long nowMs) {
        BacBoReconciler.ReconcileAction action = bacBoReconciler.reconcileBlocks(pTotal, bTotal, nowMs);
        if (action.type == BacBoReconciler.ActionType.BLOCK_CONFIRMED && !action.cellsToEmit.isEmpty()) {
            ScreenScanner.BacBoCell cell = action.cellsToEmit.get(0);
            if (browserPanel != null) {
                browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            }
            if (historyDb != null) {
                historyDb.insertBacBoResult(nowMs, activeSiteKey, cell.outcome, cell.playerTotal, cell.bankerTotal, bacBoScanMode, confidence, "integrated_browser");
            }
            BrowserScannerPlugin.emitBacBo(action.cellsToEmit, false);
        }
    }

    private void reconcileBacBoPlate(List<ScreenScanner.BacBoCell> newCells, float confidence, long nowMs) {
        BacBoReconciler.ReconcileAction action = bacBoReconciler.reconcilePlate(newCells, nowMs);
        if (action.type == BacBoReconciler.ActionType.NONE || action.cellsToEmit.isEmpty()) {
            return;
        }
        if (action.type == BacBoReconciler.ActionType.NEW_PLATE_CELLS && browserPanel != null) {
            browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
        }
        if (historyDb != null) {
            ScreenScanner.BacBoCell head = action.cellsToEmit.get(0);
            historyDb.insertBacBoResult(nowMs, activeSiteKey, head.outcome, head.playerTotal, head.bankerTotal, bacBoScanMode, confidence, "integrated_browser");
        }
        BrowserScannerPlugin.emitBacBo(action.cellsToEmit, action.isFullPlate);
    }

    // ==================== AVIATOR INTEGRATED BROWSER SCAN ====================

    private void processAviatorBitmap(
            Bitmap bitmap,
            RoiConfigStore.RoiRect roi,
            RoiConfigStore.HsvColorProfile hsvProfile,
            boolean showCalibrationFeedback,
            long scanStartMs
    ) {
        scanner.scanAviatorFrame(bitmap, roi, hsvProfile, debugOverlayEnabled, (liveMult, isCrashedColor, historyNewestFirst, confidence, debugBoxes, ocrOk) -> {
            bitmap.recycle();
            isScanningFrame = false;

            long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
            totalReadTicks++;

            boolean hasSignal = ocrOk && (liveMult >= 1.0 || (historyNewestFirst != null && !historyNewestFirst.isEmpty()));
            if (hasSignal) {
                consecutiveFailures = 0;
            } else {
                consecutiveFailures++;
            }

            int telemetryVal = liveMult >= 1.0
                    ? (int) Math.round(liveMult * 100)
                    : (historyNewestFirst != null && !historyNewestFirst.isEmpty()
                    ? (int) Math.round(historyNewestFirst.get(0) * 100)
                    : -1);
            int stripSize = historyNewestFirst != null ? historyNewestFirst.size() : 0;

            BrowserScannerPlugin.emitScanTelemetry(
                    telemetryVal,
                    elapsedMs,
                    hasSignal,
                    consecutiveFailures,
                    stripSize,
                    totalReadTicks
            );

            if (debugOverlayEnabled) {
                if (debugBoxesView != null) {
                    debugBoxesView.updateBoxes(roi, debugBoxes);
                }
                BrowserScannerPlugin.emitDebugOverlay(activeGameMode, "aviator", confidence, debugBoxes);
            }

            if (showCalibrationFeedback) {
                BrowserScannerPlugin.emitScanFeedback(
                        liveMult >= 1.0 ? stripSize + 1 : stripSize,
                        "aviator-ocr"
                );
            }

            if (showCalibrationFeedback && tvCalibStatus != null) {
                if (!hasSignal) {
                    tvCalibStatus.setText("Aviator: Ajuste a Mira sobre a faixa superior e o multiplicador.");
                } else {
                    String liveStr = liveMult >= 1.0
                            ? String.format(Locale.US, "%.2fx (%s)", liveMult, isCrashedColor ? "CRASH" : "VOANDO")
                            : "--";
                    tvCalibStatus.setText("Aviator OK · Atual: " + liveStr + " · Faixa: " + stripSize + " itens");
                }
            }

            if (hasSignal) {
                if (liveMult >= 1.0 && isCrashedColor && historyDb != null) {
                    if (lastSplitAviatorCrashSaved == null || Math.abs(lastSplitAviatorCrashSaved - liveMult) > 0.01) {
                        historyDb.insertAviatorCrash(System.currentTimeMillis(), activeSiteKey, liveMult, true, confidence, "integrated_browser");
                        lastSplitAviatorCrashSaved = liveMult;
                    }
                }
                BrowserScannerPlugin.emitAviator(
                        liveMult,
                        isCrashedColor,
                        historyNewestFirst,
                        stripSize >= 3,
                        confidence,
                        "integrated_browser"
                );
            }
        });
    }

    private Button createBarButton(String label, String textColorHex, String bgColorHex) {
        Button btn = new Button(this);
        btn.setText(label);
        btn.setAllCaps(false);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        btn.setTextColor(Color.parseColor(textColorHex));
        btn.setBackgroundColor(Color.parseColor(bgColorHex));
        btn.setPadding(dp(6), 0, dp(6), 0);
        btn.setMinWidth(0);
        btn.setMinimumWidth(0);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                dp(32)
        );
        lp.setMarginStart(dp(3));
        btn.setLayoutParams(lp);
        return btn;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
