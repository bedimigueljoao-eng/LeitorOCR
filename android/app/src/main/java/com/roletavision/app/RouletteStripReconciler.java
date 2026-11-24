package com.roletavision.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Reconciliador temporal partilhado para a faixa da Roleta (Split-Screen + MediaProjection).
 * - Confirmação inicial por 2 leituras concordantes (~700 ms) ou leitura forte >=5 pílulas com alta confiança.
 * - Correção crítica no shift == 0: exige que o índice 0 coincida para nunca bloquear correções na cabeça da faixa.
 * - Deteta +1..+4 giros novos por alinhamento de sequência com confirmação de 2 leituras (~700 ms) ou alta confiança ML Kit.
 * - Troca de mesa apenas após 3 quadros não alinhados + 2 confirmações estáveis.
 */
public class RouletteStripReconciler {

    public enum ActionType {
        NONE,
        INITIAL_FULL_STRIP,
        NEW_SPINS,
        TABLE_SWITCH_FULL_STRIP
    }

    public static class ReconcileAction {
        public final ActionType type;
        public final List<Integer> spinsToEmit;

        public ReconcileAction(ActionType type, List<Integer> spinsToEmit) {
            this.type = type;
            this.spinsToEmit = spinsToEmit != null ? spinsToEmit : Collections.emptyList();
        }
    }

    private final List<Integer> confirmedStrip = new ArrayList<>();
    private List<Integer> pendingHeadSpins = null;
    private List<Integer> pendingFullStrip = null;
    private int pendingConfirmCount = 0;
    private int unrelatedStripCount = 0;
    private Integer pendingInitHead = null;
    private int pendingInitCount = 0;

    public synchronized void reset() {
        confirmedStrip.clear();
        pendingHeadSpins = null;
        pendingFullStrip = null;
        pendingConfirmCount = 0;
        unrelatedStripCount = 0;
        pendingInitHead = null;
        pendingInitCount = 0;
    }

    public synchronized List<Integer> getConfirmedStripSnapshot() {
        return new ArrayList<>(confirmedStrip);
    }

    public synchronized ReconcileAction reconcile(List<Integer> newStrip, float avgConfidence) {
        if (newStrip == null || newStrip.size() < 3) {
            return new ReconcileAction(ActionType.NONE, Collections.emptyList());
        }

        // 1. Primeira leitura ao abrir a mesa
        if (confirmedStrip.isEmpty()) {
            Integer head = newStrip.get(0);
            if (head.equals(pendingInitHead)) {
                pendingInitCount++;
            } else {
                pendingInitHead = head;
                pendingInitCount = 1;
            }
            boolean strongSingleRead = newStrip.size() >= 5 && avgConfidence >= 0.85f;
            if (strongSingleRead || pendingInitCount >= 2) {
                confirmedStrip.clear();
                confirmedStrip.addAll(newStrip);
                pendingInitHead = null;
                pendingInitCount = 0;
                return new ReconcileAction(ActionType.INITIAL_FULL_STRIP, new ArrayList<>(newStrip));
            }
            return new ReconcileAction(ActionType.NONE, Collections.emptyList());
        }

        if (newStrip.equals(confirmedStrip)) {
            clearPendingCandidate();
            return new ReconcileAction(ActionType.NONE, Collections.emptyList());
        }

        // 2. Testa shift == 0 (MESMA cabeça e mesma faixa) ou shift negativos (-1..-3 quando pílulas à esquerda falharam temporariamente)
        int bestNegShift = 999;
        int bestNegMatches = 0;
        for (int shift = 0; shift >= -3; shift--) {
            if (shift == 0 && !newStrip.get(0).equals(confirmedStrip.get(0))) {
                // Regra obrigatória: nunca tratar shift == 0 se a cabeça mudou (evita prender erros no índice 0)
                continue;
            }
            int offsetConf = -shift;
            int maxCheck = Math.min(6, Math.min(newStrip.size(), confirmedStrip.size() - offsetConf));
            if (maxCheck < 3) continue;
            int matches = 0;
            for (int i = 0; i < maxCheck; i++) {
                if (newStrip.get(i).equals(confirmedStrip.get(i + offsetConf))) {
                    matches++;
                }
            }
            boolean valid = (maxCheck == 3 && matches == 3)
                    || (maxCheck >= 4 && matches >= Math.max(3, maxCheck - 1));
            if (valid && (matches > bestNegMatches || (matches == bestNegMatches && shift > bestNegShift))) {
                bestNegMatches = matches;
                bestNegShift = shift;
            }
        }

        if (bestNegShift != 999) {
            clearPendingCandidate();
            if (bestNegShift == 0 && newStrip.size() > confirmedStrip.size() && bestNegMatches >= 4) {
                confirmedStrip.clear();
                confirmedStrip.addAll(newStrip);
            }
            return new ReconcileAction(ActionType.NONE, Collections.emptyList());
        }

        // 3. Testa shift positivo (+1..+4): realmente entraram novos giros
        int bestPosShift = -1;
        int bestPosMatches = 0;
        for (int shift = 1; shift <= 4; shift++) {
            int maxCheck = Math.min(6, Math.min(newStrip.size() - shift, confirmedStrip.size()));
            if (maxCheck < 3) continue;
            int matches = 0;
            for (int i = 0; i < maxCheck; i++) {
                if (newStrip.get(i + shift).equals(confirmedStrip.get(i))) {
                    matches++;
                }
            }
            boolean valid = (maxCheck == 3 && matches == 3)
                    || (maxCheck >= 4 && matches >= Math.max(3, maxCheck - 1));
            if (valid && matches > bestPosMatches) {
                bestPosMatches = matches;
                bestPosShift = shift;
            }
        }

        if (bestPosShift > 0) {
            unrelatedStripCount = 0;
            List<Integer> candidateNew = new ArrayList<>(newStrip.subList(0, bestPosShift));
            if (candidateNew.equals(pendingHeadSpins)) {
                pendingConfirmCount++;
            } else {
                pendingHeadSpins = candidateNew;
                pendingFullStrip = new ArrayList<>(newStrip);
                pendingConfirmCount = 1;
            }

            // Só aceita em 1 leitura se a confiança real do ML Kit for genuinamente alta (>= 0.85) com 4+ matches
            boolean fastVerified = bestPosMatches >= 4 && avgConfidence >= 0.85f;
            if (fastVerified || pendingConfirmCount >= 2) {
                confirmedStrip.clear();
                confirmedStrip.addAll(pendingFullStrip != null ? pendingFullStrip : newStrip);
                clearPendingCandidate();
                return new ReconcileAction(ActionType.NEW_SPINS, candidateNew);
            }
            return new ReconcileAction(ActionType.NONE, Collections.emptyList());
        }

        // 4. Sem alinhamento: troca de mesa apenas após 3 quadros seguidos + 2 confirmações consistentes
        pendingHeadSpins = null;
        pendingFullStrip = null;
        pendingConfirmCount = 0;
        unrelatedStripCount++;
        if (unrelatedStripCount >= 3 && newStrip.size() >= 4) {
            Integer head = newStrip.get(0);
            if (head.equals(pendingInitHead)) {
                pendingInitCount++;
            } else {
                pendingInitHead = head;
                pendingInitCount = 1;
            }
            if (pendingInitCount >= 2) {
                confirmedStrip.clear();
                confirmedStrip.addAll(newStrip);
                unrelatedStripCount = 0;
                pendingInitHead = null;
                pendingInitCount = 0;
                return new ReconcileAction(ActionType.TABLE_SWITCH_FULL_STRIP, new ArrayList<>(newStrip));
            }
        }

        return new ReconcileAction(ActionType.NONE, Collections.emptyList());
    }

    private void clearPendingCandidate() {
        pendingHeadSpins = null;
        pendingFullStrip = null;
        pendingConfirmCount = 0;
        unrelatedStripCount = 0;
    }
}
