#!/usr/bin/env node
// Trim annotations to fit within Workers subrequest budget.
import fs from "node:fs";
const [inFile, outFile, maxProteinsArg, maxDomainsArg] = process.argv.slice(2);
const maxProteins = parseInt(maxProteinsArg || "100");
const maxDomains = parseInt(maxDomainsArg || "10");
const anns = JSON.parse(fs.readFileSync(inFile, "utf-8"));
// Sort by domain count desc, then length desc; keep top N.
anns.sort((a, b) => (b.cdd?.domains?.length || 0) - (a.cdd?.domains?.length || 0) || b.length - a.length);
const trimmed = anns.slice(0, maxProteins).map((a) => ({
  ...a,
  cdd: {
    domains: (a.cdd?.domains || []).sort((x, y) => x.evalue - y.evalue).slice(0, maxDomains),
    sites: (a.cdd?.sites || []).slice(0, 5),
  },
  foldseek: { hits: (a.foldseek?.hits || []).slice(0, 5) },
}));
const totalDomains = trimmed.reduce((n, a) => n + a.cdd.domains.length, 0);
fs.writeFileSync(outFile, JSON.stringify(trimmed, null, 2));
console.log(`Kept ${trimmed.length} proteins, ${totalDomains} domains → ${outFile}`);
