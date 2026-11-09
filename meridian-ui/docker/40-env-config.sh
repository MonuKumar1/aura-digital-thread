#!/bin/sh
# Generates window.__ENV__ at container start so one image works in any environment.
# Runs automatically via the nginx image's /docker-entrypoint.d hook.
set -eu

sanitize() {
  # Allow only URL-safe characters so values can't break out of the JS string.
  printf '%s' "$1" | tr -cd 'A-Za-z0-9:/._-'
}

API_BASE_URL_SAFE="$(sanitize "${API_BASE_URL:-}")"
USE_MOCK_SAFE="$(sanitize "${USE_MOCK:-false}")"

cat > /usr/share/nginx/html/env-config.js <<JS
window.__ENV__ = {
  API_BASE_URL: "${API_BASE_URL_SAFE}",
  USE_MOCK: "${USE_MOCK_SAFE}"
};
JS
echo "env-config.js written (API_BASE_URL='${API_BASE_URL_SAFE}', USE_MOCK='${USE_MOCK_SAFE}')"
