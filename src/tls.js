import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";

function clean(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function resolveGatewayCaPath(env = process.env) {
  const configuredPath = clean(env.OPENAPI_CA_CERT);
  return configuredPath ? path.resolve(configuredPath) : undefined;
}

export function configureGatewayTls(env = process.env) {
  const caPath = resolveGatewayCaPath(env);
  if (!caPath) return undefined;
  if (!fs.existsSync(caPath)) {
    throw new Error(`OPENAPI CA certificate does not exist: ${caPath}`);
  }
  if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") {
    throw new Error("OPENAPI requires Node.js 22.19.0 or newer to activate a custom CA certificate");
  }

  const extraCa = fs.readFileSync(caPath, "utf8").trim();
  const certificate = new X509Certificate(extraCa);
  if (!certificate.ca) {
    throw new Error(`OPENAPI certificate is not a CA certificate: ${caPath}`);
  }

  const current = tls.getCACertificates("default");
  const fingerprint = certificate.fingerprint256;
  const alreadyConfigured = current.some((pem) => {
    try {
      return new X509Certificate(pem).fingerprint256 === fingerprint;
    } catch {
      return false;
    }
  });
  if (!alreadyConfigured) tls.setDefaultCACertificates([...current, extraCa]);

  return { caPath, fingerprint, added: !alreadyConfigured };
}
