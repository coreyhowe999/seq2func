/*
 * =============================================================================
 * ProstT5 Module — Structural Alphabet (3Di) Prediction
 * =============================================================================
 *
 * ProstT5 is a protein language model from the Rostlab that translates amino
 * acid sequences into 3Di structural alphabet tokens.
 *
 * What is the 3Di alphabet?
 *   The 3Di (3D interaction) alphabet is a 20-letter code developed for
 *   FoldSeek that encodes local structural features of proteins.  Each letter
 *   describes the geometric arrangement of backbone atoms and interactions
 *   at a residue position — encoding secondary structure, backbone angles,
 *   and local tertiary contacts in a single character.
 *
 *   Key insight: Just as DNA uses {A, T, G, C} and proteins use the 20 amino
 *   acids, 3Di provides a 20-letter "structural alphabet" that describes
 *   protein structure as a linear sequence.  This enables ultra-fast structural
 *   comparison using sequence alignment algorithms (like BLAST, but for
 *   structure instead of sequence).
 *
 * How ProstT5 works:
 *   ProstT5 is a T5 encoder-decoder model fine-tuned in two modes:
 *     - AA→3Di translation: Predicts 3Di tokens from amino acid sequence
 *       (input prefix: "<AA2fold>")
 *     - 3Di→AA translation: Predicts amino acids from 3Di tokens
 *       (input prefix: "<fold2AA>")
 *
 *   We use the AA→3Di mode to predict structural features directly from
 *   sequence, without needing a 3D structure (which would require AlphaFold).
 *
 * GPU vs CPU:
 *   ProstT5 benefits significantly from GPU (10-100x speedup), but falls
 *   back to CPU mode automatically.  The Python script detects the device.
 *
 * Author: Corey Howe
 * =============================================================================
 */

process PROSTT5_PREDICT {
    tag "${meta.id}"

    /*
     * Custom container with PyTorch, HuggingFace transformers, and ProstT5
     * model weights cached.  The Dockerfile pre-downloads the model to avoid
     * downloading 2+ GB during pipeline execution.
     */
    container 'nf-transcriptome-prostt5:latest'

    /*
     * label 'process_gpu': This label is used in nextflow.config to assign
     * GPU resources when running with the 'gpu' profile.  Without a GPU
     * profile, the process runs on CPU (slower but functional).
     */
    label 'process_gpu'

    memory '16 GB'
    cpus 2
    time '2h'

    publishDir "${params.outdir}/${params.run_id}/prostt5", mode: 'copy'

    input:
    tuple val(meta), path(proteins)     // Predicted protein FASTA

    output:
    tuple val(meta), path("prostt5_3di.fasta"),       emit: structures_3di   // 3Di structural alphabet FASTA
    tuple val(meta), path("prostt5_embeddings.h5"),   emit: embeddings       // Protein embeddings (HDF5)
    path("versions.yml"),                             emit: versions

    script:
    """
    #!/bin/bash
    set -euo pipefail

    # Run ProstT5 inference.
    # The Python script handles:
    #   - Auto-detecting GPU/CPU
    #   - Batched processing for efficiency
    #   - Half-precision (fp16) for GPU memory efficiency
    #   - Graceful OOM handling (skips sequences that are too long)
    run_prostt5.py \\
        --input ${proteins} \\
        --output_3di prostt5_3di.fasta \\
        --output_embeddings prostt5_embeddings.h5 \\
        --batch_size 8 \\
        --half_precision

    cat <<-VERSIONS > versions.yml
    "${task.process}":
        prostt5: "1.0"
        pytorch: \$(python3 -c "import torch; print(torch.__version__)")
        transformers: \$(python3 -c "import transformers; print(transformers.__version__)")
    VERSIONS
    """
}
