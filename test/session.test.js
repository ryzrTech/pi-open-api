import test from "node:test";
import assert from "node:assert/strict";
import { withSessionHeader } from "../src/session.js";

test("propagates stable session IDs independently of cache retention", () => {
  const calls = [];
  const wrapped = withSessionHeader({
    stream: (_m, _c, opts) => calls.push(opts),
    streamSimple: (_m, _c, opts) => calls.push(opts),
  });
  const options = { sessionId: "session-a", cacheRetention: "none", headers: { "x-other": "value" } };
  wrapped.stream({}, {}, options);
  wrapped.streamSimple({}, {}, { sessionId: "session-a" });
  wrapped.stream({}, {}, { sessionId: "session-b" });
  assert.deepEqual(calls.map(call => call.headers["x-session-id"]), ["session-a", "session-a", "session-b"]);
  assert.equal(calls[0].headers["x-other"], "value");
  assert.equal(options.headers["x-session-id"], undefined);
});

test("does not invent or send malformed session IDs", () => {
  const calls = [];
  const wrapped = withSessionHeader({ stream: (_m, _c, opts) => calls.push(opts), streamSimple() {} });
  wrapped.stream({}, {}, undefined);
  wrapped.stream({}, {}, { sessionId: "bad\nheader" });
  wrapped.stream({}, {}, { sessionId: "x".repeat(161) });
  assert.equal(calls[0], undefined);
  assert.ok(calls.slice(1).every(call => !call.headers));
});
