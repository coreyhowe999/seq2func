/*
 * Module: PRS_CALCULATION
 * ========================
 * Polygenic Risk Score calculation using the exposure GWAS summary
 * statistics.  Simulates genotypes for a synthetic cohort and evaluates
 * PRS at multiple p-value thresholds.
 */

process PRS_CALCULATION {

    tag "PRS"

    publishDir "${params.outdir}/prs", mode: 'copy'

    input:
    path(exposure_files)
    path(lead_snps)

    output:
    path("prs_scores.tsv"),    emit: prs_scores
    path("prs_metrics.json"),  emit: prs_metrics

    script:
    """
    # Merge exposure files
    head -1 \$(ls ${exposure_files} | head -1) > merged_exposure.tsv
    for f in ${exposure_files}; do
        tail -n +2 "\$f" >> merged_exposure.tsv
    done

    calculate_prs.py \
        --gwas merged_exposure.tsv \
        --instruments ${lead_snps} \
        --n-individuals 1000 \
        --output-prs prs_scores.tsv \
        --output-metrics prs_metrics.json
    """
}
