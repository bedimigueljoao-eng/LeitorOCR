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
    private TextView tvCalibStatus;
    private Button btnScanToggle;

    private View capacitorWebView;
    private float browserSplitWeight = 0.56f;

    private final ScreenScanner scanner = new ScreenScanner();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private boolean browserVisible = false;
    private boolean autoScanEnabled = true;
    private boolean isScanningFrame = false;
    private boolean hasLoadedInitialUrl = false;

    private float roiTopRatio = 0.04f;
    private float roiHeightRatio = 0.07f;
    private List<Integer> lastObservedStrip = new ArrayList<>();

    private SharedPreferences prefs;

    private final Runnable scanRunnable = new Runnable() {
        @Override
        public void run() {
            if (browserVisible && autoScanEnabled && !isScanningFrame) {
                captureAndAnalyzeBrowser(false);
            }
            handler.postDelayed(this, 750L);
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
        handler.removeCallbacks(scanRunnable);
        handler.postDelayed(scanRunnable, 1200L);
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

        TextView title = new TextView(this);
        title.setText("Alinhar caixa verde sobre os numeros da roleta");
        title.setTextColor(Color.parseColor("#F1F5F9"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);

        SeekBar seekTop = new SeekBar(this);
        seekTop.setMax(45);
        seekTop.setProgress((int) (roiTopRatio * 100));
        seekTop.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                roiTopRatio = progress / 100f;
                updateRoiOverlayPosition();
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        SeekBar seekHeight = new SeekBar(this);
        seekHeight.setMax(18);
        seekHeight.setProgress((int) (roiHeightRatio * 100));
        seekHeight.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
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
            prefs.edit()
                    .putFloat("roi_top", roiTopRatio)
                    .putFloat("roi_height", roiHeightRatio)
                    .apply();
            calibrationBar.setVisibility(View.GONE);
            roiOverlay.setVisibility(View.GONE);
        });

        btnRow.addView(btnTest);
        btnRow.addView(btnDone);

        bar.addView(title);
        bar.addView(seekTop);
        bar.addView(seekHeight);
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

    public void triggerImmediateScan() {
        if (browserVisible && !isScanningFrame) {
            captureAndAnalyzeBrowser(true);
        }
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
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            int[] loc = new int[2];
            browserWebView.getLocationInWindow(loc);
            Rect srcRect = new Rect(loc[0], loc[1], loc[0] + w, loc[1] + h);
            try {
                PixelCopy.request(getWindow(), srcRect, bitmap, copyResult -> {
                    if (copyResult == PixelCopy.SUCCESS) {
                        processCapturedBitmap(bitmap, showCalibrationFeedback);
                    } else {
                        fallbackCanvasCapture(bitmap, showCalibrationFeedback);
                    }
                }, handler);
            } catch (Exception e) {
                fallbackCanvasCapture(bitmap, showCalibrationFeedback);
            }
        } else {
            fallbackCanvasCapture(bitmap, showCalibrationFeedback);
        }
    }

    private void fallbackCanvasCapture(Bitmap bitmap, boolean showCalibrationFeedback) {
        try {
            Canvas canvas = new Canvas(bitmap);
            browserWebView.draw(canvas);
            processCapturedBitmap(bitmap, showCalibrationFeedback);
        } catch (Exception e) {
            bitmap.recycle();
            isScanningFrame = false;
        }
    }

    private void processCapturedBitmap(Bitmap bitmap, boolean showCalibrationFeedback) {
        scanner.scanHistoryStrip(bitmap, roiTopRatio, roiHeightRatio, detectedNewestFirst -> {
            bitmap.recycle();
            isScanningFrame = false;

            if (showCalibrationFeedback && tvCalibStatus != null) {
                if (detectedNewestFirst.isEmpty()) {
                    tvCalibStatus.setText("Nenhum numero lido. Ajuste a caixa verde sobre a faixa.");
                } else {
                    tvCalibStatus.setText("Lidos: " + detectedNewestFirst.toString());
                }
            }

            if (detectedNewestFirst.size() >= 3) {
                reconcileDetectedStrip(detectedNewestFirst);
            }
        });
    }

    private void reconcileDetectedStrip(List<Integer> newStrip) {
        if (newStrip.equals(lastObservedStrip)) return;

        if (lastObservedStrip.isEmpty()) {
            lastObservedStrip = new ArrayList<>(newStrip);
            BrowserScannerPlugin.emitSpins(newStrip, true);
            return;
        }

        int matchedShift = -1;
        int maxShift = Math.min(5, newStrip.size() - 2);
        for (int shift = 1; shift <= maxShift; shift++) {
            int overlapLen = Math.min(newStrip.size() - shift, lastObservedStrip.size());
            int checkLen = Math.min(4, overlapLen);
            if (checkLen >= 3) {
                int matches = 0;
                for (int k = 0; k < checkLen; k++) {
                    if (newStrip.get(shift + k).equals(lastObservedStrip.get(k))) {
                        matches++;
                    }
                }
                if (matches == checkLen || (checkLen >= 4 && matches >= 3)) {
                    matchedShift = shift;
                    break;
                }
            }
        }

        if (matchedShift > 0) {
            List<Integer> onlyNew = new ArrayList<>(newStrip.subList(0, matchedShift));
            lastObservedStrip = new ArrayList<>(newStrip);
            if (browserPanel != null) {
                browserPanel.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            }
            BrowserScannerPlugin.emitSpins(onlyNew, false);
            return;
        }

        // Verifica se continua na mesma mesa (ex: mesmo inicio com melhoria de leitura na direita)
        int prefixCheck = Math.min(3, Math.min(newStrip.size(), lastObservedStrip.size()));
        boolean sameHead = true;
        for (int k = 0; k < prefixCheck; k++) {
            if (!newStrip.get(k).equals(lastObservedStrip.get(k))) {
                sameHead = false;
                break;
            }
        }
        if (sameHead) {
            lastObservedStrip = new ArrayList<>(newStrip);
            return;
        }

        // Mudanca completa de mesa/faixa: emite faixa completa
        if (newStrip.size() >= 5) {
            lastObservedStrip = new ArrayList<>(newStrip);
            BrowserScannerPlugin.emitSpins(newStrip, true);
        }
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
