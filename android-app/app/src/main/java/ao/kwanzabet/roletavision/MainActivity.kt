package ao.kwanzabet.roletavision

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.PixelCopy
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ao.kwanzabet.roletavision.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var db: SpinDatabase
    private val scanner = ScreenScanner()
    private val handler = Handler(Looper.getMainLooper())

    private var scannerEnabled = true
    private var panelExpanded = false
    private var isScanningFrame = false

    // Coordenadas calibradas dentro do WebView (logo abaixo do cabecalho da Kwanzabet)
    private var roiTopRatio = 0.04f
    private var roiHeightRatio = 0.07f
    private var lastObservedStrip: List<Int> = emptyList()

    private val stakeOptions = listOf(10, 25, 50, 100)
    private var stakeIndex = 2 // 50 AOA

    private val prefs by lazy { getSharedPreferences("roleta_prefs", MODE_PRIVATE) }

    private val scanRunnable = object : Runnable {
        override fun run() {
            if (scannerEnabled && !isScanningFrame) {
                captureAndAnalyzeWebView(showCalibrationFeedback = false)
            }
            handler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        db = SpinDatabase(this)
        roiTopRatio = prefs.getFloat("roi_top", 0.04f)
        roiHeightRatio = prefs.getFloat("roi_height", 0.07f)
        stakeIndex = prefs.getInt("stake_index", 2).coerceIn(0, stakeOptions.lastIndex)

        setupWebView()
        setupControls()
        refreshDashboard()

        val savedUrl = prefs.getString("last_url", getString(R.string.default_url))
            ?: getString(R.string.default_url)
        binding.etUrl.setText(savedUrl)
        binding.webView.loadUrl(savedUrl)
    }

    override fun onResume() {
        super.onResume()
        handler.postDelayed(scanRunnable, 1200L)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(scanRunnable)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(binding.webView, true)

        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString =
                "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
        }

        binding.webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                binding.etUrl.setText(url)
                prefs.edit().putString("last_url", url).apply()
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!url.isNullOrBlank()) {
                    binding.etUrl.setText(url)
                    // Oculta barra de URL ao entrar na mesa ao vivo para liberar espaco de toque
                    if (url.contains("LaunchG", ignoreCase = true) ||
                        url.contains("games.", ignoreCase = true)
                    ) {
                        binding.urlBar.visibility = View.GONE
                    }
                }
            }
        }

        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }
        }
    }

    private fun setupControls() {
        binding.btnBack.setOnClickListener {
            if (binding.webView.canGoBack()) binding.webView.goBack()
        }

        binding.btnReload.setOnClickListener {
            binding.webView.reload()
        }

        binding.btnGo.setOnClickListener { navigateToInputUrl() }
        binding.etUrl.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigateToInputUrl()
                true
            } else {
                false
            }
        }

        binding.btnToggleBrowserBar.setOnClickListener {
            binding.urlBar.visibility =
                if (binding.urlBar.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        binding.btnToggleScanner.setOnClickListener {
            scannerEnabled = !scannerEnabled
            binding.btnToggleScanner.text =
                if (scannerEnabled) "Leitura Auto: ATIVA" else "Leitura Auto: PAUSADA"
            binding.btnToggleScanner.backgroundTintList = ContextCompat.getColorStateList(
                this,
                if (scannerEnabled) R.color.accent_emerald else R.color.border_subtle
            )
        }

        binding.btnCalibrate.setOnClickListener {
            val show = binding.calibrationPanel.visibility != View.VISIBLE
            binding.calibrationPanel.visibility = if (show) View.VISIBLE else View.GONE
            binding.roiOverlay.visibility = if (show) View.VISIBLE else View.GONE
            updateRoiOverlayPosition()
        }

        binding.btnTestScan.setOnClickListener {
            binding.tvCalibrationResult.text = "Lendo faixa..."
            captureAndAnalyzeWebView(showCalibrationFeedback = true)
        }

        binding.btnCloseCalibrate.setOnClickListener {
            binding.calibrationPanel.visibility = View.GONE
            binding.roiOverlay.visibility = View.GONE
            prefs.edit()
                .putFloat("roi_top", roiTopRatio)
                .putFloat("roi_height", roiHeightRatio)
                .apply()
        }

        binding.seekRoiTop.progress = (roiTopRatio * 100).toInt()
        binding.seekRoiHeight.progress = (roiHeightRatio * 100).toInt()

        binding.seekRoiTop.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                roiTopRatio = progress / 100f
                updateRoiOverlayPosition()
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        binding.seekRoiHeight.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                roiHeightRatio = progress.coerceAtLeast(3) / 100f
                updateRoiOverlayPosition()
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        binding.btnExpandPanel.setOnClickListener {
            panelExpanded = !panelExpanded
            binding.expandedDetails.visibility = if (panelExpanded) View.VISIBLE else View.GONE
            binding.btnExpandPanel.text = if (panelExpanded) "Recolher" else "Detalhes"
        }

        binding.btnAddManual.setOnClickListener { showManualSpinDialog() }

        binding.btnCycleStake.text = "Ficha: ${stakeOptions[stakeIndex]} AOA"
        binding.btnCycleStake.setOnClickListener {
            stakeIndex = (stakeIndex + 1) % stakeOptions.size
            prefs.edit().putInt("stake_index", stakeIndex).apply()
            binding.btnCycleStake.text = "Ficha: ${stakeOptions[stakeIndex]} AOA"
            refreshDashboard()
        }

        binding.btnClearHistory.setOnClickListener {
            db.clearAll()
            lastObservedStrip = emptyList()
            refreshDashboard()
        }
    }

    private fun updateRoiOverlayPosition() {
        val containerH = binding.webContainer.height
        if (containerH <= 0) return
        val params = binding.roiOverlay.layoutParams as FrameLayout.LayoutParams
        params.topMargin = (containerH * roiTopRatio).toInt()
        params.height = (containerH * roiHeightRatio).toInt().coerceAtLeast(32)
        binding.roiOverlay.layoutParams = params
    }

    private fun navigateToInputUrl() {
        var raw = binding.etUrl.text.toString().trim()
        if (raw.isEmpty()) return
        if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
            raw = "https://$raw"
        }
        prefs.edit().putString("last_url", raw).apply()
        binding.webView.loadUrl(raw)
    }

    private fun captureAndAnalyzeWebView(showCalibrationFeedback: Boolean) {
        val w = binding.webView.width
        val h = binding.webView.height
        if (w < 50 || h < 50) return

        isScanningFrame = true
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val location = IntArray(2)
        binding.webView.getLocationInWindow(location)
        val srcRect = Rect(location[0], location[1], location[0] + w, location[1] + h)

        try {
            PixelCopy.request(window, srcRect, bitmap, { copyResult ->
                if (copyResult == PixelCopy.SUCCESS) {
                    processCapturedBitmap(bitmap, showCalibrationFeedback)
                } else {
                    fallbackCanvasCapture(bitmap, showCalibrationFeedback)
                }
            }, handler)
        } catch (_: Exception) {
            fallbackCanvasCapture(bitmap, showCalibrationFeedback)
        }
    }

    private fun fallbackCanvasCapture(bitmap: Bitmap, showCalibrationFeedback: Boolean) {
        try {
            val canvas = Canvas(bitmap)
            binding.webView.draw(canvas)
            processCapturedBitmap(bitmap, showCalibrationFeedback)
        } catch (_: Exception) {
            bitmap.recycle()
            isScanningFrame = false
            if (showCalibrationFeedback) {
                binding.tvCalibrationResult.text = "Erro ao capturar quadro."
            }
        }
    }

    private fun processCapturedBitmap(bitmap: Bitmap, showCalibrationFeedback: Boolean) {
        scanner.scanHistoryStrip(bitmap, roiTopRatio, roiHeightRatio) { detectedNewestFirst ->
            bitmap.recycle()
            isScanningFrame = false

            if (showCalibrationFeedback) {
                binding.tvCalibrationResult.text = if (detectedNewestFirst.isEmpty()) {
                    "Nenhum numero detectado. Ajuste a caixa verde sobre os numeros."
                } else {
                    "Lidos: ${detectedNewestFirst.joinToString(", ")}"
                }
            }

            if (detectedNewestFirst.size >= 3) {
                reconcileDetectedStrip(detectedNewestFirst)
            }
        }
    }

    private fun reconcileDetectedStrip(newStrip: List<Int>) {
        if (newStrip == lastObservedStrip) return

        if (lastObservedStrip.isEmpty()) {
            db.insertSpinsOldestFirst(newStrip.reversed(), "ocr_init")
            lastObservedStrip = newStrip
            refreshDashboard()
            return
        }

        var matchedShift = -1
        for (shift in 1..minOf(5, newStrip.size - 2)) {
            val overlapLen = minOf(newStrip.size - shift, lastObservedStrip.size)
            if (overlapLen >= 3) {
                val tailNew = newStrip.subList(shift, shift + overlapLen)
                val headOld = lastObservedStrip.subList(0, overlapLen)
                if (tailNew == headOld) {
                    matchedShift = shift
                    break
                }
            }
        }

        if (matchedShift > 0) {
            val newSpinsNewestFirst = newStrip.subList(0, matchedShift)
            db.insertSpinsOldestFirst(newSpinsNewestFirst.reversed(), "ocr_live")
            lastObservedStrip = newStrip
            binding.analysisPanel.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
            refreshDashboard()
        } else if (newStrip.firstOrNull() != lastObservedStrip.firstOrNull() && newStrip.size >= 5) {
            lastObservedStrip = newStrip
        }
    }

    private fun refreshDashboard() {
        val allSpins = db.getSpinsNewestFirst(500)
        val unitAoa = stakeOptions[stakeIndex]
        val analysis = RouletteEngine.analyze(allSpins, unitAoa = unitAoa)
        val sug = analysis.fieldSuggestions
        val acc = analysis.accuracy

        if (allSpins.isEmpty()) {
            binding.tvSummarySuggestion.text = "Abra a roleta ou toque em + Giro para iniciar"
            binding.tvAccuracyBanner.text = "Assertividade: aguardando giros..."
        } else {
            val neighStr = sug.neighbors.joinToString(",")
            binding.tvSummarySuggestion.text =
                "Sugestao: ${sug.color} · ${sug.parity} · ${sug.half} · ${sug.dozenIndex}a Duzia · Col ${sug.columnIndex} · Viz [$neighStr]"

            val lastHits = acc.lastRoundEvals.count { it.hit }
            val lastPart = if (acc.lastRoundEvals.isNotEmpty()) {
                "Ultimo (${acc.lastActualNumber}): $lastHits/6 acertos · "
            } else ""
            binding.tvAccuracyBanner.text =
                "${lastPart}Plataforma: ${"%.1f".format(acc.overallRatePct)}% (${acc.levelLabel})"
        }

        binding.tvAllFieldsAdvice.text =
            "Campos -> Cor: ${sug.color} | Paridade: ${sug.parity} | Forca: ${sug.half} | Bloco: ${sug.dozenLabel} | Coluna: ${sug.columnLabel} | Setor: ${sug.sectorName}"

        if (acc.lastRoundEvals.isEmpty()) {
            binding.tvLastRoundHits.text = "Ultima rodada: registre pelo menos 2 giros para avaliar."
        } else {
            val evalStr = acc.lastRoundEvals.joinToString(" | ") { ev ->
                "${ev.market}: ${if (ev.hit) "ACERTOU" else "ERROU"}"
            }
            binding.tvLastRoundHits.text = "Resultado (${acc.lastActualNumber}): $evalStr"
        }

        val ratesStr = acc.byMarket.joinToString(" · ") { m ->
            "${m.market}: ${"%.0f".format(m.ratePct)}% (${m.hits}/${m.attempts})"
        }
        binding.tvMarketRates.text = "Acertos -> $ratesStr"

        val totalStake = analysis.neighbors.size * analysis.suggestedUnitAoa
        binding.tvBankrollAdvice.text =
            "Cobertura ${"%.1f".format(analysis.coveragePct)}% · Sugestao: ${analysis.suggestedUnitAoa} AOA/ficha (Total $totalStake AOA)"

        binding.tvLearnedCount.text = "Memoria SQLite: ${analysis.totalSpins} giros salvos"

        renderHistoryChips(allSpins.take(16))
    }

    private fun renderHistoryChips(numbers: List<Int>) {
        binding.historyChipRow.removeAllViews()
        if (numbers.isEmpty()) return

        val density = resources.displayMetrics.density
        numbers.forEachIndexed { idx, num ->
            val tv = TextView(this).apply {
                text = num.toString()
                textSize = 12f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                val sizePx = (30 * density).toInt()
                val marginPx = (4 * density).toInt()
                layoutParams = LinearLayout.LayoutParams(sizePx, (26 * density).toInt()).apply {
                    marginEnd = marginPx
                }
                val bgColor = when (RouletteEngine.colorOf(num)) {
                    RouletteColor.GREEN -> ContextCompat.getColor(context, R.color.roulette_green)
                    RouletteColor.RED -> ContextCompat.getColor(context, R.color.roulette_red)
                    RouletteColor.BLACK -> ContextCompat.getColor(context, R.color.roulette_black)
                }
                background = GradientDrawable().apply {
                    cornerRadius = 6 * density
                    setColor(bgColor)
                    if (idx == 0) {
                        setStroke((1.5f * density).toInt(), ContextCompat.getColor(context, R.color.accent_gold))
                    }
                }
            }
            binding.historyChipRow.addView(tv)
        }
    }

    private fun showManualSpinDialog() {
        val input = EditText(this).apply {
            hint = "Numero de 0 a 36"
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        AlertDialog.Builder(this)
            .setTitle("Registrar giro manual")
            .setView(input)
            .setPositiveButton("Adicionar") { _, _ ->
                val num = input.text.toString().trim().toIntOrNull()
                if (num != null && num in 0..36) {
                    db.insertSpinsOldestFirst(listOf(num), "manual")
                    refreshDashboard()
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }
}
