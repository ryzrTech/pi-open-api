#!/usr/bin/env bash
set -euo pipefail

set_default=0

usage() {
  printf '%s\n' \
    'Usage: scripts/install-omp.sh [--set-default]' \
    '' \
    'Installs the checked-out OPENAPI plugin into OMP.' \
    '  --set-default  Preserve existing model roles and set the discovered OPENAPI model as default.'
}

while (($#)); do
  case "$1" in
    --set-default)
      set_default=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

for command_name in omp node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 1
  fi
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"

if [[ ! -f "$repo_dir/package.json" || ! -f "$repo_dir/dist/omp.js" ]]; then
  printf 'Plugin checkout is incomplete: %s\n' "$repo_dir" >&2
  exit 1
fi

if [[ -n "${OPENAPI_CA_CERT:-}" ]]; then
  if [[ ! -f "$OPENAPI_CA_CERT" ]]; then
    printf 'OPENAPI_CA_CERT does not exist: %s\n' "$OPENAPI_CA_CERT" >&2
    exit 1
  fi
  printf 'Using the configured CA certificate at %s\n' "$OPENAPI_CA_CERT"
fi

printf 'Linking OPENAPI plugin from %s\n' "$repo_dir"
omp plugin link "$repo_dir"
omp plugin doctor

has_credential=0
if [[ -n "${OPENAPI_OMP_API_KEY:-}" || -n "${OPENAPI_API_KEY:-}" ]]; then
  has_credential=1
elif omp token openapi >/dev/null 2>&1; then
  has_credential=1
fi

if ((has_credential == 0)); then
  printf '%s\n' \
    '' \
    'Plugin installed. A gateway credential is not available yet.' \
    'Start OMP, run /login openapi, paste a key, then run:' \
    "  $repo_dir/scripts/verify-omp.sh"
  if ((set_default == 1)); then
    printf '%s\n' 'Re-run this installer with --set-default after login.'
  fi
  exit 0
fi

omp models refresh
models_json="$(omp models openapi --json)"
model_count="$(node -e 'const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.models?.length ?? 0))' "$models_json")"
if [[ "$model_count" == "0" ]]; then
  printf 'The plugin loaded, but the gateway returned no models.\n' >&2
  exit 1
fi

if ((set_default == 1)); then
  selector="$(node -e '
    const models = JSON.parse(process.argv[1]).models ?? [];
    const preferred = models.find((model) => String(model.id).toLowerCase().endsWith(":e2b"));
    const chosen = preferred ?? models[0];
    if (!chosen) process.exit(1);
    const id = String(chosen.id);
    const suffix = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
    const suffixMatches = models.filter((model) => String(model.id).toLowerCase().endsWith(`:${suffix.toLowerCase()}`));
    process.stdout.write(suffixMatches.length === 1 ? `openapi/${suffix}` : String(chosen.selector));
  ' "$models_json")"

  roles_document="$(omp config get modelRoles --json 2>/dev/null || printf '{"value":{}}')"
  roles_value="$(node -e '
    const document = JSON.parse(process.argv[1]);
    const current = document.value && typeof document.value === "object" ? document.value : {};
    process.stdout.write(JSON.stringify({ ...current, default: process.argv[2] }));
  ' "$roles_document" "$selector")"
  omp config set modelRoles "$roles_value"
  printf 'OMP default model set to %s\n' "$selector"
fi

printf 'OPENAPI plugin installed successfully with %s discovered models.\n' "$model_count"
printf 'Run %s/scripts/verify-omp.sh for an inference smoke test.\n' "$repo_dir"
