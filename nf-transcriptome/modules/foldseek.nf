/*
 * =============================================================================
 * FoldSeek Module — Structural Homology Search
 * =============================================================================
 *
 * FoldSeek enables ultra-fast protein structure comparison by searching
 * structural databases using 3Di structural alphabet sequences.
 *
 * Why structural search matters:
 *   Proteins with similar 3D structures often share evolutionary origins
 *   and biological functions, even when their amino acid sequences have
 *   diverged beyond the detection limit of sequence-based methods like BLAST.
 *
 *   Example: Two proteins may share only 15% sequence identity (below BLAST's
 *   detection limit), yet fold into the same 3D structure and perform the
 *   same enzymatic function.  FoldSeek can detect these relationships because
 *   it compares structural features rather than sequence.
 *
 * How FoldSeek works:
 *   FoldSeek represents protein structures as sequences of 3Di tokens and
 *   uses a fast k-mer prefilter + Smith-Waterman alignment (similar to
 *   MMseqs2) to search structural databases.
 *
 *   Input: 3Di sequences from ProstT5 + amino acid sequences
 *   Database: PDB (or AlphaFold DB, UniProt, etc.)
 *   Output: Structural homologs ranked by E-value
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
    tuple val(meta), path(proteins)          // Original amino acid sequences
    path(foldseek_db)                        // FoldSeek target database

    output:
    tuple val(meta), path("foldseek_results.json"), emit: annotations    // Parsed structural homologs
    path("versions.yml"),                           emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Run FoldSeek easy-search.
    #
    # easy-search is a convenience wrapper that:
    #   1. Creates a query database from the input sequences
    #   2. Runs the search (prefilter + alignment)
    #   3. Outputs results in tabular format
    #
    # --format-output: Define custom output columns
    # -e: E-value threshold
    # --threads: Number of search threads
    # tmpFolder: Required temporary directory for FoldSeek
    #
    # Output columns:
    #   query, target, fident, alnlen, mismatch, gapopen,
    #   qstart, qend, tstart, tend, evalue, bits, taxid, taxname, theader
    foldseek easy-search \\
        ${proteins} \\
        ${foldseek_db} \\
        foldseek_results.tsv \\
        tmpFolder \\
        --format-output "query,target,fident,alnlen,mismatch,gapopen,qstart,qend,tstart,tend,evalue,bits,taxid,taxname,theader" \\
        -e ${params.evalue} \\
        --threads ${task.cpus} \\
        || true  # Don't fail if no hits found

    # Parse tabular results into structured JSON.
    parse_foldseek.py \\
        --input foldseek_results.tsv \\
        --output foldseek_results.json

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        foldseek: \$(foldseek version 2>&1 | head -n1)
    VERSIONS
    """
}
