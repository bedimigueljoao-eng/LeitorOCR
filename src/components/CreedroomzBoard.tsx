import React from 'react';
import { FieldSuggestions, getRouletteColor } from '../utils/rouletteEngine';

interface CreedroomzBoardProps {
  lastNumber: number | null;
  suggestedChips: number[];
  fieldSuggestions: FieldSuggestions;
  onRegisterSpin: (num: number) => void;
}

export const CreedroomzBoard: React.FC<CreedroomzBoardProps> = ({
  lastNumber,
  suggestedChips,
  fieldSuggestions,
  onRegisterSpin,
}) => {
  const suggestedSet = new Set(suggestedChips);

  const rows = Array.from({ length: 12 }, (_, rowIdx) => [
    rowIdx * 3 + 1,
    rowIdx * 3 + 2,
    rowIdx * 3 + 3,
  ]);

  const outsideFields = [
    {
      label: '1-18',
      isSuggested: fieldSuggestions.half.startsWith('1–18'),
      bg: 'bg-[#161E2C] text-slate-300',
    },
    {
      label: 'Par',
      isSuggested: fieldSuggestions.parity === 'Par',
      bg: 'bg-[#161E2C] text-slate-300',
    },
    {
      label: 'Verm',
      isSuggested: fieldSuggestions.color === 'Vermelho',
      bg: 'bg-[#991B1B] text-white',
    },
    {
      label: 'Pret',
      isSuggested: fieldSuggestions.color === 'Preto',
      bg: 'bg-[#131720] text-slate-200',
    },
    {
      label: 'Ímp',
      isSuggested: fieldSuggestions.parity === 'Ímpar',
      bg: 'bg-[#161E2C] text-slate-300',
    },
    {
      label: '19-36',
      isSuggested: fieldSuggestions.half.startsWith('19–36'),
      bg: 'bg-[#161E2C] text-slate-300',
    },
  ];

  return (
    <div className="w-full max-w-[340px] mx-auto select-none">
      <div className="grid grid-cols-[48px_40px_1fr] gap-1 text-xs font-mono">
        {/* Coluna externa (1-18, Par, Vermelho, Preto, Impar, 19-36) */}
        <div className="col-start-1 row-start-2 grid grid-rows-6 gap-1">
          {outsideFields.map((item) => (
            <div
              key={item.label}
              className={`${item.bg} relative flex items-center justify-center rounded border px-1 text-[11px] font-medium ${
                item.isSuggested
                  ? 'border-amber-400 ring-1 ring-amber-400/70'
                  : 'border-slate-800'
              }`}
            >
              <span>{item.label}</span>
              {item.isSuggested && (
                <span
                  title="Campo sugerido"
                  className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400"
                />
              )}
            </div>
          ))}
        </div>

        {/* Coluna de Duzias (1st12, 2nd12, 3rd12) */}
        <div className="col-start-2 row-start-2 grid grid-rows-3 gap-1">
          {[
            { idx: 1, label: '1st 12' },
            { idx: 2, label: '2nd 12' },
            { idx: 3, label: '3rd 12' },
          ].map((dz) => {
            const highlighted = fieldSuggestions.dozenIndex === dz.idx;
            return (
              <div
                key={dz.label}
                className={`relative flex items-center justify-center rounded border text-[11px] font-medium ${
                  highlighted
                    ? 'border-amber-400 bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/60'
                    : 'border-slate-800 bg-[#161E2C] text-slate-300'
                }`}
              >
                <span className="-rotate-90 whitespace-nowrap">{dz.label}</span>
              </div>
            );
          })}
        </div>

        {/* Zero no topo */}
        <button
          type="button"
          onClick={() => onRegisterSpin(0)}
          className={`col-start-3 row-start-1 relative flex h-10 items-center justify-center rounded border font-bold transition-colors cursor-pointer ${
            lastNumber === 0
              ? 'border-amber-400 bg-emerald-700 text-white'
              : 'border-emerald-700/60 bg-emerald-800/80 text-white hover:bg-emerald-700'
          }`}
        >
          0
          {suggestedSet.has(0) && (
            <span className="absolute right-2 h-4 w-4 rounded-full border-2 border-amber-300 bg-amber-500/90 text-[9px] leading-3 flex items-center justify-center text-slate-950 font-bold">
              +
            </span>
          )}
        </button>

        {/* Grade 3x12 de 1 a 36 */}
        <div className="col-start-3 row-start-2 grid grid-cols-3 gap-1">
          {rows.flat().map((num) => {
            const color = getRouletteColor(num);
            const isSuggested = suggestedSet.has(num);
            const isLast = lastNumber === num;
            const bgClass =
              color === 'red'
                ? 'bg-[#A61B26] hover:bg-[#BE222E]'
                : 'bg-[#171C26] hover:bg-[#222938]';

            return (
              <button
                key={num}
                type="button"
                onClick={() => onRegisterSpin(num)}
                className={`relative flex h-9 items-center justify-center rounded border text-xs font-semibold text-white transition-transform active:scale-95 cursor-pointer ${bgClass} ${
                  isLast
                    ? 'border-amber-400 ring-1 ring-amber-400'
                    : isSuggested
                    ? 'border-emerald-400'
                    : 'border-slate-800/90'
                }`}
              >
                {num}
                {isSuggested && (
                  <span
                    title="Ficha sugerida"
                    className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-400 text-[8px] font-bold text-slate-950"
                  >
                    +
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Linha inferior 2 to 1 (Colunas) */}
        <div className="col-start-3 row-start-3 grid grid-cols-3 gap-1">
          {[1, 2, 3].map((colIdx) => {
            const isSuggested = fieldSuggestions.columnIndex === colIdx;
            return (
              <div
                key={colIdx}
                className={`flex h-8 items-center justify-center rounded border text-[10px] font-medium ${
                  isSuggested
                    ? 'border-amber-400 bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/60'
                    : 'border-slate-800 bg-[#161E2C] text-slate-400'
                }`}
              >
                Col {colIdx}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-400 bg-amber-500/20" />
          Campos externos sugeridos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />
          Números sugeridos
        </span>
      </div>
    </div>
  );
};
