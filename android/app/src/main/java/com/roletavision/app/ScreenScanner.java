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
        void onResult(List<Integer> numbersNewestFirst);
    }

    private static class DetectedPill {
        final int number;
        final int leftX;

        DetectedPill(int number, int leftX) {
            this.number = number;
            this.leftX = leftX;
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

        InputImage image = InputImage.fromBitmap(scaled, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    List<DetectedPill> detected = new ArrayList<>();
                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            for (Text.Element element : line.getElements()) {
                                Rect box = element.getBoundingBox();
                                if (box == null) continue;
                                PillColor sampledColor = samplePillColor(scaled, box);
                                Integer parsed = parseRouletteToken(element.getText(), sampledColor);
                                if (parsed != null) {
                                    detected.add(new DetectedPill(parsed, box.left));
                                }
                            }
                        }
                    }
                    scaled.recycle();

                    Collections.sort(detected, (a, b) -> Integer.compare(a.leftX, b.leftX));
                    List<Integer> ordered = new ArrayList<>();
                    for (DetectedPill pill : detected) {
                        ordered.add(pill.number);
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
        String normalized = rawText.trim()
                .replace("O", "0")
                .replace("o", "0")
                .replace("I", "1")
                .replace("l", "1");

        StringBuilder digits = new StringBuilder();
        for (int i = 0; i < normalized.length(); i++) {
            char c = normalized.charAt(i);
            if (Character.isDigit(c)) {
                digits.append(c);
            }
        }

        if (digits.length() == 0) {
            return color == PillColor.GREEN ? 0 : null;
        }

        int num;
        try {
            num = Integer.parseInt(digits.toString());
        } catch (NumberFormatException e) {
            return null;
        }

        if (num < 0 || num > 36) return null;
        if (num == 0 && color != PillColor.GREEN) return null;
        if (num != 0 && color == PillColor.GREEN) return 0;

        boolean isRedExpected = RED_NUMBERS.contains(num);
        if (color == PillColor.RED && !isRedExpected) return null;
        if (color == PillColor.BLACK && (num == 0 || isRedExpected)) return null;

        return num;
    }

    private PillColor samplePillColor(Bitmap bitmap, Rect box) {
        int leftX = Math.max(0, Math.min(bitmap.getWidth() - 1, box.left - 6));
        int rightX = Math.max(0, Math.min(bitmap.getWidth() - 1, box.right + 6));
        int midY = Math.max(0, Math.min(bitmap.getHeight() - 1, (box.top + box.bottom) / 2));

        int p1 = bitmap.getPixel(leftX, midY);
        int p2 = bitmap.getPixel(rightX, midY);

        int r = (Color.red(p1) + Color.red(p2)) / 2;
        int g = (Color.green(p1) + Color.green(p2)) / 2;
        int b = (Color.blue(p1) + Color.blue(p2)) / 2;

        if (g > r + 24 && g > b + 18) return PillColor.GREEN;
        if (r > g + 35 && r > b + 30) return PillColor.RED;
        return PillColor.BLACK;
    }
}
