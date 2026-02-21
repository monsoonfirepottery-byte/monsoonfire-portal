#!/usr/bin/env bash
set -euo pipefail

JAVA_PORTABLE_HOME="${JAVA_PORTABLE_HOME:-$HOME/.local/jre21-portable}"

if [[ ! -x "${JAVA_PORTABLE_HOME}/bin/java" ]]; then
  echo "Portable Java runtime not found at ${JAVA_PORTABLE_HOME}" >&2
  return 1 2>/dev/null || exit 1
fi

export JAVA_HOME="${JAVA_PORTABLE_HOME}"
export PATH="${JAVA_HOME}/bin:${PATH}"

java -version
