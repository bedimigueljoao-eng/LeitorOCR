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
import java.util.Set;

public class ScreenScanner {

    public enum PillColor {
        GREEN, RED, BLACK
    }

    public interface ScanCallback {
        void onResult(List<Integer> numbersNewestFirst, boolean ocrOk);
    }

    private static class DetectedPill {
        final int number;
        final int leftX;
        final int centerY;
        final int boxHeight;

        DetectedPill(int number, int leftX, int centerY, int boxHeight) {
            this.number = number;
            this.leftX = leftX;
            this.centerY = centerY;
            this.boxHeight = boxHeight;
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
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        if (width < 40 || height < 40) {
            callback.onResult(Collections.emptyList(), false);
            return;
        }

        int topY = Math.max(0, Math.min(height - 20, (int) (height * roiTopRatio)));
        int cropH = Math.max(20, Math.min(height - topY, (int) (height * roiHeightRatio)));

        Bitmap cropped = Bitmap.createBitmap(fullBitmap, 0, topY, width, cropH);
        Bitmap scaled = Bitmap.createScaledBitmap(
                cropped,
                cropped.getWidth() * 2,
                cropped.getHeight() * 2,
                true
        );
        if (scaled != cropped) {
            cropped.recycle();
        }

        final int scaledH = scaled.getHeight();
        InputImage image = InputImage.fromBitmap(scaled, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    List<DetectedPill> candidates = new ArrayList<>();
                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            for (Text.Element element : line.getElements()) {
                                Rect box = element.getBoundingBox();
                                if (box == null) continue;
                                int bh = box.height();
                                int bw = box.width();
                                if (bh < 8 || bh > scaledH * 0.85f || bw > scaledH * 1.6f) {
                                    continue;
                                }
                                PillColor sampledColor = samplePillColor(scaled, box);
                                Integer parsed = parseRouletteToken(element.getText(), sampledColor);
                                if (parsed != null) {
                                    candidates.add(new DetectedPill(
                                            parsed,
                                            box.left,
                                            (box.top + box.bottom) / 2,
                                            bh
                                    ));
                                }
                            }
                        }
                    }
                    scaled.recycle();

                    List<DetectedPill> row = extractMainHorizontalRow(candidates, scaledH);
                    List<Integer> ordered = new ArrayList<>();
                    for (DetectedPill pill : row) {
                        ordered.add(pill.number);
                    }
                    callback.onResult(ordered, true);
                })
                .addOnFailureListener(e -> {
                    scaled.recycle();
                    callback.onResult(Collections.emptyList(), false);
                });
    }

    private List<DetectedPill> extractMainHorizontalRow(List<DetectedPill> candidates, int scaledH) {
        if (candidates.isEmpty()) return Collections.emptyList();

        int yTolerance = Math.max(12, (int) (scaledH * 0.24f));
        List<DetectedPill> bestRow = Collections.emptyList();

        for (DetectedPill anchor : candidates) {
            List<DetectedPill> row = new ArrayList<>();
            for (DetectedPill other : candidates) {
                if (Math.abs(other.centerY - anchor.centerY) <= yTolerance) {
                    row.add(other);
                }
            }
            if (row.size() > bestRow.size()) {
                bestRow = row;
            }
        }

        if (bestRow.isEmpty()) return Collections.emptyList();

        List<DetectedPill> sorted = new ArrayList<>(bestRow);
        Collections.sort(sorted, (a, b) -> Integer.compare(a.leftX, b.leftX));

        List<DetectedPill> deduped = new ArrayList<>();
        int lastX = -9999;
        for (DetectedPill p : sorted) {
            int minSpacing = Math.max(10, p.boxHeight / 2);
            if (p.leftX - lastX >= minSpacing) {
                deduped.add(p);
                lastX = p.leftX;
            }
        }
        return deduped;
    }

    private Integer parseRouletteToken(String rawText, PillColor color) {
        if (rawText == null) return null;
        String trimmed = rawText.trim();
        if (trimmed.isEmpty() || trimmed.length() > 3) return null;

        // Rejeita palavras/rótulos mistos (ex: "Depósito", "KWANZA", "2to1", "Odd")
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
        if (num == 0 && color != PillColor.GREEN) return null;
        if (num != 0 && color == PillColor.GREEN) return null;

        boolean isRedExpected = RED_NUMBERS.contains(num);
        if (color == PillColor.RED && !isRedExpected) return null;
        if (color == PillColor.BLACK && (num == 0 || isRedExpected)) return null;

        return num;
    }

    private PillColor samplePillColor(Bitmap bitmap, Rect box) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int midY = clamp((box.top + box.bottom) / 2, 0, h - 1);
        int midX = clamp((box.left + box.right) / 2, 0, w - 1);

        int[][] points = new int[][]{
                {clamp(box.left - 5, 0, w - 1), midY},
                {clamp(box.right + 5, 0, w - 1), midY},
                {midX, clamp(box.top - 5, 0, h - 1)},
                {midX, clamp(box.bottom + 5, 0, h - 1)},
                {clamp(box.left - 2, 0, w - 1), midY},
                {clamp(box.right + 2, 0, w - 1), midY}
        };

        int sumR = 0;
        int sumG = 0;
        int sumB = 0;
        int count = 0;

        for (int[] pt : points) {
            int px = bitmap.getPixel(pt[0], pt[1]);
            int r = Color.red(px);
            int g = Color.green(px);
            int b = Color.blue(px);
            // Ignora pixeis brancos da borda do ultimo numero ou do texto
            if (r > 185 && g > 185 && b > 185) {
                continue;
            }
            sumR += r;
            sumG += g;
            sumB += b;
            count++;
        }

        if (count == 0) {
            int fallback = bitmap.getPixel(clamp(box.left - 4, 0, w - 1), midY);
            sumR = Color.red(fallback);
            sumG = Color.green(fallback);
            sumB = Color.blue(fallback);
            count = 1;
        }

        int r = sumR / count;
        int g = sumG / count;
        int b = sumB / count;

        if (g > r + 20 && g > b + 15) return PillColor.GREEN;
        if (r > g + 30 && r > b + 25) return PillColor.RED;
        return PillColor.BLACK;
    }

    private int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
