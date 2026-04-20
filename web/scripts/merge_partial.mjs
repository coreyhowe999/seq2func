#!/usr/bin/env node
/*
 * Merge TransDecoder predicted_proteins.pep + cdd_results.json into
 * annotations.json format (no 3Di / FoldSeek). For runs where ProstT5 didn't
 * complete (e.g. GPU quota pressure), this lets us ship the partial results.
 *
 * Usage: node merge_partial.mjs <pep_file> <cdd_json> <out_json>
 */
import fs from "node:fs";

const [pepFile, cddFile, outFile] = process.argv.slice(2);
if (!pepFile || !cddFile || !outFile) {
  console.error("Usage: merge_partial.mjs <pep> <cdd_json> <out_json>");
  process.exit(1);
}

// Parse fasta
function parseFasta(path) {
  const out = [];
  let header = null, seq = [];
  for (const line of fs.readFileSync(path, "utf-8").split("\n")) {
    if (line.startsWith(">")) {
      if (header) out.push({ header, seq: seq.join("") });
      header = line.slice(1);
      seq = [];
    } else if (line.trim()) {
      seq.push(line.trim());
    }
  }
  if (header) out.push({ header, seq: seq.join("") });
  return out;
}

const proteins = parseFasta(pepFile);
const cdd = JSON.parse(fs.readFileSync(cddFile, "utf-8"));

const annotations = proteins.map(({ header, seq }) => {
  const pid = header.split(/\s+/)[0];
  const tid = pid.includes(".p") ? pid.slice(0, pid.lastIndexOf(".p")) : pid;
  const orfMatch = header.match(/type:(\w+)/);
  const orfType = orfMatch ? orfMatch[1] : "unknown";
  const cleanSeq = seq.replace(/\*$/, "");
  const cddEntry = cdd[pid] || { domains: [], sites: [] };

  return {
    protein_id: pid,
    sequence: cleanSeq,
    length: cleanSeq.length,
    orf_type: orfType,
    transcript_id: tid,
    cdd: cddEntry,
    prostt5: { sequence_3di: "", has_prediction: false },
    foldseek: { hits: [] },
  };
});

// Sort by length descending (matches merge_results.nf behavior)
annotations.sort((a, b) => b.length - a.length);

fs.writeFileSync(outFile, JSON.stringify(annotations, null, 2));
const withDomains = annotations.filter((a) => a.cdd.domains.length).length;
const totalDomains = annotations.reduce((n, a) => n + a.cdd.domains.length, 0);
console.log(`Wrote ${annotations.length} proteins to ${outFile}`);
console.log(`  with CDD domains: ${withDomains}`);
console.log(`  total domains:    ${totalDomains}`);
console.log(`  top 3 by length:`);
for (const a of annotations.slice(0, 3)) {
  console.log(`    ${a.protein_id}  len=${a.length}  domains=${a.cdd.domains.length}`);
}
