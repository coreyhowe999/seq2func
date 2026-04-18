"""
Unit tests for Mendelian Randomization methods.

Tests Wald ratio, IVW, MR-Egger, and diagnostic statistics with
known inputs and expected outputs.

Run:  pytest tests/test_mr.py -v
"""

import numpy as np
import pytest

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bin"))

from run_mr import wald_ratio, ivw, mr_egger, weighted_median, f_statistic, cochrans_q


# ---------------------------------------------------------------------------
# Wald Ratio
# ---------------------------------------------------------------------------

class TestWaldRatio:
    def test_known_values(self):
        """Wald ratio = beta_outcome / beta_exposure."""
        result = wald_ratio(beta_exp=0.5, beta_out=0.1, se_out=0.02, se_exp=0.05)
        assert result["method"] == "wald_ratio"
        assert abs(result["estimate"] - 0.2) < 1e-6  # 0.1 / 0.5 = 0.2

    def test_negative_exposure(self):
        """Should handle negative exposure beta correctly."""
        result = wald_ratio(beta_exp=-0.4, beta_out=0.08, se_out=0.02, se_exp=0.05)
        assert abs(result["estimate"] - (-0.2)) < 1e-6

    def test_single_instrument(self):
        result = wald_ratio(0.3, 0.06, 0.01, 0.03)
        assert result["n_instruments"] == 1


# ---------------------------------------------------------------------------
# IVW
# ---------------------------------------------------------------------------

class TestIVW:
    def test_three_instruments_consistent(self):
        """Three instruments all pointing to causal effect = 0.2."""
        beta_exp = np.array([0.5, 0.3, 0.4])
        beta_out = np.array([0.10, 0.06, 0.08])  # all give ratio = 0.2
        se_exp = np.array([0.05, 0.05, 0.05])
        se_out = np.array([0.02, 0.02, 0.02])

        result = ivw(beta_exp, beta_out, se_exp, se_out)
        assert abs(result["estimate"] - 0.2) < 0.01
        assert result["n_instruments"] == 3
        assert result["pvalue"] < 0.05

    def test_two_instruments(self):
        """IVW should work with just 2 instruments."""
        beta_exp = np.array([0.4, 0.6])
        beta_out = np.array([0.08, 0.12])
        se_exp = np.array([0.05, 0.05])
        se_out = np.array([0.02, 0.02])

        result = ivw(beta_exp, beta_out, se_exp, se_out)
        assert result["n_instruments"] == 2
        assert abs(result["estimate"] - 0.2) < 0.02


# ---------------------------------------------------------------------------
# MR-Egger
# ---------------------------------------------------------------------------

class TestMREgger:
    def test_returns_intercept(self):
        """MR-Egger should return an intercept (pleiotropy test)."""
        rng = np.random.default_rng(42)
        n = 10
        beta_exp = rng.uniform(0.2, 0.8, n)
        beta_out = 0.15 * beta_exp + rng.normal(0, 0.01, n)  # no pleiotropy
        se_exp = np.full(n, 0.05)
        se_out = np.full(n, 0.02)

        result = mr_egger(beta_exp, beta_out, se_exp, se_out)
        assert "intercept" in result
        assert "intercept_pvalue" in result
        assert result["method"] == "mr_egger"

    def test_no_pleiotropy_intercept_near_zero(self):
        """Without pleiotropy, Egger intercept should be near zero."""
        rng = np.random.default_rng(99)
        n = 20
        beta_exp = rng.uniform(0.2, 0.8, n)
        beta_out = 0.2 * beta_exp + rng.normal(0, 0.005, n)
        se_exp = np.full(n, 0.05)
        se_out = np.full(n, 0.02)

        result = mr_egger(beta_exp, beta_out, se_exp, se_out)
        assert abs(result["intercept"]) < 0.1, f"Intercept should be near 0, got {result['intercept']}"


# ---------------------------------------------------------------------------
# Weighted Median
# ---------------------------------------------------------------------------

class TestWeightedMedian:
    def test_consistent_instruments(self):
        """With consistent instruments, weighted median ≈ true causal effect."""
        rng = np.random.default_rng(42)
        n = 15
        true_effect = 0.2
        beta_exp = rng.uniform(0.2, 0.8, n)
        beta_out = true_effect * beta_exp + rng.normal(0, 0.005, n)
        se_exp = np.full(n, 0.05)
        se_out = np.full(n, 0.02)

        result = weighted_median(beta_exp, beta_out, se_exp, se_out)
        assert abs(result["estimate"] - true_effect) < 0.05


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

class TestFStatistic:
    def test_strong_instruments(self):
        """Strong instruments should have F >> 10."""
        beta_exp = np.array([0.5, 0.3, 0.4])
        se_exp = np.array([0.05, 0.03, 0.04])
        result = f_statistic(beta_exp, se_exp)
        assert result["mean_F"] > 10
        assert result["n_weak_instruments"] == 0

    def test_weak_instrument_detected(self):
        """An instrument with small beta/se should be flagged as weak."""
        beta_exp = np.array([0.5, 0.01])  # second instrument is weak
        se_exp = np.array([0.05, 0.05])
        result = f_statistic(beta_exp, se_exp)
        assert result["n_weak_instruments"] >= 1

    def test_f_stat_calculation(self):
        """F = (beta/se)^2 for a single instrument."""
        beta_exp = np.array([0.3])
        se_exp = np.array([0.05])
        result = f_statistic(beta_exp, se_exp)
        expected_f = (0.3 / 0.05) ** 2  # = 36
        assert abs(result["mean_F"] - expected_f) < 1e-6


class TestCochransQ:
    def test_no_heterogeneity(self):
        """Consistent estimates should give low Q."""
        beta_exp = np.array([0.5, 0.3, 0.4])
        beta_out = np.array([0.1, 0.06, 0.08])  # all ratio = 0.2
        se_out = np.array([0.02, 0.02, 0.02])
        result = cochrans_q(beta_exp, beta_out, se_out, ivw_estimate=0.2)
        assert result["Q"] < 10  # low heterogeneity
        assert result["Q_df"] == 2
