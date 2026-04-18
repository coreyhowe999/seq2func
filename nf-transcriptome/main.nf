#!/usr/bin/env nextflow

/*
 * =============================================================================
 * De Novo Transcriptome Assembly & Annotation Pipeline
 * =============================================================================
 *
 * A Nextflow DSL2 pipeline that takes an SRA accession ID (RNA-seq data),
 * downloads the raw FASTQ files, assembles a de novo transcriptome, predicts
 * protein-coding ORFs, and annotates the predicted proteins using:
 *   - Conserved Domain Database (CDD) via RPS-BLAST
 *   - ProstT5 structural alphabet prediction (3Di tokens)
 *   - FoldSeek structural homology search
 *
 * The pipeline reports status updates to a NextJS web application via HTTP
 * POST requests, enabling real-time monitoring through the browser UI.
 *
 * Run examples:
 *   # From SRA accession (downloads FASTQ automatically):
 *   nextflow run main.nf --srr_id SRR5437876 -profile standard
 *
 *   # From local FASTQ files (for development/testing):
 *   nextflow run main.nf --reads 'data/test/*_{1,2}.fastq.gz' -profile test
 *
 *   # Quick test with small SRA dataset:
 *   nextflow run main.nf -profile test
 *
 * Author: Corey Howe — 5 Prime Sciences interview project
 * =============================================================================
 */


/*
 * ---------------------------------------------------------------------------
 * NEXTFLOW DSL2
 * ---------------------------------------------------------------------------
 * DSL2 is the modern Nextflow syntax (default since v22.x).  It enables:
 *   - Module imports: reusable process definitions in separate files
 *   - Workflow composition: sub-workflows can be nested and reused
 *   - Explicit channel wiring: channels are passed between processes like
 *     function arguments, making data flow visible and testable
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
 *   nextflow run main.nf --srr_id SRR12345678 --min_contig_len 300
 *
 * Parameters are globally accessible as params.name anywhere in the pipeline.
 * ---------------------------------------------------------------------------
 */

// ── Primary Input ──────────────────────────────────────────────────────────
// The pipeline supports TWO mutually exclusive input modes:
//   1. --srr_id: Download FASTQ from NCBI SRA (the intended production mode)
//   2. --reads:  Use local FASTQ files (for development and testing)
params.srr_id               = null                              // SRA accession (e.g., "SRR12345678")
params.reads                = null                              // Local paired-end reads glob pattern

// ── Run Identification ─────────────────────────────────────────────────────
params.run_id               = "run_${new Date().format('yyyyMMdd_HHmmss')}"   // Unique run identifier
params.outdir               = "results"                         // Output directory for published results

// ── Web Application Integration ────────────────────────────────────────────
// The pipeline POSTs status updates to this URL after each major step.
// If the API is unreachable, updates are silently skipped (pipeline continues).
params.api_url              = "http://localhost:3000/api"       // NextJS API base URL

// ── Cloud Storage (Optional) ───────────────────────────────────────────────
params.r2_bucket            = null                              // Cloudflare R2 bucket for output files

// ── Assembly Parameters ────────────────────────────────────────────────────
params.min_contig_len       = 200                               // Trinity: minimum contig length (bp)
params.min_orf_len          = 100                               // TransDecoder: minimum ORF length (amino acids)

// ── Annotation Database Paths ──────────────────────────────────────────────
params.cdd_db               = "data/cdd/Cdd"                    // Local CDD database path for RPS-BLAST
params.foldseek_db          = "data/foldseek/pdb"               // Local FoldSeek database path

// ── Search Parameters ──────────────────────────────────────────────────────
params.evalue               = 0.01                              // E-value threshold for BLAST/FoldSeek
params.max_proteins         = 500                               // Cap proteins to annotate (for demo speed)

// ── Feature Toggles ────────────────────────────────────────────────────────
// These flags allow skipping GPU-dependent or database-dependent steps.
// Useful when running without GPU (ProstT5) or without downloaded databases.
params.skip_prostt5         = false                             // Skip ProstT5 if no GPU available
params.skip_foldseek        = false                             // Skip FoldSeek if no database downloaded
params.skip_cdd             = false                             // Skip CDD if no database downloaded

// ── SRA Download Guard ─────────────────────────────────────────────────────
params.max_sra_size         = '10G'                             // Maximum SRA download size (safety guard)


/*
 * ---------------------------------------------------------------------------
 * MODULE IMPORTS
 * ---------------------------------------------------------------------------
 * DSL2 modules are Nextflow files containing one or more process definitions.
 * We import them using the "include" keyword — analogous to Python's
 * "from module import function".
 *
 * Each module file contains a single process (or a pair of related processes
 * like TransDecoder's LongOrfs + Predict).
 * ---------------------------------------------------------------------------
 */
include { SRA_DOWNLOAD           } from './modules/sra_download'
include { FASTQC                 } from './modules/fastqc'
include { FASTQC as FASTQC_TRIMMED } from './modules/fastqc'
include { TRIMMOMATIC            } from './modules/trimmomatic'
include { TRINITY                } from './modules/trinity'
include { TRANSDECODER_LONGORFS  } from './modules/transdecoder'
include { TRANSDECODER_PREDICT   } from './modules/transdecoder'
include { CDD_SEARCH             } from './modules/cdd_search'
include { PROSTT5_PREDICT        } from './modules/prostt5'
include { FOLDSEEK_SEARCH        } from './modules/foldseek'
include { MERGE_RESULTS          } from './modules/merge_results'


/*
 * ---------------------------------------------------------------------------
 * STATUS UPDATE HELPER
 * ---------------------------------------------------------------------------
 * Instead of using a separate Nextflow process for status updates (which
 * would require DSL2 aliasing for each call), we define a simple function
 * that fires an HTTP POST to the web app.  This is called after each major
 * step using Nextflow's .subscribe() operator.
 *
 * The function is fire-and-forget: if the API is unreachable, it logs a
 * warning and continues.  The pipeline NEVER fails due to a status update.
 * ---------------------------------------------------------------------------
 */
def sendStatusUpdate(String step, String status, Map metrics = [:]) {
    try {
        def payload = [
            run_id   : params.run_id,
            step     : step,
            status   : status,
            timestamp: new Date().format("yyyy-MM-dd'T'HH:mm:ss'Z'"),
            metrics  : metrics
        ]
        def json = groovy.json.JsonOutput.toJson(payload)
        def url = new URL("${params.api_url}/pipeline/status")
        def conn = url.openConnection()
        conn.setRequestMethod("POST")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setDoOutput(true)
        conn.setConnectTimeout(5000)
        conn.setReadTimeout(5000)
        conn.outputStream.withWriter { it.write(json) }
        def code = conn.responseCode
        log.info "Status update: ${step} → ${status} (HTTP ${code})"
    } catch (Exception e) {
        log.warn "Status update failed for ${step}: ${e.message}"
    }
}


/*
 * ---------------------------------------------------------------------------
 * MAIN WORKFLOW
 * ---------------------------------------------------------------------------
 * The "workflow" block defines how processes are wired together.  Think of it
 * as the directed acyclic graph (DAG) of the pipeline.
 *
 * Key Nextflow concepts demonstrated:
 *   1. Channel creation: Channel.of(), Channel.fromFilePairs()
 *   2. Channel operators: .map(), .collect(), .mix(), .ifEmpty()
 *   3. Conditional execution: if/else blocks for optional steps
 *   4. Process invocation: calling processes like functions
 *   5. Scatter pattern: one channel element per sample → parallel execution
 *   6. Fork/join: parallel annotation branches that converge at MERGE_RESULTS
 *   7. Status reporting: non-blocking HTTP updates via .subscribe()
 * ---------------------------------------------------------------------------
 */
workflow {

    /*
     * ===== INPUT VALIDATION =====
     *
     * Enforce mutually exclusive input modes.  The pipeline accepts either
     * an SRA accession (downloads FASTQ from NCBI) or local FASTQ files,
     * but not both — this prevents ambiguous input situations.
     */
    if (params.srr_id && params.reads) {
        error """
        ERROR: Please provide either --srr_id OR --reads, not both.

        Usage:
          nextflow run main.nf --srr_id SRR12345678    # Download from SRA
          nextflow run main.nf --reads 'path/*_{1,2}.fastq.gz'  # Local files
        """.stripIndent()
    }
    if (!params.srr_id && !params.reads) {
        error """
        ERROR: No input provided. Please specify one of:

          --srr_id SRR12345678              Download FASTQ from NCBI SRA
          --reads 'path/*_{1,2}.fastq.gz'   Use local paired-end FASTQ files

        Example:
          nextflow run main.nf --srr_id SRR5437876 -profile test
        """.stripIndent()
    }

    /*
     * ===== STEP 0: Obtain Raw Reads =====
     *
     * Two code paths converge into a single ch_reads channel:
     *
     * Path A (--srr_id): Launch SRA_DOWNLOAD to fetch FASTQ from NCBI.
     *   The process auto-detects paired vs single end and constructs a
     *   meta map [id: srr_id, single_end: true/false].
     *
     * Path B (--reads): Use Channel.fromFilePairs() to create a channel
     *   from local FASTQ files.  fromFilePairs() groups files by sample
     *   name using a glob pattern (e.g., sample_{1,2}.fastq.gz).
     *
     * Both paths produce: tuple(meta_map, [fastq_files])
     * This tuple-based approach keeps metadata bundled with data files
     * throughout the pipeline — a pattern used extensively in nf-core.
     */
    if (params.srr_id) {
        // Path A: Download from SRA
        SRA_DOWNLOAD(Channel.of(params.srr_id))
        ch_reads = SRA_DOWNLOAD.out.reads

        // Report SRA download completion via subscribe
        SRA_DOWNLOAD.out.reads.subscribe { sendStatusUpdate('SRA_DOWNLOAD', 'completed') }
    } else {
        // Path B: Local FASTQ files
        // fromFilePairs groups files by the shared prefix before _{1,2}
        // Returns: tuple(sample_id, [file1, file2])
        ch_reads = Channel
            .fromFilePairs(params.reads, checkIfExists: true)
            .map { sample_id, files ->
                def meta = [id: sample_id, single_end: false]
                [meta, files]
            }
    }


    /*
     * ===== STEP 1: Raw Read Quality Assessment (FASTQC) =====
     *
     * FastQC generates per-base quality scores, GC content distribution,
     * adapter contamination metrics, and other quality indicators.
     *
     * This step runs on the RAW reads (before trimming) to establish a
     * baseline quality profile.  We'll run FastQC again after trimming
     * to verify that quality improved.
     *
     * The same FASTQC module is imported twice with different aliases:
     *   FASTQC         → runs on raw reads
     *   FASTQC_TRIMMED → runs on trimmed reads (same code, different input)
     * This is a DSL2 feature: module aliasing for process reuse.
     */
    FASTQC(ch_reads)
    FASTQC.out.zip.subscribe { sendStatusUpdate('FASTQC', 'completed') }


    /*
     * ===== STEP 2: Adapter Trimming & Quality Filtering (Trimmomatic) =====
     *
     * Trimmomatic removes:
     *   - Illumina adapter sequences (ILLUMINACLIP)
     *   - Low-quality bases from read ends (LEADING, TRAILING)
     *   - Low-quality windows within reads (SLIDINGWINDOW)
     *   - Reads that are too short after trimming (MINLEN)
     *
     * Output: paired reads (both mates survived) and unpaired reads
     * (only one mate survived).  We proceed with paired reads only.
     */
    TRIMMOMATIC(ch_reads)
    TRIMMOMATIC.out.trimmed_reads.subscribe { sendStatusUpdate('TRIMMOMATIC', 'completed') }


    /*
     * ===== STEP 3: Trimmed Read Quality Check =====
     *
     * Run FastQC again on the trimmed reads to verify improvement.
     * Using the FASTQC_TRIMMED alias (same process, different name).
     */
    FASTQC_TRIMMED(TRIMMOMATIC.out.trimmed_reads)
    FASTQC_TRIMMED.out.zip.subscribe { sendStatusUpdate('FASTQC_TRIMMED', 'completed') }


    /*
     * ===== STEP 4: De Novo Transcriptome Assembly (Trinity) =====
     *
     * Trinity is the gold standard for de novo RNA-seq assembly.
     * It reconstructs transcript sequences WITHOUT a reference genome
     * by building de Bruijn graphs from k-mers in the reads.
     *
     * Trinity produces:
     *   - Trinity.fasta: assembled transcript sequences (contigs)
     *   - gene_trans_map: mapping between genes and transcript isoforms
     *
     * This is the most resource-intensive step: Trinity needs substantial
     * memory (16 GB+) and CPU time.  The memory directive scales up on
     * retry: memory { 16.GB * task.attempt }
     */
    TRINITY(TRIMMOMATIC.out.trimmed_reads)
    TRINITY.out.assembly.subscribe { sendStatusUpdate('TRINITY', 'completed') }


    /*
     * ===== STEP 5: ORF Prediction (TransDecoder) =====
     *
     * TransDecoder identifies likely protein-coding regions (ORFs) within
     * the assembled transcripts.  It runs in two phases:
     *
     * Phase 1 — LongOrfs: Scans all 6 reading frames for ORFs longer than
     *   --min_orf_len amino acids.  This is a simple length-based filter.
     *
     * Phase 2 — Predict: Applies a log-likelihood scoring model trained
     *   on the longest ORFs to predict which ORFs are truly protein-coding.
     *   Uses Markov models of codon usage (similar to how gene finders work).
     *
     * Output: predicted protein sequences (.pep), BED coordinates, GFF3
     */
    TRANSDECODER_LONGORFS(TRINITY.out.assembly)
    TRANSDECODER_LONGORFS.out.orfs.subscribe { sendStatusUpdate('TRANSDECODER_LONGORFS', 'completed') }

    TRANSDECODER_PREDICT(TRINITY.out.assembly, TRANSDECODER_LONGORFS.out.td_dir)
    TRANSDECODER_PREDICT.out.proteins.subscribe { sendStatusUpdate('TRANSDECODER_PREDICT', 'completed') }


    /*
     * ===== STEP 6: Protein Annotation (Three Parallel Branches) =====
     *
     * The predicted proteins are annotated using three complementary methods:
     *
     *   A. CDD Search (RPS-BLAST): Identifies conserved protein domains
     *      from the NCBI Conserved Domain Database.
     *
     *   B. ProstT5: A protein language model that predicts 3Di structural
     *      alphabet tokens from amino acid sequences.
     *
     *   C. FoldSeek: Searches for structural homologs using 3Di sequences.
     *
     * DEPENDENCY CHAIN:
     *   CDD runs independently (sequence-based, no 3Di needed)
     *   ProstT5 runs independently (generates 3Di from AA sequence)
     *   FoldSeek DEPENDS on ProstT5 output (uses 3Di for structural search)
     *
     * So the actual parallelism is:
     *   CDD ──────────────────────┐
     *   ProstT5 → FoldSeek ───────┤→ MERGE_RESULTS
     *                              └─
     *
     * Nextflow resolves this DAG automatically: CDD and ProstT5 run in
     * parallel, then FoldSeek starts when ProstT5 finishes.
     */

    // ── Branch A: CDD Domain Search ────────────────────────────────────────
    if (!params.skip_cdd) {
        CDD_SEARCH(
            TRANSDECODER_PREDICT.out.proteins,
            Channel.fromPath(params.cdd_db, checkIfExists: false)
        )
        ch_cdd = CDD_SEARCH.out.annotations
        CDD_SEARCH.out.annotations.subscribe { sendStatusUpdate('CDD_SEARCH', 'completed') }
    } else {
        // When CDD is skipped, create a placeholder channel with the same
        // tuple structure: [meta, file].  We write an actual empty file so
        // Nextflow can stage it to GCS (file('NO_CDD') doesn't exist on disk
        // and causes "Can't stage file" errors on cloud executors).
        ch_cdd = TRANSDECODER_PREDICT.out.proteins.map { meta, prot ->
            def placeholder = workDir.resolve('NO_CDD')
            if (!placeholder.exists()) placeholder.text = '{}'
            [meta, placeholder]
        }
    }


    // ── Branch B: ProstT5 3Di Prediction ───────────────────────────────────
    if (!params.skip_prostt5) {
        PROSTT5_PREDICT(TRANSDECODER_PREDICT.out.proteins)
        ch_prostt5_3di = PROSTT5_PREDICT.out.structures_3di
        PROSTT5_PREDICT.out.structures_3di.subscribe { sendStatusUpdate('PROSTT5_PREDICT', 'completed') }
    } else {
        ch_prostt5_3di = TRANSDECODER_PREDICT.out.proteins.map { meta, prot ->
            def placeholder = workDir.resolve('NO_PROSTT5')
            if (!placeholder.exists()) placeholder.text = ''
            [meta, placeholder]
        }
    }


    // ── Branch C: FoldSeek Structural Search ───────────────────────────────
    if (!params.skip_prostt5 && !params.skip_foldseek) {
        FOLDSEEK_SEARCH(
            PROSTT5_PREDICT.out.structures_3di,
            TRANSDECODER_PREDICT.out.proteins,
            Channel.fromPath(params.foldseek_db, checkIfExists: false)
        )
        ch_foldseek = FOLDSEEK_SEARCH.out.annotations
        FOLDSEEK_SEARCH.out.annotations.subscribe { sendStatusUpdate('FOLDSEEK_SEARCH', 'completed') }
    } else {
        ch_foldseek = TRANSDECODER_PREDICT.out.proteins.map { meta, prot ->
            def placeholder = workDir.resolve('NO_FOLDSEEK')
            if (!placeholder.exists()) placeholder.text = '{}'
            [meta, placeholder]
        }
    }


    /*
     * ===== STEP 7: Merge All Annotations =====
     *
     * Combine all annotation sources into a single JSON file per protein.
     * This is the final GATHER step that joins the three annotation branches.
     *
     * All four input channels emit consistent tuples: [meta, file]
     * When a step is skipped, its channel emits [meta, file('NO_<STEP>')]
     * and the merge script handles placeholders by filename prefix "NO_".
     */
    MERGE_RESULTS(
        TRANSDECODER_PREDICT.out.proteins,
        ch_cdd,
        ch_prostt5_3di,
        ch_foldseek
    )
    MERGE_RESULTS.out.annotations.subscribe { sendStatusUpdate('MERGE_RESULTS', 'completed') }
}


/*
 * ---------------------------------------------------------------------------
 * WORKFLOW COMPLETION HOOK
 * ---------------------------------------------------------------------------
 * Runs after the entire pipeline finishes (success or failure).
 * Prints a summary and sends a final status update to the web app.
 * ---------------------------------------------------------------------------
 */
workflow.onComplete {
    def status = workflow.success ? 'completed' : 'failed'
    sendStatusUpdate('PIPELINE', status)

    println """
    =========================================
    Pipeline completed!
    =========================================
    Status     : ${workflow.success ? 'SUCCESS' : 'FAILED'}
    Duration   : ${workflow.duration}
    SRR ID     : ${params.srr_id ?: 'N/A (local reads)'}
    Run ID     : ${params.run_id}
    Output     : ${params.outdir}
    =========================================
    """.stripIndent()
}
