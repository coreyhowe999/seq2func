#!/usr/bin/env node
/*
 * Build a combined AA + 3Di FASTA for foldseek easy-search with pre-computed 3Di.
 *
 * Output format (two records per protein):
 *   >protein_id
 *   AMINOACID_SEQUENCE
 *   >protein_id_ss
 *   3DI_SEQUENCE
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const aaPath = args[0];
const tdiPath = args[1];
const outPath = args[2];

if (!aaPath || !tdiPath || !outPath) {
  console.error("Usage: node make_combined_fasta.mjs <aa.fasta> <3di.fasta> <out.fasta>");
  process.exit(1);
}

function parseFasta(p) {
  const out = {};
  let id = null;
  let seq = [];
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    if (line.startsWith(">")) {
      if (id) out[id] = seq.join("");
      id = line.slice(1).split(/\s+/)[0];
      seq = [];
    } else {
      seq.push(line.trim());
    }
  }
  if (id) out[id] = seq.join("");
  return out;
}

const aa = parseFasta(aaPath);
const tdi = parseFasta(tdiPath);

let written = 0;
const fd = fs.openSync(outPath, "w");
for (const id of Object.keys(aa)) {
  const aaSeq = aa[id].replace(/\*$/, "");
  const tdiSeq = tdi[id];
  if (!tdiSeq) {
    console.warn(`[skip] no 3Di for ${id}`);
    continue;
  }
  // Allow small length diffs (stop codons, trailing Xs); truncate 3Di to match AA.
  let tdi3 = tdiSeq;
  if (tdi3.length !== aaSeq.length) {
    const diff = Math.abs(tdi3.length - aaSeq.length);
    if (diff > 5) {
      console.warn(`[skip] length mismatch ${id}: AA=${aaSeq.length} 3Di=${tdi3.length}`);
      continue;
    }
    console.warn(`[trim] ${id}: AA=${aaSeq.length} 3Di=${tdi3.length} -> ${aaSeq.length}`);
    tdi3 = tdi3.slice(0, aaSeq.length).padEnd(aaSeq.length, "d");
  }
  fs.writeSync(fd, `>${id}\n${aaSeq}\n>${id}_ss\n${tdi3}\n`);
  written++;
}
fs.closeSync(fd);
console.log(`Wrote ${written} records to ${outPath}`);
