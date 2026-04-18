"use client";

import type { ProteinAnnotation } from "@/lib/types";
import DomainViewer from "./DomainViewer";
import SequenceViewer from "./SequenceViewer";
import FoldseekHits from "./FoldseekHits";

interface ProteinRowProps {
  protein: ProteinAnnotation;
  isExpanded: boolean;
  onToggle: () => void;
}

const orfTypeColors: Record<string, string> = {
  complete: "bg-green-900/40 text-green-300 border-green-700",
  "5prime_partial": "bg-yellow-900/40 text-yellow-300 border-yellow-700",
  "3prime_partial": "bg-yellow-900/40 text-yellow-300 border-yellow-700",
  internal: "bg-orange-900/40 text-orange-300 border-orange-700",
};

export default function ProteinRow({ protein, isExpanded, onToggle }: ProteinRowProps) {
  const topDomain = protein.cdd.domains[0];
  const topHit = protein.foldseek.hits[0];

  return (
    <div>
      {/* Summary Row */}
      <div
        onClick={onToggle}
        className="grid grid-cols-1 lg:grid-cols-[2fr_0.8fr_0.8fr_2fr_2fr_0.8fr] gap-2 lg:gap-4 px-4 py-3 hover:bg-navy-800/50 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${
              isExpanded ? "rotate-90" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-mono text-sm text-gray-200 truncate">{protein.protein_id}</span>
        </div>
        <div className="text-sm text-gray-300">{protein.length}</div>
        <div>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${orfTypeColors[protein.orf_type] || "bg-navy-700 text-gray-400 border-navy-600"}`}>
            {protein.orf_type}
          </span>
        </div>
        <div className="text-sm">
          {topDomain ? (
            <span className="text-gray-200">
              {topDomain.name}{" "}
              <span className="text-gray-500 text-xs">({topDomain.evalue.toExponential(1)})</span>
            </span>
          ) : (
            <span className="text-gray-600">None</span>
          )}
        </div>
        <div className="text-sm">
          {topHit ? (
            <span className="text-gray-200">
              {topHit.target_name.slice(0, 30)}{" "}
              <span className="text-gray-500 text-xs">({(topHit.identity * 100).toFixed(0)}%)</span>
            </span>
          ) : (
            <span className="text-gray-600">None</span>
          )}
        </div>
        <div className="text-sm text-gray-300">{protein.cdd.domains.length}</div>
      </div>

      {/* Expanded Detail Panel */}
      {isExpanded && (
        <div className="px-4 pb-6 pt-2 bg-navy-800/30 border-t border-navy-700 space-y-6 animate-in">
          {/* 1. Domain Architecture */}
          {protein.cdd.domains.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">Domain Architecture</h4>
              <DomainViewer
                proteinLength={protein.length}
                domains={protein.cdd.domains}
              />
            </div>
          )}

          {/* 2. Sequence Viewer */}
          <div>
            <h4 className="text-sm font-semibold text-gray-300 mb-3">Amino Acid Sequence</h4>
            <SequenceViewer
              sequence={protein.sequence}
              domains={protein.cdd.domains}
            />
          </div>

          {/* 3. CDD Domain Details */}
          {protein.cdd.domains.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">CDD Domain Hits</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b border-navy-700">
                      <th className="text-left py-2 px-2">Accession</th>
                      <th className="text-left py-2 px-2">Name</th>
                      <th className="text-left py-2 px-2">Description</th>
                      <th className="text-right py-2 px-2">E-value</th>
                      <th className="text-right py-2 px-2">Score</th>
                      <th className="text-right py-2 px-2">Coords</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-700">
                    {protein.cdd.domains.map((domain, i) => (
                      <tr key={i} className="text-gray-300">
                        <td className="py-2 px-2 font-mono text-xs">{domain.accession}</td>
                        <td className="py-2 px-2 font-medium">{domain.name}</td>
                        <td className="py-2 px-2 text-gray-400 text-xs max-w-xs truncate">{domain.description}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{domain.evalue.toExponential(1)}</td>
                        <td className="py-2 px-2 text-right">{domain.bitscore.toFixed(1)}</td>
                        <td className="py-2 px-2 text-right text-xs">{domain.from}-{domain.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Functional Sites */}
              {protein.cdd.sites.length > 0 && (
                <div className="mt-3">
                  <h5 className="text-xs font-medium text-gray-400 mb-2">Functional Sites</h5>
                  <div className="space-y-1">
                    {protein.cdd.sites.map((site, i) => (
                      <div key={i} className="text-xs text-gray-400">
                        <span className="text-teal-400 font-medium">{site.type}:</span>{" "}
                        {site.residues.join(", ")} {site.description && `\u2014 ${site.description}`}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. FoldSeek Hits */}
          {protein.foldseek.hits.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">Structural Homologs (FoldSeek)</h4>
              <FoldseekHits hits={protein.foldseek.hits} />
            </div>
          )}

          {/* 5. ProstT5 3Di Sequence */}
          {protein.prostt5.has_prediction && protein.prostt5.sequence_3di && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-2">
                3Di Structural Alphabet
                <span className="text-xs text-gray-500 font-normal ml-2">
                  Predicted by ProstT5
                </span>
              </h4>
              <div className="bg-navy-900 rounded-lg p-3 overflow-x-auto">
                <pre className="font-mono text-xs text-teal-300 whitespace-pre-wrap break-all leading-relaxed">
                  {protein.prostt5.sequence_3di.match(/.{1,60}/g)?.join("\n")}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
