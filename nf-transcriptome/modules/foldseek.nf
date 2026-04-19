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
    path(foldseek_db_files)                   // All pdb* files staged together

    output:
    tuple val(meta), path("foldseek_results.json"), emit: annotations
    path("versions.yml"),                           emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # ── Locate target database prefix from staged files ────────────────────
    # The target DB (e.g. PDB) must have been built with `foldseek createdb`
    # from real structures, so it has matching .dbtype, .index, _ss.dbtype etc.
    FS_PREFIX=\$(ls pdb.dbtype 2>/dev/null && echo "pdb" || ls *.dbtype 2>/dev/null | grep -v '_ss\\|_ca\\|_h\\|.source\\|.lookup' | head -1 | sed 's/\\.dbtype//')
    echo "Target DB prefix: \$FS_PREFIX"

    # ── Build matched AA + 3Di query fastas ────────────────────────────────
    # TransDecoder outputs AA seqs with trailing '*' (stop codons); ProstT5 3Di
    # is one character per AA residue. Strip stops and truncate either side to
    # the shorter length so foldseek's two sidecars stay aligned.
    python3 <<'PYEOF'
def parse_fasta(path):
    out = {}
    cur_id, seq = None, []
    with open(path) as f:
        for line in f:
            line = line.rstrip()
            if line.startswith('>'):
                if cur_id is not None:
                    out[cur_id] = ''.join(seq)
                cur_id = line[1:].split()[0]
                seq = []
            else:
                seq.append(line)
    if cur_id is not None:
        out[cur_id] = ''.join(seq)
    return out

aa = parse_fasta("${proteins}")
tdi = parse_fasta("${structures_3di}")

with open("query_aa.fasta", "w") as fa, open("query_3di.fasta", "w") as ft:
    for pid, a in aa.items():
        a = a.rstrip('*')
        t = tdi.get(pid)
        if t is None:
            continue
        n = min(len(a), len(t))
        if abs(len(a) - len(t)) > 5:
            continue
        fa.write(f">{pid}\\n{a[:n]}\\n")
        ft.write(f">{pid}\\n{t[:n].upper()}\\n")
PYEOF

    # ── Build foldseek query DB ────────────────────────────────────────────
    # foldseek createdb expects PDB/mmCIF structures and rejects FASTA with
    # "No structures found" — silently producing an empty DB. Instead use
    # base:createdb (mmseqs createdb passthrough) for each side, then stitch
    # them into foldseek's dual-sidecar layout.
    mkdir -p qdb tmp_ss

    foldseek base:createdb query_aa.fasta  qdb/query
    foldseek base:createdb query_3di.fasta tmp_ss/ss

    # query_ss.* are the 3Di sidecar foldseek reads during the structural
    # prefilter. Steal the target's _ss.dbtype byte so our sidecar is tagged
    # with the correct alphabet flag.
    cp tmp_ss/ss       qdb/query_ss
    cp tmp_ss/ss.index qdb/query_ss.index
    cp "\${FS_PREFIX}_ss.dbtype" qdb/query_ss.dbtype

    # ── Search + convert ───────────────────────────────────────────────────
    foldseek search \\
        qdb/query \\
        \$FS_PREFIX \\
        aln_result \\
        tmpFolder \\
        --threads ${task.cpus} \\
        -e ${params.foldseek_evalue} \\
        -s 9.5

    foldseek convertalis \\
        qdb/query \\
        \$FS_PREFIX \\
        aln_result \\
        foldseek_results.tsv \\
        --format-output "query,target,fident,alnlen,mismatch,gapopen,qstart,qend,tstart,tend,evalue,bits,taxid,taxname,theader"

    # ── Parse TSV into per-protein hits JSON ───────────────────────────────
    python3 <<'PYEOF'
import json, sys
from collections import defaultdict

results = defaultdict(list)
with open('foldseek_results.tsv') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        fields = line.split('\\t')
        if len(fields) < 12:
            continue
        pid = fields[0]
        results[pid].append({
            'target_id': fields[1],
            'target_name': fields[14] if len(fields) > 14 else fields[1],
            'identity': float(fields[2]),
            'evalue': float(fields[10]),
            'alignment_length': int(fields[3]),
            'taxonomy': fields[13] if len(fields) > 13 else '',
        })

output = {}
for pid, hits in results.items():
    hits.sort(key=lambda h: h['evalue'])
    output[pid] = {'hits': hits[:5]}

with open('foldseek_results.json', 'w') as f:
    json.dump(output, f, indent=2)

n = sum(len(v['hits']) for v in output.values())
print(f'Parsed {n} hits across {len(output)} proteins', file=sys.stderr)
PYEOF

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        foldseek: \$(foldseek version 2>&1 | head -n1)
    VERSIONS
    """
}
