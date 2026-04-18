/*
 * =============================================================================
 * CDD Search Module — Conserved Domain Annotation via RPS-BLAST
 * =============================================================================
 *
 * Identifies conserved protein domains using the NCBI Conserved Domain
 * Database (CDD) via RPS-BLAST (Reverse Position-Specific BLAST).
 *
 * RPS-BLAST searches query sequences against position-specific scoring
 * matrices (PSSMs), each representing a conserved domain family from
 * Pfam, SMART, COG, TIGRFAM, and NCBI-curated models.
 *
 * Author: Corey Howe
 * =============================================================================
 */

process CDD_SEARCH {
    tag "${meta.id}"
    container 'ncbi/blast:2.15.0'
    cpus 4
    memory '8 GB'

    publishDir "${params.outdir}/${params.run_id}/cdd", mode: 'copy'

    input:
    tuple val(meta), path(proteins)
    path(cdd_db)

    output:
    tuple val(meta), path("cdd_results.json"),  emit: annotations
    tuple val(meta), path("rpsblast_raw.out"),  emit: raw_output
    path("versions.yml"),                       emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Run RPS-BLAST against CDD
    rpsblast \
        -query ${proteins} \
        -db ${cdd_db} \
        -out rpsblast_raw.out \
        -evalue ${params.evalue} \
        -outfmt "6 qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore stitle" \
        -num_threads ${task.cpus} \
        || true  # Don't fail if no hits found

    # Parse RPS-BLAST results into structured JSON (inline Python)
    python3 -c "
import json, sys
from collections import defaultdict

results = defaultdict(lambda: {'domains': [], 'sites': []})
try:
    with open('rpsblast_raw.out') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            fields = line.split('\\t')
            if len(fields) < 12:
                continue
            pid = fields[0]
            sid = fields[1]
            acc = sid.split('|')[-1] if '|' in sid else sid
            stitle = fields[12] if len(fields) > 12 else sid
            parts = stitle.split(',', 1)
            name = parts[0].strip()
            desc = parts[1].strip() if len(parts) > 1 else ''
            try:
                results[pid]['domains'].append({
                    'accession': acc, 'name': name, 'description': desc,
                    'superfamily': '', 'evalue': float(fields[10]),
                    'bitscore': float(fields[11]),
                    'from': int(fields[6]), 'to': int(fields[7])
                })
            except (ValueError, IndexError):
                continue
except FileNotFoundError:
    pass

for pid in results:
    results[pid]['domains'].sort(key=lambda d: d['from'])

with open('cdd_results.json', 'w') as f:
    json.dump(dict(results), f, indent=2)

n_prot = len(results)
n_dom = sum(len(r['domains']) for r in results.values())
print(f'Parsed {n_dom} domains across {n_prot} proteins', file=sys.stderr)
"

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        rpsblast: \$(rpsblast -version 2>&1 | head -n1 | awk '{print \$NF}')
    VERSIONS
    """
}
