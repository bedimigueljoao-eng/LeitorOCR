package com.roletavision.app;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final String DEFAULT_URL = "https://www.kwanzabet.ao";

    private LinearLayout browserPanel;
    private LinearLayout urlBar;
    private FrameLayout browserFrame;
    private WebView browserWebView;
    private EditText etUrl;
    private View roiOverlay;
    private LinearLayout calibrationBar;
    private TextView tvCalibTitle;
    private TextView tvCalibStatus;
    private SeekBar seekRoiTop;
    private SeekBar seekRoiHeight;
    private Button btnScanToggle;

    private View capacitorWebView;
    private float browserSplitWeight = 0.56f;

    private final ScreenScanner scanner = new ScreenScanner();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private boolean browserVisible = false;
    private boolean autoScanEnabled = true;
    private boolean isScanningFrame = false;
    private boolean hasLoadedInitialUrl = false;
    private long activeScanStartMs = 0L;
    private int consecutiveFailures = 0;
    private int totalReadTicks = 0;

    private float roiTopRatio = 0.04f;
    private float roiHeightRatio = 0.07f;
    private String activeGameMode = "roulette";

    private SharedPreferences prefs;

    private final Runnable scanRunnable = new Runnable() {
        @Override
        public void run() {
            // Watchdog: nunca deixa uma falha antiga travar a próxima leitura de 500ms
            if (isScanningFrame && (System.currentTimeMillis() - activeScanStartMs) > 2000L) {
                isScanningFrame = false;
            }
            if (browserVisible && autoScanEnabled && !isScanningFrame) {
                captureAndAnalyzeBrowser(false);
            }
            handler.postDelayed(this, 500L);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BrowserScannerPlugin.class);
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences("roletavision_browser", MODE_PRIVATE);
        roiTopRatio = prefs.getFloat("roi_top", 0.04f);
        roiHeightRatio = prefs.getFloat("roi_height", 0.07f);

        setupIntegratedBrowserSplitLayout();
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

        Button btnClose = createBarButton("X", "#FCA5A5", "#3F1D24");
        btnClose.setOnClickListener(v -> closeIntegratedBrowser());

        urlBar.addView(btnBack);
        urlBar.addView(btnReload);
        urlBar.addView(etUrl);
        urlBar.addView(btnGo);
        urlBar.addView(btnScanToggle);
        urlBar.addView(btnCalib);
        urlBar.addView(btnClose);

        // Area do WebView + Mira verde de calibracao
        browserFrame = new FrameLayout(this);
        browserFrame.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
        ));

        browserWebView = new WebView(this);
        browserWebView.setFocusable(true);
        browserWebView.setFocusableInTouchMode(true);
        browserWebView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        configureBrowserWebView(browserWebView);

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

        browserFrame.addView(browserWebView);
        browserFrame.addView(roiOverlay);
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
        seekRoiTop.setMax(45);
        seekRoiTop.setProgress((int) (roiTopRatio * 100));
        seekRoiTop.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                roiTopRatio = progress / 100f;
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        seekRoiHeight = new SeekBar(this);
        seekRoiHeight.setMax(18);
        seekRoiHeight.setProgress((int) (roiHeightRatio * 100));
        seekRoiHeight.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                roiHeightRatio = Math.max(3, progress) / 100f;
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

        Button btnDone = createBarButton("Confirmar", "#0B0F17", "#10B981");
        btnDone.setLayoutParams(new LinearLayout.LayoutParams(0, dp(34), 1f));
        btnDone.setOnClickListener(v -> {
            if ("bacbo".equals(activeGameMode)) {
                prefs.edit()
                        .putFloat("bacbo_roi_top", roiTopRatio)
                        .putFloat("bacbo_roi_height", roiHeightRatio)
                        .apply();
            } else {
                prefs.edit()
                        .putFloat("roi_top", roiTopRatio)
                        .putFloat("roi_height", roiHeightRatio)
                        .apply();
            }
            calibrationBar.setVisibility(View.GONE);
            roiOverlay.setVisibility(View.GONE);
        });

        btnRow.addView(btnTest);
        btnRow.addView(btnDone);

        bar.addView(tvCalibTitle);
        bar.addView(seekRoiTop);
        bar.addView(seekRoiHeight);
        bar.addView(tvCalibStatus);
        bar.addView(btnRow);
        return bar;
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
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
        );

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && request.isForMainFrame() && request.getUrl() != null) {
                    String u = request.getUrl().toString();
                    if (u.startsWith("http://") || u.startsWith("https://")) {
                        etUrl.setText(u);
                        prefs.edit().putString("last_url", u).apply();
                    }
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && !url.isEmpty() && (url.startsWith("http://") || url.startsWith("https://"))) {
                    etUrl.setText(url);
                }
                handler.postDelayed(() -> {
                    if (browserVisible && autoScanEnabled && !isScanningFrame) {
                        captureAndAnalyzeBrowser(false);
                    }
                }, 900L);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (request != null) {
                    request.grant(request.getResources());
                }
            }
        });
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
        String nextMode = "bacbo".equals(mode) ? "bacbo" : "roulette";
        this.activeGameMode = nextMode;
        this.isScanningFrame = false;

        if (prefs != null) {
            if ("bacbo".equals(nextMode)) {
                roiTopRatio = prefs.getFloat("bacbo_roi_top", 0.66f);
                roiHeightRatio = prefs.getFloat("bacbo_roi_height", 0.15f);
                if (seekRoiTop != null) {
                    seekRoiTop.setMax(85);
                    seekRoiTop.setProgress((int) (roiTopRatio * 100));
                }
                if (seekRoiHeight != null) {
                    seekRoiHeight.setMax(28);
                    seekRoiHeight.setProgress((int) (roiHeightRatio * 100));
                }
                if (tvCalibTitle != null) {
                    tvCalibTitle.setText("Alinhar caixa verde sobre a grelha do Bac Bo");
                }
            } else {
                roiTopRatio = prefs.getFloat("roi_top", 0.04f);
                roiHeightRatio = prefs.getFloat("roi_height", 0.07f);
                if (seekRoiTop != null) {
                    seekRoiTop.setMax(45);
                    seekRoiTop.setProgress((int) (roiTopRatio * 100));
                }
                if (seekRoiHeight != null) {
                    seekRoiHeight.setMax(18);
                    seekRoiHeight.setProgress((int) (roiHeightRatio * 100));
                }
                if (tvCalibTitle != null) {
                    tvCalibTitle.setText("Alinhar caixa verde sobre os numeros da roleta");
                }
            }
            updateRoiOverlayPosition();
        }
    }

    public void triggerImmediateScan() {
        if (!browserVisible) return;
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
        int h = browserFrame.getHeight();
        if (h <= 0) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) roiOverlay.getLayoutParams();
        lp.topMargin = (int) (h * roiTopRatio);
        lp.height = Math.max(dp(28), (int) (h * roiHeightRatio));
        lp.leftMargin = dp(6);
        lp.rightMargin = dp(6);
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
        if ("bacbo".equals(activeGameMode)) {
            processBacBoBitmap(bitmap, showCalibrationFeedback, scanStartMs);
            return;
        }
        scanner.scanHistoryStrip(bitmap, roiTopRatio, roiHeightRatio, (detectedNewestFirst, ocrOk) -> {
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

            if (showCalibrationFeedback) {
                BrowserScannerPlugin.emitScanFeedback(stripSize, "ocr");
            }

            if (showCalibrationFeedback && tvCalibStatus != null) {
                if (!hasNumbers) {
                    tvCalibStatus.setText("Nenhum lido. Arraste a caixa verde sobre os numeros.");
                } else {
                    tvCalibStatus.setText("Lidos: " + detectedNewestFirst.toString());
                }
            }

            if (stripSize >= 3) {
                reconcileDetectedStrip(detectedNewestFirst);
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

    private void reconcileDetectedStrip(List<Integer> newStrip) {
        if (newStrip == null || newStrip.size() < 4) return;

        // Primeira leitura ao abrir mesa: exige 2 leituras concordantes no numero da cabeca
        if (confirmedStrip.isEmpty()) {
            if (newStrip.size() < 5) return;
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
                pendingInitHead = null;
                pendingInitCount = 0;
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

            if (pendingConfirmCount >= 2) {
                confirmedStrip.clear();
                confirmedStrip.addAll(pendingFullStrip != null ? pendingFullStrip : newStrip);
                clearPendingCandidate();
                if (browserPanel != null) {
                    browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
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

    // ==================== BAC BO RECONCILIATION ====================

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
            boolean showCalibrationFeedback,
            long scanStartMs
    ) {
        scanner.scanBacBoStrip(bitmap, roiTopRatio, roiHeightRatio, (cellsNewestFirst, ocrOk) -> {
            long elapsedMs = Math.max(1L, System.currentTimeMillis() - scanStartMs);
            totalReadTicks++;
            boolean hasCells = ocrOk && cellsNewestFirst != null && !cellsNewestFirst.isEmpty();
            if (hasCells) {
                consecutiveFailures = 0;
            } else {
                consecutiveFailures++;
            }

            int headTotal = hasCells ? cellsNewestFirst.get(0).total : -1;
            int stripSize = cellsNewestFirst != null ? cellsNewestFirst.size() : 0;
            BrowserScannerPlugin.emitScanTelemetry(
                    headTotal,
                    elapsedMs,
                    hasCells,
                    consecutiveFailures,
                    stripSize,
                    totalReadTicks
            );

            if (showCalibrationFeedback) {
                BrowserScannerPlugin.emitScanFeedback(stripSize, "bacbo-ocr");
            }

            if (showCalibrationFeedback && tvCalibStatus != null) {
                if (!hasCells) {
                    tvCalibStatus.setText("Bac Bo: Nenhum resultado lido. Ajuste a Mira sobre a grelha.");
                } else {
                    StringBuilder sb = new StringBuilder("Bac Bo lidos (" + stripSize + "): ");
                    for (int i = 0; i < Math.min(8, cellsNewestFirst.size()); i++) {
                        if (i > 0) sb.append(", ");
                        ScreenScanner.BacBoCell c = cellsNewestFirst.get(i);
                        sb.append(c.outcome).append(c.total > 0 ? c.total : "");
                    }
                    tvCalibStatus.setText(sb.toString());
                }
            }

            if (stripSize >= 3) {
                reconcileBacBoPlate(cellsNewestFirst, bitmap);
            } else {
                bitmap.recycle();
                isScanningFrame = false;
            }
        });
    }

    private boolean bacBoCellsEqual(List<ScreenScanner.BacBoCell> a, List<ScreenScanner.BacBoCell> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            if (!a.get(i).signature().equals(b.get(i).signature())) return false;
        }
        return true;
    }

    /**
     * Verifica quantos elementos de source[srcStart..] aparecem em ordem dentro target[tgtStart..].
     * Tolera eventuais falhas pontuais de 1 célula no meio do Bead Plate de 6x20.
     */
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

    private void emitBacBoWithScoreboard(
            Bitmap fullBitmap,
            List<ScreenScanner.BacBoCell> cellsToEmit,
            boolean isFullPlate
    ) {
        if (cellsToEmit.isEmpty()) {
            fullBitmap.recycle();
            isScanningFrame = false;
            return;
        }
        ScreenScanner.BacBoCell head = cellsToEmit.get(0);
        scanner.scanBacBoScoreboard(fullBitmap, roiTopRatio, (pScore, bScore) -> {
            fullBitmap.recycle();
            isScanningFrame = false;

            if (pScore >= 2 && pScore <= 12 && bScore >= 2 && bScore <= 12) {
                String scoreOutcome = pScore > bScore ? "P" : (bScore > pScore ? "B" : "T");
                int scoreWinTotal = Math.max(pScore, bScore);
                if (scoreOutcome.equals(head.outcome)
                        && (head.total < 2 || head.total == scoreWinTotal)) {
                    head.playerTotal = pScore;
                    head.bankerTotal = bScore;
                }
            }

            if (!isFullPlate) {
                lastLiveBacBoEmitMs = System.currentTimeMillis();
                if (browserPanel != null) {
                    browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
                }
            }
            BrowserScannerPlugin.emitBacBo(cellsToEmit, isFullPlate);
        });
    }

    private void reconcileBacBoPlate(List<ScreenScanner.BacBoCell> newCells, Bitmap fullBitmap) {
        if (newCells == null || newCells.size() < 4) {
            fullBitmap.recycle();
            isScanningFrame = false;
            return;
        }

        if (confirmedBacBo.isEmpty()) {
            if (newCells.size() < 5) {
                fullBitmap.recycle();
                isScanningFrame = false;
                return;
            }
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
                emitBacBoWithScoreboard(fullBitmap, newCells, true);
                return;
            }
            fullBitmap.recycle();
            isScanningFrame = false;
            return;
        }

        if (bacBoCellsEqual(newCells, confirmedBacBo)) {
            pendingBacBoNew = null;
            pendingBacBoFull = null;
            pendingBacBoConfirmCount = 0;
            unrelatedBacBoCount = 0;
            fullBitmap.recycle();
            isScanningFrame = false;
            return;
        }

        // 1. Verifica shift <= 0 (mesmo resultado mais recente ou células iniciais ocultadas no OCR)
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
            fullBitmap.recycle();
            isScanningFrame = false;
            return;
        }

        // 2. Verifica shift positivo (+1..+3): entrou novo(s) resultado(s) no Bead Plate
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
            // Cooldown de 8s entre rodadas ao vivo (ciclo real = ~9s pausa + 10-12s dados = ~20s)
            if (lastLiveBacBoEmitMs > 0L && (System.currentTimeMillis() - lastLiveBacBoEmitMs) < 8000L) {
                fullBitmap.recycle();
                isScanningFrame = false;
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
                emitBacBoWithScoreboard(fullBitmap, candidateNew, false);
                return;
            }
            fullBitmap.recycle();
            isScanningFrame = false;
            return;
        }

        // 3. Troca de mesa apenas após 4 leituras seguidas sem alinhamento e 2 confirmações
        pendingBacBoNew = null;
        pendingBacBoFull = null;
        pendingBacBoConfirmCount = 0;
        unrelatedBacBoCount++;
        if (unrelatedBacBoCount >= 4 && newCells.size() >= 5) {
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
                emitBacBoWithScoreboard(fullBitmap, newCells, true);
                return;
            }
        }
        fullBitmap.recycle();
        isScanningFrame = false;
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
