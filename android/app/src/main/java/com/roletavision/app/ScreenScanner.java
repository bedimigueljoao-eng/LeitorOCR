package com.roletavision.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class ScreenScanner {

    public enum PillColor {
        GREEN, RED, BLACK, LIGHT_BG
    }

    public interface ScanCallback {
        void onResult(List<Integer> numbersNewestFirst, String usedMode, String debugInfo);
    }

    private static class DetectedPill {
        final int number;
        final int leftX;
        final int centerY;

        DetectedPill(int number, int leftX, int centerY) {
            this.number = number;
            this.leftX = leftX;
            this.centerY = centerY;
        }
    }

    private final TextRecognizer recognizer =
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

    public void scanHistoryStrip(
            Bitmap fullBitmap,
            float roiTopRatio,
            float roiHeightRatio,
            ScanCallback callback
    ) {
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        if (width < 40 || height < 40) {
            callback.onResult(Collections.emptyList(), "empty", "bmp=" + width + "x" + height);
            return;
        }

        // Passo 1: recorta a faixa calibrada mantendo proporcao exata (sem distorcer digitos)
        int topY = Math.max(0, Math.min(height - 28, (int) (height * roiTopRatio)));
        int cropH = Math.max(32, Math.min(height - topY, (int) (height * roiHeightRatio)));
        Bitmap cropped = Bitmap.createBitmap(fullBitmap, 0, topY, width, cropH);

        float scale = Math.min(3.0f, 2200f / Math.max(1, cropped.getWidth()));
        if (scale < 1.5f) scale = 1.5f;
        int targetW = Math.max(60, Math.round(cropped.getWidth() * scale));
        int targetH = Math.max(48, Math.round(cropped.getHeight() * scale));

        Bitmap scaledColor = Bitmap.createScaledBitmap(cropped, targetW, targetH, true);
        if (scaledColor != cropped) {
            cropped.recycle();
        }

        final int avgLum = estimateAverageLuminance(scaledColor);
        final int pad = 36;

        // Gera versao preto-no-branco invertida de alto contraste (ideal para ML Kit ler digitos brancos)
        Bitmap bwPadded = createBlackOnWhitePadded(scaledColor, pad, 145);

        InputImage bwImage = InputImage.fromBitmap(bwPadded, 0);
        recognizer.process(bwImage)
                .addOnSuccessListener(bwText -> {
                    StringBuilder rawBw = new StringBuilder();
                    List<Integer> bwNums = extractRowAlignedNumbers(
                            bwText, scaledColor, pad, false, rawBw
                    );
                    bwPadded.recycle();

                    if (bwNums.size() >= 3) {
                        scaledColor.recycle();
                        callback.onResult(
                                bwNums,
                                "ocr-bw",
                                "roi=" + targetW + "x" + targetH + " lum=" + avgLum
                        );
                        return;
                    }

                    // Passo 2: tenta OCR direto na imagem colorida com borda branca
                    Bitmap rgbPadded = createPaddedColorBitmap(scaledColor, pad);
                    InputImage rgbImage = InputImage.fromBitmap(rgbPadded, 0);
                    recognizer.process(rgbImage)
                            .addOnSuccessListener(rgbText -> {
                                StringBuilder rawRgb = new StringBuilder();
                                List<Integer> rgbNums = extractRowAlignedNumbers(
                                        rgbText, scaledColor, pad, false, rawRgb
                                );
                                rgbPadded.recycle();
                                scaledColor.recycle();

                                if (rgbNums.size() >= bwNums.size() && rgbNums.size() >= 3) {
                                    callback.onResult(
                                            rgbNums,
                                            "ocr-rgb",
                                            "roi=" + targetW + "x" + targetH + " lum=" + avgLum
                                    );
                                } else if (bwNums.size() > 0 || rgbNums.size() > 0) {
                                    List<Integer> best = bwNums.size() >= rgbNums.size() ? bwNums : rgbNums;
                                    callback.onResult(
                                            best,
                                            "ocr-partial",
                                            "lum=" + avgLum + " raw=[" + rawBw + "|" + rawRgb + "]"
                                    );
                                } else {
                                    // Passo 3: auto-busca na metade superior caso a Mira esteja deslocada
                                    autoScanTopArea(fullBitmap, callback, avgLum, rawBw + "|" + rawRgb);
                                }
                            })
                            .addOnFailureListener(e2 -> {
                                rgbPadded.recycle();
                                scaledColor.recycle();
                                autoScanTopArea(fullBitmap, callback, avgLum, "e2:" + e2.getMessage());
                            });
                })
                .addOnFailureListener(e1 -> {
                    bwPadded.recycle();
                    scaledColor.recycle();
                    autoScanTopArea(fullBitmap, callback, avgLum, "e1:" + e1.getMessage());
                });
    }

    private void autoScanTopArea(
            Bitmap fullBitmap,
            ScanCallback callback,
            int roiLum,
            String roiRaw
    ) {
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        int topHeight = Math.max(60, (int) (height * 0.45f));

        Bitmap topCrop = Bitmap.createBitmap(fullBitmap, 0, 0, width, topHeight);
        float scale = Math.min(2.0f, 1600f / Math.max(1, topCrop.getWidth()));
        int targetW = Math.max(60, Math.round(topCrop.getWidth() * scale));
        int targetH = Math.max(60, Math.round(topCrop.getHeight() * scale));

        Bitmap scaledColor = Bitmap.createScaledBitmap(topCrop, targetW, targetH, true);
        if (scaledColor != topCrop) {
            topCrop.recycle();
        }

        final int pad = 24;
        Bitmap bwPadded = createBlackOnWhitePadded(scaledColor, pad, 150);

        InputImage image = InputImage.fromBitmap(bwPadded, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    StringBuilder rawAuto = new StringBuilder();
                    List<Integer> autoNumbers = extractRowAlignedNumbers(
                            visionText, scaledColor, pad, true, rawAuto
                    );
                    bwPadded.recycle();
                    scaledColor.recycle();
                    callback.onResult(
                            autoNumbers,
                            autoNumbers.size() >= 3 ? "auto-bw" : "none",
                            "lum=" + roiLum + " roiRaw=[" + roiRaw + "] auto=[" + rawAuto + "]"
                    );
                })
                .addOnFailureListener(e -> {
                    bwPadded.recycle();
                    scaledColor.recycle();
                    callback.onResult(
                            Collections.emptyList(),
                            "err",
                            "lum=" + roiLum + " err=" + e.getMessage()
                    );
                });
    }

    private Bitmap createPaddedColorBitmap(Bitmap src, int pad) {
        Bitmap out = Bitmap.createBitmap(
                src.getWidth() + pad * 2,
                src.getHeight() + pad * 2,
                Bitmap.Config.ARGB_8888
        );
        Canvas c = new Canvas(out);
        c.drawColor(Color.WHITE);
        c.drawBitmap(src, pad, pad, null);
        return out;
    }

    private Bitmap createBlackOnWhitePadded(Bitmap src, int pad, int lumThreshold) {
        int w = src.getWidth();
        int h = src.getHeight();
        int outW = w + pad * 2;
        int outH = h + pad * 2;

        int[] srcPixels = new int[w * h];
        src.getPixels(srcPixels, 0, w, 0, 0, w, h);

        int[] outPixels = new int[outW * outH];
        // Preenche tudo de branco puro
        for (int i = 0; i < outPixels.length; i++) {
            outPixels[i] = Color.WHITE;
        }

        for (int y = 0; y < h; y++) {
            int srcRow = y * w;
            int outRow = (y + pad) * outW + pad;
            for (int x = 0; x < w; x++) {
                int p = srcPixels[srcRow + x];
                int r = Color.red(p);
                int g = Color.green(p);
                int b = Color.blue(p);
                // Digitos brancos ou muito claros viram PRETO puro para o OCR
                int maxChannel = Math.max(r, Math.max(g, b));
                int lum = (r * 3 + g * 6 + b) / 10;
                if (lum >= lumThreshold || (maxChannel >= 175 && Math.min(r, Math.min(g, b)) >= 120)) {
                    outPixels[outRow + x] = Color.BLACK;
                }
            }
        }

        Bitmap out = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
        out.setPixels(outPixels, 0, outW, 0, 0, outW, outH);
        return out;
    }

    private int estimateAverageLuminance(Bitmap bmp) {
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        long sum = 0;
        int samples = 0;
        int stepX = Math.max(1, w / 24);
        int stepY = Math.max(1, h / 10);
        for (int y = 0; y < h; y += stepY) {
            for (int x = 0; x < w; x += stepX) {
                int p = bmp.getPixel(x, y);
                sum += (Color.red(p) + Color.green(p) + Color.blue(p)) / 3;
                samples++;
            }
        }
        return samples > 0 ? (int) (sum / samples) : 0;
    }

    private List<Integer> extractRowAlignedNumbers(
            Text visionText,
            Bitmap colorReference,
            int padOffset,
            boolean requireDarkOrColoredPill,
            StringBuilder rawCollector
    ) {
        List<DetectedPill> candidates = new ArrayList<>();
        for (Text.TextBlock block : visionText.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                for (Text.Element element : line.getElements()) {
                    String txt = element.getText();
                    if (rawCollector.length() < 80 && txt != null) {
                        if (rawCollector.length() > 0) rawCollector.append(',');
                        rawCollector.append(txt);
                    }
                    Rect box = element.getBoundingBox();
                    if (box == null) continue;

                    Rect unpadded = new Rect(
                            box.left - padOffset,
                            box.top - padOffset,
                            box.right - padOffset,
                            box.bottom - padOffset
                    );
                    PillColor color = samplePillColor(colorReference, unpadded);
                    if (requireDarkOrColoredPill && color == PillColor.LIGHT_BG) {
                        continue;
                    }
                    Integer parsed = parseRouletteToken(txt, color);
                    if (parsed != null) {
                        candidates.add(new DetectedPill(parsed, unpadded.left, unpadded.centerY()));
                    }
                }
            }
        }

        if (candidates.isEmpty()) {
            return Collections.emptyList();
        }

        // Encontra a linha horizontal (cluster Y) com mais fichas alinhadas
        int rowThreshold = Math.max(24, (int) (colorReference.getHeight() * 0.12f));
        List<DetectedPill> bestRow = candidates;
        if (candidates.size() >= 3) {
            bestRow = new ArrayList<>();
            for (DetectedPill anchor : candidates) {
                List<DetectedPill> cluster = new ArrayList<>();
                for (DetectedPill other : candidates) {
                    if (Math.abs(other.centerY - anchor.centerY) <= rowThreshold) {
                        cluster.add(other);
                    }
                }
                if (cluster.size() > bestRow.size()) {
                    bestRow = cluster;
                }
            }
        }

        Collections.sort(bestRow, (a, b) -> Integer.compare(a.leftX, b.leftX));
        List<Integer> ordered = new ArrayList<>();
        int lastX = Integer.MIN_VALUE;
        for (DetectedPill pill : bestRow) {
            if (pill.leftX - lastX >= 8) {
                ordered.add(pill.number);
                lastX = pill.leftX;
            }
        }
        return ordered;
    }

    private Integer parseRouletteToken(String rawText, PillColor color) {
        if (rawText == null) return null;
        String trimmed = rawText.trim();
        if (trimmed.isEmpty() || trimmed.length() > 4) return null;

        if (trimmed.contains(".") || trimmed.contains(":") || trimmed.contains(",")
                || trimmed.contains("/") || trimmed.contains("%")) {
            return null;
        }

        String cleaned = trimmed
                .replace("|", "")
                .replace("[", "")
                .replace("]", "")
                .replace("(", "")
                .replace(")", "")
                .replace("{", "")
                .replace("}", "")
                .replace("'", "")
                .trim();

        if (cleaned.isEmpty()) return null;

        String normalized = cleaned
                .replace("O", "0")
                .replace("o", "0")
                .replace("D", "0")
                .replace("Q", "0")
                .replace("I", "1")
                .replace("l", "1");

        StringBuilder digits = new StringBuilder();
        for (int i = 0; i < normalized.length(); i++) {
            char c = normalized.charAt(i);
            if (Character.isDigit(c)) {
                digits.append(c);
            } else {
                return null;
            }
        }

        if (digits.length() == 0 || digits.length() > 2) {
            return color == PillColor.GREEN ? 0 : null;
        }

        int num;
        try {
            num = Integer.parseInt(digits.toString());
        } catch (NumberFormatException e) {
            return null;
        }

        if (num < 0 || num > 36) return null;
        if (num == 0) {
            return 0;
        }
        if (color == PillColor.GREEN) {
            return 0;
        }
        return num;
    }

    private PillColor samplePillColor(Bitmap bitmap, Rect box) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int cx = (box.left + box.right) / 2;
        int cy = (box.top + box.bottom) / 2;

        int[][] points = {
                {box.left - 5, cy},
                {box.right + 5, cy},
                {cx, box.top - 5},
                {cx, box.bottom + 5},
                {box.left - 3, box.top - 3},
                {box.right + 3, box.top - 3},
                {box.left - 3, box.bottom + 3},
                {box.right + 3, box.bottom + 3}
        };

        int sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (int[] pt : points) {
            int px = Math.max(0, Math.min(w - 1, pt[0]));
            int py = Math.max(0, Math.min(h - 1, pt[1]));
            int pixel = bitmap.getPixel(px, py);
            int r = Color.red(pixel);
            int g = Color.green(pixel);
            int b = Color.blue(pixel);
            if (r > 185 && g > 185 && b > 185) {
                continue;
            }
            sumR += r;
            sumG += g;
            sumB += b;
            count++;
        }

        if (count == 0) {
            return PillColor.BLACK;
        }

        int r = sumR / count;
        int g = sumG / count;
        int b = sumB / count;

        if (g > r + 18 && g > b + 14) return PillColor.GREEN;
        if (r > g + 22 && r > b + 20) return PillColor.RED;
        if (r > 135 && g > 135 && b > 135) return PillColor.LIGHT_BG;
        return PillColor.BLACK;
    }
}
