/*
 * =============================================================================
 * CDD Search Module — Conserved Domain Annotation
 * =============================================================================
 *
 * This module identifies conserved protein domains using the NCBI Conserved
 * Domain Database (CDD) via RPS-BLAST (Reverse Position-Specific BLAST).
 *
 * How RPS-BLAST differs from standard BLAST:
 *   - Standard BLAST: Query sequence vs. sequence database
 *   - RPS-BLAST: Query sequence vs. position-specific scoring matrix (PSSM)
 *     database.  Each PSSM represents a conserved domain family.
 *
 * The CDD contains domain models from:
 *   - Pfam (protein families)
 *   - SMART (signaling and extracellular domains)
 *   - COG/KOG (clusters of orthologous groups)
 *   - cd (NCBI-curated domain models)
 *   - TIGRFAM (microbial protein families)
 *
 * After RPS-BLAST, rpsbproc post-processes the results to add:
 *   - Domain architecture (multi-domain arrangements)
 *   - Functional sites (catalytic residues, binding sites)
 *   - Superfamily classification
 *
 * Author: Corey Howe
 * =============================================================================
 */

process CDD_SEARCH {
    tag "${meta.id}"
    container 'ncbi/blast:2.15.0'     // Official NCBI BLAST+ image (includes rpsblast)
    cpus 4
    memory '8 GB'

    publishDir "${params.outdir}/${params.run_id}/cdd", mode: 'copy'

    input:
    tuple val(meta), path(proteins)     // Predicted protein FASTA from TransDecoder
    path(cdd_db)                        // CDD database directory

    output:
    tuple val(meta), path("cdd_results.json"),  emit: annotations    // Parsed domain annotations (JSON)
    tuple val(meta), path("rpsblast_raw.out"),  emit: raw_output     // Raw RPS-BLAST output
    path("versions.yml"),                       emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Step 1: Run RPS-BLAST against the CDD.
    #
    # -query: protein sequences to search
    # -db: path to the CDD PSSM database
    # -out: raw output file
    # -evalue: E-value threshold (lower = more stringent)
    # -outfmt 11: ASN.1 archive format (required for rpsbproc post-processing)
    # -num_threads: parallel search threads
    #
    # outfmt 11 (ASN.1 archive) is special: it stores the full alignment data
    # needed by rpsbproc.  Other formats lose information needed for site
    # annotation and domain architecture analysis.
    rpsblast \\
        -query ${proteins} \\
        -db ${cdd_db} \\
        -out rpsblast_raw.out \\
        -evalue ${params.evalue} \\
        -outfmt "6 qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore stitle" \\
        -num_threads ${task.cpus} \\
        || true  # Don't fail if no hits found

    # Step 2: Parse RPS-BLAST results into structured JSON.
    # Uses the parse_rpsblast.py script from bin/
    parse_rpsblast.py \\
        --input rpsblast_raw.out \\
        --output cdd_results.json

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        rpsblast: \$(rpsblast -version 2>&1 | head -n1 | awk '{print \$NF}')
    VERSIONS
    """
}
