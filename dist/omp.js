import { execFileSync } from "node:child_process";
import fs from "node:fs";
import tls from "node:tls";

import { setupGatewayCostTracking } from "./cost.js";
import { discoverModels, normalizeBaseUrl } from "./discovery.js";

const PROVIDER_ID = "openapi";
const PROVIDER_NAME = "OPENAPI";
const DEFAULT_BASE_URL = "https://ai.ryzrtech.com";

function clean(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function storedKey(provider) {
  try {
    return clean(
      execFileSync(process.execPath, ["token", provider], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      }),
    );
  } catch {
    return undefined;
  }
}

function bootstrapKey() {
  return (
    clean(process.env.OPENAPI_OMP_API_KEY) ??
    clean(process.env.OPENAPI_API_KEY) ??
    storedKey(PROVIDER_ID)
  );
}

function configureExtraCa() {
  const configuredPath = clean(process.env.OPENAPI_CA_CERT);
  if (!configuredPath) return;
  if (!fs.existsSync(configuredPath)) {
    throw new Error(`OPENAPI CA certificate does not exist: ${configuredPath}`);
  }
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    process.env.NODE_EXTRA_CA_CERTS = configuredPath;
  }
}

async function gatewayFetch(input, init) {
  const caPath = clean(process.env.NODE_EXTRA_CA_CERTS);
  if (!caPath || !fs.existsSync(caPath)) return fetch(input, init);

  const extraCa = fs.readFileSync(caPath, "utf8");
  const existingTls = init?.tls ?? {};
  const existingCa = existingTls.ca;
  const ca = existingCa === undefined
    ? [...tls.rootCertificates, extraCa]
    : Array.isArray(existingCa)
      ? [...existingCa, extraCa]
      : [existingCa, extraCa];
  return fetch(input, { ...init, tls: { ...existingTls, ca } });
}

function toOmpModel(model) {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    compat: model.compat,
  };
}

async function login(callbacks) {
  const value = await callbacks.onPrompt({
    message: "Enter OPENAPI key",
    placeholder: "sk-...",
  });
  const key = clean(value)?.replace(/^Bearer\s+/i, "");
  if (!key) throw new Error("OPENAPI key is required");
  return key;
}

export default function registerOmpAiGateway(pi) {
  configureExtraCa();
  const baseUrl = normalizeBaseUrl(process.env.OPENAPI_BASE_URL ?? DEFAULT_BASE_URL);
  const apiKey = bootstrapKey();

  pi.registerProvider(PROVIDER_ID, {
    baseUrl: `${baseUrl}/v1`,
    api: "openai-completions",
    authHeader: true,
    ...(apiKey ? { apiKey } : {}),
    oauth: {
      name: PROVIDER_NAME,
      login,
    },
    async fetchDynamicModels(resolvedKey) {
      if (!resolvedKey) throw new Error(`Run /login ${PROVIDER_ID} before refreshing models`);
      const models = await discoverModels(baseUrl, resolvedKey, {
        providerId: PROVIDER_ID,
        fetchImpl: gatewayFetch,
        onWarning: (message) => process.stderr.write(`${PROVIDER_NAME}: ${message}\n`),
      });
      return models.map(toOmpModel);
    },
  });

  setupGatewayCostTracking(pi, PROVIDER_ID);
}
