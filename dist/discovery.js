const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

export function normalizeBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "");
}

function finitePositive(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function perMillion(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * 1_000_000 : 0;
}

function booleanValue(...values) {
  return values.some((value) => value === true || value === "true" || value === 1);
}

function metadataFor(id, metadata) {
  const entry = metadata.get(id) ?? {};
  const info = entry.model_info ?? {};
  return { entry, info };
}

export function mapModels(modelsPayload, modelInfoPayload, providerId, requestBaseUrl) {
  const metadata = new Map();
  for (const entry of modelInfoPayload?.data ?? []) {
    const id = entry?.model_name ?? entry?.id;
    if (typeof id === "string" && id) metadata.set(id, entry);
  }

  const seen = new Set();
  const models = [];
  for (const row of modelsPayload?.data ?? []) {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const { entry, info } = metadataFor(id, metadata);
    const supportsVision = booleanValue(
      info.supports_vision,
      info.supports_image_input,
      entry.supports_vision,
    );
    const supportsReasoning = booleanValue(
      info.supports_reasoning,
      info.supports_reasoning_effort,
      entry.supports_reasoning,
    );

    models.push({
      id,
      name: typeof info.display_name === "string" ? info.display_name : id,
      provider: providerId,
      api: "openai-completions",
      baseUrl: requestBaseUrl,
      reasoning: supportsReasoning,
      input: supportsVision ? ["text", "image"] : ["text"],
      cost: {
        input: perMillion(info.input_cost_per_token),
        output: perMillion(info.output_cost_per_token),
        cacheRead: perMillion(info.cache_read_input_token_cost),
        cacheWrite: perMillion(info.cache_creation_input_token_cost),
      },
      contextWindow:
        finitePositive(
          info.context_window,
          info.max_input_tokens,
          info.max_tokens,
          entry.context_window,
        ) ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens:
        finitePositive(
          info.max_output_tokens,
          info.max_completion_tokens,
          entry.max_output_tokens,
        ) ?? DEFAULT_MAX_TOKENS,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    });
  }

  return models;
}

async function fetchJson(url, apiKey, { fetchImpl, signal, timeoutMs }) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: requestSignal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const suffix = body ? `: ${body.slice(0, 300)}` : "";
    throw new Error(`${url} returned HTTP ${response.status}${suffix}`);
  }

  return response.json();
}

export async function discoverModels(baseUrl, apiKey, options = {}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("OPENAPI base URL is required");
  if (!apiKey) throw new Error("OPENAPI key is required");

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const modelsPayload = await fetchJson(`${base}/v1/models`, apiKey, {
    fetchImpl,
    signal: options.signal,
    timeoutMs,
  });

  let modelInfoPayload;
  try {
    modelInfoPayload = await fetchJson(`${base}/model/info`, apiKey, {
      fetchImpl,
      signal: options.signal,
      timeoutMs,
    });
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    options.onWarning?.(
      `Model metadata was unavailable; using safe defaults (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const models = mapModels(modelsPayload, modelInfoPayload, options.providerId, `${base}/v1`);
  if (models.length === 0) throw new Error("OPENAPI returned no models from /v1/models");
  return models;
}
