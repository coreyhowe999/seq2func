#!/usr/bin/env python3
"""
Tests for the pipeline's Python parsing scripts.

Run: pytest tests/test_parse_scripts.py -v
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest

# Add bin/ to path so we can import the scripts
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))

from parse_rpsblast import parse_rpsblast_output
from parse_foldseek import parse_foldseek_output
from merge_annotations import parse_fasta, extract_orf_type, extract_transcript_id, load_json_safe


# ── parse_rpsblast tests ──────────────────────────────────────────────────

class TestParseRpsblast:
    def test_empty_file(self, tmp_path):
        empty = tmp_path / "empty.out"
        empty.write_text("")
        result = parse_rpsblast_output(empty)
        assert result == {}

    def test_missing_file(self, tmp_path):
        result = parse_rpsblast_output(tmp_path / "nonexistent.out")
        assert result == {}

    def test_single_hit(self, tmp_path):
        tsv = tmp_path / "blast.out"
        tsv.write_text(
            "PROTEIN_001\tgnl|CDD|12345\t85.5\t200\t10\t2\t15\t215\t1\t200\t1.2e-45\t165.3\tPkinase, Protein kinase domain\n"
        )
        result = parse_rpsblast_output(tsv)
        assert "PROTEIN_001" in result
        assert len(result["PROTEIN_001"]["domains"]) == 1
        d = result["PROTEIN_001"]["domains"][0]
        assert d["accession"] == "12345"
        assert d["name"] == "Pkinase"
        assert d["evalue"] == 1.2e-45
        assert d["from"] == 15
        assert d["to"] == 215

    def test_multiple_proteins(self, tmp_path):
        tsv = tmp_path / "blast.out"
        tsv.write_text(
            "PROT_A\tacc1\t90\t100\t5\t0\t10\t110\t1\t100\t1e-20\t80\tDomainA\n"
            "PROT_A\tacc2\t85\t50\t3\t0\t120\t170\t1\t50\t1e-10\t45\tDomainB\n"
            "PROT_B\tacc3\t70\t80\t8\t1\t5\t85\t1\t80\t1e-5\t30\tDomainC\n"
        )
        result = parse_rpsblast_output(tsv)
        assert len(result) == 2
        assert len(result["PROT_A"]["domains"]) == 2
        assert len(result["PROT_B"]["domains"]) == 1
        # Domains should be sorted by start position
        assert result["PROT_A"]["domains"][0]["from"] == 10
        assert result["PROT_A"]["domains"][1]["from"] == 120

    def test_comment_lines_skipped(self, tmp_path):
        tsv = tmp_path / "blast.out"
        tsv.write_text(
            "# RPS-BLAST output\n"
            "PROT_A\tacc1\t90\t100\t5\t0\t10\t110\t1\t100\t1e-20\t80\tDomainA\n"
        )
        result = parse_rpsblast_output(tsv)
        assert len(result) == 1


# ── parse_foldseek tests ─────────────────────────────────────────────────

class TestParseFoldseek:
    def test_empty_file(self, tmp_path):
        empty = tmp_path / "empty.tsv"
        empty.write_text("")
        result = parse_foldseek_output(empty)
        assert result == {}

    def test_top_n_filtering(self, tmp_path):
        # Create 10 hits for one protein
        lines = []
        for i in range(10):
            lines.append(f"PROT_A\tPDB_{i}\t0.{90-i}\t100\t5\t0\t1\t100\t1\t100\t{i+1}e-{20-i}\t50\t\tHomo sapiens\tTarget {i}\n")
        tsv = tmp_path / "fs.tsv"
        tsv.write_text("".join(lines))
        result = parse_foldseek_output(tsv, top_n=3)
        assert "PROT_A" in result
        assert len(result["PROT_A"]["hits"]) == 3


# ── merge_annotations helper tests ──────────────────────────────────────

class TestMergeHelpers:
    def test_parse_fasta(self, tmp_path):
        fasta = tmp_path / "test.fasta"
        fasta.write_text(">protein1 type:complete\nMKVLWAALLV\nTFLAGCQA\n>protein2 type:5prime_partial\nMSTQRTPVV\n")
        result = parse_fasta(fasta)
        assert len(result) == 2
        assert result[0] == ("protein1 type:complete", "MKVLWAALLVTFLAGCQA")
        assert result[1] == ("protein2 type:5prime_partial", "MSTQRTPVV")

    def test_extract_orf_type(self):
        assert extract_orf_type("PROT.p1 gene:X type:complete len:342") == "complete"
        assert extract_orf_type("PROT.p1 type:5prime_partial") == "5prime_partial"
        assert extract_orf_type("PROT.p1 no_type_here") == "unknown"

    def test_extract_transcript_id(self):
        assert extract_transcript_id("TRINITY_DN100_c0_g1_i1.p1") == "TRINITY_DN100_c0_g1_i1"
        assert extract_transcript_id("TRINITY_DN200_c0_g1_i1.p2") == "TRINITY_DN200_c0_g1_i1"
        assert extract_transcript_id("no_dot_p") == "no_dot_p"

    def test_load_json_safe_missing(self, tmp_path):
        assert load_json_safe(tmp_path / "nope.json") == {}

    def test_load_json_safe_placeholder(self, tmp_path):
        f = tmp_path / "NO_PROSTT5"
        f.write_text("")
        assert load_json_safe(f) == {}

    def test_load_json_safe_valid(self, tmp_path):
        f = tmp_path / "data.json"
        f.write_text('{"key": "value"}')
        assert load_json_safe(f) == {"key": "value"}
