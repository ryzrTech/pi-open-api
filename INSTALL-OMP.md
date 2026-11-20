# Install the OPENAPI plugin in OMP

These steps install the plugin on Ubuntu, Zorin OS, or another Linux distribution. They do not place a gateway key in the repository, shell history, or installer.

## Prerequisites

Install these commands first:

- OMP (`omp`)
- Node.js 22.19 or newer (`node`)
- Git (`git`)

## Agent-ready installation

Give the following block to the agent on the Linux machine:

```bash
set -euo pipefail
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/openapi/pi-open-api"
if [[ -d "$install_dir/.git" ]]; then
  git -C "$install_dir" pull --ff-only
else
  mkdir -p "$(dirname "$install_dir")"
  git clone https://github.com/ryzrTech/pi-open-api.git "$install_dir"
fi
"$install_dir/scripts/install-omp.sh"
```

This clones the public repository to a durable per-user path, links the native OMP extension, and runs OMP's plugin diagnostics. It is safe to run again after plugin updates.

## Store the credential

The virtual key is deliberately not accepted by the installer. Start OMP interactively:

```bash
omp
```

Inside OMP, run:

```text
/login openapi
```

Paste the API key when prompted. OMP stores it in its own local credential store. Do not send the key to the agent, add it to a command, or commit it to Git.

## Finish configuration and verify

After login, run:

```bash
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/openapi/pi-open-api"
"$install_dir/scripts/install-omp.sh" --set-default
"$install_dir/scripts/verify-omp.sh"
```

`--set-default` preserves the other OMP model-role values and chooses a currently discovered OPENAPI model. The verifier refreshes the live inventory and requires an actual inference response containing `OMP_OPENAPI_OK`.

## Update later

Pull the latest version and rerun the installer:

```bash
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/openapi/pi-open-api"
git -C "$install_dir" pull --ff-only
"$install_dir/scripts/install-omp.sh"
"$install_dir/scripts/verify-omp.sh"
```

Models do not need to be added to this plugin manually. OMP receives the current published inventory from the gateway's `/v1/models` endpoint whenever models are refreshed.

## Optional overrides

The normal defaults are already correct for the RyzrTech gateway. These variables are available for a different installation:

```bash
export OPENAPI_BASE_URL="https://gateway.example.com"
export OPENAPI_CA_CERT="$HOME/.config/company/root-ca.pem"
```

For temporary unattended testing, `OPENAPI_OMP_API_KEY` is supported, but interactive `/login openapi` is preferred because it avoids putting a key in shell startup files.

## Troubleshooting

- `git clone` fails: confirm that Git and internet access are available, then retry the public HTTPS URL above.
- OMP says no credential is available: start OMP and run `/login openapi`.
- No models appear: run `omp models refresh`, then `omp models openapi`.
- Certificate errors: set `OPENAPI_CA_CERT` to the absolute path of your gateway's CA certificate. Never disable TLS verification.
- An exact Ollama-style model name containing `:` fails at startup on OMP 17.2.12: use the interactive model picker or a unique colon-free selector. The installer handles this when setting the default.
