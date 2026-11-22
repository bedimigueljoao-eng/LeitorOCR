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

    // ==================== BAC BO OCR ====================

    public static class BacBoCell {
        public final String outcome; // "P", "B", "T"
        public final int total;      // 2..12 or -1 if unknown
        public final int centerX;
        public final int centerY;
        public final int boxHeight;
        public int playerTotal = -1;
        public int bankerTotal = -1;

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

    /**
     * Scanner unificado para Bac Bo:
     * 1) Modo 3 Blocos (Split-Screen): lê diretamente o total grande no cartão azul JOGADOR (esquerda)
     *    e no cartão vermelho BANCA (direita), ignorando completamente a tabela fixa central do EMPATE.
     * 2) Modo Grelha (Bead Plate): se a área contiver >= 6 células com bolas Azuis/Vermelhas, lê a grelha.
     */
    public void scanBacBoFrame(
            Bitmap fullBitmap,
            float roiTopRatio,
            float roiHeightRatio,
            BacBoFrameCallback callback
    ) {
        int width = fullBitmap.getWidth();
        int height = fullBitmap.getHeight();
        if (width < 40 || height < 40) {
            callback.onResult(-1, -1, false, Collections.emptyList(), false);
            return;
        }

        int topY = Math.max(0, Math.min(height - 20, (int) (height * roiTopRatio)));
        int cropH = Math.max(24, Math.min(height - topY, (int) (height * roiHeightRatio)));

        Bitmap cropped = Bitmap.createBitmap(fullBitmap, 0, topY, width, cropH);
        int scaleFactor = cropH < 240 ? 2 : 1;
        Bitmap scaled = scaleFactor > 1
                ? Bitmap.createScaledBitmap(cropped, cropped.getWidth() * scaleFactor, cropped.getHeight() * scaleFactor, true)
                : cropped;
        if (scaled != cropped) {
            cropped.recycle();
        }

        final int sw = scaled.getWidth();
        final int sh = scaled.getHeight();
        InputImage image = InputImage.fromBitmap(scaled, 0);
        recognizer.process(image)
                .addOnSuccessListener(visionText -> {
                    int bestP = -1;
                    int bestPH = 0;
                    int bestB = -1;
                    int bestBH = 0;
                    boolean blocksVisible = false;

                    List<BacBoCell> plateCandidates = new ArrayList<>();
                    int pbPlateCount = 0;

                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            for (Text.Element element : line.getElements()) {
                                String rawText = element.getText();
                                if (rawText == null) continue;
                                String upper = rawText.trim().toUpperCase();
                                if (upper.contains("JOGADOR") || upper.contains("PLAYER")
                                        || upper.contains("BANCA") || upper.contains("BANKER")
                                        || upper.contains("EMPATE") || upper.equals("1:1")) {
                                    blocksVisible = true;
                                }

                                Rect box = element.getBoundingBox();
                                if (box == null) continue;
                                int bh = box.height();
                                int bw = box.width();
                                int cx = (box.left + box.right) / 2;
                                int cy = (box.top + box.bottom) / 2;

                                Integer num = parseBacBoNumberOnly(upper);
                                if (num == null) continue;

                                String colorOutcome = sampleBacBoOutcomeColor(scaled, box);

                                // 1. Deteção nos 3 Blocos (JOGADOR à esquerda | BANCA à direita)
                                // Ignora zona central (0.37..0.63 = círculo dourado EMPATE) e texto pequeno inferior (y >= 0.78)
                                if (bh >= Math.max(16, (int) (sh * 0.10f)) && cy < sh * 0.78f) {
                                    if (cx < sw * 0.37f && "P".equals(colorOutcome) && bh > bestPH) {
                                        bestP = num;
                                        bestPH = bh;
                                        blocksVisible = true;
                                    } else if (cx > sw * 0.63f && "B".equals(colorOutcome) && bh > bestBH) {
                                        bestB = num;
                                        bestBH = bh;
                                        blocksVisible = true;
                                    }
                                }

                                // 2. Candidato a Bead Plate (células menores e uniformes; exige bolas Azuis/Vermelhas)
                                if (colorOutcome != null
                                        && bh >= 8
                                        && bh <= sh * 0.34f
                                        && bw <= sh * 1.1f) {
                                    plateCandidates.add(new BacBoCell(colorOutcome, num, cx, cy, bh));
                                    if ("P".equals(colorOutcome) || "B".equals(colorOutcome)) {
                                        pbPlateCount++;
                                    }
                                }
                            }
                        }
                    }
                    scaled.recycle();

                    // Só aceita Bead Plate se não for o círculo central EMPATE (exige bolas Azuis/Vermelhas reais)
                    List<BacBoCell> orderedPlate = Collections.emptyList();
                    if (bestP < 2 && bestB < 2 && plateCandidates.size() >= 6 && pbPlateCount >= 2) {
                        orderedPlate = orderBacBoCells(plateCandidates);
                    }

                    boolean ocrOk = blocksVisible || (bestP >= 2 && bestB >= 2) || !orderedPlate.isEmpty();
                    callback.onResult(bestP, bestB, blocksVisible, orderedPlate, ocrOk);
                })
                .addOnFailureListener(e -> {
                    scaled.recycle();
                    callback.onResult(-1, -1, false, Collections.emptyList(), false);
                });
    }

    private List<BacBoCell> orderBacBoCells(List<BacBoCell> rawCandidates) {
        if (rawCandidates.isEmpty()) return Collections.emptyList();

        // 1. Filtra ruído por altura mediana das células reais do Bead Plate
        List<Integer> heights = new ArrayList<>(rawCandidates.size());
        for (BacBoCell c : rawCandidates) heights.add(c.boxHeight);
        Collections.sort(heights);
        int medianH = heights.get(heights.size() / 2);

        List<BacBoCell> candidates = new ArrayList<>();
        for (BacBoCell c : rawCandidates) {
            if (c.boxHeight >= Math.max(6, (int) (medianH * 0.52f))
                    && c.boxHeight <= Math.max(20, (int) (medianH * 1.75f))) {
                candidates.add(c);
            }
        }
        if (candidates.isEmpty()) return Collections.emptyList();

        // 2. Deduplica elementos na mesma célula (mesmo X/Y aproximado)
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
            if (!duplicate) {
                deduped.add(c);
            }
        }

        // 3. Agrupa por colunas verticais usando centerX (robusto para 1 e 2 dígitos como 7 vs 11)
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

        // 4. Dentro de cada coluna, ordena de cima para baixo (Row 0 -> Row 5)
        List<BacBoCell> chronological = new ArrayList<>(deduped.size());
        for (List<BacBoCell> col : columns) {
            Collections.sort(col, (a, b) -> Integer.compare(a.centerY, b.centerY));
            chronological.addAll(col);
        }

        // 5. Inverte para newestFirst (índice 0 = célula mais inferior da coluna mais à direita)
        Collections.reverse(chronological);
        return chronological;
    }

    private Integer parseBacBoNumberOnly(String rawText) {
        if (rawText == null) return null;
        String trimmed = rawText.trim();
        if (trimmed.isEmpty() || trimmed.length() > 2) return null;
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

    private Integer parseBacBoToken(String rawText, String detectedOutcome) {
        if (rawText == null) return null;
        String trimmed = rawText.trim().toUpperCase();
        if (trimmed.isEmpty() || trimmed.length() > 2) return null;

        if (trimmed.equals("P") && "P".equals(detectedOutcome)) return -1;
        if (trimmed.equals("B") && "B".equals(detectedOutcome)) return -1;
        if ((trimmed.equals("T") || trimmed.equals("E")) && "T".equals(detectedOutcome)) return -1;

        return parseBacBoNumberOnly(trimmed);
    }

    private String sampleBacBoOutcomeColor(Bitmap bitmap, Rect box) {
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int midY = clamp((box.top + box.bottom) / 2, 0, h - 1);
        int midX = clamp((box.left + box.right) / 2, 0, w - 1);
        int bw = Math.max(4, box.width());
        int bh = Math.max(4, box.height());
        int dx = Math.max(2, bw / 4);
        int dy = Math.max(2, bh / 4);

        // Amostra o anel colorido ao redor do número branco sem invadir o fundo cinza/branco da grelha
        int[][] points = new int[][]{
                {clamp(box.left - 2, 0, w - 1), midY},
                {clamp(box.right + 2, 0, w - 1), midY},
                {clamp(box.left - dx, 0, w - 1), midY},
                {clamp(box.right + dx, 0, w - 1), midY},
                {midX, clamp(box.top - 2, 0, h - 1)},
                {midX, clamp(box.bottom + 2, 0, h - 1)},
                {midX, clamp(box.top - dy, 0, h - 1)},
                {midX, clamp(box.bottom + dy, 0, h - 1)},
                {clamp(box.left + 1, 0, w - 1), clamp(box.top + 1, 0, h - 1)},
                {clamp(box.right - 1, 0, w - 1), clamp(box.top + 1, 0, h - 1)},
                {clamp(box.left + 1, 0, w - 1), clamp(box.bottom - 1, 0, h - 1)},
                {clamp(box.right - 1, 0, w - 1), clamp(box.bottom - 1, 0, h - 1)}
        };

        int votesP = 0;
        int votesB = 0;
        int votesT = 0;

        for (int[] pt : points) {
            int px = bitmap.getPixel(pt[0], pt[1]);
            int r = Color.red(px);
            int g = Color.green(px);
            int b = Color.blue(px);
            int maxC = Math.max(r, Math.max(g, b));
            int minC = Math.min(r, Math.min(g, b));

            // Ignora número branco, fundo cinza claro da grelha e linhas de borda neutras
            if (r > 180 && g > 180 && b > 180) continue;
            if (maxC < 45) continue;
            if (maxC - minC < 26) continue;

            // 1. Tie (Dourado/Ocre #C59436 ou Verde): verifica ANTES de Red pois dourado também tem R alto
            if ((g > b + 32 && g > 90 && r > 115 && (r - g) < 88)
                    || (g > r + 15 && g > b + 15)) {
                votesT++;
            } else if (b > r + 24 && b >= g - 12 && b > 80) {
                // 2. Player (Azul)
                votesP++;
            } else if (r > b + 30 && r > g + 40 && r > 90 && g < b + 45) {
                // 3. Banker (Vermelho)
                votesB++;
            }
        }

        if (votesP == 0 && votesB == 0 && votesT == 0) return null;
        if (votesP >= votesB && votesP >= votesT) return "P";
        if (votesT >= votesB && votesT >= votesP) return "T";
        return "B";
    }
}
