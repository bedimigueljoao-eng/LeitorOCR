package com.roletavision.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Reconciliador unificado do Bac Bo (partilhado entre MainActivity Split-Screen e GameCaptureService).
 * - Modo "Jogador vs Banca" (Blocos): exige 2 frames consecutivos estáveis dos totais (2..12)
 *   para evitar leituras enquanto os dados ainda estão a rolar, com bloqueio anti-duplicação por ronda.
 * - Modo "Bead Plate" (Grelha): confirma grelha inicial (2 frames), extrai apenas novas jogadas
 *   por alinhamento sequencial e deteta troca de mesa.
 */
public class BacBoReconciler {

    public enum ActionType {
        NONE,
        BLOCK_CONFIRMED,
        INITIAL_FULL_PLATE,
        NEW_PLATE_CELLS,
        TABLE_SWITCH_FULL_PLATE
    }

    public static class ReconcileAction {
        public final ActionType type;
        public final List<ScreenScanner.BacBoCell> cellsToEmit;
        public final boolean isFullPlate;

        private ReconcileAction(ActionType type, List<ScreenScanner.BacBoCell> cellsToEmit, boolean isFullPlate) {
            this.type = type;
            this.cellsToEmit = cellsToEmit != null ? cellsToEmit : Collections.emptyList();
            this.isFullPlate = isFullPlate;
        }

        public static ReconcileAction none() {
            return new ReconcileAction(ActionType.NONE, Collections.emptyList(), false);
        }
    }

    private static final long BLOCK_ROUND_LOCK_MS = 3500L;
    private static final long BLOCK_EMPTY_UNLOCK_MS = 3000L;
    private static final long PLATE_ROUND_COOLDOWN_MS = 6000L;

    // Estado de reconciliação para Blocos (Jogador vs Banca)
    private boolean blockRoundLocked = false;
    private int lockedPlayerTotal = -1;
    private int lockedBankerTotal = -1;
    private int pendingBlockP = -1;
    private int pendingBlockB = -1;
    private int pendingBlockStableCount = 0;
    private int emptyBlockFrames = 0;
    private long lastLiveEmitMs = 0L;

    // Estado de reconciliação para Bead Plate (mais recente no índice 0)
    private final List<ScreenScanner.BacBoCell> confirmedPlate = new ArrayList<>();
    private List<ScreenScanner.BacBoCell> pendingPlateNew = null;
    private List<ScreenScanner.BacBoCell> pendingPlateFull = null;
    private int pendingPlateConfirmCount = 0;
    private int unrelatedPlateCount = 0;
    private String pendingPlateInitHeadSig = null;
    private int pendingPlateInitCount = 0;

    public synchronized void reset() {
        blockRoundLocked = false;
        lockedPlayerTotal = -1;
        lockedBankerTotal = -1;
        pendingBlockP = -1;
        pendingBlockB = -1;
        pendingBlockStableCount = 0;
        emptyBlockFrames = 0;
        lastLiveEmitMs = 0L;

        confirmedPlate.clear();
        pendingPlateNew = null;
        pendingPlateFull = null;
        pendingPlateConfirmCount = 0;
        unrelatedPlateCount = 0;
        pendingPlateInitHeadSig = null;
        pendingPlateInitCount = 0;
    }

    public synchronized ReconcileAction reconcileBlocks(int pTotal, int bTotal, long nowMs) {
        if (pTotal >= 2 && bTotal >= 2 && pTotal <= 12 && bTotal <= 12) {
            emptyBlockFrames = 0;

            if (blockRoundLocked) {
                boolean sameResult = (pTotal == lockedPlayerTotal && bTotal == lockedBankerTotal);
                boolean withinMinCycle = (nowMs - lastLiveEmitMs) < BLOCK_ROUND_LOCK_MS;
                if (sameResult || withinMinCycle) {
                    return ReconcileAction.none();
                }
                blockRoundLocked = false;
            }

            if (pTotal == pendingBlockP && bTotal == pendingBlockB) {
                pendingBlockStableCount++;
            } else {
                pendingBlockP = pTotal;
                pendingBlockB = bTotal;
                pendingBlockStableCount = 1;
            }

            // 2 leituras consecutivas idênticas garantem que ambos os dados já assentaram
            if (pendingBlockStableCount >= 2) {
                String outcome = pTotal > bTotal ? "P" : (bTotal > pTotal ? "B" : "T");
                int winTotal = Math.max(pTotal, bTotal);

                ScreenScanner.BacBoCell cell = new ScreenScanner.BacBoCell(outcome, winTotal, 0, 0, 0);
                cell.playerTotal = pTotal;
                cell.bankerTotal = bTotal;

                blockRoundLocked = true;
                lockedPlayerTotal = pTotal;
                lockedBankerTotal = bTotal;
                pendingBlockP = -1;
                pendingBlockB = -1;
                pendingBlockStableCount = 0;
                lastLiveEmitMs = nowMs;

                return new ReconcileAction(
                        ActionType.BLOCK_CONFIRMED,
                        Collections.singletonList(cell),
                        false
                );
            }
            return ReconcileAction.none();
        }

        // Dados voltaram a rolar / ecrã a limpar totais entre rondas
        pendingBlockP = -1;
        pendingBlockB = -1;
        pendingBlockStableCount = 0;
        emptyBlockFrames++;
        if (blockRoundLocked && emptyBlockFrames >= 3 && (nowMs - lastLiveEmitMs) >= BLOCK_EMPTY_UNLOCK_MS) {
            blockRoundLocked = false;
        }
        return ReconcileAction.none();
    }

    public synchronized ReconcileAction reconcilePlate(
            List<ScreenScanner.BacBoCell> newCellsNewestFirst,
            long nowMs
    ) {
        if (newCellsNewestFirst == null || newCellsNewestFirst.size() < 4) {
            return ReconcileAction.none();
        }

        if (confirmedPlate.isEmpty()) {
            String headSig = buildHeadSignature(newCellsNewestFirst);
            if (headSig.equals(pendingPlateInitHeadSig)) {
                pendingPlateInitCount++;
            } else {
                pendingPlateInitHeadSig = headSig;
                pendingPlateInitCount = 1;
            }
            if (pendingPlateInitCount >= 2) {
                confirmedPlate.clear();
                confirmedPlate.addAll(newCellsNewestFirst);
                pendingPlateInitHeadSig = null;
                pendingPlateInitCount = 0;
                lastLiveEmitMs = nowMs;
                return new ReconcileAction(
                        ActionType.INITIAL_FULL_PLATE,
                        new ArrayList<>(newCellsNewestFirst),
                        true
                );
            }
            return ReconcileAction.none();
        }

        if (cellsMatchExactOrColor(newCellsNewestFirst, confirmedPlate)) {
            pendingPlateNew = null;
            pendingPlateFull = null;
            pendingPlateConfirmCount = 0;
            unrelatedPlateCount = 0;
            // Se o novo frame trouxe mais totais numéricos (menos -1), atualiza cache silenciosamente
            if (countKnownTotals(newCellsNewestFirst) > countKnownTotals(confirmedPlate)) {
                confirmedPlate.clear();
                confirmedPlate.addAll(newCellsNewestFirst);
            }
            return ReconcileAction.none();
        }

        // Verifica se é apenas o mesmo histórico sem novidade (shift 0..-3)
        int bestNegShift = 999;
        int bestNegMatches = 0;
        for (int shift = 0; shift >= -3; shift--) {
            int offsetConf = -shift;
            int avail = Math.min(8, Math.min(newCellsNewestFirst.size(), confirmedPlate.size() - offsetConf));
            if (avail < 3) continue;
            int matches = countOrderedMatches(newCellsNewestFirst, 0, confirmedPlate, offsetConf, avail);
            boolean valid = (avail == 3 && matches == 3)
                    || (avail >= 4 && matches >= Math.max(3, avail - 1));
            if (shift == 0 && !cellsCompatible(newCellsNewestFirst.get(0), confirmedPlate.get(0))) {
                valid = false;
            }
            if (valid && (matches > bestNegMatches || (matches == bestNegMatches && shift > bestNegShift))) {
                bestNegMatches = matches;
                bestNegShift = shift;
            }
        }

        if (bestNegShift != 999) {
            pendingPlateNew = null;
            pendingPlateFull = null;
            pendingPlateConfirmCount = 0;
            unrelatedPlateCount = 0;
            if (bestNegShift == 0 && newCellsNewestFirst.size() >= confirmedPlate.size() && bestNegMatches >= 4) {
                confirmedPlate.clear();
                confirmedPlate.addAll(newCellsNewestFirst);
            }
            return ReconcileAction.none();
        }

        // Verifica se surgiram 1..3 novas jogadas no topo da grelha (shift +1..+3)
        int bestPosShift = -1;
        int bestPosMatches = 0;
        for (int shift = 1; shift <= 3; shift++) {
            int avail = Math.min(8, Math.min(newCellsNewestFirst.size() - shift, confirmedPlate.size()));
            if (avail < 3) continue;
            int matches = countOrderedMatches(newCellsNewestFirst, shift, confirmedPlate, 0, avail);
            boolean valid = (avail == 3 && matches == 3)
                    || (avail >= 4 && matches >= Math.max(3, avail - 1));
            if (valid && matches > bestPosMatches) {
                bestPosMatches = matches;
                bestPosShift = shift;
            }
        }

        if (bestPosShift > 0) {
            unrelatedPlateCount = 0;
            if (lastLiveEmitMs > 0L && (nowMs - lastLiveEmitMs) < PLATE_ROUND_COOLDOWN_MS) {
                return ReconcileAction.none();
            }
            List<ScreenScanner.BacBoCell> candidateNew = new ArrayList<>(newCellsNewestFirst.subList(0, bestPosShift));
            if (pendingPlateNew != null && cellsMatchExactOrColor(candidateNew, pendingPlateNew)) {
                pendingPlateConfirmCount++;
            } else {
                pendingPlateNew = candidateNew;
                pendingPlateFull = new ArrayList<>(newCellsNewestFirst);
                pendingPlateConfirmCount = 1;
            }

            if (pendingPlateConfirmCount >= 2) {
                confirmedPlate.clear();
                confirmedPlate.addAll(pendingPlateFull != null ? pendingPlateFull : newCellsNewestFirst);
                pendingPlateNew = null;
                pendingPlateFull = null;
                pendingPlateConfirmCount = 0;
                lastLiveEmitMs = nowMs;
                return new ReconcileAction(
                        ActionType.NEW_PLATE_CELLS,
                        candidateNew,
                        false
                );
            }
            return ReconcileAction.none();
        }

        // Possível troca de mesa
        pendingPlateNew = null;
        pendingPlateFull = null;
        pendingPlateConfirmCount = 0;
        unrelatedPlateCount++;
        if (unrelatedPlateCount >= 3 && newCellsNewestFirst.size() >= 4) {
            String headSig = buildHeadSignature(newCellsNewestFirst);
            if (headSig.equals(pendingPlateInitHeadSig)) {
                pendingPlateInitCount++;
            } else {
                pendingPlateInitHeadSig = headSig;
                pendingPlateInitCount = 1;
            }
            if (pendingPlateInitCount >= 2) {
                confirmedPlate.clear();
                confirmedPlate.addAll(newCellsNewestFirst);
                unrelatedPlateCount = 0;
                pendingPlateInitHeadSig = null;
                pendingPlateInitCount = 0;
                lastLiveEmitMs = nowMs;
                return new ReconcileAction(
                        ActionType.TABLE_SWITCH_FULL_PLATE,
                        new ArrayList<>(newCellsNewestFirst),
                        true
                );
            }
        }
        return ReconcileAction.none();
    }

    private static String buildHeadSignature(List<ScreenScanner.BacBoCell> cells) {
        int limit = Math.min(3, cells.size());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < limit; i++) {
            if (i > 0) sb.append('|');
            sb.append(cells.get(i).outcome);
        }
        return sb.toString();
    }

    private static boolean cellsCompatible(ScreenScanner.BacBoCell a, ScreenScanner.BacBoCell b) {
        if (!a.outcome.equals(b.outcome)) return false;
        if (a.total > 0 && b.total > 0) {
            return a.total == b.total;
        }
        return true;
    }

    private static boolean cellsMatchExactOrColor(List<ScreenScanner.BacBoCell> a, List<ScreenScanner.BacBoCell> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            if (!cellsCompatible(a.get(i), b.get(i))) return false;
        }
        return true;
    }

    private static int countKnownTotals(List<ScreenScanner.BacBoCell> list) {
        int count = 0;
        for (ScreenScanner.BacBoCell c : list) {
            if (c.total >= 2 && c.total <= 12) count++;
        }
        return count;
    }

    private static int countOrderedMatches(
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
            ScreenScanner.BacBoCell srcCell = source.get(i);
            for (int j = tgtCursor; j < tgtLimit && j <= tgtCursor + 2; j++) {
                if (cellsCompatible(srcCell, target.get(j))) {
                    matches++;
                    tgtCursor = j + 1;
                    break;
                }
            }
        }
        return matches;
    }
}
