#!/usr/bin/env python3
"""
generate_test_data.py — Generate synthetic paired-end FASTQ files for testing

Creates small paired-end FASTQ files (~10,000 reads, 150bp) with realistic
quality scores for offline pipeline development and testing.

The generated reads simulate Illumina paired-end RNA-seq from a small
set of synthetic transcript sequences.

Usage:
  python scripts/generate_test_data.py --output_dir data/test --num_reads 10000

Then run the pipeline with local reads:
  nextflow run main.nf --reads 'data/test/*_{1,2}.fastq.gz' -profile test

Author: Corey Howe — 5 Prime Sciences interview project
"""

import argparse
import gzip
import random
import string
import sys
from pathlib import Path


def generate_quality_string(length: int) -> str:
    """Generate a realistic Illumina quality string (Phred+33 encoding).

    Quality scores follow a typical Illumina pattern:
    - First ~10 bases: high quality (30-40)
    - Middle: mostly high quality with occasional drops
    - Last ~20 bases: gradual quality decline
    """
    qualities = []
    for i in range(length):
        if i < 10:
            q = random.randint(30, 40)
        elif i > length - 20:
            q = random.randint(15, 35)
        else:
            q = random.choices(
                [random.randint(30, 40), random.randint(10, 25)],
                weights=[0.95, 0.05],
            )[0]
        qualities.append(chr(q + 33))
    return "".join(qualities)


def generate_transcript(min_len: int = 300, max_len: int = 2000) -> str:
    """Generate a random transcript sequence with realistic GC content (~45%)."""
    length = random.randint(min_len, max_len)
    bases = random.choices("ACGT", weights=[0.275, 0.225, 0.225, 0.275], k=length)
    return "".join(bases)


def reverse_complement(seq: str) -> str:
    """Return the reverse complement of a DNA sequence."""
    complement = {"A": "T", "T": "A", "G": "C", "C": "G", "N": "N"}
    return "".join(complement.get(b, "N") for b in reversed(seq))


def simulate_reads(
    transcripts: list[str],
    num_reads: int,
    read_length: int = 150,
    fragment_mean: int = 300,
    fragment_sd: int = 50,
) -> list[tuple[str, str, str, str, str, str, str, str]]:
    """
    Simulate paired-end reads from transcript sequences.

    Each read pair comes from a random transcript at a random position.
    The fragment size follows a normal distribution.

    Returns list of tuples:
        (header1, seq1, qual1, header2, seq2, qual2)
    """
    reads = []
    for i in range(num_reads):
        # Pick a random transcript
        transcript = random.choice(transcripts)

        # Generate fragment size
        frag_size = max(read_length * 2, int(random.gauss(fragment_mean, fragment_sd)))

        # Pick a random start position
        if len(transcript) < frag_size:
            start = 0
            frag_size = len(transcript)
        else:
            start = random.randint(0, len(transcript) - frag_size)

        # Extract fragment
        fragment = transcript[start : start + frag_size]

        # Read 1: forward strand, first read_length bases
        seq1 = fragment[:read_length]
        # Read 2: reverse complement of last read_length bases
        seq2 = reverse_complement(fragment[-read_length:])

        # Add sequencing errors (~0.1% error rate)
        seq1 = introduce_errors(seq1, error_rate=0.001)
        seq2 = introduce_errors(seq2, error_rate=0.001)

        # Generate quality strings
        qual1 = generate_quality_string(len(seq1))
        qual2 = generate_quality_string(len(seq2))

        # FASTQ headers
        header1 = f"@SIMULATED:{i + 1}/1"
        header2 = f"@SIMULATED:{i + 1}/2"

        reads.append((header1, seq1, qual1, header2, seq2, qual2))

    return reads


def introduce_errors(seq: str, error_rate: float = 0.001) -> str:
    """Introduce random sequencing errors at the given rate."""
    seq_list = list(seq)
    for i in range(len(seq_list)):
        if random.random() < error_rate:
            bases = [b for b in "ACGT" if b != seq_list[i]]
            seq_list[i] = random.choice(bases)
    return "".join(seq_list)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate synthetic paired-end FASTQ files for testing"
    )
    parser.add_argument(
        "--output_dir",
        type=Path,
        default=Path("data/test"),
        help="Output directory for FASTQ files",
    )
    parser.add_argument(
        "--sample_name",
        type=str,
        default="test",
        help="Sample name prefix for output files",
    )
    parser.add_argument(
        "--num_reads",
        type=int,
        default=10000,
        help="Number of read pairs to generate",
    )
    parser.add_argument(
        "--num_transcripts",
        type=int,
        default=50,
        help="Number of synthetic transcripts to generate",
    )
    parser.add_argument(
        "--read_length",
        type=int,
        default=150,
        help="Read length in bases",
    )
    parser.add_argument(
        "--seed", type=int, default=42, help="Random seed for reproducibility"
    )
    args = parser.parse_args()

    random.seed(args.seed)

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Generate synthetic transcripts
    print(f"Generating {args.num_transcripts} synthetic transcripts...", file=sys.stderr)
    transcripts = [generate_transcript() for _ in range(args.num_transcripts)]
    total_bases = sum(len(t) for t in transcripts)
    print(
        f"  Total transcript bases: {total_bases:,}",
        file=sys.stderr,
    )

    # Simulate paired-end reads
    print(f"Simulating {args.num_reads:,} read pairs...", file=sys.stderr)
    reads = simulate_reads(
        transcripts,
        num_reads=args.num_reads,
        read_length=args.read_length,
    )

    # Write compressed FASTQ files
    r1_path = args.output_dir / f"{args.sample_name}_1.fastq.gz"
    r2_path = args.output_dir / f"{args.sample_name}_2.fastq.gz"

    print(f"Writing {r1_path}...", file=sys.stderr)
    with gzip.open(r1_path, "wt") as f1:
        for header1, seq1, qual1, _, _, _ in reads:
            f1.write(f"{header1}\n{seq1}\n+\n{qual1}\n")

    print(f"Writing {r2_path}...", file=sys.stderr)
    with gzip.open(r2_path, "wt") as f2:
        for _, _, _, header2, seq2, qual2 in reads:
            f2.write(f"{header2}\n{seq2}\n+\n{qual2}\n")

    print(
        f"\nGenerated test data:\n"
        f"  R1: {r1_path}\n"
        f"  R2: {r2_path}\n"
        f"  Reads: {args.num_reads:,} pairs\n"
        f"  Read length: {args.read_length} bp\n",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
