/*
 * =============================================================================
 * ProstT5 Module — Structural Alphabet (3Di) Prediction
 * =============================================================================
 *
 * Uses ProstT5 (Rostlab) to translate amino acid sequences into 3Di
 * structural alphabet tokens for FoldSeek structural search.
 *
 * GPU is used automatically if available; falls back to CPU.
 *
 * Container: Build from containers/Dockerfile.prostt5 or use szimmerman92/prostt5
 *
 * Author: Corey Howe
 * =============================================================================
 */

process PROSTT5_PREDICT {
    tag "${meta.id}"
    container 'nf-transcriptome-prostt5:latest'
    label 'process_gpu'
    memory '16 GB'
    cpus 2
    time '2h'

    publishDir "${params.outdir}/${params.run_id}/prostt5", mode: 'copy'

    input:
    tuple val(meta), path(proteins)

    output:
    tuple val(meta), path("prostt5_3di.fasta"),          emit: structures_3di
    tuple val(meta), path("prostt5_embeddings.json"),   emit: embeddings
    path("versions.yml"),                               emit: versions

    script:
    """
    #!/usr/bin/env python3
    import sys, os, warnings
    warnings.filterwarnings("ignore")

    # Auto-detect GPU/CPU
    import torch
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}", file=sys.stderr)

    from transformers import T5Tokenizer, AutoModelForSeq2SeqLM

    # Parse input FASTA
    proteins = []
    header, seq = "", []
    with open("${proteins}") as f:
        for line in f:
            line = line.strip()
            if line.startswith(">"):
                if header:
                    proteins.append((header, "".join(seq)))
                header = line
                seq = []
            elif line:
                seq.append(line)
        if header:
            proteins.append((header, "".join(seq)))

    print(f"Loaded {len(proteins)} proteins", file=sys.stderr)

    # Load ProstT5 model
    print("Loading ProstT5 model...", file=sys.stderr)
    model_name = "Rostlab/ProstT5"
    tokenizer = T5Tokenizer.from_pretrained(model_name, do_lower_case=False)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name).to(device).eval()

    if device.type == "cuda":
        model = model.half()

    # Predict 3Di sequences
    predictions = []
    batch_size = 8
    max_length = 2000

    for batch_start in range(0, len(proteins), batch_size):
        batch_end = min(batch_start + batch_size, len(proteins))
        batch_seqs = []
        batch_indices = []

        for idx in range(batch_start, batch_end):
            _, aa_seq = proteins[idx]
            if len(aa_seq) <= max_length:
                formatted = "<AA2fold> " + " ".join(list(aa_seq))
                batch_seqs.append(formatted)
                batch_indices.append(idx)
            else:
                print(f"  Skipping seq {idx} (len {len(aa_seq)} > {max_length})", file=sys.stderr)

        if not batch_seqs:
            continue

        print(f"  Batch {batch_start // batch_size + 1}: sequences {batch_start+1}-{batch_end}", file=sys.stderr)

        try:
            inputs = tokenizer(batch_seqs, return_tensors="pt", padding=True, truncation=True, max_length=max_length + 50).to(device)
            with torch.no_grad():
                outputs = model.generate(**inputs, max_new_tokens=max_length + 10, do_sample=False)
            decoded = tokenizer.batch_decode(outputs, skip_special_tokens=True)
            for i, pred in enumerate(decoded):
                predictions.append((batch_indices[i], pred.replace(" ", "").lower()))
        except torch.cuda.OutOfMemoryError:
            print(f"  OOM at batch {batch_start}, skipping", file=sys.stderr)
            torch.cuda.empty_cache()
        except Exception as e:
            print(f"  Error at batch {batch_start}: {e}", file=sys.stderr)

    # Build lookup
    pred_map = {idx: pred for idx, pred in predictions}

    # Write 3Di FASTA
    with open("prostt5_3di.fasta", "w") as f:
        for idx, (header, _) in enumerate(proteins):
            pred = pred_map.get(idx, "")
            if pred:
                f.write(f"{header}\\n")
                for i in range(0, len(pred), 60):
                    f.write(pred[i:i+60] + "\\n")

    # Write placeholder embeddings metadata (h5py not required)
    import json
    with open("prostt5_embeddings.json", "w") as f:
        json.dump({"model": model_name, "num_proteins": len(proteins), "predicted": success}, f)

    success = len(pred_map)
    print(f"Predicted 3Di for {success}/{len(proteins)} proteins", file=sys.stderr)

    # Write versions
    import transformers
    with open("versions.yml", "w") as f:
        f.write(f'"${task.process}":\\n')
        f.write(f'  prostt5: "1.0"\\n')
        f.write(f'  pytorch: "{torch.__version__}"\\n')
        f.write(f'  transformers: "{transformers.__version__}"\\n')
    """
}
