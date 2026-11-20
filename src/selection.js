import { normalizeBaseUrl } from "./discovery.js";

export async function selectGatewayModel(baseUrl, apiKey, model, options = {}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base || !apiKey) throw new Error("OPENAPI URL and key are required for model selection");
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 1_200_000);
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  async function request(path, init = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message ?? body.detail?.error?.message ??
      (typeof body.detail === "string" ? body.detail : `Model selection returned HTTP ${response.status}`));
    return body;
  }
  let result = await request("/v1/models/select", { method: "POST", body: JSON.stringify({ model }) });
  while (result.job_id && !["completed", "ready", "failed", "cancelled"].includes(result.status)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${model} to load`);
    options.onProgress?.(result.message ?? `Loading ${model} on AI server`);
    await pause(options.pollMs ?? 1500);
    result = await request(`/v1/models/selection?job_id=${encodeURIComponent(result.job_id)}`);
  }
  if (!["ready", "completed"].includes(result.status)) {
    throw new Error(result.error ?? `AI server could not select ${model}`);
  }
  return result;
}

export function setupGatewayModelSelection(pi, resolveAuth, options = {}) {
  const providerId = options.providerId ?? "openapi";
  let queue = Promise.resolve();
  let restoring = false;
  let selectionRevision = 0;
  let selectedModel;
  async function select(model, ctx, previousModel) {
    if (restoring || model?.provider !== providerId) return;
    const operation = queue.catch(() => {}).then(async () => {
      const auth = await resolveAuth(ctx, model);
      if (!auth?.apiKey || !auth?.baseUrl) throw new Error(`Run /login ${providerId} before selecting a model`);
      ctx.ui?.setStatus?.("openapi-model", `Loading ${model.id}…`);
      try {
        await selectGatewayModel(auth.baseUrl, auth.apiKey, model.id, {
          ...options, onProgress: (message) => ctx.ui?.setStatus?.("openapi-model", message),
        });
        selectedModel = `${model.provider}/${model.id}`;
      } catch (error) {
        ctx.ui?.notify?.(`AI server could not select ${model.id}: ${error.message}`, "error");
        if (previousModel && pi.setModel) {
          restoring = true;
          try { await pi.setModel(previousModel); } finally { restoring = false; }
        }
        throw error;
      } finally {
        ctx.ui?.setStatus?.("openapi-model", undefined);
      }
    });
    queue = operation;
    await operation;
  }
  pi.on("model_select", (event, ctx) => {
    selectionRevision++;
    return select(event.model, ctx, event.previousModel);
  });
  if (options.reconcileBeforeAgentStart) {
    // OMP 18 does not emit Pi's model_select extension event. Reconcile the
    // client's explicit model choice before its first request after a change.
    pi.on("before_agent_start", async (_event, ctx) => {
      if (ctx.model?.provider !== providerId) return;
      selectionRevision++;
      await queue.catch(() => {});
      if (selectedModel !== `${ctx.model.provider}/${ctx.model.id}`) {
        await select(ctx.model, ctx);
      }
    });
  }
  pi.on("session_start", async (_event, ctx) => {
    const selected = ctx.model?.provider === providerId;
    if (!selected) {
      if (!options.refreshCatalog) return;
      const auth = await resolveAuth(ctx);
      if (!auth?.apiKey || !auth?.baseUrl) return;
    }
    const startingRevision = selectionRevision;
    // Refresh discovery without selecting/loading any newly advertised model.
    const registry = ctx.modelRegistry;
    if (options.refreshCatalog && typeof registry?.refreshProvider === "function") {
      // OMP exposes a scoped, non-destructive dynamic-provider refresh.
      await registry.refreshProvider(providerId);
    } else if (options.refreshCatalog && typeof registry?.refresh === "function") {
      const result = await registry.refresh({ providers: [providerId], allowNetwork: true });
      const error = result.errors?.get(providerId);
      if (error) throw error;
    }
    // A native model selection during refresh supersedes the startup snapshot.
    if (!selected || startingRevision !== selectionRevision) return;
    await select(ctx.model, ctx);
  });
}
