#!/usr/bin/env bash
set -euo pipefail

for command_name in pi node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 1
  fi
done

models_output="$(pi --list-models OpenAPI)"
printf '%s\n' "$models_output"

selector="$(node -e '
  const lines = process.argv[1].split(/\r?\n/);
  const models = lines
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns[0] === "OpenAPI" && columns[1])
    .map((columns) => columns[1]);
  const chosen = models.find((id) => id === "ornith-1.5:35b")
    ?? models.find((id) => !id.toLowerCase().includes("embed"))
    ?? models[0];
  if (!chosen) process.exit(1);
  process.stdout.write(`OpenAPI/${chosen}`);
' "$models_output")"

if [[ -z "$selector" ]]; then
  printf 'PI loaded the plugin but did not discover any OPENAPI models.\n' >&2
  exit 1
fi

printf 'Testing OPENAPI inference with %s\n' "$selector"
result="$(pi -p --no-tools --no-session --model "$selector" 'Reply with exactly: PI_OPENAPI_OK')"
printf '%s\n' "$result"

if [[ "$result" != *"PI_OPENAPI_OK"* ]]; then
  printf 'Inference completed but did not return the expected marker.\n' >&2
  exit 1
fi

printf 'PI OPENAPI verification passed.\n'
