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
import java.util.Collections;
import java.util.List;

public class ScreenScanner {

    public enum PillColor {
        GREEN, RED, BLACK, LIGHT_BG
    }

    public interface ScanCallback {
        void onResult(List<Integer> numbersNewestFirst, String usedMode);
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
            callback.onResult(Collections.emptyList(), "empty");
            return;
        }

        // Passo 1: le a faixa calibrada ampliada 3x para maior nitidez do ML Kit
        int topY = Math.max(0, Math.min(height - 24, (int) (height * roiTopRatio)));
        int cropH = Math.max(28, Math.min(height - topY, (int) (height * roiHeightRatio)));
        Bitmap cropped = Bitmap.createBitmap(fullBitmap, 0, topY, width, cropH);
        Bitmap scaled = Bitmap.createScaledBitmap(
                cropped,
                Math.min(2400, cropped.getWidth() * 3),
                Math.min(480, cropped.getHeight() * 3),
                true
        );
        if (scaled != cropped) {
            cropped.recycle();
        }

        InputImage roiImage = InputImage.fromBitmap(scaled, 0);
        recognizer.process(roiImage)
                .addOnSuccessListener(visionText -> {
                    List<Integer> roiNumbers = extractRowAlignedNumbers(scaled, visionText, false);
                    scaled.recycle();
                    if (roiNumbers.size() >= 3) {
                        callback.onResult(roiNumbers, "roi");
                    } else {
                        // Passo 2 (Auto-busca): procura automaticamente a barra horizontal nos 48% superiores
                        autoScanTopArea(fullBitmap, callback, roiNumbers);
                    }
                })
                .addOnFailureListener(e -> {
                    scaled.recycle();
                    autoScanTopArea(fullBitmap, callback, Collections.emptyList());
                });
    }

    private void autoScanTopArea(
            Bitmap fullBitmap,
            ScanCallback callback,
            List<Integer> fallbackRoiNumbers
    ) {
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        int topHeight = Math.max(60, (int) (height * 0.48f));

        Bitmap topCrop = Bitmap.createBitmap(fullBitmap, 0, 0, width, topHeight);
        Bitmap scaled = Bitmap.createScaledBitmap(
                topCrop,
                Math.min(1800, topCrop.getWidth() * 2),
                Math.min(1200, topCrop.getHeight() * 2),
                true
        );
        if (scaled != topCrop) {
            topCrop.recycle();
        }

        InputImage image = InputImage.fromBitmap(scaled, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    List<Integer> autoNumbers = extractRowAlignedNumbers(scaled, visionText, true);
                    scaled.recycle();
                    if (autoNumbers.size() >= 3) {
                        callback.onResult(autoNumbers, "auto");
                    } else if (fallbackRoiNumbers.size() >= autoNumbers.size()) {
                        callback.onResult(fallbackRoiNumbers, "roi-partial");
                    } else {
                        callback.onResult(autoNumbers, "auto-partial");
                    }
                })
                .addOnFailureListener(e -> {
                    scaled.recycle();
                    callback.onResult(fallbackRoiNumbers, "roi-fallback");
                });
    }

    private List<Integer> extractRowAlignedNumbers(
            Bitmap bitmap,
            Text visionText,
            boolean requireDarkOrColoredPill
    ) {
        List<DetectedPill> candidates = new ArrayList<>();
        for (Text.TextBlock block : visionText.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                for (Text.Element element : line.getElements()) {
                    Rect box = element.getBoundingBox();
                    if (box == null) continue;
                    PillColor color = samplePillColor(bitmap, box);
                    if (requireDarkOrColoredPill && color == PillColor.LIGHT_BG) {
                        continue;
                    }
                    Integer parsed = parseRouletteToken(element.getText(), color);
                    if (parsed != null) {
                        candidates.add(new DetectedPill(parsed, box.left, box.centerY()));
                    }
                }
            }
        }

        if (candidates.isEmpty()) {
            return Collections.emptyList();
        }

        // Encontra a linha horizontal (cluster Y) com mais fichas alinhadas
        int rowThreshold = Math.max(24, (int) (bitmap.getHeight() * 0.08f));
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

        // Rejeita valores monetarios, relogios e porcentagens
        if (trimmed.contains(".") || trimmed.contains(":") || trimmed.contains(",")
                || trimmed.contains("/") || trimmed.contains("%")) {
            return null;
        }

        // Remove apenas bordas comuns de OCR ao redor da ficha, mantendo letras bloqueadas
        String cleaned = trimmed
                .replace("|", "")
                .replace("[", "")
                .replace("]", "")
                .replace("(", "")
                .replace(")", "")
                .replace("'", "")
                .trim();

        if (cleaned.isEmpty()) return null;

        String normalized = cleaned
                .replace("O", "0")
                .replace("o", "0")
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
            return (color == PillColor.GREEN || digits.toString().equals("0")) ? 0 : null;
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
            return PillColor.LIGHT_BG;
        }

        int r = sumR / count;
        int g = sumG / count;
        int b = sumB / count;

        if (g > r + 18 && g > b + 14) return PillColor.GREEN;
        if (r > g + 22 && r > b + 20) return PillColor.RED;
        if (r > 130 && g > 130 && b > 130) return PillColor.LIGHT_BG;
        return PillColor.BLACK;
    }
}
