#!/usr/bin/env nextflow

/*
 * =============================================================================
 * GWAS Summary Statistics QC → Mendelian Randomization Pipeline
 * =============================================================================
 *
 * A Nextflow DSL2 pipeline that:
 *   1. Generates synthetic GWAS summary statistics (per chromosome, in parallel)
 *   2. Applies quality control filters (per chromosome, in parallel — SCATTER)
 *   3. Collects results genome-wide (GATHER)
 *   4. Performs LD clumping to find independent lead variants
 *   5. Forks into two parallel branches:
 *        A. Two-sample Mendelian Randomization
 *        B. Polygenic Risk Score calculation
 *   6. Generates a self-contained HTML report
 *
 * Run:
 *   nextflow run main.nf -profile local
 *   nextflow run main.nf -profile local --n_variants 100000 --n_chromosomes 5
 *
 * Author: Corey — 5 Prime Sciences interview project
 * =============================================================================
 */


/*
 * ---------------------------------------------------------------------------
 * NEXTFLOW DSL2
 * ---------------------------------------------------------------------------
 * DSL2 is the modern Nextflow syntax (default since v22.x).  It introduces:
 *   - Module imports (reusable process definitions in separate files)
 *   - Workflow composition (sub-workflows can be nested and reused)
 *   - Explicit channel wiring (channels are passed between processes)
 *
 * In DSL1 (legacy), processes were implicitly connected by channel names.
 * DSL2 is explicit: you call processes like functions and wire their outputs.
 * ---------------------------------------------------------------------------
 */
nextflow.enable.dsl = 2


/*
 * ---------------------------------------------------------------------------
 * PIPELINE PARAMETERS
 * ---------------------------------------------------------------------------
 * params.* defines pipeline parameters with default values.  Users override
 * them on the command line:
 *
 *   nextflow run main.nf --n_variants 100000 --n_chromosomes 5
 *
 * Or in a params file (YAML/JSON):
 *   nextflow run main.nf -params-file my_params.yaml
 *
 * Parameters are globally accessible as params.name anywhere in the pipeline.
 * ---------------------------------------------------------------------------
 */

// Data generation parameters
params.n_variants           = 500000     // Number of SNPs to simulate per chromosome
params.n_chromosomes        = 22         // Number of chromosomes (1–22)
params.n_samples_exposure   = 50000      // Sample size for exposure GWAS
params.n_samples_outcome    = 50000      // Sample size for outcome GWAS

// QC thresholds
params.gwas_pvalue_threshold = 5e-8      // Genome-wide significance threshold
params.maf_threshold         = 0.01      // Minor allele frequency filter
params.info_threshold        = 0.8       // Imputation quality score filter

// LD clumping parameters
params.clumping_r2     = 0.001           // LD R² threshold (simulated)
params.clumping_window = 10000           // Clumping window in kilobases

// MR analysis parameters
params.mr_methods = ['ivw', 'egger', 'weighted_median', 'wald_ratio']

// Output directory
params.outdir = 'results'


/*
 * ---------------------------------------------------------------------------
 * MODULE IMPORTS
 * ---------------------------------------------------------------------------
 * DSL2 modules are Nextflow files containing one or more process definitions.
 * We import them using the "include" keyword.
 *
 * Syntax:  include { PROCESS_NAME } from './path/to/module.nf'
 *
 * This is analogous to Python's "from module import function".
 * Each module file typically contains a single process.
 * ---------------------------------------------------------------------------
 */
include { GENERATE_SYNTHETIC_DATA } from './modules/generate_synthetic_data'
include { GWAS_QC                } from './modules/gwas_qc'
include { LD_CLUMPING            } from './modules/clumping'
include { MR_ANALYSIS            } from './modules/mr_analysis'
include { PRS_CALCULATION        } from './modules/prs_calculation'
include { GENERATE_REPORT        } from './modules/reporting'


/*
 * ---------------------------------------------------------------------------
 * MAIN WORKFLOW
 * ---------------------------------------------------------------------------
 * The "workflow" block defines how processes are wired together.
 * Think of it as the DAG (directed acyclic graph) of your pipeline.
 *
 * Key concepts demonstrated below:
 *   1. Channel creation (Channel.of, Channel.from)
 *   2. Channel operators (.map, .collect, .flatten)
 *   3. Scatter pattern (one channel element per chromosome → parallel execution)
 *   4. Gather pattern (.collect() merges parallel outputs into one)
 *   5. Forking (one output feeds two independent downstream processes)
 *   6. Process invocation (calling processes like functions)
 * ---------------------------------------------------------------------------
 */
workflow {

    /*
     * ===== STEP 0: Create the chromosome channel =====
     *
     * Channel.of(1..N) creates a "queue channel" that emits each value
     * (1, 2, 3, ..., N) as a separate element.
     *
     * QUEUE CHANNELS vs VALUE CHANNELS:
     *   - Queue channels: elements are consumed once (FIFO).  Used for
     *     data that flows through the pipeline.
     *   - Value channels: emit the same value repeatedly.  Created with
     *     Channel.value().  Used for parameters or reference data.
     *
     * Here each chromosome number is an independent element, so
     * GENERATE_SYNTHETIC_DATA will be launched N times in parallel —
     * this is the SCATTER pattern.
     *
     * On a cluster/cloud, each chromosome would run on a separate node.
     * Locally, Nextflow uses a thread pool (size = number of CPUs).
     */
    chromosomes_ch = Channel.of(1..params.n_chromosomes)

    /*
     * ===== STEP 1: Generate synthetic GWAS data (SCATTER) =====
     *
     * Calling a process is like calling a function.  The channel
     * "chromosomes_ch" has N elements, so the process runs N times.
     *
     * GENERATE_SYNTHETIC_DATA.out is the output channel — a queue
     * channel of tuples: (chrom, exposure_file, outcome_file).
     */
    GENERATE_SYNTHETIC_DATA(chromosomes_ch)

    /*
     * ===== STEP 2: GWAS QC per chromosome (SCATTER) =====
     *
     * The output of GENERATE_SYNTHETIC_DATA is a channel of tuples.
     * We pass it directly to GWAS_QC, which also expects a tuple input.
     * Each chromosome is QC'd independently and in parallel.
     *
     * This is the "embarrassingly parallel" pattern common in genomics:
     * each chromosome is independent, so they can all run simultaneously.
     */
    GWAS_QC(GENERATE_SYNTHETIC_DATA.out)

    /*
     * ===== STEP 3: Collect QC'd files (GATHER) =====
     *
     * .collect() is a channel operator that waits for ALL elements to
     * arrive, then emits them as a single list.  This is the GATHER
     * step that merges parallel outputs.
     *
     * GWAS_QC.out.qc_data is a channel of tuples:
     *   (chrom, qc_exposure, qc_outcome)
     *
     * We use .map { } to extract just the exposure or outcome files,
     * then .collect() to gather them into a single list.
     *
     * .map { } is a channel operator that transforms each element.
     * It's like Python's map() or a list comprehension.
     *
     * Destructuring:  { chrom, exp, out -> exp }
     *   The closure receives the tuple elements as named variables.
     *   We return just the exposure file.
     */

    // Extract QC'd exposure files and collect them genome-wide
    qc_exposure_ch = GWAS_QC.out.qc_data
        .map { chrom, exp, out -> exp }   // extract exposure file from tuple
        .collect()                         // gather all into a single list

    // Extract QC'd outcome files and collect them genome-wide
    qc_outcome_ch = GWAS_QC.out.qc_data
        .map { chrom, exp, out -> out }
        .collect()

    // Collect QC metrics for the report
    qc_metrics_ch = GWAS_QC.out.qc_metrics_exposure
        .mix(GWAS_QC.out.qc_metrics_outcome)   // .mix() merges two channels
        .collect()

    /*
     * ===== STEP 4: LD Clumping (genome-wide) =====
     *
     * LD clumping must see ALL chromosomes at once because clumping is
     * genome-wide.  The .collect()-ed channel provides a single list
     * of all QC'd exposure files to one process invocation.
     *
     * This is a classic scatter-gather pattern:
     *   Scatter: QC runs on each chromosome independently
     *   Gather:  Clumping receives all chromosomes at once
     */
    LD_CLUMPING(qc_exposure_ch)

    /*
     * ===== STEP 5: Fork into two parallel branches =====
     *
     * After clumping, the pipeline splits (forks) into two independent
     * analyses that can run in parallel:
     *
     *   Branch A: Mendelian Randomization (needs exposure, outcome, instruments)
     *   Branch B: Polygenic Risk Score (needs exposure, instruments)
     *
     * In Nextflow, forking is implicit: we simply use the same channel
     * as input to two different processes.  Nextflow schedules them
     * independently and they run concurrently.
     *
     * NOTE: Queue channels can only be consumed once!  If you need to
     * feed the same data to two processes, either:
     *   1. Use the channel in two process calls (Nextflow handles this
     *      for collected channels)
     *   2. Explicitly copy with .into { ch1; ch2 } (DSL1 pattern)
     *
     * With .collect(), the result is a value-like channel that can be
     * reused, so both branches receive the same files.
     */

    // Branch A: MR Analysis
    MR_ANALYSIS(
        LD_CLUMPING.out.lead_snps,   // Instruments (lead SNPs)
        qc_exposure_ch,               // All QC'd exposure files
        qc_outcome_ch                 // All QC'd outcome files
    )

    // Branch B: PRS Calculation
    PRS_CALCULATION(
        qc_exposure_ch,               // All QC'd exposure files
        LD_CLUMPING.out.lead_snps     // Lead SNPs for filtering
    )

    /*
     * ===== STEP 6: Generate HTML Report (final GATHER) =====
     *
     * The report process is the terminal node in the DAG.  It waits
     * for ALL upstream branches to complete, then generates a single
     * HTML report.
     *
     * Nextflow automatically resolves the DAG dependencies: the report
     * process won't start until both MR_ANALYSIS and PRS_CALCULATION
     * (and all their upstream dependencies) have finished.
     */
    GENERATE_REPORT(
        qc_metrics_ch,                       // QC metrics JSONs
        qc_exposure_ch,                      // QC'd GWAS files for plots
        LD_CLUMPING.out.lead_snps,           // Lead SNPs
        MR_ANALYSIS.out.results_json,        // MR results
        MR_ANALYSIS.out.instruments_tsv,     // Per-instrument data
        PRS_CALCULATION.out.prs_metrics,     // PRS metrics
        PRS_CALCULATION.out.prs_scores       // PRS data
    )
}


/*
 * ---------------------------------------------------------------------------
 * WORKFLOW COMPLETION HOOKS
 * ---------------------------------------------------------------------------
 * workflow.onComplete is a closure that runs after the pipeline finishes.
 * Useful for sending notifications, cleanup, or printing a summary.
 * ---------------------------------------------------------------------------
 */
workflow.onComplete {
    println """
    =========================================
    Pipeline completed!
    =========================================
    Status   : ${workflow.success ? 'SUCCESS' : 'FAILED'}
    Duration : ${workflow.duration}
    Output   : ${params.outdir}
    Report   : ${params.outdir}/pipeline_report.html
    =========================================
    """.stripIndent()
}
