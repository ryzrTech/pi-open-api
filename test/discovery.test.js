import assert from "node:assert/strict";
import test from "node:test";
import { discoverModels, mapModels, normalizeBaseUrl } from "../src/discovery.js";

test("normalizes gateway URLs", () => {
  assert.equal(normalizeBaseUrl("https://ai.example.com/v1/"), "https://ai.example.com");
});

test("deduplicates /v1/models and enriches model metadata", () => {
  const models = mapModels(
    { data: [{ id: "example-model" }, { id: "example-model" }] },
    {
      data: [
        {
          model_name: "example-model",
          model_info: {
            context_window: 262144,
            max_output_tokens: 8192,
            input_cost_per_token: 0.00000001,
            output_cost_per_token: 0.00000038,
          },
        },
      ],
    },
    "openapi",
    "https://ai.example.com/v1",
  );

  assert.equal(models.length, 1);
  assert.equal(models[0].id, "example-model");
  assert.equal(models[0].compat.sendSessionAffinityHeaders, true);
  assert.equal(models[0].compat.sessionAffinityFormat, "openrouter");
  assert.equal(models[0].contextWindow, 262144);
  assert.equal(models[0].maxTokens, 8192);
  assert.equal(models[0].cost.input, 0.01);
  assert.equal(models[0].cost.output, 0.38);
});

test("uses the published output allowance instead of the 16K fallback", () => {
  const [model] = mapModels(
    { data: [{ id: "example-model", context_window: 262144 }] },
    { data: [{ model_name: "example-model", model_info: {
      max_input_tokens: 262144,
      max_output_tokens: 65536,
    } }] },
    "openapi",
    "https://api.example.com/v1",
  );
  assert.equal(model.contextWindow, 262144);
  assert.equal(model.maxTokens, 65536);
});

test("uses /v1/models as the authority when optional metadata is unavailable", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/model/info")) return new Response("missing", { status: 404 });
    return Response.json({ data: [{ id: "gemma4:12B" }] });
  };

  const warnings = [];
  const models = await discoverModels("https://ai.example.com", "example-token", {
    providerId: "openapi",
    fetchImpl,
    onWarning: (message) => warnings.push(message),
  });

  assert.deepEqual(calls, [
    "https://ai.example.com/v1/models",
    "https://ai.example.com/model/info",
  ]);
  assert.equal(models[0].id, "gemma4:12B");
  assert.equal(models[0].contextWindow, 128000);
  assert.equal(warnings.length, 1);
});

 test("keeps native context and reserves input space when output defaults are larger", () => {
  const [small, medium] = mapModels({ data: [
    { id: "small", context_window: 2048 }, { id: "medium", context_window: 16384 },
  ] }, undefined, "openapi", "http://gateway/v1");
  assert.equal(small.contextWindow, 2048);
  assert.equal(small.maxTokens, 512);
  assert.equal(medium.contextWindow, 16384);
  assert.equal(medium.maxTokens, 4096);
});
