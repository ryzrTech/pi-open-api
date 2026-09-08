import assert from "node:assert/strict";
import test from "node:test";
import { discoverModels, mapModels, normalizeBaseUrl } from "../dist/discovery.js";

test("normalizes gateway URLs", () => {
  assert.equal(normalizeBaseUrl("https://ai.example.com/v1/"), "https://ai.example.com");
});

test("deduplicates /v1/models and enriches model metadata", () => {
  const models = mapModels(
    { data: [{ id: "ornith:35b" }, { id: "ornith:35b" }] },
    {
      data: [
        {
          model_name: "ornith:35b",
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
  assert.equal(models[0].id, "ornith:35b");
  assert.equal(models[0].contextWindow, 262144);
  assert.equal(models[0].maxTokens, 8192);
  assert.equal(models[0].cost.input, 0.01);
  assert.equal(models[0].cost.output, 0.38);
});

test("uses /v1/models as the authority when optional metadata is unavailable", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/model/info")) return new Response("missing", { status: 404 });
    return Response.json({ data: [{ id: "gemma4:12B" }] });
  };

  const warnings = [];
  const models = await discoverModels("https://ai.example.com", "sk-test", {
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
