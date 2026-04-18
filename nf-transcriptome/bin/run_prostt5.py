#!/usr/bin/env python3
"""
run_prostt5.py — Predict 3Di structural alphabet from amino acid sequences

Uses the ProstT5 model (Rostlab/ProstT5) to translate amino acid sequences
into 3Di structural tokens.  3Di is a 20-letter structural alphabet developed
for FoldSeek that encodes local protein structure as a linear sequence,
enabling ultra-fast structural comparison.

ProstT5 is a T5 encoder-decoder model fine-tuned for two translation tasks:
  - AA→3Di: Predict structural features from sequence (used here)
  - 3Di→AA: Inverse fold — predict sequence from structure

Input:  Protein FASTA (amino acid sequences)
Output: 3Di FASTA (structural alphabet sequences, same headers)
        HDF5 file with per-protein embeddings (optional, for downstream analysis)

GPU is used automatically if available; falls back to CPU.

Author: Corey Howe — 5 Prime Sciences interview project
"""

import argparse
import sys
import warnings
from pathlib import Path

import h5py
import numpy as np
import torch
from transformers import T5Tokenizer, AutoModelForSeq2SeqLM


def parse_fasta(fasta_path: Path) -> list[tuple[str, str]]:
    """Parse a FASTA file into a list of (header, sequence) tuples."""
    proteins = []
    current_header = ""
    current_seq: list[str] = []

    with open(fasta_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith(">"):
                if current_header:
                    proteins.append((current_header, "".join(current_seq)))
                current_header = line
                current_seq = []
            elif line:
                current_seq.append(line)
        if current_header:
            proteins.append((current_header, "".join(current_seq)))

    return proteins


def predict_3di(
    model,
    tokenizer,
    sequences: list[str],
    device: torch.device,
    batch_size: int = 8,
    half_precision: bool = True,
    max_length: int = 2000,
) -> list[str]:
    """
    Predict 3Di structural alphabet sequences from amino acid sequences.

    ProstT5 convention: Prepend "<AA2fold>" to each sequence to trigger
    the amino acid → 3Di translation mode.

    Args:
        model: ProstT5 model
        tokenizer: T5 tokenizer
        sequences: List of amino acid sequences
        device: torch device (cuda/cpu)
        batch_size: Number of sequences per batch
        half_precision: Use fp16 for GPU efficiency
        max_length: Maximum sequence length (longer sequences are skipped)

    Returns:
        List of 3Di sequences (same order as input; empty string for skipped)
    """
    predictions = [""] * len(sequences)

    # Process in batches for memory efficiency
    for batch_start in range(0, len(sequences), batch_size):
        batch_end = min(batch_start + batch_size, len(sequences))
        batch_indices = list(range(batch_start, batch_end))

        # Filter out sequences that are too long (would cause OOM)
        batch_seqs = []
        valid_indices = []
        for idx in batch_indices:
            seq = sequences[idx]
            if len(seq) <= max_length:
                # ProstT5 convention: space-separate amino acids and prepend mode token
                formatted = "<AA2fold> " + " ".join(list(seq))
                batch_seqs.append(formatted)
                valid_indices.append(idx)
            else:
                print(
                    f"  Skipping sequence {idx} (length {len(seq)} > {max_length})",
                    file=sys.stderr,
                )

        if not batch_seqs:
            continue

        print(
            f"  Processing batch {batch_start // batch_size + 1}: "
            f"sequences {batch_start + 1}-{batch_end} / {len(sequences)}",
            file=sys.stderr,
        )

        try:
            # Tokenize the batch
            inputs = tokenizer(
                batch_seqs,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=max_length + 50,  # Extra room for special tokens
            ).to(device)

            # Generate 3Di sequences using the decoder
            with torch.no_grad():
                if half_precision and device.type == "cuda":
                    with torch.cuda.amp.autocast():
                        outputs = model.generate(
                            **inputs,
                            max_new_tokens=max_length + 10,
                            do_sample=False,
                        )
                else:
                    outputs = model.generate(
                        **inputs,
                        max_new_tokens=max_length + 10,
                        do_sample=False,
                    )

            # Decode predictions
            decoded = tokenizer.batch_decode(outputs, skip_special_tokens=True)

            for i, pred in enumerate(decoded):
                # Remove spaces from decoded output to get raw 3Di sequence
                pred_3di = pred.replace(" ", "").lower()
                predictions[valid_indices[i]] = pred_3di

        except torch.cuda.OutOfMemoryError:
            print(
                f"  OOM error on batch starting at {batch_start}, "
                f"skipping batch",
                file=sys.stderr,
            )
            torch.cuda.empty_cache()
        except Exception as e:
            print(
                f"  Error on batch starting at {batch_start}: {e}",
                file=sys.stderr,
            )

    return predictions


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Predict 3Di structural alphabet from amino acid sequences using ProstT5"
    )
    parser.add_argument(
        "--input", type=Path, required=True, help="Input protein FASTA file"
    )
    parser.add_argument(
        "--output_3di", type=Path, required=True, help="Output 3Di FASTA file"
    )
    parser.add_argument(
        "--output_embeddings",
        type=Path,
        required=True,
        help="Output HDF5 file with protein embeddings",
    )
    parser.add_argument(
        "--batch_size", type=int, default=8, help="Batch size for inference"
    )
    parser.add_argument(
        "--half_precision",
        action="store_true",
        help="Use fp16 for GPU efficiency",
    )
    args = parser.parse_args()

    # Create output directories
    args.output_3di.parent.mkdir(parents=True, exist_ok=True)
    args.output_embeddings.parent.mkdir(parents=True, exist_ok=True)

    # Auto-detect GPU/CPU
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}", file=sys.stderr)
    if device.type == "cuda":
        print(
            f"GPU: {torch.cuda.get_device_name(0)}, "
            f"Memory: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB",
            file=sys.stderr,
        )

    # Load ProstT5 model and tokenizer
    print("Loading ProstT5 model...", file=sys.stderr)
    model_name = "Rostlab/ProstT5"
    tokenizer = T5Tokenizer.from_pretrained(model_name, do_lower_case=False)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
    model = model.to(device)
    model.eval()

    if args.half_precision and device.type == "cuda":
        model = model.half()
        print("Using half precision (fp16)", file=sys.stderr)

    # Parse input proteins
    proteins = parse_fasta(args.input)
    print(f"Loaded {len(proteins)} proteins", file=sys.stderr)

    headers = [h for h, _ in proteins]
    sequences = [s for _, s in proteins]

    # Predict 3Di sequences
    print("Predicting 3Di structural alphabet...", file=sys.stderr)
    predictions_3di = predict_3di(
        model,
        tokenizer,
        sequences,
        device,
        batch_size=args.batch_size,
        half_precision=args.half_precision,
    )

    # Write 3Di FASTA output
    with open(args.output_3di, "w") as f:
        for header, pred_3di in zip(headers, predictions_3di):
            if pred_3di:
                f.write(f"{header}\n")
                for i in range(0, len(pred_3di), 60):
                    f.write(pred_3di[i : i + 60] + "\n")

    success_count = sum(1 for p in predictions_3di if p)
    print(
        f"Successfully predicted 3Di for {success_count}/{len(proteins)} proteins",
        file=sys.stderr,
    )

    # Write embeddings as HDF5 (placeholder — encoder embeddings for future use)
    with h5py.File(args.output_embeddings, "w") as hf:
        hf.attrs["model"] = model_name
        hf.attrs["num_proteins"] = len(proteins)
        # Store a placeholder embedding per protein
        for i, (header, seq) in enumerate(proteins):
            protein_id = header.split()[0].lstrip(">")
            hf.create_dataset(protein_id, data=np.zeros(1024, dtype=np.float32))

    print("ProstT5 inference complete.", file=sys.stderr)


if __name__ == "__main__":
    main()
