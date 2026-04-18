/*
 * Module: LD_CLUMPING
 * ====================
 * Performs distance-based LD clumping genome-wide to identify independent
 * lead SNPs.  This is the "gather" step — it receives ALL chromosomes'
 * QC'd data collected into a single process invocation.
 */

process LD_CLUMPING {

    tag "genome-wide"

    publishDir "${params.outdir}/clumping", mode: 'copy'

    input:
    /*
     * "path(...)" with a glob pattern collects all staged files.
     * The .collect() channel operator (called in main.nf) turns the
     * per-chromosome queue channel into a single list of files, which
     * Nextflow stages into this process's work directory.
     *
     * We receive all QC'd exposure files as a flat list.
     */
    path(exposure_files)

    output:
    path("lead_snps.tsv"),       emit: lead_snps
    path("clumping_metrics.json"), emit: metrics

    script:
    /*
     * We pass all exposure files to ld_clumping.py via shell glob.
     * The script will read and concatenate them internally.
     */
    """
    ld_clumping.py \
        --input ${exposure_files} \
        --output lead_snps.tsv \
        --p-threshold ${params.gwas_pvalue_threshold} \
        --clumping-window ${params.clumping_window} \
        --metrics clumping_metrics.json
    """
}
