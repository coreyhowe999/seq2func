/*
 * =============================================================================
 * FastQC Module — Read Quality Assessment
 * =============================================================================
 *
 * FastQC provides a comprehensive quality report for FASTQ files, including:
 *   - Per-base sequence quality (Phred scores)
 *   - Per-sequence quality scores distribution
 *   - GC content distribution
 *   - Sequence length distribution
 *   - Adapter contamination levels
 *   - Overrepresented sequences
 *
 * This module is imported TWICE in the main workflow using DSL2 aliasing:
 *   FASTQC         → runs on raw reads (pre-trimming baseline)
 *   FASTQC_TRIMMED → runs on trimmed reads (post-trimming verification)
 *
 * This reuse pattern avoids duplicating process code while maintaining
 * clear naming in the pipeline DAG.
 *
 * Author: Corey Howe
 * =============================================================================
 */

process FASTQC {
    tag "${meta.id}"
    container 'biocontainers/fastqc:0.12.1--hdfd78af_0'

    /*
     * publishDir: Save HTML reports and zip archives to the output directory.
     * FastQC HTML reports are useful for manual quality review and inclusion
     * in publications or presentations.
     */
    publishDir "${params.outdir}/${params.run_id}/fastqc", mode: 'copy'

    input:
    /*
     * tuple val(meta), path(reads):
     *   meta: A Groovy map with sample metadata, e.g., [id: "SRR5437876", single_end: false]
     *   reads: One or more FASTQ files (paired-end = 2 files, single-end = 1 file)
     *
     * The tuple pattern keeps metadata bundled with data files throughout
     * the pipeline.  This is the standard nf-core convention.
     */
    tuple val(meta), path(reads)

    output:
    tuple val(meta), path("*.html"), emit: html       // HTML quality reports
    tuple val(meta), path("*.zip"),  emit: zip         // Zip archives with raw data
    path("versions.yml"),            emit: versions     // Tool version tracking

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Run FastQC on all input FASTQ files.
    # --threads: use available CPUs for parallel file processing
    # --outdir .: write output to the current working directory
    # FastQC auto-detects file format (FASTQ, BAM, etc.)
    fastqc \\
        --threads ${task.cpus} \\
        --outdir . \\
        ${reads}

    # Record tool version for reproducibility tracking.
    # versions.yml follows nf-core convention for MultiQC aggregation.
    cat <<-VERSIONS > versions.yml
    "${task.process}":
        fastqc: \$(fastqc --version 2>&1 | sed 's/FastQC v//')
    VERSIONS
    """
}
