"""
Unit tests for PRS calculation module.

Tests genotype simulation, PRS scoring, and R-squared calculation.

Run:  pytest tests/test_prs.py -v
"""

import numpy as np
import pytest

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bin"))

from calculate_prs import simulate_genotypes, calculate_prs_at_threshold, r_squared


# ---------------------------------------------------------------------------
# Genotype simulation
# ---------------------------------------------------------------------------

class TestSimulateGenotypes:
    def test_output_shape(self):
        rng = np.random.default_rng(42)
        freqs = np.array([0.3, 0.5, 0.1])
        geno = simulate_genotypes(100, freqs, rng)
        assert geno.shape == (100, 3)

    def test_values_in_range(self):
        """Genotypes should be 0, 1, or 2."""
        rng = np.random.default_rng(42)
        freqs = np.array([0.3, 0.5, 0.1])
        geno = simulate_genotypes(1000, freqs, rng)
        assert set(np.unique(geno)).issubset({0, 1, 2})

    def test_allele_frequency_matches(self):
        """Mean genotype / 2 should approximate the allele frequency."""
        rng = np.random.default_rng(42)
        freq = 0.4
        geno = simulate_genotypes(100_000, np.array([freq]), rng)
        observed_freq = geno.mean() / 2
        assert abs(observed_freq - freq) < 0.02


# ---------------------------------------------------------------------------
# PRS calculation
# ---------------------------------------------------------------------------

class TestPRSCalculation:
    def test_known_prs(self):
        """PRS with known genotypes and betas."""
        genotypes = np.array([
            [2, 0, 1],
            [0, 2, 0],
            [1, 1, 1],
        ], dtype=np.int8)
        betas = np.array([0.1, 0.2, 0.3])
        p_values = np.array([1e-9, 1e-9, 1e-9])  # all significant

        prs, n_snps = calculate_prs_at_threshold(genotypes, betas, p_values, 5e-8)
        assert n_snps == 3
        # PRS = genotype @ betas
        expected = genotypes @ betas
        np.testing.assert_allclose(prs, expected)

    def test_threshold_filtering(self):
        """Only SNPs with P below threshold should be included."""
        genotypes = np.array([
            [2, 0, 1],
            [0, 2, 0],
        ], dtype=np.int8)
        betas = np.array([0.1, 0.2, 0.3])
        p_values = np.array([1e-9, 0.5, 1e-10])  # only first and third significant

        prs, n_snps = calculate_prs_at_threshold(genotypes, betas, p_values, 5e-8)
        assert n_snps == 2
        # Should use only betas[0] and betas[2]
        expected = genotypes[:, [0, 2]] @ betas[[0, 2]]
        np.testing.assert_allclose(prs, expected)

    def test_no_significant_snps(self):
        """If no SNPs pass threshold, PRS should be all zeros."""
        genotypes = np.array([[2, 1], [0, 2]], dtype=np.int8)
        betas = np.array([0.1, 0.2])
        p_values = np.array([0.5, 0.8])

        prs, n_snps = calculate_prs_at_threshold(genotypes, betas, p_values, 5e-8)
        assert n_snps == 0
        np.testing.assert_allclose(prs, np.zeros(2))

    def test_higher_beta_shifts_prs(self):
        """Doubling betas should double PRS values."""
        rng = np.random.default_rng(42)
        freqs = np.array([0.3, 0.5])
        geno = simulate_genotypes(500, freqs, rng)
        betas1 = np.array([0.1, 0.2])
        betas2 = np.array([0.2, 0.4])
        p_values = np.array([1e-9, 1e-9])

        prs1, _ = calculate_prs_at_threshold(geno, betas1, p_values, 5e-8)
        prs2, _ = calculate_prs_at_threshold(geno, betas2, p_values, 5e-8)

        np.testing.assert_allclose(prs2, 2 * prs1)


# ---------------------------------------------------------------------------
# R-squared
# ---------------------------------------------------------------------------

class TestRSquared:
    def test_perfect_correlation(self):
        y_true = np.array([1, 2, 3, 4, 5], dtype=float)
        y_pred = y_true * 2 + 1  # perfect linear relationship
        assert abs(r_squared(y_true, y_pred) - 1.0) < 1e-10

    def test_no_correlation(self):
        rng = np.random.default_rng(42)
        y_true = rng.standard_normal(10000)
        y_pred = rng.standard_normal(10000)
        assert r_squared(y_true, y_pred) < 0.01

    def test_zero_variance_pred(self):
        """If prediction is constant, R² should be 0."""
        y_true = np.array([1, 2, 3, 4, 5], dtype=float)
        y_pred = np.array([3, 3, 3, 3, 3], dtype=float)
        assert r_squared(y_true, y_pred) == 0.0
