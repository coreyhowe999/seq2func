"use client";

import { useState } from "react";
import ProteinRow from "./ProteinRow";
import type { ProteinAnnotation } from "@/lib/types";

interface ProteinTableProps {
  proteins: ProteinAnnotation[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export default function ProteinTable({ proteins, total, page, pageSize, onPageChange }: ProteinTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const totalPages = Math.ceil(total / pageSize);

  const handleToggle = (proteinId: string) => {
    setExpandedId(expandedId === proteinId ? null : proteinId);
  };

  return (
    <div>
      {/* Table Header */}
      <div className="hidden lg:grid grid-cols-[2fr_0.8fr_0.8fr_2fr_2fr_0.8fr] gap-4 px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-navy-700">
        <div>Protein ID</div>
        <div>Length (aa)</div>
        <div>ORF Type</div>
        <div>Top CDD Domain</div>
        <div>Top FoldSeek Hit</div>
        <div># Domains</div>
      </div>

      {/* Protein Rows */}
      <div className="divide-y divide-navy-700">
        {proteins.map((protein) => (
          <ProteinRow
            key={protein.protein_id}
            protein={protein}
            isExpanded={expandedId === protein.protein_id}
            onToggle={() => handleToggle(protein.protein_id)}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-navy-700">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1 rounded text-sm bg-navy-700 text-gray-300 hover:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded text-sm bg-navy-700 text-gray-300 hover:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
