const COST_HEADERS = [
  "x-asg-response-cost",
  "X-Asg-Response-Cost",
  "x-litellm-response-cost",
  "X-Litellm-Response-Cost",
];

export function setupGatewayCostTracking(pi, providerId = "openapi") {
  const pendingResponseCosts = new Map();

  pi.on("after_provider_response", (event, ctx) => {
    if (ctx.model?.provider !== providerId) return;

    const rawCost = COST_HEADERS.map((name) => event.headers?.[name]).find(
      (value) => value !== undefined && value !== null && value !== "",
    );
    const cost = Number.parseFloat(String(rawCost ?? ""));
    if (Number.isFinite(cost) && cost >= 0) {
      pendingResponseCosts.set(providerId, cost);
      return;
    }
    pendingResponseCosts.delete(providerId);
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "assistant" || event.message.provider !== providerId) return;
    const usage = event.message.usage;
    if (!usage) return;

    const totalCost = pendingResponseCosts.get(providerId);
    if (totalCost === undefined) return;
    pendingResponseCosts.delete(providerId);

    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite = usage.cacheWrite ?? 0;
    const totalTokens = usage.input + usage.output + cacheRead + cacheWrite;
    const apportioned = (tokens) => (totalTokens > 0 ? totalCost * (tokens / totalTokens) : 0);

    return {
      message: {
        ...event.message,
        usage: {
          ...usage,
          cost: {
            input: apportioned(usage.input),
            output: apportioned(usage.output),
            cacheRead: apportioned(cacheRead),
            cacheWrite: apportioned(cacheWrite),
            total: totalCost,
          },
        },
      },
    };
  });
}
