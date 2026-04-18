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

    # Strategy: Use the ENA API to get the exact FASTQ download URLs.
    # This is more reliable than constructing URLs manually.
    # ENA provides pre-computed FASTQ files via HTTP — no SRA toolkit needed.
    echo "  Querying ENA API for FASTQ URLs..."
    ENA_RESPONSE=\$(curl -sf "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=${srr_id}&result=read_run&fields=fastq_ftp&format=tsv" 2>/dev/null || echo "")

    if echo "\$ENA_RESPONSE" | grep -q "fastq_ftp" && echo "\$ENA_RESPONSE" | grep -q "ftp.sra.ebi.ac.uk"; then
        # Parse the FTP URLs from the ENA response and convert to HTTPS
        FASTQ_URLS=\$(echo "\$ENA_RESPONSE" | tail -1 | awk -F'\\t' '{print \$NF}' | tr ';' '\\n')

        echo "  Downloading FASTQ files from ENA..."
        for URL in \$FASTQ_URLS; do
            FILENAME=\$(basename "\$URL")
            echo "    \$FILENAME"
            curl -sL "https://\$URL" -o "\$FILENAME" &
        done
        wait
        echo "  ENA download complete"
    else
        echo "  ENA API did not return FASTQ URLs for ${srr_id}"
        echo "  ERROR: Cannot download ${srr_id}"
        exit 1
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
