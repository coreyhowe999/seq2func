"use client";

import { useState } from "react";
import type { CddDomain } from "@/lib/types";

interface DomainViewerProps {
  proteinLength: number;
  domains: CddDomain[];
}

const DOMAIN_COLORS = [
  "#4F46E5", // Indigo
  "#DC2626", // Red
  "#059669", // Emerald
  "#D97706", // Amber
  "#7C3AED", // Violet
  "#DB2777", // Pink
  "#0891B2", // Cyan
  "#65A30D", // Lime
  "#EA580C", // Orange
  "#6366F1", // Indigo light
];

export default function DomainViewer({ proteinLength, domains }: DomainViewerProps) {
  const [hoveredDomain, setHoveredDomain] = useState<number | null>(null);

  const width = 800;
  const height = 80;
  const padding = 40;
  const barY = 30;
  const barHeight = 24;
  const scaleWidth = width - padding * 2;

  const scale = (pos: number) => padding + (pos / proteinLength) * scaleWidth;

  // Generate scale ticks
  const tickInterval = proteinLength > 500 ? 100 : proteinLength > 200 ? 50 : 25;
  const ticks = [];
  for (let i = 0; i <= proteinLength; i += tickInterval) {
    ticks.push(i);
  }
  if (ticks[ticks.length - 1] !== proteinLength) {
    ticks.push(proteinLength);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ maxWidth: "800px" }}
      >
        {/* Protein backbone bar */}
        <rect
          x={padding}
          y={barY}
          width={scaleWidth}
          height={barHeight}
          rx={4}
          fill="#334e68"
          stroke="#486581"
          strokeWidth={1}
        />

        {/* Domain blocks */}
        {domains.map((domain, i) => {
          const x = scale(domain.from);
          const w = scale(domain.to) - x;
          const color = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
          const isHovered = hoveredDomain === i;

          return (
            <g
              key={i}
              onMouseEnter={() => setHoveredDomain(i)}
              onMouseLeave={() => setHoveredDomain(null)}
              className="cursor-pointer"
            >
              <rect
                x={x}
                y={barY + 2}
                width={Math.max(w, 4)}
                height={barHeight - 4}
                rx={3}
                fill={color}
                fillOpacity={isHovered ? 1 : 0.85}
                stroke={isHovered ? "#fff" : "none"}
                strokeWidth={isHovered ? 2 : 0}
              />
              {/* Domain label (only if wide enough) */}
              {w > 40 && (
                <text
                  x={x + w / 2}
                  y={barY + barHeight / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize={10}
                  fontWeight={600}
                  className="pointer-events-none"
                >
                  {domain.name.length > w / 7 ? domain.name.slice(0, Math.floor(w / 7)) : domain.name}
                </text>
              )}
            </g>
          );
        })}

        {/* Scale bar */}
        <line
          x1={padding}
          y1={barY + barHeight + 8}
          x2={padding + scaleWidth}
          y2={barY + barHeight + 8}
          stroke="#627d98"
          strokeWidth={1}
        />
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={scale(tick)}
              y1={barY + barHeight + 5}
              x2={scale(tick)}
              y2={barY + barHeight + 11}
              stroke="#627d98"
              strokeWidth={1}
            />
            <text
              x={scale(tick)}
              y={barY + barHeight + 22}
              textAnchor="middle"
              fill="#829ab1"
              fontSize={9}
            >
              {tick}
            </text>
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredDomain !== null && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full bg-navy-900 border border-navy-600 rounded-lg p-3 shadow-xl z-10 text-xs min-w-[200px]">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: DOMAIN_COLORS[hoveredDomain % DOMAIN_COLORS.length] }}
            />
            <span className="font-semibold text-gray-200">{domains[hoveredDomain].name}</span>
          </div>
          <p className="text-gray-400">{domains[hoveredDomain].description}</p>
          <div className="mt-1 text-gray-500">
            <span className="font-mono">{domains[hoveredDomain].accession}</span>
            {" \u2022 "}
            E-value: {domains[hoveredDomain].evalue.toExponential(1)}
            {" \u2022 "}
            {domains[hoveredDomain].from}-{domains[hoveredDomain].to} aa
          </div>
        </div>
      )}
    </div>
  );
}
