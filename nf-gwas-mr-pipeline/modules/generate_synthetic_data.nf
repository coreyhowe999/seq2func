/*
 * Module: GENERATE_SYNTHETIC_DATA
 * ================================
 * Generates synthetic GWAS summary statistics for a single chromosome.
 *
 * This is a Nextflow DSL2 "process" — the fundamental unit of work.
 * A process defines:
 *   - input:  what data it consumes (typed declarations)
 *   - output: what data it produces (also typed)
 *   - script: the shell commands to run
 *
 * Each process runs in its own isolated work directory.  Nextflow handles
 * scheduling, staging inputs, and capturing outputs automatically.
 */

process GENERATE_SYNTHETIC_DATA {

    /*
     * "tag" adds a human-readable label to this task instance in the
     * Nextflow log.  Since we run one instance per chromosome, we tag
     * with the chromosome number so the log reads:
     *   [chr1] GENERATE_SYNTHETIC_DATA ...
     */
    tag "chr${chrom}"

    /*
     * publishDir copies (or symlinks) output files to a user-visible
     * directory.  'mode: copy' physically copies them so they survive
     * cleanup of the Nextflow work/ directory.
     */
    publishDir "${params.outdir}/synthetic_data", mode: 'copy'

    input:
    /*
     * "val" declares a simple value channel input.
     * Here we receive the chromosome number as an integer.
     */
    val(chrom)

    output:
    /*
     * "tuple" bundles multiple outputs into a single channel element.
     * The downstream process receives (chrom, exposure_file, outcome_file)
     * as one unit, keeping them associated.
     *
     * "val(chrom)" passes the chromosome number through so downstream
     * processes know which chromosome the files belong to.
     *
     * "path(...)" captures files matching the glob pattern.
     */
    tuple val(chrom), path("exposure_chr${chrom}.tsv.gz"), path("outcome_chr${chrom}.tsv.gz")

    script:
    /*
     * The script block is a Bash heredoc.  Nextflow variable interpolation
     * uses ${...} just like Bash, but Nextflow resolves its own variables
     * first.  To use literal Bash variables, escape with \$ or use
     * single-quoted strings.
     *
     * "generate_gwas_data.py" is found automatically because Nextflow adds
     * the project's bin/ directory to the PATH.
     */
    """
    generate_gwas_data.py \
        --chrom ${chrom} \
        --n-variants ${params.n_variants} \
        --n-samples-exposure ${params.n_samples_exposure} \
        --n-samples-outcome ${params.n_samples_outcome} \
        --outdir .
    """
}
