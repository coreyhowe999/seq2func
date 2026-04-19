#!/usr/bin/env node
// Produce two fastas with matching headers, same simple IDs, same sequence lengths.
import fs from "node:fs";

const [aaIn, tdiIn, combinedOut] = process.argv.slice(2);

function parse(p) {
  const r = {};
  let id = null, seq = [];
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    if (line.startsWith(">")) { if (id) r[id] = seq.join(""); id = line.slice(1).split(/\s+/)[0]; seq = []; }
    else seq.push(line.trim());
  }
  if (id) r[id] = seq.join("");
  return r;
}

const aa = parse(aaIn);
const tdi = parse(tdiIn);
const outFd = fs.openSync(combinedOut, "w");
let n = 0;
for (const id of Object.keys(aa)) {
  const a = aa[id].replace(/\*$/, "");
  let t = tdi[id];
  if (!t) continue;
  if (t.length !== a.length) {
    if (Math.abs(t.length - a.length) > 5) continue;
    t = t.slice(0, a.length).padEnd(a.length, "d");
  }
  // Combined fasta: AA entry followed by _ss entry with UPPERCASE 3Di.
  fs.writeSync(outFd, `>${id}\n${a}\n>${id}_ss\n${t.toUpperCase()}\n`);
  n++;
}
fs.closeSync(outFd);
console.log(`Wrote ${n} records (AA+3Di pairs) to ${combinedOut}`);
