#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${1:-https://billing.polyizon.tech}"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "${work_dir}"' EXIT

curl --fail --silent --show-error --location \
  --connect-timeout 10 --max-time 30 \
  --dump-header "${work_dir}/headers" \
  --output "${work_dir}/body" \
  "${base_url}/login"

required_headers=(
  'content-security-policy:'
  'strict-transport-security:'
  'x-content-type-options: nosniff'
  'referrer-policy:'
  'permissions-policy:'
)
for header in "${required_headers[@]}"; do
  grep -qi "^${header}" "${work_dir}/headers" || {
    echo "Missing required header: ${header}" >&2
    exit 1
  }
done

if grep -Eqi '<script[^>]+src=["'\'']http://' "${work_dir}/body"; then
  echo "Mixed-content script found" >&2
  exit 1
fi

protected_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 10 --max-time 30 \
  "${base_url}/api/billing-workspace/overview")"
[[ "${protected_status}" == "401" || "${protected_status}" == "403" ]] || {
  echo "Protected API returned ${protected_status} without authentication" >&2
  exit 1
}

for path in '/.env' '/.git/config' '/server.js' '/package.json' '/api/../.env'; do
  status="$(curl --path-as-is --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 10 --max-time 30 "${base_url}${path}")"
  [[ "${status}" =~ ^(400|401|403|404)$ ]] || {
    echo "Sensitive probe ${path} returned unexpected ${status}" >&2
    exit 1
  }
done

echo "DAST baseline passed for ${base_url}"
