/**
 * Shared, non-secret configuration helpers.
 *
 * API keys are stored in chrome.storage.local by options.js. This file contains
 * defaults and validation only, so it is safe to publish.
 */
var YTD_SETTINGS = (() => {
  const STORAGE_KEY = "ytd_settings";
  const DEFAULT_PROVIDER = "deepseek";

  /**
   * Built-in AI providers. Each entry maps to a preset base URL + model name.
   * `custom` keeps the user-entered base URL / model instead.
   * Add future models here as new entries (plus options UI options).
   */
  const AI_PROVIDERS = Object.freeze({
    deepseek: {
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    },
    minimax: {
      label: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
      model: "MiniMax-M3",
    },
    custom: {
      label: "Custom",
      baseUrl: "",
      model: "",
    },
  });

  const DEFAULTS = Object.freeze({
    provider: DEFAULT_PROVIDER,
    aiApiKey: "",
    minimaxApiKey: "",
    customApiKey: "",
    aiBaseUrl: AI_PROVIDERS[DEFAULT_PROVIDER].baseUrl,
    aiModel: AI_PROVIDERS[DEFAULT_PROVIDER].model,
    customBaseUrl: "",
    customModel: "",
    asrApiKey: "",
    supadataApiKey: "",
  });

  function isKnownProvider(value) {
    return Object.prototype.hasOwnProperty.call(AI_PROVIDERS, value);
  }

  /**
   * Legacy "custom" rows (pre-1.0.2) only had provider + aiApiKey and no
   * customBaseUrl/customModel fields. Treat them as unsafe leftovers: reset
   * to DeepSeek and clear the key so the user re-enters it consciously.
   */
  function isLegacyCustom(input) {
    return (
      !!input &&
      input.provider === "custom" &&
      typeof input.customBaseUrl !== "string"
    );
  }

  function normalizeProvider(input) {
    return isKnownProvider(input.provider) ? input.provider : DEFAULT_PROVIDER;
  }

  function trimString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalize(input = {}) {
    const legacyCustom = isLegacyCustom(input);
    const provider = legacyCustom
      ? DEFAULT_PROVIDER
      : normalizeProvider(input);
    const isCustom = provider === "custom";
    return {
      provider,
      aiApiKey: legacyCustom ? "" : trimString(input.aiApiKey),
      minimaxApiKey: trimString(input.minimaxApiKey),
      customApiKey: trimString(input.customApiKey),
      aiBaseUrl: isCustom
        ? trimString(input.customBaseUrl)
        : AI_PROVIDERS[provider].baseUrl,
      aiModel: isCustom
        ? trimString(input.customModel)
        : AI_PROVIDERS[provider].model,
      customBaseUrl: trimString(input.customBaseUrl),
      customModel: trimString(input.customModel),
      asrApiKey: trimString(input.asrApiKey),
      supadataApiKey: "",
    };
  }

  function migrateLegacyCustom(input = {}) {
    return {
      settings: normalize(input),
      migrated: isLegacyCustom(input),
    };
  }

  function chatCompletionsUrl(baseUrl = DEFAULTS.aiBaseUrl) {
    const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
    return `${normalized}/chat/completions`;
  }

  /**
   * Resolve the active API key for the current provider.
   * Each provider keeps its own key so switching never loses credentials.
   */
  function resolveAiApiKey(settings = {}) {
    const provider = settings.provider || DEFAULT_PROVIDER;
    if (provider === "minimax") return settings.minimaxApiKey || "";
    if (provider === "custom") return settings.customApiKey || "";
    return settings.aiApiKey || "";
  }

  function canonicalBilibiliUrl(videoId) {
    const normalized = String(videoId || "").trim();
    if (!/^BV[A-Za-z0-9]{10}$/.test(normalized)) {
      throw new Error("Invalid Bilibili BV ID.");
    }
    return `https://www.bilibili.com/video/${normalized}`;
  }

  return {
    STORAGE_KEY,
    DEFAULTS,
    AI_PROVIDERS,
    DEFAULT_PROVIDER,
    isKnownProvider,
    isLegacyCustom,
    normalize,
    migrateLegacyCustom,
    chatCompletionsUrl,
    resolveAiApiKey,
    canonicalBilibiliUrl,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_SETTINGS;
}
