#!/usr/bin/env node
/*
 * Merge a foldseek results.tsv into an existing annotations.json, keeping top N hits per protein.
 *
 * Usage:
 *   node scripts/merge_foldseek.mjs <annotations.json> <foldseek.tsv> <out.json> [topN]
 */
import fs from "node:fs";

const [annIn, tsvIn, outPath, topNArg] = process.argv.slice(2);
const topN = topNArg ? parseInt(topNArg) : 5;

const annotations = JSON.parse(fs.readFileSync(annIn, "utf-8"));
const tsv = fs.readFileSync(tsvIn, "utf-8");

// Columns: query,target,fident,alnlen,mismatch,gapopen,qstart,qend,tstart,tend,evalue,bits,taxid,taxname,theader
const hitsByProtein = {};
for (const line of tsv.split("\n")) {
  if (!line.trim()) continue;
  const cols = line.split("\t");
  if (cols.length < 15) continue;
  const [query, target, fident, alnlen, , , , , , , evalue, , , taxname, theader] = cols;
  hitsByProtein[query] ??= [];
  hitsByProtein[query].push({
    target_id: target,
    target_name: theader || target,
    identity: parseFloat(fident),
    evalue: parseFloat(evalue),
    alignment_length: parseInt(alnlen),
    taxonomy: taxname || "",
  });
}

for (const ann of annotations) {
  const hits = (hitsByProtein[ann.protein_id] || [])
    .sort((a, b) => a.evalue - b.evalue)
    .slice(0, topN);
  ann.foldseek = { hits };
}

fs.writeFileSync(outPath, JSON.stringify(annotations, null, 2));
const totalHits = annotations.reduce((n, a) => n + a.foldseek.hits.length, 0);
console.log(`Merged ${totalHits} foldseek hits across ${annotations.length} proteins -> ${outPath}`);
for (const a of annotations) {
  console.log(`  ${a.protein_id}: ${a.foldseek.hits.length} hits${a.foldseek.hits[0] ? ' (top=' + a.foldseek.hits[0].target_id + ' ' + a.foldseek.hits[0].evalue.toExponential(1) + ')' : ''}`);
}
