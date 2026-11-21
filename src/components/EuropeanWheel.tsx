import React from 'react';
import { getRouletteColor, WHEEL_ORDER } from '../utils/rouletteEngine';

interface EuropeanWheelProps {
  lastNumber: number | null;
  suggestedNumbers: number[];
  hotNumbers: number[];
  onSelectNumber: (num: number) => void;
}

export const EuropeanWheel: React.FC<EuropeanWheelProps> = ({
  lastNumber,
  suggestedNumbers,
  hotNumbers,
  onSelectNumber,
}) => {
  const suggestedSet = new Set(suggestedNumbers);
  const hotSet = new Set(hotNumbers);
  const total = WHEEL_ORDER.length;
  const sliceAngle = (2 * Math.PI) / total;
  const cx = 180;
  const cy = 180;
  const outerR = 166;
  const innerR = 104;
  const labelR = 138;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 360 360"
        className="w-full max-w-[330px] select-none"
        role="img"
        aria-label="Roda Europeia de 37 números"
      >
        {/* Aro externo metálico */}
        <circle
          cx={cx}
          cy={cy}
          r={174}
          fill="#0F1520"
          stroke="#2A3548"
          strokeWidth={2}
        />

        {WHEEL_ORDER.map((num, idx) => {
          const startAngle = idx * sliceAngle - Math.PI / 2 - sliceAngle / 2;
          const endAngle = startAngle + sliceAngle;
          const midAngle = (startAngle + endAngle) / 2;

          const x1Out = cx + outerR * Math.cos(startAngle);
          const y1Out = cy + outerR * Math.sin(startAngle);
          const x2Out = cx + outerR * Math.cos(endAngle);
          const y2Out = cy + outerR * Math.sin(endAngle);

          const x1In = cx + innerR * Math.cos(endAngle);
          const y1In = cy + innerR * Math.sin(endAngle);
          const x2In = cx + innerR * Math.cos(startAngle);
          const y2In = cy + innerR * Math.sin(startAngle);

          const pathData = [
            `M ${x1Out.toFixed(2)} ${y1Out.toFixed(2)}`,
            `A ${outerR} ${outerR} 0 0 1 ${x2Out.toFixed(2)} ${y2Out.toFixed(2)}`,
            `L ${x1In.toFixed(2)} ${y1In.toFixed(2)}`,
            `A ${innerR} ${innerR} 0 0 0 ${x2In.toFixed(2)} ${y2In.toFixed(2)}`,
            'Z',
          ].join(' ');

          const color = getRouletteColor(num);
          const fill =
            color === 'green'
              ? '#059669'
              : color === 'red'
              ? '#991B1B'
              : '#161B26';

          const isLast = lastNumber === num;
          const isSuggested = suggestedSet.has(num);
          const isHot = hotSet.has(num);

          const tx = cx + labelR * Math.cos(midAngle);
          const ty = cy + labelR * Math.sin(midAngle);
          const deg = (midAngle * 180) / Math.PI + 90;

          const dotX = cx + (innerR + 9) * Math.cos(midAngle);
          const dotY = cy + (innerR + 9) * Math.sin(midAngle);

          return (
            <g
              key={num}
              onClick={() => onSelectNumber(num)}
              className="cursor-pointer transition-opacity hover:opacity-85"
            >
              <path
                d={pathData}
                fill={fill}
                stroke={isLast ? '#FBBF24' : isSuggested ? '#10B981' : '#0B0F17'}
                strokeWidth={isLast ? 2.5 : isSuggested ? 1.8 : 1}
              />
              {isSuggested && (
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={3.5}
                  fill="#10B981"
                  stroke="#0B0F17"
                  strokeWidth={1}
                />
              )}
              {!isSuggested && isHot && (
                <circle cx={dotX} cy={dotY} r={2.5} fill="#F59E0B" />
              )}
              <text
                x={tx}
                y={ty}
                fill={isLast ? '#FDE68A' : '#F8FAFC'}
                fontSize="10.5"
                fontWeight={isLast || isSuggested ? '700' : '500'}
                fontFamily="JetBrains Mono, monospace"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${deg.toFixed(2)}, ${tx.toFixed(2)}, ${ty.toFixed(2)})`}
              >
                {num}
              </text>
            </g>
          );
        })}

        {/* Cone central */}
        <circle
          cx={cx}
          cy={cy}
          r={innerR - 4}
          fill="#111722"
          stroke="#2A3548"
          strokeWidth={1.5}
        />
        <circle
          cx={cx}
          cy={cy}
          r={56}
          fill="#0B0F17"
          stroke="#334155"
          strokeWidth={1}
        />

        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          fill="#94A3B8"
          fontSize="10"
          fontFamily="Plus Jakarta Sans, sans-serif"
        >
          Último giro
        </text>
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          fill="#FBBF24"
          fontSize="28"
          fontWeight="700"
          fontFamily="JetBrains Mono, monospace"
        >
          {lastNumber !== null ? lastNumber : '--'}
        </text>
      </svg>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          Cobertura sugerida
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />
          Último número
        </span>
        <span>Toque em qualquer número para simular giro</span>
      </div>
    </div>
  );
};
