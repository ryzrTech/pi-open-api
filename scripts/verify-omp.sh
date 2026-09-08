#!/usr/bin/env bash
set -euo pipefail

for command_name in omp node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 1
  fi
done

if [[ -z "${OPENAPI_OMP_API_KEY:-}" && -z "${OPENAPI_API_KEY:-}" ]]; then
  if ! omp token openapi >/dev/null 2>&1; then
    printf 'No OPENAPI credential found. Start OMP and run /login openapi first.\n' >&2
    exit 1
  fi
fi

omp plugin doctor
omp models refresh
models_json="$(omp models openapi --json)"
selector="$(node -e '
  const models = JSON.parse(process.argv[1]).models ?? [];
  const preferred = models.find((model) => String(model.id).toLowerCase().endsWith(":e2b"));
  const chosen = preferred ?? models.find((model) => !String(model.id).toLowerCase().includes("embed")) ?? models[0];
  if (!chosen) process.exit(1);
  const id = String(chosen.id);
  const suffix = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  const matches = models.filter((model) => String(model.id).toLowerCase().endsWith(`:${suffix.toLowerCase()}`));
  process.stdout.write(matches.length === 1 ? `openapi/${suffix}` : String(chosen.selector));
' "$models_json")"

printf 'Testing OPENAPI inference with %s\n' "$selector"
result="$(omp -p --no-tools --no-session --model "$selector" 'Reply with exactly: OMP_OPENAPI_OK')"
printf '%s\n' "$result"

if [[ "$result" != *"OMP_OPENAPI_OK"* ]]; then
  printf 'Inference completed but did not return the expected marker.\n' >&2
  exit 1
fi

printf 'OMP OPENAPI verification passed.\n'
