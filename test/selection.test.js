import assert from "node:assert/strict";
import test from "node:test";
import { selectGatewayModel, setupGatewayModelSelection } from "../src/selection.js";

test("model selection waits for successful server transition with authenticated polling", async () => {
  const requests=[];
  const states=[{status:"queued",job_id:"job"},{status:"running",job_id:"job"},{status:"completed",job_id:"job"}];
  const result=await selectGatewayModel("https://gateway.example/v1","test-key","Bonsai 2 27B",{
    pause:async()=>{},fetchImpl:async (url,init)=>{requests.push({url,init});return new Response(JSON.stringify(states.shift()));},
  });
  assert.equal(result.status,"completed");
  assert.equal(requests[0].url,"https://gateway.example/v1/models/select");
  assert.deepEqual(JSON.parse(requests[0].init.body),{model:"Bonsai 2 27B"});
  assert.equal(requests.length,3);
  assert.ok(requests.every(r=>r.init.headers.Authorization==="Bearer test-key"));
});

test("failed server selection reports its reason", async () => {
  await assert.rejects(selectGatewayModel("https://gateway.example","key","Test",{
    fetchImpl:async()=>new Response(JSON.stringify({status:"failed",error:"admission rejected"})),
  }),/admission rejected/);
});

test("native model_select hook switches on selection and restores prior client model on failure", async () => {
  const hooks=new Map(), selected=[],notifications=[];
  const pi={on:(event,hook)=>hooks.set(event,hook),setModel:async(model)=>selected.push(model.id)};
  const ctx={ui:{setStatus:()=>{},notify:(message)=>notifications.push(message)}};
  let fail=false;
  setupGatewayModelSelection(pi,async()=>({baseUrl:"https://gateway.example",apiKey:"key"}),{
    fetchImpl:async(_url,init)=>{
      selected.push(JSON.parse(init.body).model);
      return new Response(JSON.stringify(fail?{status:"failed",error:"bad profile"}:{status:"ready"}));
    },
  });
  await hooks.get("model_select")({model:{provider:"other",id:"skip"}},ctx);
  await hooks.get("model_select")({model:{provider:"openapi",id:"Bonsai"}},ctx);
  fail=true;
  await assert.rejects(hooks.get("model_select")({model:{provider:"openapi",id:"Qwen"},previousModel:{provider:"openapi",id:"Bonsai"}},ctx));
  assert.deepEqual(selected,["Bonsai","Qwen","Bonsai"]);
  assert.ok(notifications[0].includes("bad profile"));
});


test("OMP startup refreshes only its provider before selecting the model", async () => {
  const hooks=new Map(), calls=[];
  const pi={on:(event,hook)=>hooks.set(event,hook)};
  setupGatewayModelSelection(pi,async()=>({baseUrl:"https://gateway.example",apiKey:"key"}),{
    refreshCatalog:true,fetchImpl:async()=>{calls.push("select");return Response.json({status:"ready"});},
  });
  await hooks.get("session_start")({}, {model:{provider:"openapi",id:"Bonsai"},
    modelRegistry:{refreshProvider:async(id)=>calls.push(`refresh:${id}`)}});
  assert.deepEqual(calls,["refresh:openapi","select"]);
});

test("a new native selection supersedes the startup model during discovery refresh", async () => {
  const hooks = new Map(), selected = [];
  let completeRefresh;
  const refresh = new Promise(resolve => { completeRefresh = resolve; });
  const pi = {on: (event, hook) => hooks.set(event, hook)};
  setupGatewayModelSelection(pi, async () => ({baseUrl: "https://gateway.example", apiKey: "key"}), {
    refreshCatalog: true,
    fetchImpl: async (_url, init) => {
      selected.push(JSON.parse(init.body).model);
      return Response.json({status: "ready"});
    },
  });
  const startup = hooks.get("session_start")({}, {
    model: {provider: "openapi", id: "Bonsai"},
    modelRegistry: {refreshProvider: async () => refresh},
  });
  await hooks.get("model_select")({model: {provider: "openapi", id: "Ornith"}}, {});
  completeRefresh();
  await startup;
  assert.deepEqual(selected, ["Ornith"]);
});

test("OMP reconciles a changed explicit choice before generation without reselecting unchanged models", async () => {
  const hooks = new Map(), selected = [];
  setupGatewayModelSelection({on: (event, hook) => hooks.set(event, hook)},
    async () => ({baseUrl: "https://gateway.example", apiKey: "key"}), {
      reconcileBeforeAgentStart: true,
      fetchImpl: async (_url, init) => {
        selected.push(JSON.parse(init.body).model);
        return Response.json({status: "ready"});
      },
    });
  await hooks.get("session_start")({}, {model: {provider: "openapi", id: "Bonsai"}});
  await hooks.get("before_agent_start")({}, {model: {provider: "openapi", id: "Ornith"}});
  await hooks.get("before_agent_start")({}, {model: {provider: "openapi", id: "Ornith"}});
  await hooks.get("before_agent_start")({}, {model: {provider: "other", id: "skip"}});
  assert.deepEqual(selected, ["Bonsai", "Ornith"]);
});

test("OMP generation during startup refresh supersedes the stale startup choice", async () => {
  const hooks = new Map(), selected = [];
  let finish;
  const refresh = new Promise(resolve => { finish = resolve; });
  setupGatewayModelSelection({on: (event, hook) => hooks.set(event, hook)},
    async () => ({baseUrl: "https://gateway.example", apiKey: "key"}), {
      refreshCatalog: true, reconcileBeforeAgentStart: true,
      fetchImpl: async (_url, init) => {
        selected.push(JSON.parse(init.body).model);
        return Response.json({status: "ready"});
      },
    });
  const startup = hooks.get("session_start")({}, {
    model: {provider: "openapi", id: "Bonsai"},
    modelRegistry: {refreshProvider: async () => refresh},
  });
  await hooks.get("before_agent_start")({}, {model: {provider: "openapi", id: "Ornith"}});
  finish();
  await startup;
  assert.deepEqual(selected, ["Ornith"]);
});

test("Pi selection recognizes the OpenAPI provider ID", async () => {
  const hooks = new Map();
  const pi = { on: (event, handler) => hooks.set(event, handler) };
  const calls = [];
  setupGatewayModelSelection(pi, async () => ({ baseUrl: "https://gateway.example", apiKey: "test" }), {
    providerId: "OpenAPI",
    fetchImpl: async () => { calls.push("select"); return Response.json({status: "completed"}); },
  });
  await hooks.get("model_select")({ model: {provider: "OpenAPI", id: "model"} }, {});
  assert.deepEqual(calls, ["select"]);
});

test("discovers configured provider on startup without selecting a different model", async () => {
  const hooks = new Map(), calls = [];
  const pi = { on: (event, handler) => hooks.set(event, handler) };
  setupGatewayModelSelection(pi, async () => ({ baseUrl: "https://gateway.example", apiKey: "test" }), {providerId:"OpenAPI", refreshCatalog:true});
  await hooks.get("session_start")({}, { model: {provider:"another", id:"model"}, modelRegistry: { refresh: async ({providers}) => { calls.push(providers); return {errors: new Map()}; } } });
  assert.deepEqual(calls, [["OpenAPI"]]);
});
