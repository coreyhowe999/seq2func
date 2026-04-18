"""
Unit tests for GWAS QC module.

Tests palindromic SNP detection, MAF / INFO filtering, lambda GC
calculation, and the full QC pipeline.

Run:  pytest tests/test_gwas_qc.py -v
"""

import numpy as np
import polars as pl
import pytest

# Allow importing from bin/
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bin"))

from gwas_qc import (
    filter_maf,
    filter_info,
    filter_palindromic,
    filter_extreme_beta,
    remove_duplicates,
    compute_lambda_gc,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_df() -> pl.DataFrame:
    """A small DataFrame with known properties for testing."""
    return pl.DataFrame({
        "SNP":  ["rs1", "rs2", "rs3", "rs4", "rs5", "rs6"],
        "CHR":  [1,     1,     1,     1,     1,     1],
        "BP":   [100,   200,   300,   400,   500,   600],
        "A1":   ["A",   "C",   "A",   "G",   "A",   "C"],
        "A2":   ["G",   "T",   "T",   "C",   "C",   "A"],
        # rs3 is palindromic (A/T), rs4 is palindromic (G/C)
        "FREQ": [0.25,  0.10,  0.50,  0.005, 0.30,  0.995],
        # rs4 has MAF < 0.01, rs6 has MAF = 0.005 (1-0.995)
        "BETA": [0.05,  -0.03, 0.01,  15.0,  0.08,  0.02],
        # rs4 has |BETA| > 10
        "SE":   [0.01,  0.02,  0.01,  2.0,   0.01,  0.01],
        "P":    [1e-6,  0.05,  0.3,   1e-10, 1e-8,  0.01],
        "N":    [50000, 50000, 50000, 50000, 50000, 50000],
        "INFO": [0.95,  0.70,  0.99,  0.85,  0.92,  0.88],
        # rs2 has INFO < 0.8
    })


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPalindromicFilter:
    def test_removes_at_pair(self, sample_df: pl.DataFrame):
        """rs3 (A/T) should be removed as palindromic."""
        result = filter_palindromic(sample_df.lazy()).collect()
        assert "rs3" not in result["SNP"].to_list()

    def test_removes_gc_pair(self, sample_df: pl.DataFrame):
        """rs4 (G/C) should be removed as palindromic."""
        result = filter_palindromic(sample_df.lazy()).collect()
        assert "rs4" not in result["SNP"].to_list()

    def test_keeps_non_palindromic(self, sample_df: pl.DataFrame):
        """rs1 (A/G), rs2 (C/T) should be kept."""
        result = filter_palindromic(sample_df.lazy()).collect()
        kept = result["SNP"].to_list()
        assert "rs1" in kept
        assert "rs2" in kept

    def test_correct_count(self, sample_df: pl.DataFrame):
        """Should remove exactly 2 palindromic SNPs."""
        result = filter_palindromic(sample_df.lazy()).collect()
        assert len(result) == 4


class TestMAFFilter:
    def test_removes_low_maf(self, sample_df: pl.DataFrame):
        """rs4 (FREQ=0.005) should be removed at MAF threshold 0.01."""
        result = filter_maf(sample_df.lazy(), 0.01).collect()
        assert "rs4" not in result["SNP"].to_list()

    def test_removes_high_freq(self, sample_df: pl.DataFrame):
        """rs6 (FREQ=0.99) should be removed at MAF threshold 0.01."""
        result = filter_maf(sample_df.lazy(), 0.01).collect()
        assert "rs6" not in result["SNP"].to_list()

    def test_keeps_common_variants(self, sample_df: pl.DataFrame):
        """rs1 (FREQ=0.25) should be kept."""
        result = filter_maf(sample_df.lazy(), 0.01).collect()
        assert "rs1" in result["SNP"].to_list()


class TestINFOFilter:
    def test_removes_low_info(self, sample_df: pl.DataFrame):
        """rs2 (INFO=0.70) should be removed at threshold 0.8."""
        result = filter_info(sample_df.lazy(), 0.8).collect()
        assert "rs2" not in result["SNP"].to_list()

    def test_keeps_high_info(self, sample_df: pl.DataFrame):
        """rs1 (INFO=0.95) should be kept."""
        result = filter_info(sample_df.lazy(), 0.8).collect()
        assert "rs1" in result["SNP"].to_list()


class TestExtremeBeta:
    def test_removes_extreme(self, sample_df: pl.DataFrame):
        """rs4 (BETA=15.0) should be removed at max_abs=10."""
        result = filter_extreme_beta(sample_df.lazy(), 10.0).collect()
        assert "rs4" not in result["SNP"].to_list()


class TestDuplicateRemoval:
    def test_keeps_lowest_pvalue(self):
        """When SNPs are duplicated, keep the one with lowest P."""
        df = pl.DataFrame({
            "SNP": ["rs1", "rs1", "rs2"],
            "P":   [0.05,  0.001, 0.1],
            "BETA": [0.1,  0.2,   0.3],
        })
        result = remove_duplicates(df.lazy()).collect()
        assert len(result) == 2
        rs1_beta = result.filter(pl.col("SNP") == "rs1")["BETA"].item()
        assert rs1_beta == 0.2  # the row with P=0.001


class TestLambdaGC:
    def test_null_distribution(self):
        """Under the null (uniform p-values), lambda GC should be ~1.0."""
        rng = np.random.default_rng(42)
        p = rng.uniform(0, 1, size=100_000)
        lam = compute_lambda_gc(p)
        assert 0.95 < lam < 1.05, f"Lambda GC under null should be ~1.0, got {lam}"

    def test_inflated_distribution(self):
        """Inflated p-values should give lambda > 1."""
        rng = np.random.default_rng(42)
        z = rng.normal(0, 1.5, size=100_000)  # inflated z-scores
        from scipy.stats import norm
        p = 2 * norm.sf(np.abs(z))
        lam = compute_lambda_gc(p)
        assert lam > 1.5, f"Lambda GC with inflation should be > 1.5, got {lam}"
