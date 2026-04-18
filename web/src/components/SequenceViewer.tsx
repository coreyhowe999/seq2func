"use client";

import type { CddDomain } from "@/lib/types";

interface SequenceViewerProps {
  sequence: string;
  domains: CddDomain[];
}

// Amino acid property colors (simplified)
function getResidueColor(aa: string): string {
  const hydrophobic = "AILMFWVP";
  const positive = "RKH";
  const negative = "DE";
  const polar = "STNQYC";

  if (hydrophobic.includes(aa)) return "text-blue-400";
  if (positive.includes(aa)) return "text-red-400";
  if (negative.includes(aa)) return "text-purple-400";
  if (polar.includes(aa)) return "text-green-400";
  return "text-gray-400";
}

const DOMAIN_UNDERLINE_COLORS = [
  "border-indigo-500",
  "border-red-500",
  "border-emerald-500",
  "border-amber-500",
  "border-violet-500",
  "border-pink-500",
  "border-cyan-500",
  "border-lime-500",
];

export default function SequenceViewer({ sequence, domains }: SequenceViewerProps) {
  const LINE_LENGTH = 60;
  const lines: string[] = [];

  for (let i = 0; i < sequence.length; i += LINE_LENGTH) {
    lines.push(sequence.slice(i, i + LINE_LENGTH));
  }

  // Precompute which domain covers each position
  const domainAtPos: (number | -1)[] = new Array(sequence.length).fill(-1);
  domains.forEach((domain, idx) => {
    for (let i = domain.from - 1; i < Math.min(domain.to, sequence.length); i++) {
      domainAtPos[i] = idx;
    }
  });

  return (
    <div className="bg-navy-900 rounded-lg p-4 overflow-x-auto">
      <pre className="font-mono text-xs leading-relaxed">
        {lines.map((line, lineIdx) => {
          const startPos = lineIdx * LINE_LENGTH;
          const endPos = startPos + line.length;

          return (
            <div key={lineIdx} className="flex gap-2">
              {/* Position number */}
              <span className="text-gray-600 w-8 text-right select-none flex-shrink-0">
                {startPos + 1}
              </span>

              {/* Sequence characters */}
              <span>
                {line.split("").map((aa, charIdx) => {
                  const absPos = startPos + charIdx;
                  const domIdx = domainAtPos[absPos];
                  const hasDomain = domIdx >= 0;
                  const underlineColor = hasDomain
                    ? DOMAIN_UNDERLINE_COLORS[domIdx % DOMAIN_UNDERLINE_COLORS.length]
                    : "";

                  return (
                    <span
                      key={charIdx}
                      className={`${getResidueColor(aa)} ${
                        hasDomain ? `border-b-2 ${underlineColor}` : ""
                      }`}
                      title={`${aa}${absPos + 1}${hasDomain ? ` (${domains[domIdx].name})` : ""}`}
                    >
                      {aa}
                    </span>
                  );
                })}
              </span>

              {/* End position */}
              <span className="text-gray-600 select-none flex-shrink-0">
                {endPos}
              </span>
            </div>
          );
        })}
      </pre>

      {/* Legend */}
      <div className="mt-3 pt-3 border-t border-navy-700 flex flex-wrap gap-4 text-xs">
        <span className="text-blue-400">Hydrophobic</span>
        <span className="text-red-400">Positive</span>
        <span className="text-purple-400">Negative</span>
        <span className="text-green-400">Polar</span>
        <span className="text-gray-400">Other</span>
      </div>
    </div>
  );
}
