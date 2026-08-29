# EasyWork - Docker sandbox image for LLM-generated Python code execution
FROM python:3.12-slim

# Data science packages (same versions as requirements.txt)
RUN pip install --no-cache-dir \
    openpyxl>=3.1.5 \
    pandas>=2.2.0 \
    matplotlib>=3.8.0 \
    seaborn>=0.13.0 \
    msal>=1.28.0

# Chinese font support (matplotlib charts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Compatibility with --read-only flag
ENV MPLCONFIGDIR=/tmp/matplotlib
ENV HOME=/tmp

CMD ["python"]
