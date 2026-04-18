/*
 * =============================================================================
 * Trinity Module — De Novo Transcriptome Assembly
 * =============================================================================
 *
 * Trinity is the de facto standard for de novo RNA-seq transcriptome assembly.
 * It reconstructs full-length transcript sequences WITHOUT a reference genome
 * by combining three independent algorithms:
 *
 *   1. Inchworm: Builds initial contigs using greedy k-mer extension
 *   2. Chrysalis: Clusters contigs into components (gene-level groups) and
 *      constructs de Bruijn graphs for each component
 *   3. Butterfly: Resolves transcript isoforms by tracing paths through the
 *      de Bruijn graphs
 *
 * The output is a FASTA file where each sequence header contains:
 *   >TRINITY_DN{gene_id}_c{component}_g{gene}_i{isoform}
 *
 * For example: >TRINITY_DN100_c0_g1_i1 means:
 *   DN100 = gene 100, c0 = component 0, g1 = gene 1, i1 = isoform 1
 *
 * RESOURCE REQUIREMENTS:
 *   Trinity is extremely memory-hungry.  A typical RNA-seq dataset needs
 *   16-64 GB of RAM.  The memory directive scales up on retry:
 *     memory { 16.GB * task.attempt }
 *   So attempt 1 = 16 GB, attempt 2 = 32 GB, attempt 3 = 48 GB.
 *
 * Author: Corey Howe
 * =============================================================================
 */

process TRINITY {
    tag "${meta.id}"
    container 'trinityrnaseq/trinityrnaseq:2.15.1'

    /*
     * Dynamic resource allocation:
     *   memory { 16.GB * task.attempt } — scales up on each retry
     *   task.attempt is a Nextflow built-in: 1 on first try, 2 on first retry, etc.
     *
     * This pattern handles OOM (Out-Of-Memory) failures gracefully:
     * if Trinity runs out of memory, Nextflow retries with more RAM.
     */
    memory { 16.GB * task.attempt }
    cpus 4
    time '4h'
    errorStrategy 'retry'
    maxRetries 2

    publishDir "${params.outdir}/${params.run_id}/trinity", mode: 'copy'

    input:
    tuple val(meta), path(reads)

    output:
    tuple val(meta), path("trinity_out*.Trinity.fasta"),              emit: assembly     // Assembled transcripts
    tuple val(meta), path("trinity_out*.Trinity.fasta.gene_trans_map"), emit: gene_map   // Gene-to-transcript mapping
    path("versions.yml"),                                            emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Run Trinity in de novo mode.
    #
    # Key parameters:
    #   --seqType fq: Input is FASTQ format
    #   --left/--right: Forward and reverse paired-end reads
    #   --max_memory: Maximum RAM Trinity can use (from Nextflow's memory directive)
    #   --CPU: Number of threads
    #   --min_contig_length: Discard assembled contigs shorter than this (default 200 bp)
    #   --full_cleanup: Remove intermediate files to save disk space
    #   --output: Output directory name
    #
    # Trinity outputs:
    #   Trinity.fasta — all assembled transcript sequences
    #   Trinity.fasta.gene_trans_map — tab-delimited gene-to-transcript mapping
    Trinity \\
        --seqType fq \\
        --left ${reads[0]} \\
        --right ${reads[1]} \\
        --max_memory ${task.memory.toGiga()}G \\
        --CPU ${task.cpus} \\
        --min_contig_length ${params.min_contig_len} \\
        --output trinity_out \\
        --full_cleanup

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        trinity: \$(Trinity --version 2>&1 | head -n1 | sed 's/Trinity version: //')
    VERSIONS
    """
}
