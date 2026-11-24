package com.roletavision.app;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Motor OCR reescrito para Roleta, Bac Bo e Aviator:
 * - Recorte exato de ROI (x, y, w, h)
 * - Escala de cinza + CLAHE local + binarização adaptativa para texto pequeno
 * - Escala inteligente 2x apenas se altura da ROI < 120 px
 * - Amostragem de cor HSV calibrável por site
 * - Modo forçado Bac Bo (Blocos / Bead Plate / Auto) + fallback por cor dominante
 * - Saída de caixas de debug visual + confiança média + timestamp
 */
public class ScreenScanner {

    private static final int MIN_IMAGE_DIMENSION_PX = 40;
    private static final int MIN_ROI_CROP_PX = 16;
    private static final int SMART_UPSCALE_HEIGHT_THRESHOLD_PX = 120;
    private static final int ADAPTIVE_BINARIZE_HEIGHT_THRESHOLD_PX = 140;

    private static final int CLAHE_GRID_COLS = 4;
    private static final int CLAHE_GRID_ROWS = 2;
    private static final float CLAHE_CLIP_FACTOR = 2.6f;
    private static final float ROULETTE_CLAHE_CLIP_FACTOR = 1.45f;

    private static final float MAX_ROULETTE_BOX_HEIGHT_RATIO = 0.88f;
    private static final float MAX_ROULETTE_BOX_WIDTH_RATIO = 2.40f;
    private static final float ROULETTE_ROW_Y_TOLERANCE_RATIO = 0.28f;
    private static final float ROULETTE_MIN_SPACING_FACTOR = 0.48f;

    private static final float AVIATOR_LIVE_MIN_HEIGHT_RATIO = 0.16f;
    private static final float AVIATOR_STRIP_MAX_HEIGHT_RATIO = 0.34f;
    private static final int DHASH_COLS = 9;
    private static final int DHASH_ROWS = 8;

    public enum PillColor {
        GREEN, RED, BLACK
    }

    public static class OcrDebugBox {
        public final float leftRatio;
        public final float topRatio;
        public final float rightRatio;
        public final float bottomRatio;
        public final String text;
        public final String colorLabel;
        public final boolean accepted;
        public final String reason;

        public OcrDebugBox(
                Rect box,
                int imgW,
                int imgH,
                String text,
                String colorLabel,
                boolean accepted,
                String reason
        ) {
            float safeW = Math.max(1f, imgW);
            float safeH = Math.max(1f, imgH);
            this.leftRatio = clampRatio(box.left / safeW);
            this.topRatio = clampRatio(box.top / safeH);
            this.rightRatio = clampRatio(box.right / safeW);
            this.bottomRatio = clampRatio(box.bottom / safeH);
            this.text = text != null ? text : "";
            this.colorLabel = colorLabel != null ? colorLabel : "";
            this.accepted = accepted;
            this.reason = reason != null ? reason : "";
        }

        private static float clampRatio(float v) {
            return Math.max(0f, Math.min(1f, v));
        }
    }

    public static class RoiFrameSignature {
        public final long dHash;
        public final long leftEdgeHash;
        public final int meanLuma;

        public RoiFrameSignature(long dHash, long leftEdgeHash, int meanLuma) {
            this.dHash = dHash;
            this.leftEdgeHash = leftEdgeHash;
            this.meanLuma = meanLuma;
        }
    }

    /**
     * Calcula dHash 64-bit global + dHash 64-bit da borda esquerda (35% iniciais) e luminância média
     * em < 1 ms para detetar imediatamente novos números de roleta ou alterações sem travar frames parados.
     */
    public static RoiFrameSignature computeRoiSignature(Bitmap bitmap, RoiConfigStore.RoiRect roi) {
        if (bitmap == null || bitmap.isRecycled()) return new RoiFrameSignature(0L, 0L, 0);
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        if (w < MIN_IMAGE_DIMENSION_PX || h < MIN_IMAGE_DIMENSION_PX) {
            return new RoiFrameSignature(0L, 0L, 0);
        }

        int x0 = clamp((int) (w * roi.leftRatio), 0, w - 2);
        int y0 = clamp((int) (h * roi.topRatio), 0, h - 2);
        int rw = clamp((int) (w * roi.widthRatio), 16, w - x0);
        int rh = clamp((int) (h * roi.heightRatio), 16, h - y0);

        long hash = computeGridDHash(bitmap, x0, y0, rw, rh, w, h);
        int leftW = Math.max(16, Math.round(rw * 0.35f));
        long leftHash = computeGridDHash(bitmap, x0, y0, leftW, rh, w, h);
        int meanLuma = computeMeanLuma(bitmap, x0, y0, rw, rh, w, h);
        return new RoiFrameSignature(hash, leftHash, meanLuma);
    }

    private static long computeGridDHash(Bitmap bitmap, int x0, int y0, int rw, int rh, int imgW, int imgH) {
        int[][] grid = new int[DHASH_ROWS][DHASH_COLS];
        for (int r = 0; r < DHASH_ROWS; r++) {
            int py = clamp(y0 + ((r * 2 + 1) * rh) / (DHASH_ROWS * 2), 0, imgH - 1);
            for (int c = 0; c < DHASH_COLS; c++) {
                int px = clamp(x0 + ((c * 2 + 1) * rw) / (DHASH_COLS * 2), 0, imgW - 1);
                int pixel = bitmap.getPixel(px, py);
                grid[r][c] = (77 * Color.red(pixel) + 150 * Color.green(pixel) + 29 * Color.blue(pixel)) >> 8;
            }
        }
        long hash = 0L;
        int bit = 0;
        for (int r = 0; r < DHASH_ROWS; r++) {
            for (int c = 0; c < DHASH_COLS - 1; c++) {
                if (grid[r][c] > grid[r][c + 1]) {
                    hash |= (1L << bit);
                }
                bit++;
            }
        }
        return hash;
    }

    private static int computeMeanLuma(Bitmap bitmap, int x0, int y0, int rw, int rh, int imgW, int imgH) {
        long sumLuma = 0L;
        int samples = 0;
        for (int r = 0; r < 4; r++) {
            int py = clamp(y0 + ((r * 2 + 1) * rh) / 8, 0, imgH - 1);
            for (int c = 0; c < 8; c++) {
                int px = clamp(x0 + ((c * 2 + 1) * rw) / 16, 0, imgW - 1);
                int pixel = bitmap.getPixel(px, py);
                sumLuma += (77 * Color.red(pixel) + 150 * Color.green(pixel) + 29 * Color.blue(pixel)) >> 8;
                samples++;
            }
        }
        return (int) (sumLuma / Math.max(1, samples));
    }

    public static boolean hasSignificantRoiChange(RoiFrameSignature prev, RoiFrameSignature curr) {
        if (prev == null || curr == null) return true;
        int hamming = Long.bitCount(prev.dHash ^ curr.dHash);
        int leftHamming = Long.bitCount(prev.leftEdgeHash ^ curr.leftEdgeHash);
        int lumaDiff = Math.abs(prev.meanLuma - curr.meanLuma);
        return hamming >= 2 || leftHamming >= 2 || lumaDiff >= 3;
    }

    private static class PreparedCrop {
        final Bitmap colorBitmap;
        final Bitmap ocrBitmap;
        final int scaleFactor;

        PreparedCrop(Bitmap colorBitmap, Bitmap ocrBitmap, int scaleFactor) {
            this.colorBitmap = colorBitmap;
            this.ocrBitmap = ocrBitmap;
            this.scaleFactor = scaleFactor;
        }

        void recycle() {
            if (ocrBitmap != null && ocrBitmap != colorBitmap && !ocrBitmap.isRecycled()) {
                ocrBitmap.recycle();
            }
            if (colorBitmap != null && !colorBitmap.isRecycled()) {
                colorBitmap.recycle();
            }
        }
    }

    private PreparedCrop preprocessRouletteCropForOcr(
            Bitmap fullBitmap,
            RoiConfigStore.RoiRect roi
    ) {
        int w = fullBitmap.getWidth();
        int h = fullBitmap.getHeight();
        int leftX = clamp((int) (w * roi.leftRatio), 0, w - MIN_ROI_CROP_PX);
        int topY = clamp((int) (h * roi.topRatio), 0, h - MIN_ROI_CROP_PX);
        int cropW = clamp((int) (w * roi.widthRatio), MIN_ROI_CROP_PX, w - leftX);
        int cropH = clamp((int) (h * roi.heightRatio), MIN_ROI_CROP_PX, h - topY);

        Bitmap cropped = Bitmap.createBitmap(fullBitmap, leftX, topY, cropW, cropH);
        int scaleFactor = cropH < 64 ? 3 : (cropH < 130 ? 2 : 1);
        Bitmap colorScaled = scaleFactor > 1
                ? Bitmap.createScaledBitmap(cropped, cropW * scaleFactor, cropH * scaleFactor, true)
                : cropped;
        if (colorScaled != cropped) {
            cropped.recycle();
        }

        Bitmap ocrBitmap = buildClaheGrayscaleBitmap(colorScaled, false, ROULETTE_CLAHE_CLIP_FACTOR);
        return new PreparedCrop(colorScaled, ocrBitmap, scaleFactor);
    }

    private PreparedCrop preprocessCropForOcr(
            Bitmap fullBitmap,
            RoiConfigStore.RoiRect roi,
            boolean forceBinaryForSmall
    ) {
        int w = fullBitmap.getWidth();
        int h = fullBitmap.getHeight();
        int leftX = clamp((int) (w * roi.leftRatio), 0, w - MIN_ROI_CROP_PX);
        int topY = clamp((int) (h * roi.topRatio), 0, h - MIN_ROI_CROP_PX);
        int cropW = clamp((int) (w * roi.widthRatio), MIN_ROI_CROP_PX, w - leftX);
        int cropH = clamp((int) (h * roi.heightRatio), MIN_ROI_CROP_PX, h - topY);

        Bitmap cropped = Bitmap.createBitmap(fullBitmap, leftX, topY, cropW, cropH);
        // Regra explícita: escala inteligente 2x SOMENTE se altura da ROI < 120 px
        int scaleFactor = cropH < SMART_UPSCALE_HEIGHT_THRESHOLD_PX ? 2 : 1;
        Bitmap colorScaled = scaleFactor > 1
                ? Bitmap.createScaledBitmap(cropped, cropW * scaleFactor, cropH * scaleFactor, true)
                : cropped;
        if (colorScaled != cropped) {
            cropped.recycle();
        }

        boolean applyBinary = forceBinaryForSmall && cropH < ADAPTIVE_BINARIZE_HEIGHT_THRESHOLD_PX;
        Bitmap ocrBitmap = buildClaheGrayscaleBitmap(colorScaled, applyBinary, CLAHE_CLIP_FACTOR);
        return new PreparedCrop(colorScaled, ocrBitmap, scaleFactor);
    }

    /**
     * Converte para luminância em escala de cinza + CLAHE por blocos + binarização adaptativa opcional.
     */
    private Bitmap buildClaheGrayscaleBitmap(Bitmap src, boolean adaptiveBinarize, float clipFactor) {
        int w = src.getWidth();
        int h = src.getHeight();
        int total = w * h;
        int[] pixels = new int[total];
        src.getPixels(pixels, 0, w, 0, 0, w, h);

        int[] gray = new int[total];
        for (int i = 0; i < total; i++) {
            int p = pixels[i];
            int r = (p >> 16) & 0xFF;
            int g = (p >> 8) & 0xFF;
            int b = p & 0xFF;
            gray[i] = (77 * r + 150 * g + 29 * b) >> 8;
        }

        // CLAHE local em grade 4x2
        int cols = Math.min(CLAHE_GRID_COLS, Math.max(1, w / 32));
        int rows = Math.min(CLAHE_GRID_ROWS, Math.max(1, h / 24));
        int[][][] luts = new int[rows][cols][256];

        for (int ty = 0; ty < rows; ty++) {
            int y0 = (ty * h) / rows;
            int y1 = ((ty + 1) * h) / rows;
            for (int tx = 0; tx < cols; tx++) {
                int x0 = (tx * w) / cols;
                int x1 = ((tx + 1) * w) / cols;

                int[] hist = new int[256];
                int count = 0;
                for (int y = y0; y < y1; y++) {
                    int rowOff = y * w;
                    for (int x = x0; x < x1; x++) {
                        hist[gray[rowOff + x]]++;
                        count++;
                    }
                }
                if (count == 0) continue;

                int clipLimit = Math.max(2, (int) ((count / 256f) * clipFactor));
                int excess = 0;
                for (int i = 0; i < 256; i++) {
                    if (hist[i] > clipLimit) {
                        excess += hist[i] - clipLimit;
                        hist[i] = clipLimit;
                    }
                }
                int addAll = excess / 256;
                int rem = excess % 256;
                for (int i = 0; i < 256; i++) {
                    hist[i] += addAll + (i < rem ? 1 : 0);
                }

                int cdf = 0;
                for (int i = 0; i < 256; i++) {
                    cdf += hist[i];
                    luts[ty][tx][i] = clamp((cdf * 255) / count, 0, 255);
                }
            }
        }

        int[] enhanced = new int[total];
        for (int y = 0; y < h; y++) {
            float fy = ((y + 0.5f) * rows / h) - 0.5f;
            int ty0 = clamp((int) Math.floor(fy), 0, rows - 1);
            int ty1 = clamp(ty0 + 1, 0, rows - 1);
            float wy = Math.max(0f, Math.min(1f, fy - ty0));

            int rowOff = y * w;
            for (int x = 0; x < w; x++) {
                float fx = ((x + 0.5f) * cols / w) - 0.5f;
                int tx0 = clamp((int) Math.floor(fx), 0, cols - 1);
                int tx1 = clamp(tx0 + 1, 0, cols - 1);
                float wx = Math.max(0f, Math.min(1f, fx - tx0));

                int v = gray[rowOff + x];
                float topVal = luts[ty0][tx0][v] * (1f - wx) + luts[ty0][tx1][v] * wx;
                float botVal = luts[ty1][tx0][v] * (1f - wx) + luts[ty1][tx1][v] * wx;
                int outVal = clamp(Math.round(topVal * (1f - wy) + botVal * wy), 0, 255);
                enhanced[rowOff + x] = outVal;
            }
        }

        if (adaptiveBinarize && w > 8 && h > 8) {
            // Binarização suave preservando anti-aliasing de dígitos claros sobre fundo escuro
            int[] outPixels = new int[total];
            int win = 6;
            for (int y = 0; y < h; y++) {
                int yUp = Math.max(0, y - win);
                int yDn = Math.min(h - 1, y + win);
                int rowOff = y * w;
                for (int x = 0; x < w; x++) {
                    int cVal = enhanced[rowOff + x];
                    int localMean = (enhanced[yUp * w + x] + enhanced[yDn * w + x]
                            + enhanced[rowOff + Math.max(0, x - win)]
                            + enhanced[rowOff + Math.min(w - 1, x + win)]) >> 2;
                    int finalVal;
                    if (cVal > localMean + 18) {
                        finalVal = Math.min(255, cVal + 36);
                    } else if (cVal < localMean - 14) {
                        finalVal = Math.max(0, cVal - 28);
                    } else {
                        finalVal = cVal;
                    }
                    outPixels[rowOff + x] = 0xFF000000 | (finalVal << 16) | (finalVal << 8) | finalVal;
                }
            }
            Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            out.setPixels(outPixels, 0, w, 0, 0, w, h);
            return out;
        }

        int[] outPixels = new int[total];
        for (int i = 0; i < total; i++) {
            int v = enhanced[i];
            outPixels[i] = 0xFF000000 | (v << 16) | (v << 8) | v;
        }
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        out.setPixels(outPixels, 0, w, 0, 0, w, h);
        return out;
    }

    // ==================== ROLETA OCR (HSV + PERFIS POR SITE) ====================

    public interface ScanCallback {
        void onResult(List<Integer> numbersNewestFirst, boolean ocrOk);
    }

    public interface RouletteFrameCallback {
        void onResult(
                List<Integer> numbersNewestFirst,
                float avgConfidence,
                long timestampMs,
                List<OcrDebugBox> debugBoxes,
                List<RoiConfigStore.HsvSample> colorSamples,
                boolean ocrOk
        );
    }

    private static class DetectedPill {
        final int number;
        final int leftX;
        final int centerY;
        final int boxHeight;
        final float confidence;
        final boolean colorMatched;

        DetectedPill(int number, int leftX, int centerY, int boxHeight, float confidence, boolean colorMatched) {
            this.number = number;
            this.leftX = leftX;
            this.centerY = centerY;
            this.boxHeight = boxHeight;
            this.confidence = confidence;
            this.colorMatched = colorMatched;
        }
    }

    private static final Set<Integer> RED_NUMBERS = new HashSet<>(Arrays.asList(
            1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
    ));

    private final TextRecognizer recognizer =
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

    public void scanHistoryStrip(
            Bitmap fullBitmap,
            float roiTopRatio,
            float roiHeightRatio,
            ScanCallback callback
    ) {
        scanRouletteFrame(
                fullBitmap,
                new RoiConfigStore.RoiRect(0f, roiTopRatio, 1f, roiHeightRatio),
                RoiConfigStore.HsvColorProfile.defaultForSite("kwanzabet"),
                true,
                false,
                false,
                (numbersNewestFirst, avgConfidence, timestampMs, debugBoxes, colorSamples, ocrOk) ->
                        callback.onResult(numbersNewestFirst, ocrOk)
        );
    }

    public void scanRouletteFrame(
            Bitmap fullBitmap,
            RoiConfigStore.RoiRect roi,
            RoiConfigStore.HsvColorProfile hsvProfile,
            boolean collectDebug,
            RouletteFrameCallback callback
    ) {
        scanRouletteFrame(fullBitmap, roi, hsvProfile, true, false, collectDebug, callback);
    }

    public void scanRouletteFrame(
            Bitmap fullBitmap,
            RoiConfigStore.RoiRect roi,
            RoiConfigStore.HsvColorProfile hsvProfile,
            boolean newestOnLeft,
            boolean multiplierMode,
            boolean collectDebug,
            RouletteFrameCallback callback
    ) {
        if (fullBitmap == null || fullBitmap.isRecycled()) {
            callback.onResult(Collections.emptyList(), 0f, System.currentTimeMillis(), Collections.emptyList(), Collections.emptyList(), false);
            return;
        }
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        if (width < MIN_IMAGE_DIMENSION_PX || height < MIN_IMAGE_DIMENSION_PX) {
            callback.onResult(Collections.emptyList(), 0f, System.currentTimeMillis(), Collections.emptyList(), Collections.emptyList(), false);
            return;
        }

        final RoiConfigStore.HsvColorProfile profile =
                hsvProfile != null ? hsvProfile : RoiConfigStore.HsvColorProfile.defaultForSite("kwanzabet");
        final PreparedCrop prep = preprocessRouletteCropForOcr(fullBitmap, roi);
        final int sw = prep.ocrBitmap.getWidth();
        final int sh = prep.ocrBitmap.getHeight();

        InputImage image = InputImage.fromBitmap(prep.ocrBitmap, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    List<DetectedPill> candidates = new ArrayList<>();
                    List<OcrDebugBox> debugBoxes = collectDebug ? new ArrayList<>() : Collections.emptyList();
                    List<RoiConfigStore.HsvSample> hsvSamples = collectDebug ? new ArrayList<>() : Collections.emptyList();

                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            for (Text.Element element : line.getElements()) {
                                Rect box = element.getBoundingBox();
                                if (box == null) continue;
                                int bh = box.height();
                                int bw = box.width();
                                if (bh < 7 || bh > sh * MAX_ROULETTE_BOX_HEIGHT_RATIO || bw > sh * MAX_ROULETTE_BOX_WIDTH_RATIO) {
                                    continue;
                                }

                                String raw = element.getText();
                                if (raw == null) continue;
                                String cleaned = raw.trim();
                                if (cleaned.isEmpty()) continue;

                                // Rejeita imediatamente etiquetas de multiplicador ("50x", "250x", "2.5x", etc.)
                                String lower = cleaned.toLowerCase(Locale.US);
                                if (lower.contains("x") || lower.contains("×") || lower.contains(".")) {
                                    if (collectDebug) {
                                        debugBoxes.add(new OcrDebugBox(box, sw, sh, cleaned, "MULT", false, "multiplier-skip"));
                                    }
                                    continue;
                                }

                                // Se o ML Kit colou 2 pílulas vizinhas (ex: "2734" ou "524"), tenta separar com validação de cor HSV
                                if (cleaned.length() >= 3 && cleaned.length() <= 4 && bw > bh * 1.15f) {
                                    if (trySplitGluedPills(cleaned, box, element, prep.colorBitmap, profile,
                                            sw, sh, collectDebug, candidates, debugBoxes, hsvSamples)) {
                                        continue;
                                    }
                                }

                                float[] avgHsv = new float[3];
                                PillColor sampledColor = samplePillColorHsv(prep.colorBitmap, box, profile, avgHsv);
                                Integer parsed = parseRouletteToken(cleaned, sampledColor);
                                String colorTag = sampledColor != null ? sampledColor.name() : "AUTO";
                                if (parsed != null) {
                                    boolean colorMatched = sampledColor != null;
                                    float conf = estimateElementConfidence(element, colorMatched);
                                    candidates.add(new DetectedPill(
                                            parsed,
                                            box.left,
                                            (box.top + box.bottom) / 2,
                                            bh,
                                            conf,
                                            colorMatched
                                    ));
                                    if (collectDebug) {
                                        debugBoxes.add(new OcrDebugBox(box, sw, sh, String.valueOf(parsed), colorTag, true, colorMatched ? "ok" : "auto"));
                                        if (colorMatched) {
                                            hsvSamples.add(new RoiConfigStore.HsvSample(colorTag, avgHsv[0], avgHsv[1], avgHsv[2]));
                                        }
                                    }
                                } else if (collectDebug) {
                                    debugBoxes.add(new OcrDebugBox(box, sw, sh, cleaned, colorTag, false, "cross-check"));
                                }
                            }
                        }
                    }
                    prep.recycle();

                    List<DetectedPill> row = extractMainHorizontalRow(candidates, sh, newestOnLeft, multiplierMode);
                    List<Integer> ordered = new ArrayList<>(row.size());
                    float confSum = 0f;
                    for (DetectedPill pill : row) {
                        ordered.add(pill.number);
                        confSum += pill.confidence;
                    }
                    float avgConf = row.isEmpty() ? 0f : (confSum / row.size());
                    callback.onResult(ordered, avgConf, System.currentTimeMillis(), debugBoxes, hsvSamples, !ordered.isEmpty());
                })
                .addOnFailureListener(e -> {
                    prep.recycle();
                    callback.onResult(Collections.emptyList(), 0f, System.currentTimeMillis(), Collections.emptyList(), Collections.emptyList(), false);
                });
    }

    private boolean trySplitGluedPills(
            String digits,
            Rect box,
            Text.Element element,
            Bitmap colorBitmap,
            RoiConfigStore.HsvColorProfile profile,
            int sw,
            int sh,
            boolean collectDebug,
            List<DetectedPill> outCandidates,
            List<OcrDebugBox> debugBoxes,
            List<RoiConfigStore.HsvSample> hsvSamples
    ) {
        for (int i = 0; i < digits.length(); i++) {
            if (!Character.isDigit(digits.charAt(i))) return false;
        }
        int len = digits.length();
        for (int split = 1; split < len; split++) {
            if (split > 2 || (len - split) > 2) continue;
            String p1 = digits.substring(0, split);
            String p2 = digits.substring(split);
            int splitX = box.left + Math.round(box.width() * (split / (float) len));
            Rect b1 = new Rect(box.left, box.top, Math.max(box.left + 4, splitX - 1), box.bottom);
            Rect b2 = new Rect(Math.min(box.right - 4, splitX + 1), box.top, box.right, box.bottom);

            float[] hsv1 = new float[3];
            float[] hsv2 = new float[3];
            PillColor c1 = samplePillColorHsv(colorBitmap, b1, profile, hsv1);
            PillColor c2 = samplePillColorHsv(colorBitmap, b2, profile, hsv2);
            if (c1 == null || c2 == null) continue;

            Integer n1 = parseRouletteToken(p1, c1);
            Integer n2 = parseRouletteToken(p2, c2);
            if (n1 != null && n2 != null) {
                int cy = (box.top + box.bottom) / 2;
                float conf = Math.min(0.92f, estimateElementConfidence(element, true) * 0.94f);
                outCandidates.add(new DetectedPill(n1, b1.left, cy, b1.height(), conf, true));
                outCandidates.add(new DetectedPill(n2, b2.left, cy, b2.height(), conf, true));
                if (collectDebug) {
                    debugBoxes.add(new OcrDebugBox(b1, sw, sh, String.valueOf(n1), c1.name(), true, "split-1"));
                    debugBoxes.add(new OcrDebugBox(b2, sw, sh, String.valueOf(n2), c2.name(), true, "split-2"));
                    hsvSamples.add(new RoiConfigStore.HsvSample(c1.name(), hsv1[0], hsv1[1], hsv1[2]));
                    hsvSamples.add(new RoiConfigStore.HsvSample(c2.name(), hsv2[0], hsv2[1], hsv2[2]));
                }
                return true;
            }
        }
        return false;
    }

    private float estimateElementConfidence(Text.Element element, boolean colorMatched) {
        float raw = element.getConfidence();
        if (raw > 0f) {
            return colorMatched
                    ? Math.min(0.98f, raw * 0.88f + 0.12f)
                    : Math.min(0.75f, raw * 0.60f);
        }
        return colorMatched ? 0.72f : 0.45f;
    }

    private List<DetectedPill> extractMainHorizontalRow(
            List<DetectedPill> candidates,
            int scaledH,
            boolean newestOnLeft,
            boolean multiplierMode
    ) {
        if (candidates.isEmpty()) return Collections.emptyList();

        List<DetectedPill> pool = candidates;
        if (multiplierMode && candidates.size() >= 3) {
            int maxUpperH = 0;
            for (DetectedPill p : candidates) {
                if (p.centerY <= scaledH * 0.72f && p.boxHeight > maxUpperH) {
                    maxUpperH = p.boxHeight;
                }
            }
            if (maxUpperH > 0) {
                List<DetectedPill> filtered = new ArrayList<>();
                for (DetectedPill p : candidates) {
                    if (p.centerY > scaledH * 0.74f && p.boxHeight < maxUpperH * 0.72f) {
                        continue;
                    }
                    filtered.add(p);
                }
                if (!filtered.isEmpty()) pool = filtered;
            }
        }

        int yTolerance = Math.max(12, (int) (scaledH * ROULETTE_ROW_Y_TOLERANCE_RATIO));
        List<DetectedPill> bestRow = Collections.emptyList();
        int bestScore = -1;

        for (DetectedPill anchor : pool) {
            List<DetectedPill> row = new ArrayList<>();
            int colorMatchedCount = 0;
            for (DetectedPill other : pool) {
                if (Math.abs(other.centerY - anchor.centerY) <= yTolerance) {
                    row.add(other);
                    if (other.colorMatched) colorMatchedCount++;
                }
            }
            int score = row.size() * 10 + colorMatchedCount * 6;
            if (score > bestScore) {
                bestScore = score;
                bestRow = row;
            }
        }

        if (bestRow.isEmpty()) return Collections.emptyList();

        // Exige pelo menos 2 pílulas com cor validada no strip se houver 3+ candidatos (evita texto de UI branco solto)
        int colorCount = 0;
        int sumY = 0;
        for (DetectedPill p : bestRow) {
            if (p.colorMatched) colorCount++;
            sumY += p.centerY;
        }
        if (bestRow.size() >= 2 && colorCount < Math.min(2, bestRow.size())) {
            if (colorCount == 0) return Collections.emptyList();
        }
        int medianY = sumY / bestRow.size();
        int strictUncoloredTol = Math.max(8, (int) (yTolerance * 0.65f));

        List<DetectedPill> sorted = new ArrayList<>();
        for (DetectedPill p : bestRow) {
            if (!p.colorMatched && Math.abs(p.centerY - medianY) > strictUncoloredTol) {
                continue;
            }
            sorted.add(p);
        }
        Collections.sort(sorted, (a, b) -> Integer.compare(a.leftX, b.leftX));

        List<DetectedPill> deduped = new ArrayList<>();
        int lastX = -9999;
        for (DetectedPill p : sorted) {
            int minSpacing = Math.max(8, (int) (p.boxHeight * ROULETTE_MIN_SPACING_FACTOR));
            if (p.leftX - lastX >= minSpacing) {
                deduped.add(p);
                lastX = p.leftX;
            } else if (!deduped.isEmpty()) {
                DetectedPill prev = deduped.get(deduped.size() - 1);
                if (!prev.colorMatched && p.colorMatched) {
                    deduped.set(deduped.size() - 1, p);
                    lastX = p.leftX;
                }
            }
        }

        if (!newestOnLeft) {
            Collections.reverse(deduped);
        }
        return deduped;
    }

    private Integer parseRouletteToken(String rawText, PillColor color) {
        if (rawText == null) return null;
        String trimmed = rawText.trim();
        if (trimmed.isEmpty() || trimmed.length() > 2) return null;

        String cleaned = trimmed;
        if (cleaned.length() == 1 && (cleaned.equals("O") || cleaned.equals("o"))) {
            return color == PillColor.GREEN ? 0 : null;
        }
        if (cleaned.length() == 2) {
            cleaned = cleaned.replace("O", "0").replace("o", "0");
        }

        for (int i = 0; i < cleaned.length(); i++) {
            if (!Character.isDigit(cleaned.charAt(i))) {
                return null;
            }
        }

        int num;
        try {
            num = Integer.parseInt(cleaned);
        } catch (NumberFormatException e) {
            return null;
        }

        if (num < 0 || num > 36) return null;
        if (color == null) {
            return num >= 1 ? num : null;
        }
        if (num == 0 && color != PillColor.GREEN) return null;
        if (num != 0 && color == PillColor.GREEN) return null;

        boolean isRedExpected = RED_NUMBERS.contains(num);
        if (color == PillColor.RED && !isRedExpected) return null;
        if (color == PillColor.BLACK && (num == 0 || isRedExpected)) return null;

        return num;
    }

    /**
     * Amostragem HSV no interior da pílula (grade 5x5 dentro de box ±1px),
     * filtrando os traços brancos/dourados do texto para ler exatamente o fundo daquela célula.
     */
    private PillColor samplePillColorHsv(
            Bitmap bitmap,
            Rect box,
            RoiConfigStore.HsvColorProfile profile,
            float[] outAvgHsv
    ) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int xStart = clamp(box.left - 1, 0, w - 1);
        int xEnd = clamp(box.right + 1, 0, w - 1);
        int yStart = clamp(box.top - 1, 0, h - 1);
        int yEnd = clamp(box.bottom + 1, 0, h - 1);
        if (xEnd <= xStart || yEnd <= yStart) return null;

        int votesGreen = 0;
        int votesRed = 0;
        int votesBlack = 0;
        float sumH = 0f, sumS = 0f, sumV = 0f;
        int validCount = 0;
        float[] hsv = new float[3];

        for (int r = 0; r < 5; r++) {
            int py = clamp(yStart + (r * (yEnd - yStart)) / 4, 0, h - 1);
            for (int c = 0; c < 5; c++) {
                int px = clamp(xStart + (c * (xEnd - xStart)) / 4, 0, w - 1);
                int pixel = bitmap.getPixel(px, py);
                Color.colorToHSV(pixel, hsv);
                float hue = hsv[0];
                float sat = hsv[1];
                float val = hsv[2];

                // Ignora tinta branca dos dígitos
                if (sat < 0.20f && val > 0.62f) continue;
                // Ignora realce dourado de pílula destacada / multiplicador
                if (hue >= 24f && hue <= 62f && sat >= 0.45f && val >= 0.70f) continue;

                sumH += hue;
                sumS += sat;
                sumV += val;
                validCount++;

                if (hue >= profile.greenHueMin && hue <= profile.greenHueMax
                        && sat >= profile.greenMinSat && val >= profile.greenMinVal) {
                    votesGreen++;
                } else if ((hue <= profile.redHueLowMax || hue >= profile.redHueHighMin)
                        && sat >= profile.redMinSat && val >= profile.redMinVal) {
                    votesRed++;
                } else if ((sat <= profile.blackMaxSat && val <= profile.blackMaxVal + 0.14f) || val <= 0.24f) {
                    votesBlack++;
                }
            }
        }

        if (outAvgHsv != null && validCount > 0) {
            outAvgHsv[0] = sumH / validCount;
            outAvgHsv[1] = sumS / validCount;
            outAvgHsv[2] = sumV / validCount;
        }

        if (votesGreen > votesRed && votesGreen >= votesBlack && votesGreen >= 3) return PillColor.GREEN;
        if (votesRed > votesGreen && votesRed >= votesBlack && votesRed >= 3) return PillColor.RED;
        if (votesBlack > votesRed && votesBlack > votesGreen && votesBlack >= 4) return PillColor.BLACK;
        return null;
    }

    // ==================== BAC BO OCR (MODOS EXPLÍCITOS + FALLBACK COR) ====================

    public static class BacBoCell {
        public final String outcome; // "P", "B", "T"
        public final int total;      // 2..12 or -1 if unknown (color-only fallback)
        public final int centerX;
        public final int centerY;
        public final int boxHeight;
        public int playerTotal = -1;
        public int bankerTotal = -1;
        public boolean colorFallback = false;

        public BacBoCell(String outcome, int total, int centerX, int centerY, int boxHeight) {
            this.outcome = outcome;
            this.total = total;
            this.centerX = centerX;
            this.centerY = centerY;
            this.boxHeight = boxHeight;
        }

        public String signature() {
            return outcome + ":" + total;
        }
    }

    public interface BacBoFrameCallback {
        void onResult(
                int playerTotal,
                int bankerTotal,
                boolean blocksVisible,
                List<BacBoCell> plateCellsNewestFirst,
                boolean ocrOk
        );
    }

    public interface BacBoDetailedCallback {
        void onResult(
                int playerTotal,
                int bankerTotal,
                boolean blocksVisible,
                List<BacBoCell> plateCellsNewestFirst,
                float confidence,
                String resolvedMode,
                List<OcrDebugBox> debugBoxes,
                boolean ocrOk
        );
    }

    private PreparedCrop preprocessBacBoCropForOcr(
            Bitmap fullBitmap,
            RoiConfigStore.RoiRect roi
    ) {
        int w = fullBitmap.getWidth();
        int h = fullBitmap.getHeight();
        int leftX = clamp((int) (w * roi.leftRatio), 0, w - MIN_ROI_CROP_PX);
        int topY = clamp((int) (h * roi.topRatio), 0, h - MIN_ROI_CROP_PX);
        int cropW = clamp((int) (w * roi.widthRatio), MIN_ROI_CROP_PX, w - leftX);
        int cropH = clamp((int) (h * roi.heightRatio), MIN_ROI_CROP_PX, h - topY);

        Bitmap cropped = Bitmap.createBitmap(fullBitmap, leftX, topY, cropW, cropH);
        int scaleFactor = cropH < 64 ? 3 : (cropH < 150 ? 2 : 1);
        Bitmap colorScaled = scaleFactor > 1
                ? Bitmap.createScaledBitmap(cropped, cropW * scaleFactor, cropH * scaleFactor, true)
                : cropped;
        if (colorScaled != cropped) {
            cropped.recycle();
        }

        // CLAHE suave sem binarização agressiva preserva os dígitos brancos dentro das bolas e blocos coloridos
        Bitmap ocrBitmap = buildClaheGrayscaleBitmap(colorScaled, false, ROULETTE_CLAHE_CLIP_FACTOR);
        return new PreparedCrop(colorScaled, ocrBitmap, scaleFactor);
    }

    public void scanBacBoFrame(
            Bitmap fullBitmap,
            float roiTopRatio,
            float roiHeightRatio,
            BacBoFrameCallback callback
    ) {
        scanBacBoFrame(
                fullBitmap,
                new RoiConfigStore.RoiRect(0f, roiTopRatio, 1f, roiHeightRatio),
                RoiConfigStore.BACBO_MODE_AUTO,
                RoiConfigStore.HsvColorProfile.defaultForSite("kwanzabet"),
                false,
                (pTotal, bTotal, blocksVisible, plateCellsNewestFirst, confidence, resolvedMode, debugBoxes, ocrOk) ->
                        callback.onResult(pTotal, bTotal, blocksVisible, plateCellsNewestFirst, ocrOk)
        );
    }

    public void scanBacBoFrame(
            Bitmap fullBitmap,
            RoiConfigStore.RoiRect roi,
            String scanMode,
            RoiConfigStore.HsvColorProfile hsvProfile,
            boolean collectDebug,
            BacBoDetailedCallback callback
    ) {
        if (fullBitmap == null || fullBitmap.isRecycled()) {
            callback.onResult(-1, -1, false, Collections.emptyList(), 0f, scanMode, Collections.emptyList(), false);
            return;
        }
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        if (width < MIN_IMAGE_DIMENSION_PX || height < MIN_IMAGE_DIMENSION_PX) {
            callback.onResult(-1, -1, false, Collections.emptyList(), 0f, scanMode, Collections.emptyList(), false);
            return;
        }

        final String mode = scanMode != null ? scanMode : RoiConfigStore.BACBO_MODE_AUTO;
        final RoiConfigStore.HsvColorProfile profile =
                hsvProfile != null ? hsvProfile : RoiConfigStore.HsvColorProfile.defaultForSite("kwanzabet");
        final PreparedCrop prep = preprocessBacBoCropForOcr(fullBitmap, roi);
        final int sw = prep.ocrBitmap.getWidth();
        final int sh = prep.ocrBitmap.getHeight();

        InputImage image = InputImage.fromBitmap(prep.ocrBitmap, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    int bestP = -1;
                    int bestPScore = -1;
                    boolean pColorMatched = false;

                    int bestB = -1;
                    int bestBScore = -1;
                    boolean bColorMatched = false;

                    boolean blocksVisible = false;
                    List<BacBoCell> plateNumCandidates = new ArrayList<>();
                    List<OcrDebugBox> debugBoxes = collectDebug ? new ArrayList<>() : Collections.emptyList();

                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            for (Text.Element element : line.getElements()) {
                                String rawText = element.getText();
                                if (rawText == null) continue;
                                String trimmed = rawText.trim();
                                String upper = trimmed.toUpperCase(Locale.US);
                                if (upper.contains("JOGADOR") || upper.contains("PLAYER")
                                        || upper.contains("BANCA") || upper.contains("BANKER")
                                        || upper.contains("EMPATE") || upper.contains("TIE")
                                        || upper.contains("TOTAL") || upper.equals("1:1")) {
                                    blocksVisible = true;
                                }

                                Rect box = element.getBoundingBox();
                                if (box == null) continue;
                                int bh = box.height();
                                int bw = box.width();
                                int cx = (box.left + box.right) / 2;
                                int cy = (box.top + box.bottom) / 2;

                                Integer num = parseBacBoNumberOnly(trimmed);
                                if (num == null) continue;

                                // 1. Modo Direto Jogador (esq) vs Banca (dir): compara diretamente os totais (2..12)
                                if (!RoiConfigStore.BACBO_MODE_BEAD_PLATE.equals(mode)
                                        && bh >= Math.max(10, (int) (sh * 0.06f))
                                        && cy < sh * 0.92f) {
                                    String cardSide = sampleBlockCardInteriorHsv(prep.colorBitmap, box, profile);
                                    if (cx < sw * 0.49f && !"B".equals(cardSide)) {
                                        boolean isBlue = "P".equals(cardSide);
                                        int score = bh + (isBlue ? 120 : 0);
                                        if (score > bestPScore) {
                                            bestP = num;
                                            bestPScore = score;
                                            pColorMatched = isBlue;
                                        }
                                        if (collectDebug) {
                                            debugBoxes.add(new OcrDebugBox(box, sw, sh, "P:" + num, isBlue ? "P" : "LEFT", true, "player-total"));
                                        }
                                    } else if (cx > sw * 0.51f && !"P".equals(cardSide)) {
                                        boolean isRed = "B".equals(cardSide);
                                        int score = bh + (isRed ? 120 : 0);
                                        if (score > bestBScore) {
                                            bestB = num;
                                            bestBScore = score;
                                            bColorMatched = isRed;
                                        }
                                        if (collectDebug) {
                                            debugBoxes.add(new OcrDebugBox(box, sw, sh, "B:" + num, isRed ? "B" : "RIGHT", true, "banker-total"));
                                        }
                                    }
                                }

                                // 2. Candidatos numéricos para fusão na grelha Bead Plate
                                if (!RoiConfigStore.BACBO_MODE_BLOCKS.equals(mode)
                                        && bh >= 7
                                        && bh <= sh * 0.38f
                                        && bw <= sh * 0.90f) {
                                    String outcomeColor = sampleBacBoOutcomeColorHsv(prep.colorBitmap, box, profile);
                                    plateNumCandidates.add(new BacBoCell(
                                            outcomeColor != null ? outcomeColor : "U",
                                            num,
                                            cx,
                                            cy,
                                            bh
                                    ));
                                }
                            }
                        }
                    }

                    // Se não detetou palavras-chave nem cor nos blocos, só aceita totais grandes/coloridos para evitar temporizadores
                    if (!blocksVisible && !pColorMatched && !bColorMatched) {
                        if (bestPScore < Math.max(18, (int) (sh * 0.14f))
                                || bestBScore < Math.max(18, (int) (sh * 0.14f))) {
                            bestP = -1;
                            bestB = -1;
                        }
                    }

                    boolean bothScoresReady = bestP >= 2 && bestB >= 2;
                    if (bothScoresReady && (blocksVisible || pColorMatched || bColorMatched)) {
                        blocksVisible = true;
                    }

                    List<BacBoCell> orderedPlate = Collections.emptyList();
                    String resolvedMode = mode;
                    float confidence = 0f;

                    boolean preferBlocks = RoiConfigStore.BACBO_MODE_BLOCKS.equals(mode)
                            || (RoiConfigStore.BACBO_MODE_AUTO.equals(mode) && (bothScoresReady || blocksVisible));

                    if (preferBlocks) {
                        resolvedMode = RoiConfigStore.BACBO_MODE_BLOCKS;
                        if (bothScoresReady) {
                            confidence = (pColorMatched && bColorMatched) ? 0.95f : 0.84f;
                        } else if (bestP >= 2 || bestB >= 2) {
                            confidence = 0.55f;
                        } else if (blocksVisible) {
                            confidence = 0.45f;
                        }
                    } else {
                        resolvedMode = RoiConfigStore.BACBO_MODE_BEAD_PLATE;
                        List<BacBoCell> hybridCells = scanBacBoBeadPlateHybrid(
                                prep.colorBitmap,
                                plateNumCandidates,
                                profile,
                                debugBoxes,
                                collectDebug
                        );
                        if (hybridCells.size() >= 4) {
                            orderedPlate = hybridCells;
                            int withTotals = 0;
                            for (BacBoCell cell : orderedPlate) {
                                if (cell.total >= 2 && cell.total <= 12) withTotals++;
                            }
                            float totalRatio = orderedPlate.isEmpty() ? 0f : (float) withTotals / orderedPlate.size();
                            confidence = Math.min(0.96f, 0.72f + totalRatio * 0.24f);
                        } else {
                            // Fallback puro de elementos ML Kit com cor confirmada
                            List<BacBoCell> coloredOnly = new ArrayList<>();
                            for (BacBoCell c : plateNumCandidates) {
                                if ("P".equals(c.outcome) || "B".equals(c.outcome) || "T".equals(c.outcome)) {
                                    coloredOnly.add(c);
                                }
                            }
                            if (coloredOnly.size() >= 4) {
                                orderedPlate = orderBacBoCells(coloredOnly);
                                confidence = 0.72f;
                            }
                        }
                    }

                    prep.recycle();

                    boolean ocrOk = bothScoresReady || blocksVisible || !orderedPlate.isEmpty();
                    callback.onResult(bestP, bestB, blocksVisible, orderedPlate, confidence, resolvedMode, debugBoxes, ocrOk);
                })
                .addOnFailureListener(e -> {
                    prep.recycle();
                    callback.onResult(-1, -1, false, Collections.emptyList(), 0f, mode, Collections.emptyList(), false);
                });
    }

    /**
     * Detector híbrido para Bead Plate (6 linhas):
     * 1) Localiza a caixa exata das bolas azuis (P) e vermelhas (B) para ignorar bordas castanhas/douradas da mesa
     * 2) Segmenta dinamicamente até 6 linhas e todas as colunas preenchidas
     * 3) Classifica cada bola por HSV (P/B/T) e associa o dígito (2..12) do ML Kit pelo centro (x, y).
     */
    private List<BacBoCell> scanBacBoBeadPlateHybrid(
            Bitmap colorBitmap,
            List<BacBoCell> mlKitNumCandidates,
            RoiConfigStore.HsvColorProfile profile,
            List<OcrDebugBox> debugBoxes,
            boolean collectDebug
    ) {
        int w = colorBitmap.getWidth();
        int h = colorBitmap.getHeight();
        if (w < 60 || h < 30) return Collections.emptyList();

        float[] hsv = new float[3];
        int step = Math.max(1, Math.min(w, h) / 90);

        // Passo 1: âncoras Blue (P) e Red (B) isolam a área exata da grelha e evitam confundir feltro castanho com Tie
        int anchorMinX = w, anchorMaxX = -1, anchorMinY = h, anchorMaxY = -1;
        int anchorCount = 0;
        for (int y = 0; y < h; y += step) {
            for (int x = 0; x < w; x += step) {
                Color.colorToHSV(colorBitmap.getPixel(x, y), hsv);
                boolean anyP = hsv[0] >= profile.blueHueMin - 6f && hsv[0] <= profile.blueHueMax + 6f
                        && hsv[1] >= 0.18f && hsv[2] >= 0.22f;
                boolean anyB = (hsv[0] <= Math.min(20f, profile.redHueLowMax) || hsv[0] >= profile.redHueHighMin)
                        && hsv[1] >= 0.24f && hsv[2] >= 0.22f;
                if (anyP || anyB) {
                    anchorCount++;
                    if (x < anchorMinX) anchorMinX = x;
                    if (x > anchorMaxX) anchorMaxX = x;
                    if (y < anchorMinY) anchorMinY = y;
                    if (y > anchorMaxY) anchorMaxY = y;
                }
            }
        }

        int gridTop;
        int gridBottom;
        int scanLeft;
        int scanRight;

        if (anchorCount >= 10 && anchorMaxY > anchorMinY + 12 && anchorMaxX > anchorMinX + 12) {
            int spanY = anchorMaxY - anchorMinY;
            int padY = Math.max(2, Math.round(spanY * 0.045f));
            gridTop = Math.max(0, anchorMinY - padY);
            gridBottom = Math.min(h - 1, anchorMaxY + padY);
            int estRowH = Math.max(8, (gridBottom - gridTop) / 6);
            scanLeft = Math.max(0, anchorMinX - Math.round(estRowH * 0.25f));
            scanRight = Math.min(w - 1, anchorMaxX + Math.round(estRowH * 1.15f));
        } else {
            gridTop = 0;
            gridBottom = h - 1;
            scanLeft = 0;
            scanRight = w - 1;
        }

        int gridH = gridBottom - gridTop + 1;
        int rows = gridH >= 48 ? 6 : 1;
        float rowH = gridH / (float) rows;
        int colStep = Math.max(1, Math.round(rowH / 12f));
        int yStep = Math.max(1, Math.round(rowH / 10f));

        // Passo 2: perfil vertical dentro de [gridTop..gridBottom] para detetar colunas preenchidas
        int xBins = Math.max(1, (scanRight - scanLeft) / colStep + 1);
        int[] colHits = new int[xBins];
        int yRowsChecked = 0;
        for (int y = gridTop + Math.max(1, Math.round(rowH * 0.12f)); y <= gridBottom - Math.round(rowH * 0.12f); y += yStep) {
            yRowsChecked++;
            for (int bi = 0; bi < xBins; bi++) {
                int x = Math.min(scanRight, scanLeft + bi * colStep);
                Color.colorToHSV(colorBitmap.getPixel(x, y), hsv);
                String c = classifyBacBoGridPixelHsv(hsv[0], hsv[1], hsv[2], profile);
                if (c != null) {
                    colHits[bi]++;
                }
            }
        }
        if (yRowsChecked < 3) return Collections.emptyList();

        int minColBinHits = Math.max(2, yRowsChecked / 7);
        List<int[]> rawBands = new ArrayList<>();
        boolean inBand = false;
        int bandStartX = scanLeft;
        for (int bi = 0; bi < xBins; bi++) {
            int x = Math.min(scanRight, scanLeft + bi * colStep);
            if (colHits[bi] >= minColBinHits) {
                if (!inBand) {
                    inBand = true;
                    bandStartX = x;
                }
            } else if (inBand) {
                if (x - bandStartX >= Math.max(4, rowH * 0.35f)) {
                    rawBands.add(new int[]{bandStartX, x});
                }
                inBand = false;
            }
        }
        if (inBand && (scanRight - bandStartX) >= Math.max(4, rowH * 0.35f)) {
            rawBands.add(new int[]{bandStartX, scanRight});
        }

        // Passo 3: divide bandas largas (colunas encostadas) pelo passo médio ~rowH
        List<int[]> colIntervals = new ArrayList<>();
        for (int[] band : rawBands) {
            int bw = band[1] - band[0];
            // Descarta meia-bola cortada exatamente na borda esquerda x<=2
            if (band[0] <= 2 && bw < rowH * 0.45f) {
                continue;
            }
            int subCols = Math.max(1, Math.round(bw / Math.max(6f, rowH * 0.98f)));
            if (bw < rowH * 1.45f) subCols = 1;
            float subW = bw / (float) subCols;
            for (int sc = 0; sc < subCols; sc++) {
                int c0 = Math.round(band[0] + sc * subW);
                int c1 = Math.round(band[0] + (sc + 1) * subW);
                if (c1 - c0 >= 4) {
                    colIntervals.add(new int[]{c0, c1});
                }
            }
        }

        if (colIntervals.isEmpty()) return Collections.emptyList();

        // Passo 4: lê cada célula (col asc, row asc) e associa número ML Kit se presente
        boolean[] usedNum = new boolean[mlKitNumCandidates.size()];
        List<BacBoCell> chronological = new ArrayList<>();
        int maxMatchDistSq = Math.round((rowH * 0.62f) * (rowH * 0.62f));

        for (int[] colRange : colIntervals) {
            int x0 = clamp(colRange[0] + Math.max(1, (colRange[1] - colRange[0]) / 6), 0, w - 1);
            int x1 = clamp(colRange[1] - Math.max(1, (colRange[1] - colRange[0]) / 6), 0, w - 1);
            if (x1 <= x0) continue;
            int colCenterX = (x0 + x1) / 2;

            // Verifica se a coluna está sobre o cartão branco da grelha (rejeita colunas só com feltro castanho)
            int whiteBgSamples = 0;
            int colPbCount = 0;
            int bgStepY = Math.max(1, Math.round(rowH / 6f));
            for (int y = gridTop; y <= gridBottom; y += bgStepY) {
                Color.colorToHSV(colorBitmap.getPixel(colCenterX, y), hsv);
                if (hsv[1] <= 0.22f && hsv[2] >= 0.72f) {
                    whiteBgSamples++;
                }
                String colSample = classifyBacBoGridPixelHsv(hsv[0], hsv[1], hsv[2], profile);
                if ("P".equals(colSample) || "B".equals(colSample)) {
                    colPbCount++;
                }
            }
            if (colPbCount == 0 && whiteBgSamples < 2) {
                continue;
            }

            for (int r = 0; r < rows; r++) {
                int y0 = clamp(Math.round(gridTop + r * rowH + rowH * 0.16f), 0, h - 1);
                int y1 = clamp(Math.round(gridTop + (r + 1) * rowH - rowH * 0.16f), 0, h - 1);
                if (y1 <= y0) continue;
                int rowCenterY = (y0 + y1) / 2;

                int votesP = 0, votesB = 0, votesT = 0, samples = 0;
                int sx = Math.max(1, (x1 - x0) / 4);
                int sy = Math.max(1, (y1 - y0) / 4);
                for (int y = y0; y <= y1; y += sy) {
                    for (int x = x0; x <= x1; x += sx) {
                        samples++;
                        Color.colorToHSV(colorBitmap.getPixel(x, y), hsv);
                        // Ignora tinta branca do dígito central
                        if (hsv[1] < 0.20f && hsv[2] > 0.65f) continue;
                        String c = classifyBacBoGridPixelHsv(hsv[0], hsv[1], hsv[2], profile);
                        if ("P".equals(c)) votesP++;
                        else if ("B".equals(c)) votesB++;
                        else if ("T".equals(c)) votesT++;
                    }
                }

                int minVotes = Math.max(3, samples / 5);
                String winner = null;
                if (votesP >= minVotes && votesP >= votesB && votesP >= votesT) winner = "P";
                else if (votesB >= minVotes && votesB > votesP && votesB >= votesT) winner = "B";
                else if (votesT >= minVotes && votesT > votesP && votesT > votesB) winner = "T";

                if (winner != null) {
                    int matchedTotal = -1;
                    int bestIdx = -1;
                    int bestDist = maxMatchDistSq;
                    for (int ni = 0; ni < mlKitNumCandidates.size(); ni++) {
                        if (usedNum[ni]) continue;
                        BacBoCell nc = mlKitNumCandidates.get(ni);
                        int dx = nc.centerX - colCenterX;
                        int dy = nc.centerY - rowCenterY;
                        int d2 = dx * dx + dy * dy;
                        if (d2 <= bestDist) {
                            bestDist = d2;
                            bestIdx = ni;
                        }
                    }
                    if (bestIdx >= 0) {
                        usedNum[bestIdx] = true;
                        matchedTotal = mlKitNumCandidates.get(bestIdx).total;
                    }

                    BacBoCell cell = new BacBoCell(winner, matchedTotal, colCenterX, rowCenterY, Math.round(rowH));
                    cell.colorFallback = matchedTotal < 2;
                    chronological.add(cell);

                    if (collectDebug) {
                        String lbl = winner + (matchedTotal >= 2 ? ":" + matchedTotal : "");
                        debugBoxes.add(new OcrDebugBox(new Rect(x0, y0, x1, y1), w, h, lbl, winner, true, "plate-grid"));
                    }
                }
            }
        }

        Collections.reverse(chronological);
        return chronological;
    }

    private String classifyBacBoGridPixelHsv(
            float hue,
            float sat,
            float val,
            RoiConfigStore.HsvColorProfile profile
    ) {
        if (sat < 0.16f || val < 0.16f) return null;
        // Player azul (inclui azul suavizado na vinheta esquerda)
        if (hue >= profile.blueHueMin - 6f && hue <= profile.blueHueMax + 6f && sat >= 0.17f && val >= 0.22f) {
            return "P";
        }
        // Banker vermelho (exclui castanho/dourado separando hue<=19° ou >=332°)
        if ((hue <= Math.min(20f, profile.redHueLowMax) || hue >= profile.redHueHighMin)
                && sat >= Math.max(0.24f, profile.redMinSat * 0.72f) && val >= 0.22f) {
            return "B";
        }
        // Tie dourado/mostarda vivo (val >= 0.60 exclui feltro castanho #94713E que tem V~0.58) ou verde
        if ((hue >= profile.goldHueMin && hue <= profile.goldHueMax
                && sat >= Math.max(0.40f, profile.goldMinSat) && val >= 0.60f)
                || (hue >= profile.greenHueMin && hue <= profile.greenHueMax && sat >= profile.greenMinSat)) {
            return "T";
        }
        return null;
    }

    /**
     * Amostra uma grade 5x5 no interior da caixa do placar ±2px mais halo externo,
     * filtrando a tinta branca do número para identificar cartões azuis (Player) ou vermelhos (Banker).
     */
    private String sampleBlockCardInteriorHsv(
            Bitmap bitmap,
            Rect box,
            RoiConfigStore.HsvColorProfile profile
    ) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int x0 = clamp(box.left - 2, 0, w - 1);
        int x1 = clamp(box.right + 2, 0, w - 1);
        int y0 = clamp(box.top - 2, 0, h - 1);
        int y1 = clamp(box.bottom + 2, 0, h - 1);
        if (x1 <= x0 || y1 <= y0) return null;

        int votesP = 0;
        int votesB = 0;
        float[] hsv = new float[3];

        for (int r = 0; r < 5; r++) {
            int py = clamp(y0 + (r * (y1 - y0)) / 4, 0, h - 1);
            for (int c = 0; c < 5; c++) {
                int px = clamp(x0 + (c * (x1 - x0)) / 4, 0, w - 1);
                Color.colorToHSV(bitmap.getPixel(px, py), hsv);
                if (hsv[1] < 0.18f && hsv[2] > 0.68f) continue;
                if (hsv[0] >= profile.blueHueMin - 10f && hsv[0] <= profile.blueHueMax + 10f && hsv[1] >= 0.22f && hsv[2] >= 0.22f) {
                    votesP++;
                } else if ((hsv[0] <= Math.min(22f, profile.redHueLowMax) || hsv[0] >= profile.redHueHighMin - 6f)
                        && hsv[1] >= 0.24f && hsv[2] >= 0.22f) {
                    votesB++;
                }
            }
        }

        if (votesP >= 3 && votesP > votesB) return "P";
        if (votesB >= 3 && votesB > votesP) return "B";

        // Fallback pelo halo externo do cartão caso o fundo direto do dígito seja escuro/transparente
        int midX = clamp((box.left + box.right) / 2, 0, w - 1);
        int midY = clamp((box.top + box.bottom) / 2, 0, h - 1);
        int pad = Math.max(4, box.height() / 4);
        int[][] halo = new int[][]{
                {clamp(box.left - pad, 0, w - 1), midY},
                {clamp(box.right + pad, 0, w - 1), midY},
                {midX, clamp(box.top - pad, 0, h - 1)},
                {midX, clamp(box.bottom + pad, 0, h - 1)}
        };
        for (int[] pt : halo) {
            Color.colorToHSV(bitmap.getPixel(pt[0], pt[1]), hsv);
            if (hsv[1] < 0.18f && hsv[2] > 0.72f) continue;
            if (hsv[0] >= profile.blueHueMin - 10f && hsv[0] <= profile.blueHueMax + 10f && hsv[1] >= 0.22f) {
                votesP++;
            } else if ((hsv[0] <= Math.min(22f, profile.redHueLowMax) || hsv[0] >= profile.redHueHighMin - 6f)
                    && hsv[1] >= 0.24f) {
                votesB++;
            }
        }
        if (votesP == 0 && votesB == 0) return null;
        return votesP >= votesB ? "P" : "B";
    }

    private String sampleBacBoOutcomeColorHsv(
            Bitmap bitmap,
            Rect box,
            RoiConfigStore.HsvColorProfile profile
    ) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int x0 = clamp(box.left - 1, 0, w - 1);
        int x1 = clamp(box.right + 1, 0, w - 1);
        int y0 = clamp(box.top - 1, 0, h - 1);
        int y1 = clamp(box.bottom + 1, 0, h - 1);
        if (x1 <= x0 || y1 <= y0) return null;

        int votesP = 0, votesB = 0, votesT = 0;
        float[] hsv = new float[3];
        for (int r = 0; r < 5; r++) {
            int py = clamp(y0 + (r * (y1 - y0)) / 4, 0, h - 1);
            for (int c = 0; c < 5; c++) {
                int px = clamp(x0 + (c * (x1 - x0)) / 4, 0, w - 1);
                Color.colorToHSV(bitmap.getPixel(px, py), hsv);
                if (hsv[1] < 0.20f && hsv[2] > 0.65f) continue;
                String out = classifyBacBoGridPixelHsv(hsv[0], hsv[1], hsv[2], profile);
                if ("P".equals(out)) votesP++;
                else if ("B".equals(out)) votesB++;
                else if ("T".equals(out)) votesT++;
            }
        }

        if (votesP < 2 && votesB < 2 && votesT < 2) return null;
        if (votesP >= votesB && votesP >= votesT) return "P";
        if (votesT >= votesB && votesT >= votesP) return "T";
        return "B";
    }

    private List<BacBoCell> orderBacBoCells(List<BacBoCell> rawCandidates) {
        if (rawCandidates.isEmpty()) return Collections.emptyList();

        List<Integer> heights = new ArrayList<>(rawCandidates.size());
        for (BacBoCell c : rawCandidates) heights.add(c.boxHeight);
        Collections.sort(heights);
        int medianH = heights.get(heights.size() / 2);

        List<BacBoCell> candidates = new ArrayList<>();
        for (BacBoCell c : rawCandidates) {
            if (c.boxHeight >= Math.max(6, (int) (medianH * 0.50f))
                    && c.boxHeight <= Math.max(20, (int) (medianH * 1.80f))) {
                candidates.add(c);
            }
        }
        if (candidates.isEmpty()) return Collections.emptyList();

        List<BacBoCell> deduped = new ArrayList<>();
        int dupTolX = Math.max(10, (int) (medianH * 0.75f));
        int dupTolY = Math.max(8, (int) (medianH * 0.60f));
        for (BacBoCell c : candidates) {
            boolean duplicate = false;
            for (BacBoCell existing : deduped) {
                if (Math.abs(c.centerX - existing.centerX) <= dupTolX
                        && Math.abs(c.centerY - existing.centerY) <= dupTolY) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) deduped.add(c);
        }

        Collections.sort(deduped, (a, b) -> Integer.compare(a.centerX, b.centerX));
        int colTolerance = Math.max(12, (int) (medianH * 0.90f));
        List<List<BacBoCell>> columns = new ArrayList<>();
        for (BacBoCell cell : deduped) {
            if (columns.isEmpty()) {
                List<BacBoCell> col = new ArrayList<>();
                col.add(cell);
                columns.add(col);
                continue;
            }
            List<BacBoCell> lastCol = columns.get(columns.size() - 1);
            int sumX = 0;
            for (BacBoCell item : lastCol) sumX += item.centerX;
            int avgX = sumX / lastCol.size();
            if (Math.abs(cell.centerX - avgX) <= colTolerance) {
                lastCol.add(cell);
            } else {
                List<BacBoCell> col = new ArrayList<>();
                col.add(cell);
                columns.add(col);
            }
        }

        List<BacBoCell> chronological = new ArrayList<>(deduped.size());
        for (List<BacBoCell> col : columns) {
            Collections.sort(col, (a, b) -> Integer.compare(a.centerY, b.centerY));
            chronological.addAll(col);
        }

        Collections.reverse(chronological);
        return chronological;
    }

    private Integer parseBacBoNumberOnly(String rawText) {
        if (rawText == null) return null;
        String trimmed = rawText.trim();
        if (trimmed.isEmpty() || trimmed.length() > 2) return null;
        // Rejeita zeros à esquerda (ex: "09", "05" típicos de relógio/temporizador)
        if (trimmed.length() == 2 && trimmed.charAt(0) == '0') return null;
        for (int i = 0; i < trimmed.length(); i++) {
            if (!Character.isDigit(trimmed.charAt(i))) return null;
        }
        try {
            int val = Integer.parseInt(trimmed);
            if (val >= 2 && val <= 12) return val;
        } catch (NumberFormatException ignored) {
        }
        return null;
    }

    // ==================== AVIATOR OCR (HSV + MULTIPLICADOR + CRASH) ====================

    private static class AviatorTokenCandidate {
        final double multiplier;
        final int leftX;
        final int centerY;
        final int boxHeight;
        final Rect box;

        AviatorTokenCandidate(double multiplier, int leftX, int centerY, int boxHeight, Rect box) {
            this.multiplier = multiplier;
            this.leftX = leftX;
            this.centerY = centerY;
            this.boxHeight = boxHeight;
            this.box = box;
        }
    }

    public interface AviatorFrameCallback {
        void onResult(
                double liveMultiplier,
                boolean isCrashedColor,
                List<Double> historyNewestFirst,
                float confidence,
                boolean ocrOk
        );
    }

    public interface AviatorDetailedCallback {
        void onResult(
                double liveMultiplier,
                boolean isCrashedColor,
                List<Double> historyNewestFirst,
                float confidence,
                List<OcrDebugBox> debugBoxes,
                boolean ocrOk
        );
    }

    public void scanAviatorFrame(
            Bitmap fullBitmap,
            float roiTopRatio,
            float roiHeightRatio,
            AviatorFrameCallback callback
    ) {
        scanAviatorFrame(
                fullBitmap,
                new RoiConfigStore.RoiRect(0f, roiTopRatio, 1f, roiHeightRatio),
                RoiConfigStore.HsvColorProfile.defaultForSite("kwanzabet"),
                false,
                (liveMultiplier, isCrashedColor, historyNewestFirst, confidence, debugBoxes, ocrOk) ->
                        callback.onResult(liveMultiplier, isCrashedColor, historyNewestFirst, confidence, ocrOk)
        );
    }

    public void scanAviatorFrame(
            Bitmap fullBitmap,
            RoiConfigStore.RoiRect roi,
            RoiConfigStore.HsvColorProfile hsvProfile,
            boolean collectDebug,
            AviatorDetailedCallback callback
    ) {
        if (fullBitmap == null || fullBitmap.isRecycled()) {
            callback.onResult(-1.0, false, Collections.emptyList(), 0f, Collections.emptyList(), false);
            return;
        }
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        if (width < MIN_IMAGE_DIMENSION_PX || height < MIN_IMAGE_DIMENSION_PX) {
            callback.onResult(-1.0, false, Collections.emptyList(), 0f, Collections.emptyList(), false);
            return;
        }

        final RoiConfigStore.HsvColorProfile profile =
                hsvProfile != null ? hsvProfile : RoiConfigStore.HsvColorProfile.defaultForSite("kwanzabet");
        final PreparedCrop prep = preprocessCropForOcr(fullBitmap, roi, true);
        final int sw = prep.ocrBitmap.getWidth();
        final int sh = prep.ocrBitmap.getHeight();

        InputImage image = InputImage.fromBitmap(prep.ocrBitmap, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    List<AviatorTokenCandidate> candidates = new ArrayList<>();
                    List<OcrDebugBox> debugBoxes = collectDebug ? new ArrayList<>() : Collections.emptyList();
                    boolean hasCrashKeyword = false;

                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            String lineRaw = line.getText();
                            if (lineRaw != null) {
                                String lineUpper = lineRaw.trim().toUpperCase(Locale.US);
                                if (lineUpper.contains("VOOU") || lineUpper.contains("FLEW")) {
                                    hasCrashKeyword = true;
                                }
                            }

                            boolean parsedFromElements = false;
                            for (Text.Element element : line.getElements()) {
                                Rect box = element.getBoundingBox();
                                if (box == null) continue;
                                Double mult = parseAviatorMultiplier(element.getText());
                                if (mult != null) {
                                    int bh = box.height();
                                    if (bh >= 8 && bh <= sh * 0.85f) {
                                        candidates.add(new AviatorTokenCandidate(
                                                mult,
                                                box.left,
                                                (box.top + box.bottom) / 2,
                                                bh,
                                                box
                                        ));
                                        parsedFromElements = true;
                                        if (collectDebug) {
                                            debugBoxes.add(new OcrDebugBox(box, sw, sh, mult + "x", classifyAviatorTier(mult), true, "aviator-elem"));
                                        }
                                    }
                                }
                            }

                            if (!parsedFromElements && lineRaw != null && line.getBoundingBox() != null) {
                                Double lineMult = parseAviatorMultiplier(lineRaw);
                                Rect lbox = line.getBoundingBox();
                                int lbh = lbox.height();
                                if (lineMult != null && lbh >= Math.max(18, (int) (sh * 0.12f)) && lbh <= sh * 0.85f) {
                                    candidates.add(new AviatorTokenCandidate(
                                            lineMult,
                                            lbox.left,
                                            (lbox.top + lbox.bottom) / 2,
                                            lbh,
                                            lbox
                                    ));
                                    if (collectDebug) {
                                        debugBoxes.add(new OcrDebugBox(lbox, sw, sh, lineMult + "x", classifyAviatorTier(lineMult), true, "aviator-line"));
                                    }
                                }
                            }
                        }
                    }

                    AviatorTokenCandidate liveCandidate = null;
                    int liveMinH = Math.max(20, (int) (sh * AVIATOR_LIVE_MIN_HEIGHT_RATIO));
                    for (AviatorTokenCandidate c : candidates) {
                        if (c.boxHeight >= liveMinH) {
                            if (liveCandidate == null || c.boxHeight > liveCandidate.boxHeight) {
                                liveCandidate = c;
                            }
                        }
                    }

                    boolean isCrashedColor = false;
                    double liveMult = -1.0;
                    if (liveCandidate != null) {
                        liveMult = liveCandidate.multiplier;
                        isCrashedColor = hasCrashKeyword || isAviatorRedMultiplierHsv(prep.colorBitmap, liveCandidate.box, profile);
                    }

                    List<AviatorTokenCandidate> stripPool = new ArrayList<>();
                    int stripMaxH = liveCandidate != null
                            ? Math.max(16, (int) (liveCandidate.boxHeight * 0.60f))
                            : (int) (sh * AVIATOR_STRIP_MAX_HEIGHT_RATIO);
                    for (AviatorTokenCandidate c : candidates) {
                        if (c != liveCandidate && c.boxHeight <= stripMaxH) {
                            stripPool.add(c);
                        }
                    }

                    List<AviatorTokenCandidate> stripRow = extractAviatorHorizontalRow(stripPool, sh);
                    List<Double> historyNewestFirst = new ArrayList<>(stripRow.size());
                    for (AviatorTokenCandidate item : stripRow) {
                        historyNewestFirst.add(item.multiplier);
                    }

                    prep.recycle();

                    boolean hasLive = liveMult >= 1.0;
                    boolean hasStrip = !historyNewestFirst.isEmpty();
                    float confidence = 0f;
                    if (hasLive && hasStrip) confidence = 0.95f;
                    else if (hasLive || historyNewestFirst.size() >= 3) confidence = 0.85f;
                    else if (hasStrip) confidence = 0.72f;

                    callback.onResult(liveMult, isCrashedColor, historyNewestFirst, confidence, debugBoxes, hasLive || hasStrip);
                })
                .addOnFailureListener(e -> {
                    prep.recycle();
                    callback.onResult(-1.0, false, Collections.emptyList(), 0f, Collections.emptyList(), false);
                });
    }

    private String classifyAviatorTier(double mult) {
        if (mult < 2.0) return "BLUE";
        if (mult < 10.0) return "PURPLE";
        return "PINK";
    }

    private Double parseAviatorMultiplier(String rawText) {
        if (rawText == null) return null;
        String cleaned = rawText.trim().replace(",", ".").replaceAll("\\s+", "");
        if (cleaned.length() < 2 || cleaned.length() > 10) return null;
        char last = cleaned.charAt(cleaned.length() - 1);
        if (last != 'x' && last != 'X' && last != '×') return null;
        String numPart = cleaned.substring(0, cleaned.length() - 1);
        if (numPart.isEmpty()) return null;

        int dots = 0;
        for (int i = 0; i < numPart.length(); i++) {
            char ch = numPart.charAt(i);
            if (ch == '.') {
                dots++;
                if (dots > 1) return null;
            } else if (!Character.isDigit(ch)) {
                return null;
            }
        }
        try {
            double val = Double.parseDouble(numPart);
            if (val < 1.0 || val > 100000.0) return null;
            return Math.round(val * 100.0) / 100.0;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private boolean isAviatorRedMultiplierHsv(
            Bitmap bitmap,
            Rect box,
            RoiConfigStore.HsvColorProfile profile
    ) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int x0 = clamp(box.left, 0, w - 1);
        int x1 = clamp(box.right, 0, w - 1);
        int y0 = clamp(box.top, 0, h - 1);
        int y1 = clamp(box.bottom, 0, h - 1);
        int stepX = Math.max(1, (x1 - x0) / 18);
        int stepY = Math.max(1, (y1 - y0) / 12);

        int redTextPx = 0;
        int whiteTextPx = 0;
        float[] hsv = new float[3];
        for (int y = y0; y <= y1; y += stepY) {
            for (int x = x0; x <= x1; x += stepX) {
                Color.colorToHSV(bitmap.getPixel(x, y), hsv);
                if ((hsv[0] <= profile.redHueLowMax + 4f || hsv[0] >= profile.redHueHighMin - 6f)
                        && hsv[1] >= 0.42f && hsv[2] >= 0.45f) {
                    redTextPx++;
                } else if (hsv[1] < 0.20f && hsv[2] > 0.78f) {
                    whiteTextPx++;
                }
            }
        }
        return redTextPx >= 4 && redTextPx >= whiteTextPx * 0.70f;
    }

    private List<AviatorTokenCandidate> extractAviatorHorizontalRow(
            List<AviatorTokenCandidate> candidates,
            int scaledH
    ) {
        if (candidates.isEmpty()) return Collections.emptyList();
        int yTolerance = Math.max(14, (int) (scaledH * 0.14f));
        List<AviatorTokenCandidate> bestRow = Collections.emptyList();

        for (AviatorTokenCandidate anchor : candidates) {
            List<AviatorTokenCandidate> row = new ArrayList<>();
            for (AviatorTokenCandidate other : candidates) {
                if (Math.abs(other.centerY - anchor.centerY) <= yTolerance) {
                    row.add(other);
                }
            }
            if (row.size() > bestRow.size()) {
                bestRow = row;
            }
        }

        if (bestRow.isEmpty()) return Collections.emptyList();
        List<AviatorTokenCandidate> sorted = new ArrayList<>(bestRow);
        Collections.sort(sorted, (a, b) -> Integer.compare(a.leftX, b.leftX));

        List<AviatorTokenCandidate> deduped = new ArrayList<>();
        int lastX = -9999;
        for (AviatorTokenCandidate item : sorted) {
            int minSpacing = Math.max(12, item.boxHeight);
            if (item.leftX - lastX >= minSpacing) {
                deduped.add(item);
                lastX = item.leftX;
            }
        }
        return deduped;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
