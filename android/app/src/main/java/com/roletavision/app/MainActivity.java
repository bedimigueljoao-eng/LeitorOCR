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
    private View roiOverlay;
    private DebugBoxesView debugBoxesView;
    private LinearLayout calibrationBar;
    private TextView tvCalibTitle;
    private TextView tvCalibStatus;
    private SeekBar seekRoiTop;
    private SeekBar seekRoiHeight;
    private Button btnScanToggle;
    private Button btnBacBoMode;
    private Button btnDebugToggle;

    private View capacitorWebView;
    private float browserSplitWeight = 0.56f;

    private final ScreenScanner scanner = new ScreenScanner();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private RoiConfigStore configStore;
    private GameHistoryDb historyDb;

    private boolean browserVisible = false;
    private boolean autoScanEnabled = true;
    private boolean isScanningFrame = false;
    private boolean hasLoadedInitialUrl = false;
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
        loadRoiForCurrentMode();

        setupIntegratedBrowserSplitLayout();
    }

    private void loadRoiForCurrentMode() {
        if (configStore == null) return;
        RoiConfigStore.RoiRect rect = configStore.getRoiRect(activeGameMode, activeSiteKey);
        roiLeftRatio = rect.leftRatio;
        roiTopRatio = rect.topRatio;
        roiWidthRatio = rect.widthRatio;
        roiHeightRatio = rect.heightRatio;
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

        roiOverlay = new View(this);
        GradientDrawable roiDrawable = new GradientDrawable();
        roiDrawable.setColor(Color.parseColor("#2210B981"));
        roiDrawable.setCornerRadius(dp(6));
        roiDrawable.setStroke(dp(2), Color.parseColor("#10B981"), dp(8), dp(4));
        roiOverlay.setBackground(roiDrawable);
        roiOverlay.setVisibility(View.GONE);
        roiOverlay.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(40)
        ));

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
    }

    private LinearLayout buildCalibrationBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#EE131924"));
        bar.setPadding(dp(12), dp(10), dp(12), dp(10));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
        );
        bar.setLayoutParams(lp);

        tvCalibTitle = new TextView(this);
        tvCalibTitle.setText("Alinhar caixa verde sobre os numeros da roleta");
        tvCalibTitle.setTextColor(Color.parseColor("#F1F5F9"));
        tvCalibTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);

        seekRoiTop = new SeekBar(this);
        seekRoiTop.setMax(85);
        seekRoiTop.setProgress((int) (roiTopRatio * 100));
        seekRoiTop.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                roiTopRatio = progress / 100f;
                lastSplitRoiSig = null;
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        seekRoiHeight = new SeekBar(this);
        seekRoiHeight.setMax(55);
        seekRoiHeight.setProgress((int) (roiHeightRatio * 100));
        seekRoiHeight.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                roiHeightRatio = Math.max(3, progress) / 100f;
                lastSplitRoiSig = null;
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        tvCalibStatus = new TextView(this);
        tvCalibStatus.setText("Toque em Testar para conferir a leitura.");
        tvCalibStatus.setTextColor(Color.parseColor("#FBBF24"));
        tvCalibStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setPadding(0, dp(6), 0, 0);

        Button btnTest = createBarButton("Testar", "#F1F5F9", "#1E293B");
        btnTest.setLayoutParams(new LinearLayout.LayoutParams(0, dp(34), 1f));
        btnTest.setOnClickListener(v -> {
            tvCalibStatus.setText("Lendo faixa...");
            captureAndAnalyzeBrowser(true);
        });

        btnBacBoMode = createBarButton("Modo: " + formatBacBoModeLabel(bacBoScanMode), "#93C5FD", "#1E293B");
        btnBacBoMode.setLayoutParams(new LinearLayout.LayoutParams(0, dp(34), 1.15f));
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
        btnDebugToggle.setLayoutParams(new LinearLayout.LayoutParams(0, dp(34), 0.9f));
        btnDebugToggle.setOnClickListener(v -> setDebugOverlayEnabled(!debugOverlayEnabled));

        Button btnDone = createBarButton("Confirmar", "#0B0F17", "#10B981");
        btnDone.setLayoutParams(new LinearLayout.LayoutParams(0, dp(34), 1f));
        btnDone.setOnClickListener(v -> {
            saveRoiRectForSite(activeGameMode, activeSiteKey, roiLeftRatio, roiTopRatio, roiWidthRatio, roiHeightRatio);
            calibrationBar.setVisibility(View.GONE);
            roiOverlay.setVisibility(View.GONE);
        });

        btnRow.addView(btnTest);
        btnRow.addView(btnBacBoMode);
        btnRow.addView(btnDebugToggle);
        btnRow.addView(btnDone);

        bar.addView(tvCalibTitle);
        bar.addView(seekRoiTop);
        bar.addView(seekRoiHeight);
        bar.addView(tvCalibStatus);
        bar.addView(btnRow);
        return bar;
    }

    private String formatBacBoModeLabel(String mode) {
        if (RoiConfigStore.BACBO_MODE_BLOCKS.equals(mode)) return "Blocos";
        if (RoiConfigStore.BACBO_MODE_BEAD_PLATE.equals(mode)) return "Grelha";
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
        loadRoiForCurrentMode();

        if (seekRoiTop != null) {
            if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
                seekRoiTop.setMax(85);
            } else if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
                seekRoiTop.setMax(65);
            } else {
                seekRoiTop.setMax(45);
            }
            seekRoiTop.setProgress((int) (roiTopRatio * 100));
        }
        if (seekRoiHeight != null) {
            if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
                seekRoiHeight.setMax(50);
            } else if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
                seekRoiHeight.setMax(55);
            } else {
                seekRoiHeight.setMax(18);
            }
            seekRoiHeight.setProgress((int) (roiHeightRatio * 100));
        }
        if (tvCalibTitle != null) {
            if (RoiConfigStore.GAME_BACBO.equals(activeGameMode)) {
                tvCalibTitle.setText("Alinhar caixa verde sobre Jogador (esq.) e Banca (dir.) ou Grelha");
            } else if (RoiConfigStore.GAME_AVIATOR.equals(activeGameMode)) {
                tvCalibTitle.setText("Alinhar caixa verde sobre a faixa + multiplicador do Aviator");
            } else {
                tvCalibTitle.setText("Alinhar caixa verde sobre os numeros da roleta");
            }
        }
        if (btnBacBoMode != null) {
            btnBacBoMode.setVisibility(RoiConfigStore.GAME_BACBO.equals(activeGameMode) ? View.VISIBLE : View.GONE);
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

    public void saveRoiRectForSite(String game, String site, float left, float top, float width, float height) {
        RoiConfigStore.RoiRect rect = new RoiConfigStore.RoiRect(left, top, width, height);
        if (configStore != null) {
            configStore.saveRoiRect(game, site, rect);
        }
        if (RoiConfigStore.normalizeGame(game).equals(activeGameMode)) {
            roiLeftRatio = rect.leftRatio;
            roiTopRatio = rect.topRatio;
            roiWidthRatio = rect.widthRatio;
            roiHeightRatio = rect.heightRatio;
            lastSplitRoiSig = null;
            updateRoiOverlayPosition();
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
        int w = browserFrame.getWidth();
        int h = browserFrame.getHeight();
        if (h <= 0 || w <= 0) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) roiOverlay.getLayoutParams();
        lp.leftMargin = Math.max(dp(4), (int) (w * roiLeftRatio));
        lp.topMargin = (int) (h * roiTopRatio);
        lp.width = Math.max(dp(60), (int) (w * roiWidthRatio) - dp(8));
        lp.height = Math.max(dp(28), (int) (h * roiHeightRatio));
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
        }
        performPixelCopyCapture(wasOverlayVisible, showCalibrationFeedback, activeScanStartMs);
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
        scanner.scanRouletteFrame(bitmap, activeRoi, hsvProfile, debugOverlayEnabled, (detectedNewestFirst, avgConfidence, timestampMs, debugBoxes, hsvSamples, ocrOk) -> {
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

    private final List<Integer> confirmedStrip = new ArrayList<>();
    private List<Integer> pendingHeadSpins = null;
    private List<Integer> pendingFullStrip = null;
    private int pendingConfirmCount = 0;
    private int unrelatedStripCount = 0;
    private Integer pendingInitHead = null;
    private int pendingInitCount = 0;

    private void reconcileDetectedStrip(List<Integer> newStrip, float avgConfidence) {
        if (newStrip == null || newStrip.size() < 3) return;

        // Primeira leitura ao abrir mesa: confirmação instantânea se faixa >=4 com boa confiança, ou 2 leituras
        if (confirmedStrip.isEmpty()) {
            Integer head = newStrip.get(0);
            if (head.equals(pendingInitHead)) {
                pendingInitCount++;
            } else {
                pendingInitHead = head;
                pendingInitCount = 1;
            }
            boolean strongSingleRead = newStrip.size() >= 4 && avgConfidence >= 0.78f;
            if (strongSingleRead || pendingInitCount >= 2) {
                confirmedStrip.clear();
                confirmedStrip.addAll(newStrip);
                pendingInitHead = null;
                pendingInitCount = 0;
                if (historyDb != null) {
                    historyDb.insertRouletteResult(System.currentTimeMillis(), activeSiteKey, newStrip, avgConfidence, "integrated_browser");
                }
                BrowserScannerPlugin.emitSpins(newStrip, true);
            }
            return;
        }

        if (newStrip.equals(confirmedStrip)) {
            clearPendingCandidate();
            return;
        }

        // Procura o melhor alinhamento entre -3 (pilulas da esquerda falharam no OCR) e +4 (novos giros)
        int bestNegShift = 999;
        int bestNegMatches = 0;
        for (int shift = 0; shift >= -3; shift--) {
            int offsetConf = -shift;
            int maxCheck = Math.min(6, Math.min(newStrip.size(), confirmedStrip.size() - offsetConf));
            if (maxCheck < 3) continue;
            int matches = 0;
            for (int i = 0; i < maxCheck; i++) {
                if (newStrip.get(i).equals(confirmedStrip.get(i + offsetConf))) {
                    matches++;
                }
            }
            boolean valid = (maxCheck == 3 && matches == 3)
                    || (maxCheck >= 4 && matches >= Math.max(3, maxCheck - 1));
            if (valid && (matches > bestNegMatches || (matches == bestNegMatches && shift > bestNegShift))) {
                bestNegMatches = matches;
                bestNegShift = shift;
            }
        }

        // Se alinhou com shift <= 0, eh a MESMA faixa (apenas oscilacao de OCR) -> nunca emite giro duplicado!
        if (bestNegShift != 999) {
            clearPendingCandidate();
            if (bestNegShift == 0 && newStrip.size() > confirmedStrip.size() && bestNegMatches >= 4) {
                confirmedStrip.clear();
                confirmedStrip.addAll(newStrip);
            }
            return;
        }

        // Testa shift positivo (+1..+4): realmente entrou numero(s) novo(s) na esquerda
        int bestPosShift = -1;
        int bestPosMatches = 0;
        for (int shift = 1; shift <= 4; shift++) {
            int maxCheck = Math.min(6, Math.min(newStrip.size() - shift, confirmedStrip.size()));
            if (maxCheck < 3) continue;
            int matches = 0;
            for (int i = 0; i < maxCheck; i++) {
                if (newStrip.get(i + shift).equals(confirmedStrip.get(i))) {
                    matches++;
                }
            }
            boolean valid = (maxCheck == 3 && matches == 3)
                    || (maxCheck >= 4 && matches >= Math.max(3, maxCheck - 1));
            if (valid && matches > bestPosMatches) {
                bestPosMatches = matches;
                bestPosShift = shift;
            }
        }

        if (bestPosShift > 0) {
            unrelatedStripCount = 0;
            List<Integer> candidateNew = new ArrayList<>(newStrip.subList(0, bestPosShift));
            if (candidateNew.equals(pendingHeadSpins)) {
                pendingConfirmCount++;
            } else {
                pendingHeadSpins = candidateNew;
                pendingFullStrip = new ArrayList<>(newStrip);
                pendingConfirmCount = 1;
            }

            // Se 3+ números anteriores deslocaram de forma coerente com boa confiança, regista de imediato (< 0.4s)
            boolean fastVerified = bestPosMatches >= 3 && avgConfidence >= 0.74f;
            if (fastVerified || pendingConfirmCount >= 2) {
                confirmedStrip.clear();
                confirmedStrip.addAll(pendingFullStrip != null ? pendingFullStrip : newStrip);
                clearPendingCandidate();
                if (browserPanel != null) {
                    browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                }
                if (historyDb != null) {
                    historyDb.insertRouletteResult(System.currentTimeMillis(), activeSiteKey, candidateNew, avgConfidence, "integrated_browser");
                }
                BrowserScannerPlugin.emitSpins(candidateNew, false);
            }
            return;
        }

        // Frame sem alinhamento claro: so troca de mesa se persistir 4 ciclos seguidos com mesmo inicio
        pendingHeadSpins = null;
        pendingFullStrip = null;
        pendingConfirmCount = 0;
        unrelatedStripCount++;
        if (unrelatedStripCount >= 4 && newStrip.size() >= 5) {
            Integer head = newStrip.get(0);
            if (head.equals(pendingInitHead)) {
                pendingInitCount++;
            } else {
                pendingInitHead = head;
                pendingInitCount = 1;
            }
            if (pendingInitCount >= 2) {
                confirmedStrip.clear();
                confirmedStrip.addAll(newStrip);
                unrelatedStripCount = 0;
                pendingInitHead = null;
                pendingInitCount = 0;
                if (historyDb != null) {
                    historyDb.insertRouletteResult(System.currentTimeMillis(), activeSiteKey, newStrip, avgConfidence, "integrated_browser");
                }
                BrowserScannerPlugin.emitSpins(newStrip, true);
            }
        }
    }

    private void clearPendingCandidate() {
        pendingHeadSpins = null;
        pendingFullStrip = null;
        pendingConfirmCount = 0;
        unrelatedStripCount = 0;
    }

    // ==================== BAC BO RECONCILIATION (3 BLOCOS + BEAD PLATE) ====================

    // Estado para leitura direta nos 3 blocos (JOGADOR | EMPATE | BANCA) em Split-Screen
    private boolean blockRoundLocked = false;
    private int lockedPlayerTotal = -1;
    private int lockedBankerTotal = -1;
    private int pendingBlockP = -1;
    private int pendingBlockB = -1;
    private int pendingBlockStableCount = 0;
    private int emptyBlockFrames = 0;

    // Estado para leitura de Bead Plate quando visível
    private final List<ScreenScanner.BacBoCell> confirmedBacBo = new ArrayList<>();
    private List<ScreenScanner.BacBoCell> pendingBacBoNew = null;
    private List<ScreenScanner.BacBoCell> pendingBacBoFull = null;
    private int pendingBacBoConfirmCount = 0;
    private int unrelatedBacBoCount = 0;
    private String pendingBacBoInitSig = null;
    private int pendingBacBoInitCount = 0;
    private long lastLiveBacBoEmitMs = 0L;

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

            long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
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
                    tvCalibStatus.setText("Bac Bo: Alinhe a Mira sobre os números de Jogador e Banca.");
                }
            }

            if (RoiConfigStore.BACBO_MODE_BLOCKS.equals(resolvedMode) && (hasScore || blocksVisible)) {
                reconcileBacBoBlocks(pTotal, bTotal, confidence);
            } else if (stripSize >= 4) {
                reconcileBacBoPlate(plateCells, confidence);
            }
        });
    }

    private void reconcileBacBoBlocks(int pTotal, int bTotal, float confidence) {
        long nowMs = System.currentTimeMillis();

        if (pTotal >= 2 && bTotal >= 2) {
            emptyBlockFrames = 0;

            if (blockRoundLocked) {
                boolean sameResult = (pTotal == lockedPlayerTotal && bTotal == lockedBankerTotal);
                boolean withinMinCycle = (nowMs - lastLiveBacBoEmitMs) < 3500L;
                if (sameResult || withinMinCycle) {
                    return;
                }
                blockRoundLocked = false;
            }

            if (pTotal == pendingBlockP && bTotal == pendingBlockB) {
                pendingBlockStableCount++;
            } else {
                pendingBlockP = pTotal;
                pendingBlockB = bTotal;
                pendingBlockStableCount = 1;
            }

            // 2 leituras estáveis dos 2 totais confirmam que ambos os dados já pararam de rolar
            if (pendingBlockStableCount >= 2) {
                String outcome = pTotal > bTotal ? "P" : (bTotal > pTotal ? "B" : "T");
                int winTotal = Math.max(pTotal, bTotal);

                ScreenScanner.BacBoCell cell = new ScreenScanner.BacBoCell(outcome, winTotal, 0, 0, 0);
                cell.playerTotal = pTotal;
                cell.bankerTotal = bTotal;

                blockRoundLocked = true;
                lockedPlayerTotal = pTotal;
                lockedBankerTotal = bTotal;
                pendingBlockP = -1;
                pendingBlockB = -1;
                pendingBlockStableCount = 0;
                lastLiveBacBoEmitMs = nowMs;

                if (browserPanel != null) {
                    browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                }
                if (historyDb != null) {
                    historyDb.insertBacBoResult(nowMs, activeSiteKey, outcome, pTotal, bTotal, bacBoScanMode, confidence, "integrated_browser");
                }
                BrowserScannerPlugin.emitBacBo(Collections.singletonList(cell), false);
            }
            return;
        }

        // Dados voltaram a rolar / mesa a preparar próxima ronda
        pendingBlockP = -1;
        pendingBlockB = -1;
        pendingBlockStableCount = 0;
        emptyBlockFrames++;
        if (blockRoundLocked && emptyBlockFrames >= 3 && (nowMs - lastLiveBacBoEmitMs) >= 3000L) {
            blockRoundLocked = false;
        }
    }

    private boolean bacBoCellsEqual(List<ScreenScanner.BacBoCell> a, List<ScreenScanner.BacBoCell> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            if (!a.get(i).signature().equals(b.get(i).signature())) return false;
        }
        return true;
    }

    private int countOrderedMatches(
            List<ScreenScanner.BacBoCell> source,
            int srcStart,
            List<ScreenScanner.BacBoCell> target,
            int tgtStart,
            int window
    ) {
        int matches = 0;
        int tgtCursor = tgtStart;
        int srcLimit = Math.min(source.size(), srcStart + window);
        int tgtLimit = Math.min(target.size(), tgtStart + window + 3);
        for (int i = srcStart; i < srcLimit; i++) {
            String sig = source.get(i).signature();
            for (int j = tgtCursor; j < tgtLimit && j <= tgtCursor + 2; j++) {
                if (sig.equals(target.get(j).signature())) {
                    matches++;
                    tgtCursor = j + 1;
                    break;
                }
            }
        }
        return matches;
    }

    private void reconcileBacBoPlate(List<ScreenScanner.BacBoCell> newCells, float confidence) {
        if (newCells == null || newCells.size() < 4) return;

        if (confirmedBacBo.isEmpty()) {
            String sig = newCells.get(0).signature();
            if (sig.equals(pendingBacBoInitSig)) {
                pendingBacBoInitCount++;
            } else {
                pendingBacBoInitSig = sig;
                pendingBacBoInitCount = 1;
            }
            if (pendingBacBoInitCount >= 2) {
                confirmedBacBo.clear();
                confirmedBacBo.addAll(newCells);
                pendingBacBoInitSig = null;
                pendingBacBoInitCount = 0;
                if (historyDb != null) {
                    ScreenScanner.BacBoCell head = newCells.get(0);
                    historyDb.insertBacBoResult(System.currentTimeMillis(), activeSiteKey, head.outcome, head.playerTotal, head.bankerTotal, bacBoScanMode, confidence, "integrated_browser");
                }
                BrowserScannerPlugin.emitBacBo(newCells, true);
            }
            return;
        }

        if (bacBoCellsEqual(newCells, confirmedBacBo)) {
            pendingBacBoNew = null;
            pendingBacBoFull = null;
            pendingBacBoConfirmCount = 0;
            unrelatedBacBoCount = 0;
            return;
        }

        int bestNegShift = 999;
        int bestNegMatches = 0;
        for (int shift = 0; shift >= -3; shift--) {
            int offsetConf = -shift;
            int avail = Math.min(6, Math.min(newCells.size(), confirmedBacBo.size() - offsetConf));
            if (avail < 3) continue;
            int matches = countOrderedMatches(newCells, 0, confirmedBacBo, offsetConf, avail);
            boolean valid = (avail == 3 && matches == 3)
                    || (avail >= 4 && matches >= Math.max(3, avail - 1));
            if (valid && (matches > bestNegMatches || (matches == bestNegMatches && shift > bestNegShift))) {
                bestNegMatches = matches;
                bestNegShift = shift;
            }
        }

        if (bestNegShift != 999) {
            pendingBacBoNew = null;
            pendingBacBoFull = null;
            pendingBacBoConfirmCount = 0;
            unrelatedBacBoCount = 0;
            if (bestNegShift == 0 && newCells.size() >= confirmedBacBo.size() && bestNegMatches >= 4) {
                confirmedBacBo.clear();
                confirmedBacBo.addAll(newCells);
            }
            return;
        }

        int bestPosShift = -1;
        int bestPosMatches = 0;
        for (int shift = 1; shift <= 3; shift++) {
            int avail = Math.min(6, Math.min(newCells.size() - shift, confirmedBacBo.size()));
            if (avail < 3) continue;
            int matches = countOrderedMatches(newCells, shift, confirmedBacBo, 0, avail);
            boolean valid = (avail == 3 && matches == 3)
                    || (avail >= 4 && matches >= Math.max(3, avail - 1));
            if (valid && matches > bestPosMatches) {
                bestPosMatches = matches;
                bestPosShift = shift;
            }
        }

        if (bestPosShift > 0) {
            unrelatedBacBoCount = 0;
            if (lastLiveBacBoEmitMs > 0L && (System.currentTimeMillis() - lastLiveBacBoEmitMs) < 8000L) {
                return;
            }
            List<ScreenScanner.BacBoCell> candidateNew = new ArrayList<>(newCells.subList(0, bestPosShift));
            if (pendingBacBoNew != null && bacBoCellsEqual(candidateNew, pendingBacBoNew)) {
                pendingBacBoConfirmCount++;
            } else {
                pendingBacBoNew = candidateNew;
                pendingBacBoFull = new ArrayList<>(newCells);
                pendingBacBoConfirmCount = 1;
            }

            if (pendingBacBoConfirmCount >= 2) {
                confirmedBacBo.clear();
                confirmedBacBo.addAll(pendingBacBoFull != null ? pendingBacBoFull : newCells);
                pendingBacBoNew = null;
                pendingBacBoFull = null;
                pendingBacBoConfirmCount = 0;
                lastLiveBacBoEmitMs = System.currentTimeMillis();
                if (browserPanel != null) {
                    browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                }
                if (historyDb != null) {
                    ScreenScanner.BacBoCell head = candidateNew.get(0);
                    historyDb.insertBacBoResult(lastLiveBacBoEmitMs, activeSiteKey, head.outcome, head.playerTotal, head.bankerTotal, bacBoScanMode, confidence, "integrated_browser");
                }
                BrowserScannerPlugin.emitBacBo(candidateNew, false);
            }
            return;
        }

        pendingBacBoNew = null;
        pendingBacBoFull = null;
        pendingBacBoConfirmCount = 0;
        unrelatedBacBoCount++;
        if (unrelatedBacBoCount >= 4 && newCells.size() >= 4) {
            String sig = newCells.get(0).signature();
            if (sig.equals(pendingBacBoInitSig)) {
                pendingBacBoInitCount++;
            } else {
                pendingBacBoInitSig = sig;
                pendingBacBoInitCount = 1;
            }
            if (pendingBacBoInitCount >= 2) {
                confirmedBacBo.clear();
                confirmedBacBo.addAll(newCells);
                unrelatedBacBoCount = 0;
                pendingBacBoInitSig = null;
                pendingBacBoInitCount = 0;
                if (historyDb != null) {
                    ScreenScanner.BacBoCell head = newCells.get(0);
                    historyDb.insertBacBoResult(System.currentTimeMillis(), activeSiteKey, head.outcome, head.playerTotal, head.bankerTotal, bacBoScanMode, confidence, "integrated_browser");
                }
                BrowserScannerPlugin.emitBacBo(newCells, true);
            }
        }
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
