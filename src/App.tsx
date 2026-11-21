import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Plus, CheckCircle2, XCircle } from 'lucide-react';
import {
  analyzeSpins,
  getRouletteColor,
  INITIAL_SCREENSHOT_SPINS,
  StrategyProfile,
} from './utils/rouletteEngine';
import { EuropeanWheel } from './components/EuropeanWheel';
import { CreedroomzBoard } from './components/CreedroomzBoard';
import { ScreenshotScannerTab } from './components/ScreenshotScannerTab';
import { AndroidBuilderTab } from './components/AndroidBuilderTab';

type ActiveTab = 'analyzer' | 'scanner' | 'board' | 'android';

const STORAGE_KEY_SPINS = 'roletavision_spins_v1';
const STORAGE_KEY_BANKROLL = 'roletavision_bankroll_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');
  const [spins, setSpins] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SPINS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return INITIAL_SCREENSHOT_SPINS;
  });

  const [bankrollAoa, setBankrollAoa] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BANKROLL);
      if (saved) {
        const val = Number(saved);
        if (!Number.isNaN(val) && val > 0) return val;
      }
    } catch {
      // ignore storage errors
    }
    return 238.39;
  });

  const [unitStakeAoa, setUnitStakeAoa] = useState<number>(10);
  const [profile, setProfile] = useState<StrategyProfile>('neighbors');
  const [manualInput, setManualInput] = useState<string>('');
  const [roiTopPct, setRoiTopPct] = useState<number>(12);
  const [roiHeightPct, setRoiHeightPct] = useState<number>(7);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SPINS, JSON.stringify(spins));
    } catch {
      // ignore storage errors
    }
  }, [spins]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_BANKROLL, String(bankrollAoa));
    } catch {
      // ignore storage errors
    }
  }, [bankrollAoa]);

  const analysis = useMemo(
    () => analyzeSpins(spins, profile, bankrollAoa, unitStakeAoa),
    [spins, profile, bankrollAoa, unitStakeAoa]
  );

  const handleRegisterSpin = (num: number) => {
    if (num < 0 || num > 36 || !Number.isInteger(num)) return;
    setSpins((prev) => [num, ...prev].slice(0, 500));
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(manualInput.trim());
    if (!Number.isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 36) {
      handleRegisterSpin(num);
      setManualInput('');
    }
  };

  const handleApplyScannedResults = (
    numbersNewestFirst: number[],
    detectedBalance: number | null
  ) => {
    if (numbersNewestFirst.length > 0) {
      setSpins((prev) => {
        const sameHead =
          prev.slice(0, numbersNewestFirst.length).join(',') ===
          numbersNewestFirst.join(',');
        if (sameHead) return prev;
        return numbersNewestFirst;
      });
    }
    if (detectedBalance !== null && detectedBalance >= 0) {
      setBankrollAoa(detectedBalance);
    }
  };

  const handleResetToSample = () => {
    setSpins(INITIAL_SCREENSHOT_SPINS);
    setBankrollAoa(238.39);
  };

  const handleClearSpins = () => {
    setSpins([]);
  };

  const { fieldSuggestions, accuracy } = analysis;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Bar Contract: exatamente 3 zonas separadas por gap-8 */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0B0F17]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 h-16">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('analyzer');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            RoletaVision
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {[
              { id: 'analyzer', label: 'Analisador' },
              { id: 'scanner', label: 'Leitor de Tela' },
              { id: 'board', label: 'Mesa e Roda' },
              { id: 'android', label: 'App Android' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id as ActiveTab)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  activeTab === item.id
                    ? 'border-amber-400 text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Ler Captura
            </button>
          </div>
        </div>

        <div className="flex md:hidden border-t border-slate-800/80 px-2 overflow-x-auto">
          {[
            { id: 'analyzer', label: 'Analisador' },
            { id: 'scanner', label: 'Leitor' },
            { id: 'board', label: 'Mesa' },
            { id: 'android', label: 'APK Android' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as ActiveTab)}
              className={`flex-1 py-2.5 px-3 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === item.id
                  ? 'border-amber-400 text-slate-100'
                  : 'border-transparent text-slate-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-6 space-y-6">
        {/* Faixa de Histórico Sincronizada */}
        <section className="rounded-xl border border-slate-800 bg-[#131924] p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Sessão Creedroomz</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {analysis.totalSpins} giros registrados
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-emerald-400">
                  Banca {bankrollAoa.toFixed(2)} AOA
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-amber-300">
                  Assertividade {accuracy.overallRatePct.toFixed(1)}%
                </span>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-100">
                Sugestões por Campo e Taxa de Acerto em Tempo Real
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={handleManualSubmit} className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="0–36"
                  aria-label="Registrar número manualmente"
                  className="w-20 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Giro</span>
                </button>
              </form>

              <button
                type="button"
                onClick={handleResetToSample}
                title="Carregar sequência da captura enviada"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Restaurar Print</span>
              </button>

              <button
                type="button"
                onClick={handleClearSpins}
                className="rounded-lg border border-slate-800 px-3 py-2 text-xs font-medium text-slate-400 hover:text-red-300 hover:border-red-900/60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Limpar
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1.5 overflow-x-auto pb-1">
            {spins.length === 0 ? (
              <span className="text-xs text-slate-500 py-1">
                Nenhum giro na sessão. Clique na mesa ou registre um número de 0 a 36.
              </span>
            ) : (
              spins.slice(0, 24).map((num, idx) => {
                const col = getRouletteColor(num);
                const bg =
                  col === 'green'
                    ? 'bg-emerald-700 border-emerald-500'
                    : col === 'red'
                    ? 'bg-[#A61B26] border-red-800/80'
                    : 'bg-[#181C24] border-slate-700';
                return (
                  <span
                    key={`${num}-${idx}`}
                    className={`inline-flex h-8 min-w-[32px] px-1.5 items-center justify-center rounded border font-mono text-xs font-bold text-white tabular-nums shrink-0 ${bg} ${
                      idx === 0 ? 'ring-2 ring-amber-400' : ''
                    }`}
                  >
                    {num}
                  </span>
                );
              })
            )}
          </div>
        </section>

        {activeTab === 'analyzer' && (
          <div className="space-y-6">
            {/* Sugestoes Completas para o Proximo Giro (Todos os Campos da Mesa) */}
            <section className="rounded-xl border border-slate-800 bg-[#131924] p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Sugestões de Aposta para o Próximo Giro
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Cobertura recomendada em todos os campos da mesa com base no histórico atual
                  </p>
                </div>
                <div className="font-mono text-xs text-emerald-400 tabular-nums">
                  {analysis.totalRoundStakeAoa.toFixed(0)} AOA sugeridos ({analysis.suggestedChips.length} fichas × {analysis.stakePerUnitAoa} AOA)
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
                  <div className="text-xs text-slate-400">Cor (Vermelho / Preto)</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`inline-block h-3 w-3 rounded-sm ${
                        fieldSuggestions.color === 'Vermelho'
                          ? 'bg-[#B91C1C]'
                          : 'bg-slate-900 border border-slate-600'
                      }`}
                    />
                    <span className="text-base font-semibold text-slate-100">
                      {fieldSuggestions.color}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {fieldSuggestions.colorReason}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
                  <div className="text-xs text-slate-400">Paridade (Par / Ímpar)</div>
                  <div className="mt-1 text-base font-semibold text-slate-100">
                    {fieldSuggestions.parity}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {fieldSuggestions.parityReason}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
                  <div className="text-xs text-slate-400">Força / Metade (1–18 / 19–36)</div>
                  <div className="mt-1 text-base font-semibold text-slate-100">
                    {fieldSuggestions.half}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {fieldSuggestions.halfReason}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
                  <div className="text-xs text-slate-400">Bloco / Dúzia</div>
                  <div className="mt-1 text-base font-semibold text-amber-300">
                    {fieldSuggestions.dozenLabel}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {fieldSuggestions.dozenReason}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
                  <div className="text-xs text-slate-400">Coluna (2to1)</div>
                  <div className="mt-1 text-base font-semibold text-amber-300">
                    {fieldSuggestions.columnLabel}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {fieldSuggestions.columnReason}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
                  <div className="text-xs text-slate-400">
                    Números Diretos e Setor ({fieldSuggestions.sectorName})
                  </div>
                  <div className="mt-1 font-mono text-base font-bold text-emerald-400 tabular-nums">
                    {fieldSuggestions.neighbors.join(' · ')}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Âncora {fieldSuggestions.anchorNumber} com ±2 vizinhos na roda
                  </div>
                </div>
              </div>
            </section>

            {/* Desempenho de Previsao: Acertou / Errou + Percentual por Campo */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Esquerda: Nivel Geral e Taxa por Mercado */}
              <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Nível de Acerto da Plataforma
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {accuracy.levelLabel} · {accuracy.evaluatedRounds} rodadas verificadas
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-2xl font-bold text-emerald-400 tabular-nums">
                      {accuracy.overallRatePct.toFixed(1)}%
                    </div>
                    <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {accuracy.totalHits}/{accuracy.totalAttempts} previsões acertadas
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-3 font-medium">Campo de Aposta</th>
                        <th className="py-2 px-3 font-medium text-right">Acertos</th>
                        <th className="py-2 px-3 font-medium text-right">Taxa Real</th>
                        <th className="py-2 pl-3 font-medium text-right">Base Roleta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {accuracy.byMarket.map((m) => {
                        const aboveBase = m.attempts > 0 && m.ratePct >= m.expectedRandomPct;
                        return (
                          <tr key={m.market} className="hover:bg-slate-800/30">
                            <td className="py-2.5 pr-3 font-medium text-slate-200">
                              {m.market}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                              {m.hits}/{m.attempts}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                                m.attempts === 0
                                  ? 'text-slate-500'
                                  : aboveBase
                                  ? 'text-emerald-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {m.ratePct.toFixed(1)}%
                            </td>
                            <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-500">
                              {m.expectedRandomPct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Direita: Resultado da Ultima Previsao (Acertou ou Errou em cada campo) */}
              <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Última Rodada Verificada
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Comparação entre sugestão ativa e resultado real
                    </p>
                  </div>
                  {accuracy.lastRound && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Saiu:</span>
                      <span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded border font-mono text-sm font-bold text-white tabular-nums ${
                          accuracy.lastRound.actualColor === 'green'
                            ? 'bg-emerald-700 border-emerald-500'
                            : accuracy.lastRound.actualColor === 'red'
                            ? 'bg-[#B91C1C] border-red-700'
                            : 'bg-[#181C24] border-slate-600'
                        }`}
                      >
                        {accuracy.lastRound.actualNumber}
                      </span>
                    </div>
                  )}
                </div>

                {!accuracy.lastRound ? (
                  <p className="text-xs text-slate-500 py-6">
                    Adicione pelo menos 2 giros para comparar previsão vs resultado.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800/70">
                    {accuracy.lastRound.markets.map((ev) => (
                      <div
                        key={ev.market}
                        className="py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-200">{ev.market}</div>
                          <div className="text-slate-400 truncate">
                            Sugestão: <span className="text-slate-200">{ev.predicted}</span> · Saiu:{' '}
                            <span className="text-slate-200">{ev.actual}</span>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 font-medium shrink-0 ${
                            ev.hit ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {ev.hit ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          <span>{ev.hit ? 'Acertou' : 'Errou'}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Grid Principal: Roda + Mesa + Estatisticas & Config */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#131924] p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Roda Europeia e Vizinhos
                  </h2>
                  <div className="flex items-center gap-1 p-1 bg-[#0B0F17] rounded-lg border border-slate-800">
                    {[
                      { id: 'neighbors', label: 'Vizinhos' },
                      { id: 'sectors', label: 'Setores' },
                      { id: 'balanced', label: 'Misto' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProfile(p.id as StrategyProfile)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          profile === p.id
                            ? 'bg-slate-800 text-amber-300'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <EuropeanWheel
                  lastNumber={analysis.lastNumber}
                  suggestedNumbers={analysis.suggestedChips}
                  hotNumbers={analysis.hotNumbers.map((x) => x.number)}
                  onSelectNumber={handleRegisterSpin}
                />
              </div>

              <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#131924] p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Mesa Creedroomz (Toque para Testar)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Campos e números destacados conforme sugestão atual
                  </p>
                </div>

                <CreedroomzBoard
                  lastNumber={analysis.lastNumber}
                  suggestedChips={analysis.suggestedChips}
                  fieldSuggestions={fieldSuggestions}
                  onRegisterSpin={handleRegisterSpin}
                />
              </div>

              <div className="lg:col-span-3 space-y-5">
                <div className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-4">
                  <h2 className="text-base font-semibold text-slate-100">
                    Parâmetros em AOA
                  </h2>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Banca atual (AOA)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={1}
                      value={bankrollAoa}
                      onChange={(e) => setBankrollAoa(Math.max(1, Number(e.target.value)))}
                      className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Valor base por ficha (AOA)
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[5, 10, 25, 50].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setUnitStakeAoa(v)}
                          className={`rounded-lg border py-1.5 font-mono text-xs font-medium cursor-pointer transition-colors ${
                            unitStakeAoa === v
                              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                              : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#131924] p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    Histórico Recente de Acertos
                  </h3>
                  {accuracy.recentRounds.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Registre mais um giro para iniciar a avaliação por rodada.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800/70 text-xs">
                      {accuracy.recentRounds.slice(0, 6).map((r) => (
                        <div
                          key={r.spinIndex}
                          className="py-2 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded font-mono text-[11px] font-bold text-white ${
                                r.actualColor === 'green'
                                  ? 'bg-emerald-700'
                                  : r.actualColor === 'red'
                                  ? 'bg-[#B91C1C]'
                                  : 'bg-[#181C24] border border-slate-700'
                              }`}
                            >
                              {r.actualNumber}
                            </span>
                            <span className="text-slate-300">
                              {r.markets[0]?.hit ? 'Cor OK' : 'Cor X'} ·{' '}
                              {r.markets[1]?.hit ? 'Par/Ímp OK' : 'Par/Ímp X'}
                            </span>
                          </div>
                          <span className="font-mono tabular-nums text-emerald-400">
                            {r.hitsCount}/{r.totalMarkets}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'scanner' && (
          <ScreenshotScannerTab
            roiTopPct={roiTopPct}
            roiHeightPct={roiHeightPct}
            onChangeRoiTop={setRoiTopPct}
            onChangeRoiHeight={setRoiHeightPct}
            onApplyScannedResults={(nums, bal) => {
              handleApplyScannedResults(nums, bal);
            }}
          />
        )}

        {activeTab === 'board' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="rounded-xl border border-slate-800 bg-[#131924] p-6">
              <h2 className="text-base font-semibold text-slate-100 mb-4">
                Roda Física Completa (37 Números)
              </h2>
              <EuropeanWheel
                lastNumber={analysis.lastNumber}
                suggestedNumbers={analysis.suggestedChips}
                hotNumbers={analysis.hotNumbers.map((x) => x.number)}
                onSelectNumber={handleRegisterSpin}
              />
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#131924] p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Painel Vertical Creedroomz
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Toque nos números abaixo para simular e acompanhar a taxa de acerto em tempo real
                </p>
              </div>
              <CreedroomzBoard
                lastNumber={analysis.lastNumber}
                suggestedChips={analysis.suggestedChips}
                fieldSuggestions={fieldSuggestions}
                onRegisterSpin={handleRegisterSpin}
              />
            </div>
          </div>
        )}

        {activeTab === 'android' && (
          <AndroidBuilderTab roiTopPct={roiTopPct} roiHeightPct={roiHeightPct} />
        )}
      </main>
    </div>
  );
}
