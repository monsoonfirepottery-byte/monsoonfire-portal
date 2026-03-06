FROM python:3.11-slim

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    binutils \
    autoconf \
    automake \
    libtool \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip "setuptools==68.2.2" wheel \
  && python -m pip install --no-cache-dir libratom==0.7.1

ENTRYPOINT ["ratom"]
