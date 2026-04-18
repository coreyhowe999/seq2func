/*
 * =============================================================================
 * Trimmomatic Module — Adapter Trimming & Quality Filtering
 * =============================================================================
 *
 * Trimmomatic performs two critical pre-processing steps:
 *
 * 1. ADAPTER REMOVAL (ILLUMINACLIP):
 *    Illumina sequencing adds adapter sequences to both ends of each DNA
 *    fragment.  These adapters are synthetic sequences that must be removed
 *    before assembly — otherwise they'd be incorporated into the assembled
 *    transcripts, producing chimeric artifacts.
 *
 * 2. QUALITY FILTERING:
 *    - LEADING/TRAILING: Remove low-quality bases from read ends
 *    - SLIDINGWINDOW: Scan with a 4-base window, cut when average quality
 *      drops below 20 (Phred score).  This removes internal low-quality
 *      regions while preserving high-quality portions of reads.
 *    - MINLEN: Discard reads shorter than 36 bp after trimming (too short
 *      to map or assemble reliably)
 *
 * Output: Paired reads (both mates passed) and unpaired reads (only one
 * mate passed).  Downstream processes use the paired reads only.
 *
 * Author: Corey Howe
 * =============================================================================
 */

process TRIMMOMATIC {
    tag "${meta.id}"
    container 'biocontainers/trimmomatic:0.39--hdfd78af_2'

    publishDir "${params.outdir}/${params.run_id}/trimmomatic", mode: 'copy', pattern: '*.log'

    input:
    tuple val(meta), path(reads)

    output:
    tuple val(meta), path("*_paired_{1,2}.fastq.gz"),   emit: trimmed_reads    // Paired reads for assembly
    tuple val(meta), path("*_unpaired_{1,2}.fastq.gz"), emit: unpaired_reads   // Unpaired reads (one mate lost)
    tuple val(meta), path("*.log"),                     emit: log              // Trimming statistics
    path("versions.yml"),                               emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Run Trimmomatic in paired-end mode (PE).
    #
    # Input: two FASTQ files (forward and reverse reads)
    # Output: four files —
    #   ${meta.id}_paired_1.fastq.gz    (forward reads, both mates survived)
    #   ${meta.id}_unpaired_1.fastq.gz  (forward reads, mate was discarded)
    #   ${meta.id}_paired_2.fastq.gz    (reverse reads, both mates survived)
    #   ${meta.id}_unpaired_2.fastq.gz  (reverse reads, mate was discarded)
    #
    # ILLUMINACLIP parameters:
    #   TruSeq3-PE.fa — adapter sequences file (bundled with Trimmomatic)
    #   2:30:10:2:True — seed mismatches:palindrome threshold:simple threshold:
    #                     minAdapterLength:keepBothReads
    trimmomatic PE \\
        -threads ${task.cpus} \\
        -phred33 \\
        ${reads[0]} ${reads[1]} \\
        ${meta.id}_paired_1.fastq.gz ${meta.id}_unpaired_1.fastq.gz \\
        ${meta.id}_paired_2.fastq.gz ${meta.id}_unpaired_2.fastq.gz \\
        ILLUMINACLIP:TruSeq3-PE.fa:2:30:10:2:True \\
        LEADING:3 \\
        TRAILING:3 \\
        SLIDINGWINDOW:4:20 \\
        MINLEN:36 \\
        2>&1 | tee ${meta.id}_trimmomatic.log

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        trimmomatic: \$(trimmomatic -version 2>&1 | head -n1)
    VERSIONS
    """
}
