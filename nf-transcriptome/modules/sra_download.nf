/*
 * =============================================================================
 * SRA Download Module
 * =============================================================================
 *
 * Downloads raw FASTQ files from NCBI's Sequence Read Archive using the
 * SRA Toolkit (prefetch + fasterq-dump).
 *
 * This module handles:
 *   - Downloading .sra files via prefetch (resumable, network-resilient)
 *   - Converting to FASTQ via fasterq-dump (multi-threaded)
 *   - Auto-detecting paired-end vs single-end layout
 *   - Extracting SRA metadata (organism, platform, read counts)
 *   - Compressing output with pigz/gzip
 *
 * The meta map propagated downstream contains:
 *   [id: srr_id, single_end: true/false]
 *
 * Author: Corey Howe
 * =============================================================================
 */

process SRA_DOWNLOAD {
    /*
     * tag: Human-readable label shown in Nextflow's console output and reports.
     * Using the SRR accession makes it easy to identify which download is running.
     */
    tag "${srr_id}"

    /*
     * container: The Docker image to use for this process.
     * ncbi/sra-tools is the official NCBI SRA Toolkit image.
     * All tools (prefetch, fasterq-dump, vdb-dump) are included.
     */
    container 'quay.io/biocontainers/sra-tools:3.4.1--h4304569_1'

    /*
     * Resource directives:
     *   cpus 4: fasterq-dump uses multiple threads for extraction
     *   memory '4 GB': SRA downloads are not memory-intensive
     *   time '2h': Large datasets can take a while to download
     */
    cpus 4
    memory '4 GB'
    time '2h'

    /*
     * Error handling:
     *   errorStrategy 'retry': Automatically retry on failure
     *   maxRetries 3: Network downloads are flaky — retry up to 3 times
     *
     * prefetch is resumable, so retries pick up where they left off
     * rather than restarting the entire download.
     */
    errorStrategy 'retry'
    maxRetries 3

    /*
     * publishDir: Copy key outputs to the results directory.
     * mode: 'copy' ensures files persist even if the work directory is cleaned.
     */
    publishDir "${params.outdir}/${params.run_id}/sra", mode: 'copy', pattern: 'sra_metadata.json'

    input:
    val(srr_id)     // SRA accession string, e.g., "SRR12345678"

    output:
    tuple val(meta), path("*.fastq.gz"), emit: reads        // FASTQ files with meta map
    path("sra_metadata.json"),           emit: metadata      // SRA run metadata
    path("versions.yml"),                emit: versions       // Tool versions for reproducibility

    script:
    /*
     * We construct the meta map AFTER the script runs, because we need
     * to detect whether the data is paired-end or single-end based on
     * the output files from fasterq-dump.
     *
     * The meta map follows nf-core conventions: [id: sample_name, single_end: bool]
     */
    meta = [id: srr_id, single_end: false]  // Default to paired-end; updated below
    """
    #!/bin/bash
    set -euo pipefail

    # Use /tmp as scratch space for SRA downloads.
    # On GCP, the working directory is a GCS FUSE mount — SRA tools (prefetch)
    # segfault when writing large files to FUSE.  /tmp is a real local disk.
    WORKDIR="\$(pwd)"
    SCRATCH="/tmp/sra_scratch_${srr_id}"
    mkdir -p "\$SCRATCH"

    echo "=== Step 1: Prefetch SRA accession ${srr_id} ==="
    prefetch ${srr_id} \\
        --max-size ${params.max_sra_size} \\
        --output-directory "\$SCRATCH" \\
        --progress

    echo "=== Step 2: Convert .sra to FASTQ ==="
    fasterq-dump "\$SCRATCH/${srr_id}/${srr_id}.sra" \\
        --outdir "\$SCRATCH" \\
        --temp "\$SCRATCH" \\
        --split-3 \\
        --threads ${task.cpus} \\
        --skip-technical \\
        --print-read-nr

    echo "=== Step 3: Compress FASTQ files ==="
    if command -v pigz >/dev/null 2>&1; then
        pigz -p ${task.cpus} "\$SCRATCH"/*.fastq
    else
        gzip "\$SCRATCH"/*.fastq
    fi

    # Copy compressed FASTQs back to the Nextflow working directory
    cp "\$SCRATCH"/*.fastq.gz "\$WORKDIR/"
    rm -rf "\$SCRATCH"

    echo "=== Step 4: Detect paired/single-end layout ==="
    # fasterq-dump --split-3 creates:
    #   Paired-end: ${srr_id}_1.fastq.gz + ${srr_id}_2.fastq.gz
    #   Single-end: ${srr_id}.fastq.gz only
    if [ -f "${srr_id}_1.fastq.gz" ] && [ -f "${srr_id}_2.fastq.gz" ]; then
        LAYOUT="PAIRED"
        echo "Detected PAIRED-end data"
    else
        LAYOUT="SINGLE"
        echo "Detected SINGLE-end data"
    fi

    echo "=== Step 5: Extract SRA metadata ==="
    # Count reads in the FASTQ files for accurate metrics.
    READ_COUNT=\$(zcat *.fastq.gz | wc -l | awk '{print int(\$1/4)}')
    BASE_COUNT=\$(zcat *.fastq.gz | awk 'NR%4==2{sum+=length(\$0)}END{print sum}')

    # Query NCBI for organism and study metadata via E-utilities.
    # Falls back to "Unknown" if NCBI is unreachable.
    ORGANISM="Unknown"
    STUDY_TITLE="SRA Run ${srr_id}"
    PLATFORM="ILLUMINA"

    if command -v curl >/dev/null 2>&1; then
        # Fetch run metadata from NCBI SRA via efetch
        SRA_XML=\$(curl -sf "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=sra&id=${srr_id}&rettype=xml" 2>/dev/null || echo "")
        if [ -n "\$SRA_XML" ]; then
            # Extract metadata using sed (avoids grep -P which Nextflow can't parse)
            ORGANISM=\$(echo "\$SRA_XML" | sed -n 's/.*<ScientificName>\\([^<]*\\)<.*/\\1/p' | head -1)
            STUDY_TITLE=\$(echo "\$SRA_XML" | sed -n 's/.*<STUDY_TITLE>\\([^<]*\\)<.*/\\1/p' | head -1)
            PLATFORM=\$(echo "\$SRA_XML" | sed -n 's/.*<INSTRUMENT_MODEL>\\([^<]*\\)<.*/\\1/p' | head -1)
            [ -z "\$ORGANISM" ] && ORGANISM="Unknown"
            [ -z "\$STUDY_TITLE" ] && STUDY_TITLE="SRA Run ${srr_id}"
            [ -z "\$PLATFORM" ] && PLATFORM="ILLUMINA"
            echo "  Organism: \$ORGANISM"
            echo "  Study: \$STUDY_TITLE"
        else
            echo "  NCBI unreachable — using defaults"
        fi
    fi

    cat > sra_metadata.json <<METADATA
    {
        "srr_id": "${srr_id}",
        "library_layout": "\${LAYOUT}",
        "total_reads": \${READ_COUNT},
        "total_bases": \${BASE_COUNT},
        "platform": "\${PLATFORM}",
        "organism": "\${ORGANISM}",
        "study_title": "\${STUDY_TITLE}"
    }
METADATA

    echo "=== Step 6: Cleanup SRA cache ==="
    # Remove the .sra cache file to save disk space.
    rm -rf ${srr_id}/${srr_id}.sra 2>/dev/null || true
    rm -rf ${srr_id} 2>/dev/null || true

    echo "=== Step 7: Record tool versions ==="
    cat <<-VERSIONS > versions.yml
    "${task.process}":
        sra-tools: \$(prefetch --version 2>&1 | head -n1 | awk '{print \$NF}')
    VERSIONS

    echo "SRA download complete for ${srr_id}"
    """
}
