/*
 * =============================================================================
 * SRA Download Module
 * =============================================================================
 *
 * Downloads raw FASTQ files for an SRA accession. Uses EBI's ENA mirror
 * which provides direct FASTQ downloads via HTTP (no SRA toolkit needed).
 * Falls back to NCBI SRA toolkit if ENA doesn't have the accession.
 *
 * Author: Corey Howe
 * =============================================================================
 */

process SRA_DOWNLOAD {
    tag "${srr_id}"

    // Use a general-purpose container with curl, wget, and pigz
    container 'ubuntu:22.04'

    cpus 4
    memory '8 GB'
    time '2h'
    errorStrategy 'retry'
    maxRetries 3

    publishDir "${params.outdir}/${params.run_id}/sra", mode: 'copy', pattern: 'sra_metadata.json'

    input:
    val(srr_id)

    output:
    tuple val(meta), path("*.fastq.gz"), emit: reads
    path("sra_metadata.json"),           emit: metadata
    path("versions.yml"),                emit: versions

    script:
    meta = [id: srr_id, single_end: false]
    """
    #!/bin/bash
    set -euo pipefail

    # Install curl if not available (ubuntu:22.04 base)
    apt-get update -qq && apt-get install -y -qq curl pigz >/dev/null 2>&1 || true

    echo "=== Downloading FASTQ for ${srr_id} ==="

    # Strategy: Download from EBI's European Nucleotide Archive (ENA).
    # ENA provides direct FASTQ downloads via HTTP — no SRA toolkit needed.
    # This avoids the prefetch/fasterq-dump segfault issues on GCP.
    #
    # ENA URL pattern:
    #   https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR543/006/SRR5437876/SRR5437876_1.fastq.gz
    #   The subdirectory uses the first 6 chars of the accession + zero-padded last digit

    # Build the ENA FTP path
    PREFIX="\${1:0:6}"
    SRR_PREFIX="${srr_id}"
    SRR6="\${SRR_PREFIX:0:6}"
    LAST_DIGITS="\${SRR_PREFIX:6}"

    # Determine the zero-padded subdirectory
    if [ \${#SRR_PREFIX} -gt 9 ]; then
        SUBDIR="\${SRR_PREFIX:0:6}/0\${SRR_PREFIX:9}"
    elif [ \${#SRR_PREFIX} -eq 10 ]; then
        SUBDIR="\${SRR_PREFIX:0:6}/0\${SRR_PREFIX:9}"
    else
        SUBDIR="\${SRR_PREFIX:0:6}"
    fi

    ENA_BASE="https://ftp.sra.ebi.ac.uk/vol1/fastq/\${SUBDIR}/${srr_id}"

    echo "  Trying ENA: \${ENA_BASE}"

    # Try paired-end first
    PAIRED=false
    if curl -sfI "\${ENA_BASE}/${srr_id}_1.fastq.gz" >/dev/null 2>&1; then
        echo "  Downloading paired-end FASTQ from ENA..."
        curl -sL "\${ENA_BASE}/${srr_id}_1.fastq.gz" -o "${srr_id}_1.fastq.gz" &
        curl -sL "\${ENA_BASE}/${srr_id}_2.fastq.gz" -o "${srr_id}_2.fastq.gz" &
        wait
        PAIRED=true
        echo "  Downloaded paired-end reads"
    elif curl -sfI "\${ENA_BASE}/${srr_id}.fastq.gz" >/dev/null 2>&1; then
        echo "  Downloading single-end FASTQ from ENA..."
        curl -sL "\${ENA_BASE}/${srr_id}.fastq.gz" -o "${srr_id}.fastq.gz"
        echo "  Downloaded single-end reads"
    else
        echo "  ENA download not available. Trying NCBI fasterq-dump..."
        # Fallback: use fasterq-dump if available in the container
        if command -v fasterq-dump >/dev/null 2>&1; then
            SCRATCH="/tmp/sra_scratch_${srr_id}"
            mkdir -p "\$SCRATCH"
            fasterq-dump ${srr_id} \\
                --outdir "\$SCRATCH" \\
                --temp "\$SCRATCH" \\
                --split-3 \\
                --threads ${task.cpus} \\
                --skip-technical
            if command -v pigz >/dev/null 2>&1; then
                pigz -p ${task.cpus} "\$SCRATCH"/*.fastq
            else
                gzip "\$SCRATCH"/*.fastq
            fi
            cp "\$SCRATCH"/*.fastq.gz .
            rm -rf "\$SCRATCH"
        else
            echo "ERROR: Cannot download ${srr_id} — neither ENA nor SRA tools available"
            exit 1
        fi
    fi

    echo "=== Detecting layout ==="
    if [ -f "${srr_id}_1.fastq.gz" ] && [ -f "${srr_id}_2.fastq.gz" ]; then
        LAYOUT="PAIRED"
        echo "  PAIRED-end data"
    else
        LAYOUT="SINGLE"
        echo "  SINGLE-end data"
    fi

    echo "=== Counting reads ==="
    READ_COUNT=\$(zcat *.fastq.gz | wc -l | awk '{print int(\$1/4)}')
    BASE_COUNT=\$(zcat *.fastq.gz | awk 'NR%4==2{sum+=length(\$0)}END{print sum}')

    echo "=== Fetching metadata from NCBI ==="
    ORGANISM="Unknown"
    STUDY_TITLE="SRA Run ${srr_id}"
    PLATFORM="ILLUMINA"

    SRA_XML=\$(curl -sf "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=sra&id=${srr_id}&rettype=xml" 2>/dev/null || echo "")
    if [ -n "\$SRA_XML" ]; then
        ORGANISM=\$(echo "\$SRA_XML" | sed -n 's/.*<ScientificName>\\([^<]*\\)<.*/\\1/p' | head -1)
        STUDY_TITLE=\$(echo "\$SRA_XML" | sed -n 's/.*<STUDY_TITLE>\\([^<]*\\)<.*/\\1/p' | head -1)
        PLATFORM=\$(echo "\$SRA_XML" | sed -n 's/.*<INSTRUMENT_MODEL>\\([^<]*\\)<.*/\\1/p' | head -1)
        [ -z "\$ORGANISM" ] && ORGANISM="Unknown"
        [ -z "\$STUDY_TITLE" ] && STUDY_TITLE="SRA Run ${srr_id}"
        [ -z "\$PLATFORM" ] && PLATFORM="ILLUMINA"
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

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        curl: \$(curl --version 2>&1 | head -1 | awk '{print \$2}')
    VERSIONS

    echo "=== Download complete for ${srr_id} ==="
    echo "  Reads: \$READ_COUNT | Bases: \$BASE_COUNT | Layout: \$LAYOUT"
    echo "  Organism: \$ORGANISM"
    """
}
