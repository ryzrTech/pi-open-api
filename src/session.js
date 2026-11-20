/** Add Pi's per-conversation ID independently of prompt-cache configuration. */
export function withSessionHeader(api) {
  const withId = (options) => {
    const id = options?.sessionId;
    if (typeof id !== "string" || !id || id.length > 160 || !/^[\x20-\x7e]+$/.test(id)) return options;
    return { ...options, headers: { ...options.headers, "x-session-id": id } };
  };
  return {
    ...api,
    stream: (model, context, options) => api.stream(model, context, withId(options)),
    streamSimple: (model, context, options) => api.streamSimple(model, context, withId(options)),
  };
}
