/*
 * =============================================================================
 * TransDecoder Module — ORF Prediction
 * =============================================================================
 *
 * TransDecoder identifies candidate protein-coding regions within transcript
 * sequences.  It's the standard tool for predicting ORFs in de novo assembled
 * transcriptomes (where no reference genome annotation exists).
 *
 * The prediction happens in two phases:
 *
 * Phase 1 — LongOrfs:
 *   Scans all six reading frames (3 forward + 3 reverse complement) for
 *   open reading frames longer than --min_orf_len amino acids.  This is a
 *   simple length-based filter that generates candidate ORFs.
 *
 * Phase 2 — Predict:
 *   Applies a log-likelihood scoring model to distinguish true protein-coding
 *   ORFs from random open reading frames.  The model is trained on the longest
 *   ORFs from Phase 1 (assumed to be enriched for real proteins) and uses:
 *     - Hexamer frequency bias (codon usage patterns)
 *     - GC content at the third codon position (wobble position)
 *     - ORF length distribution
 *
 * ORF Types in output:
 *   - complete: Has both start (M) and stop codon — full-length protein
 *   - 5prime_partial: Missing start codon — N-terminal truncation
 *   - 3prime_partial: Missing stop codon — C-terminal truncation
 *   - internal: Missing both start and stop — fragment
 *
 * Author: Corey Howe
 * =============================================================================
 */

process TRANSDECODER_LONGORFS {
    tag "${meta.id}"
    container 'ghcr.io/transdecoderse/transdecoder:5.7.1'

    input:
    tuple val(meta), path(assembly)     // Trinity.fasta — assembled transcripts

    output:
    tuple val(meta), path("longest_orfs.pep"),   emit: orfs       // All candidate ORFs (FASTA)
    tuple val(meta), path("transdecoder_dir/"),   emit: td_dir     // TransDecoder working directory
    path("versions.yml"),                         emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Phase 1: Identify the longest ORFs in each reading frame.
    # -t: input transcript FASTA
    # -m: minimum ORF length in amino acids (default 100)
    #
    # Output goes to a directory named {input}.transdecoder_dir/
    # containing longest_orfs.pep (FASTA of all candidate ORFs)
    TransDecoder.LongOrfs \\
        -t ${assembly} \\
        -m ${params.min_orf_len}

    # Copy outputs to clean names for downstream consumption.
    # The original output directory has a long name tied to the input filename.
    cp ${assembly}.transdecoder_dir/longest_orfs.pep .
    cp -r ${assembly}.transdecoder_dir transdecoder_dir

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        transdecoder: \$(TransDecoder.LongOrfs --version 2>&1 | head -n1 | sed 's/TransDecoder.LongOrfs //')
    VERSIONS
    """
}


process TRANSDECODER_PREDICT {
    tag "${meta.id}"
    container 'ghcr.io/transdecoderse/transdecoder:5.7.1'

    publishDir "${params.outdir}/${params.run_id}/transdecoder", mode: 'copy'

    input:
    tuple val(meta), path(assembly)     // Trinity.fasta (needed for coordinate reference)
    tuple val(meta), path(td_dir)       // TransDecoder working directory from LongOrfs

    output:
    tuple val(meta), path("predicted_proteins.pep"), emit: proteins   // Final predicted proteins
    tuple val(meta), path("*.transdecoder.bed"),     emit: bed        // BED coordinates
    tuple val(meta), path("*.transdecoder.gff3"),    emit: gff        // GFF3 annotation
    path("versions.yml"),                            emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Restore the TransDecoder directory with the expected name.
    # TransDecoder.Predict looks for {input}.transdecoder_dir/ based on the
    # input filename, so we create a symlink with the correct name.
    ln -s ${td_dir} ${assembly}.transdecoder_dir

    # Phase 2: Predict coding regions using the log-likelihood model.
    # --single_best_only: Report only the single best ORF per transcript
    #   (prevents multiple overlapping ORF predictions from the same transcript)
    TransDecoder.Predict \\
        -t ${assembly} \\
        --single_best_only

    # Cap the number of proteins for demo speed.
    # We take the top N proteins by sequence length (longer proteins are
    # more likely to be biologically interesting and have domain annotations).
    python3 -c "
import sys

proteins = []
current_header = ''
current_seq = []

with open('${assembly}.transdecoder.pep') as f:
    for line in f:
        line = line.strip()
        if line.startswith('>'):
            if current_header:
                proteins.append((current_header, ''.join(current_seq)))
            current_header = line
            current_seq = []
        else:
            current_seq.append(line)
    if current_header:
        proteins.append((current_header, ''.join(current_seq)))

# Sort by length (longest first) and take top N
proteins.sort(key=lambda x: len(x[1]), reverse=True)
proteins = proteins[:${params.max_proteins}]

with open('predicted_proteins.pep', 'w') as out:
    for header, seq in proteins:
        out.write(header + '\\n')
        # Write sequence in 60-character lines (standard FASTA format)
        for i in range(0, len(seq), 60):
            out.write(seq[i:i+60] + '\\n')

print(f'Capped proteins: {len(proteins)} (from total ORFs)', file=sys.stderr)
"

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        transdecoder: \$(TransDecoder.Predict --version 2>&1 | head -n1 | sed 's/TransDecoder.Predict //')
    VERSIONS
    """
}
