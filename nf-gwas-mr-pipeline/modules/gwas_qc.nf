/*
 * Module: GWAS_QC
 * ================
 * Applies quality control filters to GWAS summary statistics for one
 * chromosome.  Runs independently per chromosome (scatter pattern).
 */

process GWAS_QC {

    tag "chr${chrom}"

    publishDir "${params.outdir}/qc", mode: 'copy'

    input:
    /*
     * We receive a tuple that was emitted by GENERATE_SYNTHETIC_DATA.
     * Destructuring the tuple in the input block keeps the chromosome
     * number associated with its files throughout the pipeline.
     */
    tuple val(chrom), path(exposure), path(outcome)

    output:
    /*
     * We produce QC'd versions of both exposure and outcome, plus a
     * JSON file with QC metrics.  The tuple maintains chromosome
     * association.
     */
    tuple val(chrom), path("qc_exposure_chr${chrom}.tsv.gz"), path("qc_outcome_chr${chrom}.tsv.gz"), emit: qc_data
    path("qc_metrics_exposure_chr${chrom}.json"), emit: qc_metrics_exposure
    path("qc_metrics_outcome_chr${chrom}.json"),  emit: qc_metrics_outcome

    script:
    """
    # QC the exposure GWAS
    gwas_qc.py \
        --input ${exposure} \
        --output qc_exposure_chr${chrom}.tsv.gz \
        --metrics qc_metrics_exposure_chr${chrom}.json \
        --maf-threshold ${params.maf_threshold} \
        --info-threshold ${params.info_threshold}

    # QC the outcome GWAS
    gwas_qc.py \
        --input ${outcome} \
        --output qc_outcome_chr${chrom}.tsv.gz \
        --metrics qc_metrics_outcome_chr${chrom}.json \
        --maf-threshold ${params.maf_threshold} \
        --info-threshold ${params.info_threshold}
    """
}
