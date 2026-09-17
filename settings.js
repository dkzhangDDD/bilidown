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
  // ASR (speech-to-text) providers live in their own registry so chat and
  // speech-to-text choices can evolve independently. Bailian fun-asr uses
  // DashScope OSS-backed async tasks; minimasr-1.0 uses a synchronous
  // multipart POST; local Whisper targets a user-run HTTP server. All
  // implementations live in background.js and are selected via dispatchAsr().
  const DEFAULT_ASR_PROVIDER = "bailian";
  const ASR_PROVIDERS = Object.freeze({
    bailian: {
      label: "Aliyun Bailian (Fun-ASR)",
      endpoint: "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
      model: "fun-asr",
      maxBytes: Infinity,
      maxSeconds: Infinity,
      keyField: "asrApiKey",
    },
    minimax: {
      label: "minimasr (asr-1.0)",
      endpoint: "https://api.minimaxi.com/v1/speech_to_text",
      model: "asr-1.0",
      // Hard limits from minimasr docs: 50 MB per request, 500 s.
      maxBytes: 50 * 1024 * 1024,
      maxSeconds: 500,
      // Reuse minimaxApiKey so users do not paste the same key twice.
      keyField: "minimaxApiKey",
    },
    whisper: {
      label: "Local Whisper",
      endpoint: "http://127.0.0.1:9000/v1/audio/transcriptions",
      model: "large-v3-turbo",
      maxBytes: Infinity,
      maxSeconds: Infinity,
      keyField: "whisperApiKey",
      keyOptional: true,
    },
  });
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
    asrProvider: DEFAULT_ASR_PROVIDER,
    asrApiKey: "",
    whisperEndpoint: ASR_PROVIDERS.whisper.endpoint,
    whisperModel: ASR_PROVIDERS.whisper.model,
    whisperApiKey: "",
    supadataApiKey: "",
  });

  function isKnownProvider(value) {
    return Object.prototype.hasOwnProperty.call(AI_PROVIDERS, value);
  }
  function isKnownAsrProvider(value) {
    return Object.prototype.hasOwnProperty.call(ASR_PROVIDERS, value);
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
  function normalizeAsrProvider(input) {
    // Pre-1.2 settings only had asrApiKey without asrProvider.
    // If a key is present and the provider is unset, default to
    // Bailian - this is the only provider that ever populated it.
    if (input && isKnownAsrProvider(input.asrProvider)) return input.asrProvider;
    if (input && typeof input.asrApiKey === "string" && input.asrApiKey.trim()) {
      return "bailian";
    }
    return DEFAULT_ASR_PROVIDER;
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
    const legacyWhisperEndpoint =
      "http://127.0.0.1:8000/v1/audio/transcriptions";
    const whisperEndpoint =
      input.whisperEndpoint === undefined
        ? DEFAULTS.whisperEndpoint
        : trimString(input.whisperEndpoint);
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
      asrProvider: normalizeAsrProvider(input),
      asrApiKey: trimString(input.asrApiKey),
      whisperEndpoint:
        whisperEndpoint === legacyWhisperEndpoint
          ? DEFAULTS.whisperEndpoint
          : whisperEndpoint,
      whisperModel:
        input.whisperModel === undefined
          ? DEFAULTS.whisperModel
          : trimString(input.whisperModel),
      whisperApiKey: trimString(input.whisperApiKey),
      supadataApiKey: trimString(input.supadataApiKey),
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
  /**
   * Resolve the active API key for the current ASR provider.
   * Each ASR provider reuses a known field; bailian -> asrApiKey,
   * minimax -> minimaxApiKey (same field as the chat provider).
   * Returns "" for unknown providers so the dispatcher can detect
   * "no key configured".
   */
  function resolveAsrApiKey(settings = {}) {
    const provider = settings.asrProvider || DEFAULT_ASR_PROVIDER;
    const meta = ASR_PROVIDERS[provider];
    if (!meta) return "";
    return trimString(settings[meta.keyField]);
  }

  function resolveAsrEndpoint(settings = {}) {
    const provider = settings.asrProvider || DEFAULT_ASR_PROVIDER;
    const meta = ASR_PROVIDERS[provider];
    if (!meta) return "";
    if (provider === "whisper") {
      return trimString(settings.whisperEndpoint) || meta.endpoint;
    }
    return meta.endpoint;
  }

  function resolveAsrModel(settings = {}) {
    const provider = settings.asrProvider || DEFAULT_ASR_PROVIDER;
    const meta = ASR_PROVIDERS[provider];
    if (!meta) return "";
    if (provider === "whisper") {
      return trimString(settings.whisperModel) || meta.model;
    }
    return meta.model;
  }

  function isValidWhisperEndpoint(value) {
    try {
      const url = new URL(trimString(value));
      return (
        url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      );
    } catch (_error) {
      return false;
    }
  }

  function isAsrProviderConfigured(settings = {}) {
    const provider = settings.asrProvider || DEFAULT_ASR_PROVIDER;
    const meta = ASR_PROVIDERS[provider];
    if (!meta) return false;
    if (meta.keyOptional) {
      return !!resolveAsrEndpoint(settings);
    }
    return !!resolveAsrApiKey(settings);
  }

  function canonicalBilibiliUrl(videoId) {
    const normalized = String(videoId || "").trim();
    if (!/^BV[A-Za-z0-9]{10}$/.test(normalized)) {
      throw new Error("Invalid Bilibili BV ID.");
    }
    return `https://www.bilibili.com/video/${normalized}`;
  }

  function canonicalYouTubeUrl(videoId) {
    const normalized = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(normalized)) {
      throw new Error("Invalid YouTube video ID.");
    }
    return `https://www.youtube.com/watch?v=${normalized}`;
  }

  function detectPlatform(url) {
    try {
      const parsed = new URL(String(url || ""));
      if (
        parsed.hostname.endsWith("bilibili.com") &&
        /^\/video\/BV[A-Za-z0-9]{10}/i.test(parsed.pathname)
      ) {
        return "bilibili";
      }
      if (
        parsed.hostname === "youtu.be" ||
        parsed.hostname === "youtube.com" ||
        parsed.hostname.endsWith(".youtube.com")
      ) {
        return "youtube";
      }
      return null;
    } catch (_error) {
      return null;
    }
  }

  function isSupportedVideoUrl(url) {
    return detectPlatform(url) !== null;
  }

  /**
   * Removes model reasoning wrappers that some OpenAI-compatible providers
   * include in message.content. Only the final user-facing answer should reach
   * the summary UI or cache.
   */
  function stripReasoningTags(value) {
    if (typeof value !== "string") return "";
    let text = value;
    text = text.replace(
      /<\s*(?:think|thinking|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*(?:think|thinking|reasoning)\s*>/gi,
      "",
    );
    // Also handle an unclosed reasoning block so its contents cannot leak.
    text = text.replace(
      /<\s*(?:think|thinking|reasoning)\b[^>]*>[\s\S]*$/gi,
      "",
    );
    text = text.replace(
      /<\s*\/\s*(?:think|thinking|reasoning)\s*>/gi,
      "",
    );
    return text.trim();
  }

  return {
    STORAGE_KEY,
    DEFAULTS,
    AI_PROVIDERS,
    ASR_PROVIDERS,
    DEFAULT_ASR_PROVIDER,
    isKnownAsrProvider,
    DEFAULT_PROVIDER,
    isKnownProvider,
    isLegacyCustom,
    normalize,
    migrateLegacyCustom,
    chatCompletionsUrl,
    resolveAiApiKey,
    resolveAsrApiKey,
    resolveAsrEndpoint,
    resolveAsrModel,
    isValidWhisperEndpoint,
    isAsrProviderConfigured,
    canonicalBilibiliUrl,
    canonicalYouTubeUrl,
    detectPlatform,
    isSupportedVideoUrl,
    stripReasoningTags,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_SETTINGS;
}
