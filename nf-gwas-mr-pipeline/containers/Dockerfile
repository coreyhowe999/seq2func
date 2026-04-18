# =============================================================================
# Dockerfile — nf-gwas-mr-pipeline
# =============================================================================
#
# Single container with all Python dependencies for the GWAS-MR pipeline.
# Uses python:3.11-slim for a small footprint.
#
# Build:
#   docker build -t nf-gwas-mr-pipeline:latest containers/
#
# Design decisions:
#   - python:3.11-slim over full python: ~120MB vs ~900MB
#   - Non-root user for security (TRE best practice)
#   - No unnecessary packages (no gcc, no dev headers needed for pure wheels)
#   - pip --no-cache-dir to keep image small
# =============================================================================

FROM python:3.11-slim

# --- Metadata ---------------------------------------------------------------
LABEL maintainer="Corey"
LABEL description="GWAS summary statistics QC and Mendelian Randomization pipeline"
LABEL version="1.0.0"

# --- Install Python dependencies -------------------------------------------
# polars, numpy, scipy, matplotlib are all available as pre-built wheels
# for linux/amd64, so no compilation is needed.
RUN pip install --no-cache-dir \
    polars==1.19.0 \
    numpy==2.1.3 \
    scipy==1.14.1 \
    matplotlib==3.9.3

# --- Copy pipeline scripts --------------------------------------------------
COPY bin/ /usr/local/bin/

# Make scripts executable
RUN chmod +x /usr/local/bin/*.py

# --- Security: create and switch to a non-root user -------------------------
# This is a best practice for production containers and a requirement in
# most Trusted Research Environments (TREs).  Running as root inside a
# container is a security risk — if the container is compromised, the
# attacker has root privileges within the container's namespace.
RUN groupadd -r pipeline && useradd -r -g pipeline -d /home/pipeline -s /bin/bash pipeline
RUN mkdir -p /home/pipeline && chown -R pipeline:pipeline /home/pipeline

USER pipeline
WORKDIR /home/pipeline

# --- Default command ---------------------------------------------------------
CMD ["python3", "--version"]
