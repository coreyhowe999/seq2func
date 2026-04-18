#!/usr/bin/env python3
"""
merge_annotations.py — Merge all annotation sources into unified JSON

Combines protein sequences with annotations from three sources:
  1. CDD domain search (RPS-BLAST)
  2. ProstT5 3Di structural predictions
  3. FoldSeek structural homology search

For each predicted protein, produces a unified annotation object that feeds
the web application's interactive protein results table.

Output schema:
  [
    {
      "protein_id": "TRINITY_DN100_c0_g1_i1.p1",
      "sequence": "MKVLWAALLVTFLAGCQA...",
      "length": 342,
      "orf_type": "complete",
      "transcript_id": "TRINITY_DN100_c0_g1_i1",
      "cdd": { "domains": [...], "sites": [...] },
      "prostt5": { "sequence_3di": "dddddvlvvcccc...", "has_prediction": true },
      "foldseek": { "hits": [...] }
    }
  ]

Author: Corey Howe — 5 Prime Sciences interview project
"""

import argparse
import json
import re
import sys
from pathlib import Path


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
                current_header = line[1:]  # Remove '>' prefix
                current_seq = []
            elif line:
                current_seq.append(line)
        if current_header:
            proteins.append((current_header, "".join(current_seq)))

    return proteins


def extract_orf_type(header: str) -> str:
    """
    Extract ORF type from TransDecoder header.

    TransDecoder headers include the ORF type:
      >TRINITY_DN100_c0_g1_i1.p1 ... type:complete ...
      >TRINITY_DN100_c0_g1_i1.p1 ... type:5prime_partial ...
    """
    match = re.search(r"type:(\w+)", header)
    return match.group(1) if match else "unknown"


def extract_transcript_id(protein_id: str) -> str:
    """
    Extract the parent transcript ID from a protein ID.

    Protein IDs follow the pattern: TRINITY_DN100_c0_g1_i1.p1
    The transcript ID is everything before '.p': TRINITY_DN100_c0_g1_i1
    """
    if ".p" in protein_id:
        return protein_id.rsplit(".p", 1)[0]
    return protein_id


def load_json_safe(path: Path) -> dict:
    """Load a JSON file, returning empty dict if file doesn't exist or is a placeholder."""
    if not path.exists() or path.name.startswith("NO_"):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def load_3di_fasta(path: Path) -> dict[str, str]:
    """Load 3Di FASTA into a dict keyed by protein ID."""
    if not path.exists() or path.name.startswith("NO_"):
        return {}

    result = {}
    try:
        proteins = parse_fasta(path)
        for header, seq in proteins:
            protein_id = header.split()[0]
            result[protein_id] = seq
    except IOError:
        pass
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge all annotation sources into unified JSON"
    )
    parser.add_argument(
        "--proteins", type=Path, required=True, help="Predicted protein FASTA"
    )
    parser.add_argument(
        "--cdd", type=Path, required=True, help="CDD annotations JSON"
    )
    parser.add_argument(
        "--prostt5", type=Path, required=True, help="ProstT5 3Di FASTA"
    )
    parser.add_argument(
        "--foldseek", type=Path, required=True, help="FoldSeek annotations JSON"
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Output unified annotations JSON"
    )
    parser.add_argument(
        "--summary", type=Path, required=True, help="Output summary TSV"
    )
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.summary.parent.mkdir(parents=True, exist_ok=True)

    # Load all data sources
    print("Loading protein sequences...", file=sys.stderr)
    proteins = parse_fasta(args.proteins)
    print(f"  {len(proteins)} proteins loaded", file=sys.stderr)

    print("Loading CDD annotations...", file=sys.stderr)
    cdd_data = load_json_safe(args.cdd)
    print(f"  {len(cdd_data)} proteins with CDD hits", file=sys.stderr)

    print("Loading ProstT5 3Di predictions...", file=sys.stderr)
    prostt5_data = load_3di_fasta(args.prostt5)
    print(f"  {len(prostt5_data)} proteins with 3Di predictions", file=sys.stderr)

    print("Loading FoldSeek annotations...", file=sys.stderr)
    foldseek_data = load_json_safe(args.foldseek)
    print(f"  {len(foldseek_data)} proteins with FoldSeek hits", file=sys.stderr)

    # Merge annotations per protein
    annotations = []
    for header, sequence in proteins:
        protein_id = header.split()[0]
        orf_type = extract_orf_type(header)
        transcript_id = extract_transcript_id(protein_id)

        # Remove stop codon asterisk from sequence if present
        sequence_clean = sequence.rstrip("*")

        # Get CDD domains for this protein
        cdd_entry = cdd_data.get(protein_id, {"domains": [], "sites": []})

        # Get ProstT5 3Di prediction
        prostt5_3di = prostt5_data.get(protein_id, "")

        # Get FoldSeek hits
        foldseek_entry = foldseek_data.get(protein_id, {"hits": []})

        annotation = {
            "protein_id": protein_id,
            "sequence": sequence_clean,
            "length": len(sequence_clean),
            "orf_type": orf_type,
            "transcript_id": transcript_id,
            "cdd": cdd_entry,
            "prostt5": {
                "sequence_3di": prostt5_3di,
                "has_prediction": bool(prostt5_3di),
            },
            "foldseek": foldseek_entry,
        }
        annotations.append(annotation)

    # Sort by length (longest proteins first — most likely to be interesting)
    annotations.sort(key=lambda a: a["length"], reverse=True)

    # Write unified annotations JSON
    with open(args.output, "w") as f:
        json.dump(annotations, f, indent=2)

    # Write summary TSV
    with open(args.summary, "w") as f:
        headers = [
            "protein_id",
            "length",
            "orf_type",
            "num_domains",
            "top_domain",
            "top_foldseek_hit",
            "top_foldseek_evalue",
        ]
        f.write("\t".join(headers) + "\n")

        for ann in annotations:
            domains = ann["cdd"].get("domains", [])
            foldseek_hits = ann["foldseek"].get("hits", [])

            top_domain = domains[0]["name"] if domains else "None"
            top_fs_hit = foldseek_hits[0]["target_name"] if foldseek_hits else "None"
            top_fs_eval = (
                f"{foldseek_hits[0]['evalue']:.2e}" if foldseek_hits else "N/A"
            )

            row = [
                ann["protein_id"],
                str(ann["length"]),
                ann["orf_type"],
                str(len(domains)),
                top_domain,
                top_fs_hit,
                top_fs_eval,
            ]
            f.write("\t".join(row) + "\n")

    print(
        f"Merged annotations for {len(annotations)} proteins → {args.output}",
        file=sys.stderr,
    )
    print(f"Summary table → {args.summary}", file=sys.stderr)


if __name__ == "__main__":
    main()
