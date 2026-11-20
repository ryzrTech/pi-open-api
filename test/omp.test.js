import assert from "node:assert/strict";
import test from "node:test";

import registerOmpAiGateway from "../src/omp.js";

test("registers the native OMP provider without exposing a key in the package", async () => {
  const previousKey = process.env.OPENAPI_OMP_API_KEY;
  const previousBaseUrl = process.env.OPENAPI_BASE_URL;
  const previousCa = process.env.NODE_EXTRA_CA_CERTS;
  process.env.OPENAPI_OMP_API_KEY = "example-token";
  process.env.OPENAPI_BASE_URL = "https://gateway.example.com/v1/";

  let registered;
  const callbacks = new Map();
  try {
    registerOmpAiGateway({
      registerProvider(name, config) {
        registered = { name, config };
      },
      on(name, callback) {
        callbacks.set(name, callback);
      },
    });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAPI_OMP_API_KEY;
    else process.env.OPENAPI_OMP_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.OPENAPI_BASE_URL;
    else process.env.OPENAPI_BASE_URL = previousBaseUrl;
    if (previousCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = previousCa;
  }

  assert.equal(registered.name, "openapi");
  assert.equal(registered.config.baseUrl, "https://gateway.example.com/v1");
  assert.equal(registered.config.apiKey, "example-token");
  assert.equal(registered.config.api, "openai-completions");
  assert.equal(registered.config.authHeader, true);
  assert.equal(typeof registered.config.fetchDynamicModels, "function");
  assert.equal(await registered.config.oauth.login({ onPrompt: async () => "Bearer example-login-token" }), "example-login-token");
  assert.equal(callbacks.has("after_provider_response"), true);
  assert.equal(callbacks.has("message_end"), true);
});

test("OMP requires an explicit API URL rather than using a private default", () => {
  const before = process.env.OPENAPI_BASE_URL;
  delete process.env.OPENAPI_BASE_URL;
  try {
    assert.throws(() => registerOmpAiGateway({registerProvider() {}, on() {}}), /Set OPENAPI_BASE_URL/);
  } finally {
    if (before !== undefined) process.env.OPENAPI_BASE_URL = before;
  }
});
