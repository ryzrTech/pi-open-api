import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { discoverModels, normalizeBaseUrl } from "./discovery.js";
import { setupGatewayCostTracking } from "./cost.js";
import { configureGatewayTls } from "./tls.js";
import { setupGatewayModelSelection } from "./selection.js";
import { withSessionHeader } from "./session.js";

const PROVIDER_ID = "OpenAPI";
const PROVIDER_NAME = "OpenAPI";
const BASE_URL_ENV = "OPENAPI_BASE_URL";
const API_KEY_ENV = "OPENAPI_API_KEY";

function clean(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

async function login(interaction) {
  const rawBaseUrl = await interaction.prompt({
    type: "text",
    message: "Enter OPENAPI URL (without /v1):",
    placeholder: "https://ai.example.com",
  });
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  if (!baseUrl) throw new Error("OPENAPI URL is required");

  const rawKey = await interaction.prompt({
    type: "secret",
    message: "Enter OPENAPI key:",
  });
  const key = clean(rawKey)?.replace(/^Bearer\s+/i, "");
  if (!key) throw new Error("OPENAPI key is required");

  await discoverModels(baseUrl, key, {
    providerId: PROVIDER_ID,
    onWarning: (message) => process.stderr.write(`${PROVIDER_NAME}: ${message}\n`),
  });

  return {
    type: "api_key",
    key,
    env: { [BASE_URL_ENV]: baseUrl },
  };
}

async function resolveCredential({ ctx, credential }) {
  const baseUrl = normalizeBaseUrl(
    credential?.env?.[BASE_URL_ENV] ?? (await ctx.env(BASE_URL_ENV)),
  );
  const apiKey = clean(credential?.key ?? (await ctx.env(API_KEY_ENV)));
  if (!baseUrl || !apiKey) return undefined;

  return {
    auth: {
      apiKey,
      baseUrl: `${baseUrl}/v1`,
    },
    env: { [BASE_URL_ENV]: baseUrl },
    source: credential?.key ? "stored credential" : API_KEY_ENV,
  };
}

async function checkCredential({ ctx, credential }) {
  const baseUrl = normalizeBaseUrl(
    credential?.env?.[BASE_URL_ENV] ?? (await ctx.env(BASE_URL_ENV)),
  );
  const hasKey = Boolean(clean(credential?.key ?? (await ctx.env(API_KEY_ENV))));
  return baseUrl && hasKey ? { type: "api_key", source: credential?.key ? "stored credential" : API_KEY_ENV } : undefined;
}

export default function registerAiGateway(pi) {
  configureGatewayTls();
  const provider = createProvider({
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    baseUrl: "http://127.0.0.1/invalid/v1",
    auth: {
      apiKey: {
        name: "OPENAPI key",
        login,
        check: checkCredential,
        resolve: resolveCredential,
      },
    },
    models: [],
    async fetchModels(context) {
      const credential = context.credential;
      const baseUrl = normalizeBaseUrl(credential?.env?.[BASE_URL_ENV]);
      const apiKey = clean(credential?.key);
      if (!baseUrl || !apiKey) {
        throw new Error(`Run /login ${PROVIDER_ID} before refreshing models`);
      }

      return discoverModels(baseUrl, apiKey, {
        providerId: PROVIDER_ID,
        signal: context.signal,
        onWarning: (message) => process.stderr.write(`${PROVIDER_NAME}: ${message}\n`),
      });
    },
    api: withSessionHeader(openAICompletionsApi()),
  });

  pi.registerProvider(provider);
  setupGatewayCostTracking(pi, PROVIDER_ID);
  setupGatewayModelSelection(pi, async (ctx) => {
    const resolved = await ctx.modelRegistry.getProviderAuth(PROVIDER_ID);
    return resolved?.auth;
  }, { refreshCatalog: true, providerId: PROVIDER_ID });
}
