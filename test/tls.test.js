import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import test from "node:test";

import { configureGatewayTls, resolveGatewayCaPath } from "../dist/tls.js";

test("does nothing when no custom CA is configured", () => {
  assert.equal(resolveGatewayCaPath({}), undefined);
  assert.equal(configureGatewayTls({}), undefined);
});

test("accepts an explicitly configured CA certificate", () => {
  const original = tls.getCACertificates("default");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-open-api-ca-"));
  const caPath = path.join(tempDir, "custom-ca.pem");
  fs.writeFileSync(caPath, tls.rootCertificates[0]);
  try {
    const result = configureGatewayTls({ OPENAPI_CA_CERT: caPath });
    const expected = new X509Certificate(fs.readFileSync(caPath, "utf8")).fingerprint256;
    const active = tls.getCACertificates("default").some((pem) => new X509Certificate(pem).fingerprint256 === expected);

    assert.equal(result.fingerprint, expected);
    assert.equal(active, true);
  } finally {
    tls.setDefaultCACertificates(original);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejects a configured CA path that does not exist", () => {
  assert.throws(
    () => configureGatewayTls({ OPENAPI_CA_CERT: "/definitely/missing/openapi-ca.pem" }),
    /does not exist/,
  );
});
