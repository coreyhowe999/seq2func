/*
 * Module: GENERATE_REPORT
 * ========================
 * Produces a self-contained HTML report with embedded plots summarising
 * every stage of the pipeline: QC, clumping, MR, and PRS.
 */

process GENERATE_REPORT {

    tag "report"

    publishDir "${params.outdir}", mode: 'copy'

    input:
    /*
     * This process is the final "gather" — it consumes outputs from
     * every upstream branch.  Each input is a collected set of files
     * from across chromosomes or pipeline branches.
     */
    path(qc_metrics)
    path(qc_gwas_files)
    path(clumping_file)
    path(mr_json)
    path(mr_instruments)
    path(prs_metrics)
    path(prs_data)

    output:
    path("pipeline_report.html"), emit: report

    script:
    /*
     * We pass the individual files as space-separated lists via
     * Nextflow's automatic staging.  The Python script's argparse
     * uses nargs="*" to accept multiple files for QC metrics / GWAS.
     */
    def params_str = "n_variants=${params.n_variants}, chroms=${params.n_chromosomes}, MAF>${params.maf_threshold}, INFO>${params.info_threshold}"
    """
    generate_report.py \
        --qc-metrics ${qc_metrics} \
        --qc-gwas ${qc_gwas_files} \
        --clumping ${clumping_file} \
        --mr-json ${mr_json} \
        --mr-instruments ${mr_instruments} \
        --prs-metrics ${prs_metrics} \
        --prs-data ${prs_data} \
        --params-summary "${params_str}" \
        --output pipeline_report.html
    """
}
