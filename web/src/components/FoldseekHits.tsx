"use client";

import type { FoldseekHit } from "@/lib/types";

interface FoldseekHitsProps {
  hits: FoldseekHit[];
}

export default function FoldseekHits({ hits }: FoldseekHitsProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase border-b border-navy-700">
            <th className="text-left py-2 px-2">Target</th>
            <th className="text-left py-2 px-2">Name</th>
            <th className="text-right py-2 px-2">Identity</th>
            <th className="text-right py-2 px-2">E-value</th>
            <th className="text-right py-2 px-2">Aln. Length</th>
            <th className="text-left py-2 px-2">Organism</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-700">
          {hits.map((hit, i) => {
            // Extract PDB ID from target_id (format: "4HHB_A" → "4HHB")
            const pdbId = hit.target_id.split("_")[0];

            return (
              <tr key={i} className="text-gray-300 hover:bg-navy-800/30 transition-colors">
                <td className="py-2 px-2">
                  <a
                    href={`https://www.rcsb.org/structure/${pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-teal-400 hover:text-teal-300 transition-colors"
                  >
                    {hit.target_id}
                  </a>
                </td>
                <td className="py-2 px-2 text-gray-200 max-w-xs truncate">
                  {hit.target_name}
                </td>
                <td className="py-2 px-2 text-right">
                  <span
                    className={`font-medium ${
                      hit.identity >= 0.5
                        ? "text-green-400"
                        : hit.identity >= 0.3
                        ? "text-yellow-400"
                        : "text-gray-400"
                    }`}
                  >
                    {(hit.identity * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="py-2 px-2 text-right font-mono text-xs">
                  {hit.evalue.toExponential(1)}
                </td>
                <td className="py-2 px-2 text-right">{hit.alignment_length}</td>
                <td className="py-2 px-2 text-gray-400 text-xs italic">
                  {hit.taxonomy}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
