/*
 * =============================================================================
 * FoldSeek Module — Structural Homology Search
 * =============================================================================
 *
 * Searches for structural homologs using 3Di structural alphabet sequences
 * predicted by ProstT5.  Proteins with similar 3D structures often share
 * function even when sequence identity is below BLAST detection limits.
 *
 * This process DEPENDS on ProstT5 output (3Di sequences).
 *
 * Author: Corey Howe
 * =============================================================================
 */

process FOLDSEEK_SEARCH {
    tag "${meta.id}"
    container 'ghcr.io/steineggerlab/foldseek:latest'
    cpus 4
    memory '8 GB'

    publishDir "${params.outdir}/${params.run_id}/foldseek", mode: 'copy'

    input:
    tuple val(meta), path(structures_3di)   // 3Di sequences from ProstT5
    tuple val(meta2), path(proteins)         // Original AA sequences (for output context)
    path(foldseek_db)                        // FoldSeek target database

    output:
    tuple val(meta), path("foldseek_results.json"), emit: annotations
    path("versions.yml"),                           emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # FoldSeek easy-search using 3Di structural sequences
    # The 3Di FASTA from ProstT5 is the query — this enables structural comparison
    foldseek easy-search \\
        ${structures_3di} \\
        ${foldseek_db} \\
        foldseek_results.tsv \\
        tmpFolder \\
        --format-output "query,target,fident,alnlen,mismatch,gapopen,qstart,qend,tstart,tend,evalue,bits,taxid,taxname,theader" \\
        -e ${params.evalue} \\
        --threads ${task.cpus} \\
        || true  # Don't fail if no hits

    # Parse FoldSeek results into JSON (inline Python)
    python3 -c "
import json, sys
from collections import defaultdict

results = defaultdict(list)
try:
    with open('foldseek_results.tsv') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            fields = line.split('\\t')
            if len(fields) < 12:
                continue
            pid = fields[0]
            try:
                results[pid].append({
                    'target_id': fields[1],
                    'target_name': fields[14] if len(fields) > 14 else fields[1],
                    'identity': float(fields[2]),
                    'evalue': float(fields[10]),
                    'alignment_length': int(fields[3]),
                    'taxonomy': fields[13] if len(fields) > 13 else '',
                })
            except (ValueError, IndexError):
                continue
except FileNotFoundError:
    pass

output = {}
for pid, hits in results.items():
    hits.sort(key=lambda h: h['evalue'])
    output[pid] = {'hits': hits[:5]}

with open('foldseek_results.json', 'w') as f:
    json.dump(output, f, indent=2)

n = sum(len(v['hits']) for v in output.values())
print(f'Parsed {n} hits across {len(output)} proteins', file=sys.stderr)
" || echo '{}' > foldseek_results.json

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        foldseek: \$(foldseek version 2>&1 | head -n1)
    VERSIONS
    """
}
