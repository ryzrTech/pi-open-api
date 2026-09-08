import assert from "node:assert/strict";
import test from "node:test";

import { setupGatewayCostTracking } from "../dist/cost.js";

function hooks() {
  const callbacks = new Map();
  setupGatewayCostTracking({
    on(name, callback) {
      callbacks.set(name, callback);
    },
  });
  return callbacks;
}

function assistantMessage(total = 999) {
  return {
    role: "assistant",
    provider: "openapi",
    usage: {
      input: 75,
      output: 25,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
    },
  };
}

test("uses the OPENAPI exact response cost", async () => {
  const callbacks = hooks();
  callbacks.get("after_provider_response")(
    { headers: { "x-asg-response-cost": "0.04" } },
    { model: { provider: "openapi" } },
  );

  const result = await callbacks.get("message_end")({ message: assistantMessage() });
  assert.equal(result.message.usage.cost.total, 0.04);
  assert.equal(result.message.usage.cost.input, 0.03);
  assert.equal(result.message.usage.cost.output, 0.01);
});

test("keeps Pi's calculated cost when a response has no exact cost header", async () => {
  const callbacks = hooks();
  callbacks.get("after_provider_response")(
    { headers: {} },
    { model: { provider: "openapi" } },
  );

  const result = await callbacks.get("message_end")({ message: assistantMessage(0.02) });
  assert.equal(result, undefined);
});

test("ignores response headers from other providers", async () => {
  const callbacks = hooks();
  callbacks.get("after_provider_response")(
    { headers: { "x-asg-response-cost": "12" } },
    { model: { provider: "openai" } },
  );

  const result = await callbacks.get("message_end")({ message: assistantMessage(0.02) });
  assert.equal(result, undefined);
});
