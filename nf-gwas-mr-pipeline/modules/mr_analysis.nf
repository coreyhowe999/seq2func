/*
 * Module: MR_ANALYSIS
 * ====================
 * Two-sample Mendelian Randomization using the independent lead SNPs
 * as genetic instruments.  Runs genome-wide (all chromosomes merged).
 */

process MR_ANALYSIS {

    tag "MR"

    publishDir "${params.outdir}/mr", mode: 'copy'

    input:
    /*
     * We need three inputs:
     *   1. Lead SNPs from clumping (the instruments)
     *   2. All QC'd exposure summary stats (merged)
     *   3. All QC'd outcome summary stats (merged)
     */
    path(lead_snps)
    path(exposure_files)
    path(outcome_files)

    output:
    path("mr_results.json"),       emit: results_json
    path("mr_instruments.tsv"),    emit: instruments_tsv

    script:
    """
    # Concatenate per-chromosome exposure files into one
    # (header from first file, data from all)
    head -1 \$(ls ${exposure_files} | head -1) > merged_exposure.tsv
    for f in ${exposure_files}; do
        tail -n +2 "\$f" >> merged_exposure.tsv
    done

    # Same for outcome
    head -1 \$(ls ${outcome_files} | head -1) > merged_outcome.tsv
    for f in ${outcome_files}; do
        tail -n +2 "\$f" >> merged_outcome.tsv
    done

    run_mr.py \
        --exposure merged_exposure.tsv \
        --outcome merged_outcome.tsv \
        --instruments ${lead_snps} \
        --methods ${params.mr_methods.join(' ')} \
        --output-json mr_results.json \
        --output-instruments mr_instruments.tsv
    """
}
