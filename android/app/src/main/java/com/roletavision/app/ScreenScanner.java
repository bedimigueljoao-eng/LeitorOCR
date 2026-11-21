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
        GREEN, RED, BLACK
    }

    public interface ScanCallback {
        void onResult(List<Integer> numbersNewestFirst);
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
            callback.onResult(Collections.emptyList());
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

        final int stripMidY = scaled.getHeight() / 2;
        final int maxBandDeviation = Math.max(16, (int) (scaled.getHeight() * 0.38f));

        InputImage image = InputImage.fromBitmap(scaled, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    List<DetectedPill> detected = new ArrayList<>();
                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            for (Text.Element element : line.getElements()) {
                                Rect box = element.getBoundingBox();
                                if (box == null) continue;
                                int cy = box.centerY();
                                if (Math.abs(cy - stripMidY) > maxBandDeviation) {
                                    continue;
                                }
                                PillColor sampledColor = samplePillColor(scaled, box);
                                Integer parsed = parseRouletteToken(element.getText(), sampledColor);
                                if (parsed != null) {
                                    detected.add(new DetectedPill(parsed, box.left, cy));
                                }
                            }
                        }
                    }
                    scaled.recycle();

                    if (detected.size() >= 3) {
                        List<Integer> ys = new ArrayList<>();
                        for (DetectedPill p : detected) ys.add(p.centerY);
                        Collections.sort(ys);
                        int medianY = ys.get(ys.size() / 2);
                        int rowTolerance = Math.max(14, cropH / 2);
                        List<DetectedPill> rowAligned = new ArrayList<>();
                        for (DetectedPill p : detected) {
                            if (Math.abs(p.centerY - medianY) <= rowTolerance) {
                                rowAligned.add(p);
                            }
                        }
                        detected = rowAligned;
                    }

                    Collections.sort(detected, (a, b) -> Integer.compare(a.leftX, b.leftX));
                    List<Integer> ordered = new ArrayList<>();
                    int lastX = Integer.MIN_VALUE;
                    for (DetectedPill pill : detected) {
                        // Evita duplicado do mesmo bounding box sobreposto
                        if (pill.leftX - lastX >= 8) {
                            ordered.add(pill.number);
                            lastX = pill.leftX;
                        }
                    }
                    callback.onResult(ordered);
                })
                .addOnFailureListener(e -> {
                    scaled.recycle();
                    callback.onResult(Collections.emptyList());
                });
    }

    private Integer parseRouletteToken(String rawText, PillColor color) {
        if (rawText == null) return null;
        String trimmed = rawText.trim();
        if (trimmed.isEmpty() || trimmed.length() > 3) return null;

        // Rejeita precos, horas e textos como "2to1" ou "1st12"
        if (trimmed.contains(".") || trimmed.contains(":") || trimmed.contains(",")
                || trimmed.contains("/") || trimmed.contains("%")) {
            return null;
        }

        String normalized = trimmed
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
                // Contem letra nao numerica: ignora token para nunca virar falso numero
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
            return (color == PillColor.GREEN || trimmed.equals("0")) ? 0 : null;
        }
        if (color == PillColor.GREEN) {
            return 0;
        }

        // Numero 1..36 dentro da faixa calibrada: retorna mesmo se a iluminacao variar
        // entre vermelho escuro e preto, mantendo integridade da roleta europeia.
        return num;
    }

    private PillColor samplePillColor(Bitmap bitmap, Rect box) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int cx = (box.left + box.right) / 2;
        int cy = (box.top + box.bottom) / 2;

        int[][] points = {
                {box.left - 4, cy},
                {box.right + 4, cy},
                {cx, box.top - 4},
                {cx, box.bottom + 4},
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
            // Ignora pixels brancos dos digitos ou da borda branca do numero mais recente
            if (r > 180 && g > 180 && b > 180) {
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
        return PillColor.BLACK;
    }
}
