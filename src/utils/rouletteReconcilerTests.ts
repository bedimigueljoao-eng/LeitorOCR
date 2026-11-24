import assert from 'node:assert/strict';
import { reconcileScannerSpins } from './rouletteReconciler';

export function runRouletteReconcilerTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const check = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${name}:`, err);
    }
  };

  check('1. Incremental spin prepends to sessionSpins', () => {
    const res = reconcileScannerSpins([34, 16], [32, 10, 5], [27], false);
    assert.deepEqual(res.nextSession, [27, 34, 16]);
    assert.deepEqual(res.nextBackup, [32, 10, 5]);
  });

  check('2. Repeat number as incremental spin is preserved', () => {
    const res = reconcileScannerSpins([17, 34, 16], [], [17], false);
    assert.deepEqual(res.nextSession, [17, 17, 34, 16]);
  });

  check('3. Full strip initial table load populates backup without polluting session', () => {
    const res = reconcileScannerSpins([], [], [27, 34, 16, 32, 10], true);
    assert.deepEqual(res.nextSession, []);
    assert.deepEqual(res.nextBackup, [27, 34, 16, 32, 10]);
  });

  check('4. Full strip with exact shifted new spins promotes only new spins to session', () => {
    const res = reconcileScannerSpins([16, 32], [10, 5, 24], [27, 34, 16, 32, 10], true);
    assert.deepEqual(res.nextSession, [27, 34, 16, 32]);
  });

  check('5. Full strip with 1 flickering middle digit still aligns (3-of-4)', () => {
    // 32 temporarily read as 22 at index 3, anchor still matches at shift=1 ([34, 16, 22, 10] vs [16, 32, 10, 5])
    const res = reconcileScannerSpins([16, 32], [10, 5, 24], [27, 16, 22, 10, 5], true);
    assert.deepEqual(res.nextSession, [27, 16, 32]);
  });

  check('6. Identical full strip does not duplicate backup', () => {
    const res = reconcileScannerSpins([], [27, 34, 16, 32], [27, 34, 16, 32], true);
    assert.deepEqual(res.nextSession, []);
    assert.deepEqual(res.nextBackup, [27, 34, 16, 32]);
  });

  console.log(`Roulette Reconciler Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

runRouletteReconcilerTests();
