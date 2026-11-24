(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HttpClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Shared request helper for every external call made by the observatory.
  // It never invents data: every failure becomes a typed RequestError so the UI
  // can say *why* a value is unavailable (HTTP, JSON, network, timeout, aborted).
  const DEFAULT_TIMEOUT_MS = 15000;

  class RequestError extends Error {
    constructor(kind, message, details) {
      super(message);
      this.name = "RequestError";
      this.kind = kind; // "http" | "json" | "network" | "timeout" | "aborted"
      if (details && details.status !== undefined) this.status = details.status;
      if (details && details.cause !== undefined) this.cause = details.cause;
    }
  }

  function isAbortError(error) {
    return !!error && (error.name === "AbortError" || error.kind === "aborted" || error.kind === "timeout");
  }

  function hasAbortController() {
    return typeof AbortController === "function";
  }

  // Runs one request with an optional timeout and an optional caller signal.
  // `parse` is "json" (default), "text" or "none" (returns the Response).
  async function request(url, options) {
    const config = options || {};
    const fetcher = config.fetch || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) throw new RequestError("network", "Fetch implementation is unavailable");
    const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
    const parse = config.parse || "json";
    const external = config.signal || null;
    if (external && external.aborted) throw new RequestError("aborted", "Request was cancelled");

    const controller = hasAbortController() ? new AbortController() : null;
    let timedOut = false;
    let cancelled = false;
    let rejectRace = null;
    const race = new Promise(function (_, reject) { rejectRace = reject; });
    race.catch(function () {});
    const timer = setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
      rejectRace(new RequestError("timeout", "Request timed out after " + timeoutMs + " ms"));
    }, timeoutMs);
    const onExternalAbort = function () {
      cancelled = true;
      if (controller) controller.abort();
      rejectRace(new RequestError("aborted", "Request was cancelled"));
    };
    if (external && typeof external.addEventListener === "function") {
      external.addEventListener("abort", onExternalAbort, { once: true });
    }
    const init = Object.assign({}, config.init || {});
    if (config.headers) init.headers = config.headers;
    if (controller) init.signal = controller.signal;

    try {
      let response;
      try {
        // The race guarantees a bounded wait even if the fetch implementation
        // ignores AbortSignal (older browsers or injected test doubles).
        response = await Promise.race([fetcher(url, init), race]);
      } catch (error) {
        if (error instanceof RequestError) throw error;
        if (timedOut) throw new RequestError("timeout", "Request timed out after " + timeoutMs + " ms", { cause: error });
        if (cancelled || (error && error.name === "AbortError")) throw new RequestError("aborted", "Request was cancelled", { cause: error });
        throw new RequestError("network", "Network request failed" + (error && error.message ? ": " + error.message : ""), { cause: error });
      }
      if (!response || !response.ok) {
        const status = response && response.status !== undefined ? response.status : 0;
        throw new RequestError("http", "HTTP " + status, { status: status });
      }
      if (parse === "none") return response;
      try {
        if (parse === "text") return await Promise.race([response.text(), race]);
        return await Promise.race([response.json(), race]);
      } catch (error) {
        if (error instanceof RequestError) throw error;
        if (timedOut) throw new RequestError("timeout", "Request timed out after " + timeoutMs + " ms", { cause: error });
        if (cancelled) throw new RequestError("aborted", "Request was cancelled", { cause: error });
        throw new RequestError(parse === "text" ? "network" : "json", parse === "text" ? "Response body could not be read" : "Response is not valid JSON", { cause: error });
      }
    } finally {
      clearTimeout(timer);
      if (external && typeof external.removeEventListener === "function") {
        external.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  // Tracks "the latest request" for a UI control. start() cancels the previous
  // request (when AbortController exists) and returns a token whose isCurrent()
  // lets the caller discard late responses even where abort is unsupported.
  function createLatestTracker() {
    let sequence = 0;
    let controller = null;
    return {
      start: function () {
        if (controller) controller.abort();
        controller = hasAbortController() ? new AbortController() : null;
        const id = ++sequence;
        const own = controller;
        return {
          id: id,
          signal: own ? own.signal : undefined,
          isCurrent: function () { return id === sequence; }
        };
      },
      cancel: function () {
        if (controller) controller.abort();
        controller = null;
        sequence++;
      }
    };
  }

  // Arabic, user-facing explanation of a failure. Keeps the technical kind visible.
  function describeError(error) {
    if (!error) return "خطأ غير معروف";
    switch (error.kind) {
      case "timeout": return "انتهت مهلة الاتصال بالخدمة";
      case "aborted": return "أُلغي الطلب لصالح طلب أحدث";
      case "http": return "استجابة غير ناجحة من الخدمة (" + error.message + ")";
      case "json": return "استجابة الخدمة ليست بيانات JSON صالحة";
      case "network": return "تعذر الوصول إلى الخدمة (انقطاع الشبكة أو حظر CORS)";
      default: return error.message || "خطأ غير معروف";
    }
  }

  return { request, createLatestTracker, describeError, isAbortError, RequestError, DEFAULT_TIMEOUT_MS };
});
