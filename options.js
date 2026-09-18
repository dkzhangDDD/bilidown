const YTD_OPTIONS = (() => {
  const LANGUAGE_STORAGE_KEY = "ytd_options_language";
  const PREVIEW_STORAGE_PREFIX = "bilidownPreview:";
  const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN"]);

  const COPY = {
    en: {
      pageTitle: "bilidown Settings",
      languageGroupLabel: "Interface language",
      heading: "Bring your own API keys",
      lede:
        "Keys stay in this Chrome profile. Bilibili audio is sent only to the ASR service you select. YouTube native captions are requested from Supadata, while transcripts and context are sent to your chosen AI provider.",
      asrService: "Bilibili recognition",
      asrServiceIntro:
        "Bilibili native subtitles are checked first. Only when none are available does bilidown use the selected ASR provider.",
      asrProviderLabel: "Transcription engine",
      asrProviderBailian: "Aliyun Bailian Fun-ASR (recommended)",
      asrProviderMinimax: "minimasr asr-1.0",
      asrProviderWhisper: "Local Whisper",
      whisperEndpointLabel: "Local service URL",
      whisperModelLabel: "Model name",
      whisperApiKeyLabel: "API key (optional)",
      whisperAsrHelp:
        "Local OpenAI-compatible /v1/audio/transcriptions, also compatible with whisper.cpp /inference. For whisper.cpp add --convert and install ffmpeg, because Bilibili audio is M4A.",
      whisperGuideAriaLabel: "Local Whisper setup guide",
      whisperGuideSummary: "Local Whisper setup guide",
      whisperGuideStepInstall:
        "Install Python 3.10+, then run `pip install -r local-whisper\\requirements.txt`.",
      whisperGuideStepModel:
        "Run `local-whisper\\download_model.ps1` to download the Whisper and Chinese punctuation models.",
      whisperGuideStepStart:
        "Run `powershell -File local-whisper\\start.ps1` to start the service.",
      whisperGuideStepVerify:
        "Open http://127.0.0.1:9000/health and confirm both `status` and `punctuation_status` are `ready`.",
      whisperGuideStepFill:
        "In this extension settings: pick Local Whisper, URL `http://127.0.0.1:9000/v1/audio/transcriptions`, model name `large-v3-turbo`, leave API key empty.",
      whisperPrivacyNote:
        "The URL must use http://localhost or http://127.0.0.1. Audio is sent only to that local port and never to a developer server.",
      invalidWhisperEndpoint:
        "Enter an http://localhost or http://127.0.0.1 URL for Local Whisper.",
      bailianAsrKeyLabel: "Bailian API key",
      bailianAsrHelp:
        "bilinote downloads the B station audio, uploads it to a 48-hour Bailian staging bucket, and runs Fun-ASR async. Works for any video length.",
      bailianAsrLink: "Create a Bailian API key",
      bailianAsrHelpSuffix: ".",
      minimaxAsrHelp:
        "minimasr-1.0 uses a synchronous multipart upload - lower latency, no staging bucket. Limit: <=50 MB and <=500 seconds per request. Longer videos are rejected; switch to Bailian instead.",
      minimaxAsrKeyNote:
        "Reuses the MiniMax key you entered in the AI model section above. No second key required.",
      addAsrKey: "Add an API key for the selected ASR provider.",
      transcriptProvider: "YouTube recognition",
      supadataApiKeyLabel: "Supadata API key",
      supadataHelp: "Used to fetch timestamped YouTube native captions. ",
      supadataLink: "Create a Supadata account and key",
      supadataHelpSuffix:
        ". Supadata generates the key during onboarding.",
      aiProvider: "AI model",
      aiModelLabel: "AI model",
      providerCustom: "Custom",
      deepseekApiKeyLabel: "DeepSeek API key",
      deepseekHelp:
        "bilidown uses DeepSeek V4 Flash for overviews, explanations, translation, and note polishing. ",
      deepseekLink: "Create a DeepSeek API key",
      deepseekHelpSuffix: ".",
      minimaxApiKeyLabel: "MiniMax API key",
      minimaxHelp:
        'bilidown uses MiniMax M3 for overviews, summaries, translation, and note polishing. Token Plan subscribers can find their subscription key at <a href="https://platform.minimaxi.com" target="_blank" rel="noreferrer">MiniMax Open Platform</a> under Subscription Management &gt; Token Plan.',
      minimaxPrivacyNote:
        "When you use AI features, MiniMax receives the video transcript and relevant video context. Review MiniMax's terms and pricing before saving.",
      customApiKeyLabel: "API key",
      customBaseUrlLabel: "Base URL",
      customModelLabel: "Model name",
      customHelp:
        "The provider must expose an OpenAI-compatible /chat/completions endpoint. A trailing /v1 in the Base URL is fine.",
      privacyNote:
        "When you use AI features, DeepSeek receives the video transcript and relevant video context. Review DeepSeek's terms and pricing before saving.",
      saveSettings: "Save settings",
      localRemix: "Local remix",
      customizationTitle: "Want to use another AI model?",
      customizationPurpose: "Edit and copy a safe prompt for your coding agent",
      agentBadge: "Coding agent ready",
      customizationIntro:
        "You can edit the prompt directly. Complete these three steps before copying:",
      customizationStepFolder:
        "Open the extracted bilidown project folder in your coding agent.",
      customizationStepReplace:
        "Replace [PROVIDER] and [MODEL] with the service and model you want to use.",
      customizationStepKeys:
        "Never include API keys in the prompt or chat. Enter them yourself after the code is ready.",
      customizationPromptLabel: "Editable customization prompt",
      customizationReminderLabel: "Prompt reminder",
      customizationReminder:
        "Before copying, replace [PROVIDER] and [MODEL] with the provider and model you want to use.",
      customizationPrompt:
        "Customize this local bilidown workspace to use [PROVIDER] with [MODEL]. Work only in the current workspace. Before editing, verify that it contains manifest.json and that the manifest name is bilidown. If verification fails, stop and ask me to open the extracted bilidown project folder in my coding agent. Do not search other folders, edit a guessed copy, assume an installation path, or claim Chrome can reveal the absolute OS source path. Update the provider's API endpoint, request format, and minimum Chrome host permissions. Preserve bring-your-own-key and local Chrome storage. Never put API keys in source code, commits, logs, screenshots, this prompt, or chat; after the code is ready, tell me where to enter the key myself. Keep DeepSeek-only request fields and retry behavior isolated to DeepSeek. Handle provider-specific rules separately so one provider does not affect another. Update README.md, README.zh-CN.md, PRIVACY.md, SECURITY.md, and tests. Run npm test, npm run check, and npm run package. Then explain how to reload the unpacked extension and test it on a real Bilibili video.",
      copyCustomizationPrompt: "Copy edited prompt",
      localData: "Local data",
      localDataHelp:
        "Summaries, translations, and notes are stored only in this Chrome profile. You can remove them at any time.",
      clearCache: "Clear cached summaries",
      deleteNotes: "Delete all notes",
      resetData: "Reset content data (keep keys)",
      footer:
        'Read <a href="PRIVACY.md" target="_blank">PRIVACY.md</a> in the repository for the complete data-flow description.',
      migrationWarning:
        "Custom provider settings were removed safely. Your Supadata key was kept, but the AI key was cleared. Enter an API key for your AI model to continue.",
      saving: "Saving…",
      addSupadataKey: "Add a Supadata API key.",
      addDeepseekKey: "Add an API key for the selected AI model.",
      saved: "Settings saved and verified. bilidown will use them immediately.",
      saveFailed: "Could not save settings. Please try again.",
      copying: "Copying…",
      promptCopied: "Edited prompt copied.",
      copyFailed:
        "Could not copy the prompt. Select the prompt text and copy it manually.",
      clearedSummaries: ({ count }) =>
        `Cleared ${count} cached summar${count === 1 ? "y" : "ies"}.`,
      notesDeleted: "Deleted all saved notes.",
      resetConfirm:
        "Delete cached summaries, translations, and saved notes? Your API keys will be kept.",
      allDataDeleted:
        "Content data was reset. Your API keys were kept.",
      settingsLoadFailed:
        "Could not load saved settings. You can still preview this page.",
    },
    "zh-CN": {
      pageTitle: "bilidown 设置",
      languageGroupLabel: "界面语言",
      heading: "bilidown 设置",
      lede:
        "密钥仅保存在当前 Chrome 个人资料中。B 站音频只会发送给你选择的语音识别服务；YouTube 原生字幕由 Supadata 获取；字幕和视频上下文会发送给你选择的 AI 服务。",
      asrService: "B站识别",
      asrServiceIntro:
        "bilidown 会先检查 B 站原生字幕；只有没有可用字幕时，才使用所选的语音识别服务。",
      asrProviderLabel: "识别引擎",
      asrProviderBailian: "阿里云百炼 Fun-ASR（首推）",
      asrProviderMinimax: "minimasr asr-1.0",
      asrProviderWhisper: "本地 Whisper",
      whisperEndpointLabel: "本机服务地址",
      whisperModelLabel: "模型名称",
      whisperApiKeyLabel: "API Key（可选）",
      whisperAsrHelp:
        "走本地 OpenAI 兼容的 /v1/audio/transcriptions，也兼容 whisper.cpp 的 /inference。使用 whisper.cpp 时请加 --convert 并装 ffmpeg，因为 B 站音轨是 M4A。",
      whisperGuideAriaLabel: "本地 Whisper 启动指引",
      whisperGuideSummary: "本地 Whisper 启动指引",
      whisperGuideStepInstall:
        "装好 Python 3.10+，运行 `pip install -r local-whisper\\requirements.txt`。",
      whisperGuideStepModel:
        "运行 `local-whisper\\download_model.ps1` 下载 Whisper 和中文标点模型。",
      whisperGuideStepStart:
        "运行 `powershell -File local-whisper\\start.ps1` 启动服务。",
      whisperGuideStepVerify:
        "打开 http://127.0.0.1:9000/health，确认 `status` 与 `punctuation_status` 都为 `ready`。",
      whisperGuideStepFill:
        "回到本扩展设置：识别引擎选「本地 Whisper」，地址填 `http://127.0.0.1:9000/v1/audio/transcriptions`，模型名称填 `large-v3-turbo`，API Key 留空。",
      whisperPrivacyNote:
        "地址必须使用 http://localhost 或 http://127.0.0.1。音频只发送到本机端口，不会经过开发者服务器。",
      invalidWhisperEndpoint:
        "请为本地 Whisper 填写 http://localhost 或 http://127.0.0.1 开头的服务地址。",
      bailianAsrKeyLabel: "百炼 API 密钥",
      bailianAsrHelp:
        "bilinote 会下载当前B站音轨，上传到百炼 48 小时临时空间，使用 Fun-ASR 异步识别生成带时间戳字幕，适合任意时长。",
      bailianAsrLink: "创建百炼 API 密钥",
      bailianAsrHelpSuffix: "。",
      minimaxAsrHelp:
        "minimasr-1.0 直接 multipart 上传音轨，无需中转，延迟低。限制：单文件 &le; 50 MB 且 &le; 500 秒；长视频会被拒绝，请改用阿里百炼。",
      minimaxAsrKeyNote:
        "复用上方「AI 服务」中填写的 MiniMax Key，无需在此重复填写。",
      addAsrKey: "请为当前选择的语音识别服务填写 API 密钥。",
      transcriptProvider: "YouTube识别",
      supadataApiKeyLabel: "Supadata API 密钥",
      supadataHelp: "用于获取带时间戳的 YouTube 原生字幕。",
      supadataLink: "创建 Supadata 账号并获取密钥",
      supadataHelpSuffix: "。Supadata 会在引导流程中生成密钥。",
      aiProvider: "AI 模型",
      aiModelLabel: "AI 模型",
      providerCustom: "自定义",
      deepseekApiKeyLabel: "DeepSeek API 密钥",
      deepseekHelp:
        "bilidown 使用 DeepSeek V4 Flash 生成概览、解释内容、翻译字幕和润色笔记。",
      deepseekLink: "创建 DeepSeek API 密钥",
      deepseekHelpSuffix: "。",
      minimaxApiKeyLabel: "MiniMax API 密钥",
      minimaxHelp:
        'bilidown 使用 MiniMax M3 生成概览、总结、翻译与润色。包月 Token Plan 用户请在<a href="https://platform.minimaxi.com" target="_blank" rel="noreferrer">MiniMax 开放平台</a>「订阅管理 &gt; Token Plan」查看订阅 Key。',
      minimaxPrivacyNote:
        "使用 AI 功能时，MiniMax 会收到视频字幕及相关视频上下文。保存前请查看 MiniMax 的服务条款和价格。",
      customApiKeyLabel: "API 密钥",
      customBaseUrlLabel: "Base URL",
      customModelLabel: "模型名称",
      customHelp:
        "服务商需提供 OpenAI 兼容的 /chat/completions 接口。Base URL 以 /v1 结尾也没关系，会自动拼接。",
      privacyNote:
        "使用 AI 功能时，DeepSeek 会收到视频字幕及相关视频上下文。保存前请查看 DeepSeek 的服务条款和价格。",
      saveSettings: "保存设置",
      localRemix: "本地改造",
      customizationTitle: "想使用其他 AI 模型？",
      customizationPurpose: "编辑并复制一段可安全交给编程 Agent 的提示词",
      agentBadge: "可交给编程 Agent",
      customizationIntro: "你可以直接编辑提示词。复制前完成以下三步：",
      customizationStepFolder:
        "在编程 Agent 中打开 bilidown 解压后的项目文件夹。",
      customizationStepReplace:
        "把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationStepKeys:
        "不要在提示词或聊天中加入 API 密钥。代码准备好后，请自行填写。",
      customizationPromptLabel: "可编辑的自定义提示词",
      customizationReminderLabel: "提示词提醒",
      customizationReminder:
        "复制前，请先把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationPrompt:
        "请把当前本地 bilidown 工作区改为使用 [PROVIDER] 提供的 [MODEL]。只在当前工作区中操作。编辑前，先确认其中包含 manifest.json，且 manifest 中的 name 是 bilidown。如果验证失败，请停止，并让我在编程 Agent 中打开 bilidown 解压后的项目文件夹。不要搜索其他文件夹，不要编辑猜测的副本，不要假设安装路径，也不要声称 Chrome 可以显示操作系统中的绝对源码路径。更新该服务的 API endpoint、请求格式和最少的 Chrome host permissions。保留用户自带密钥模式和 Chrome 本地存储。不要把 API 密钥写入源代码、提交记录、日志、截图、这段提示词或聊天；代码准备好后，请告诉我应该在哪里自行填写密钥。DeepSeek 专用的请求参数和重试逻辑继续只用于 DeepSeek。新服务的专属规则请单独处理，避免相互影响。更新 README.md、README.zh-CN.md、PRIVACY.md、SECURITY.md 和测试。运行 npm test、npm run check 和 npm run package。最后，说明如何重新加载已解压的扩展，并在真实 Bilibili 视频上测试。",
      copyCustomizationPrompt: "复制编辑后的提示词",
      localData: "本地数据",
      localDataHelp:
        "摘要、翻译和笔记仅保存在当前 Chrome 个人资料中。你可以随时删除。",
      clearCache: "清除缓存的摘要",
      deleteNotes: "删除全部笔记",
      resetData: "重置内容数据（保留密钥）",
      footer:
        '完整数据流说明请参阅仓库中的 <a href="PRIVACY.md" target="_blank">PRIVACY.md</a>。',
      migrationWarning:
        "已安全移除自定义服务设置。Supadata 密钥已保留，AI 密钥已清除。请为 AI 模型重新输入密钥。",
      saving: "正在保存…",
      addSupadataKey: "请添加 Supadata API 密钥。",
      addDeepseekKey: "请为当前选择的 AI 模型添加 API 密钥。",
      saved: "设置已保存并验证成功，bilidown 将立即使用新配置。",
      saveFailed: "无法保存设置，请重试。",
      copying: "正在复制…",
      promptCopied: "已复制编辑后的提示词。",
      copyFailed: "无法复制提示词。请选中提示词文本并手动复制。",
      clearedSummaries: ({ count }) => `已清除 ${count} 条缓存摘要。`,
      notesDeleted: "已删除全部已保存的笔记。",
      resetConfirm:
        "要删除缓存摘要、翻译和已保存的笔记吗？DeepSeek 与百炼 API 密钥会保留。",
      allDataDeleted: "已重置内容数据，API 密钥已保留。",
      settingsLoadFailed: "无法加载已保存的设置，但你仍可预览此页面。",
    },
  };

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.has(language) ? language : "en";
  }

  function translate(language, key, params = {}) {
    const normalizedLanguage = normalizeLanguage(language);
    const value = COPY[normalizedLanguage][key] ?? COPY.en[key] ?? "";
    return typeof value === "function" ? value(params) : value;
  }

  function createStorageAdapter(chromeApi, fallbackStorage) {
    const chromeStorage = chromeApi?.storage?.local;
    const memoryStorage = new Map();

    function fallbackKeys() {
      const keys = [];
      if (!fallbackStorage) return keys;
      try {
        for (let index = 0; index < fallbackStorage.length; index += 1) {
          const key = fallbackStorage.key(index);
          if (key?.startsWith(PREVIEW_STORAGE_PREFIX)) keys.push(key);
        }
      } catch (_error) {
        return [];
      }
      return keys;
    }

    function readFallbackValue(key) {
      try {
        const rawValue = fallbackStorage?.getItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
        );
        if (rawValue !== null && rawValue !== undefined) {
          return JSON.parse(rawValue);
        }
      } catch (_error) {
        // Fall through to memory when localStorage is unavailable or malformed.
      }
      return memoryStorage.get(key);
    }

    function writeFallbackValue(key, value) {
      memoryStorage.set(key, value);
      try {
        fallbackStorage?.setItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
          JSON.stringify(value),
        );
      } catch (_error) {
        // The in-memory copy keeps a restricted preview functional.
      }
    }

    return {
      async get(keys) {
        if (chromeStorage) return chromeStorage.get(keys);

        const requestedKeys =
          keys === null
            ? [
                ...new Set([
                  ...memoryStorage.keys(),
                  ...fallbackKeys().map((key) =>
                    key.slice(PREVIEW_STORAGE_PREFIX.length),
                  ),
                ]),
              ]
            : Array.isArray(keys)
              ? keys
              : [keys];

        return Object.fromEntries(
          requestedKeys
            .map((key) => [key, readFallbackValue(key)])
            .filter(([, value]) => value !== undefined),
        );
      },

      async set(items) {
        if (chromeStorage) return chromeStorage.set(items);
        for (const [key, value] of Object.entries(items)) {
          writeFallbackValue(key, value);
        }
      },

      async remove(keys) {
        if (chromeStorage) return chromeStorage.remove(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          memoryStorage.delete(key);
          try {
            fallbackStorage?.removeItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
          } catch (_error) {
            // Memory removal is sufficient for this preview session.
          }
        }
      },

      async clear() {
        if (chromeStorage) return chromeStorage.clear();
        memoryStorage.clear();
        for (const key of fallbackKeys()) {
          try {
            fallbackStorage.removeItem(key);
          } catch (_error) {
            // Continue clearing any remaining preview keys.
          }
        }
      },
    };
  }

  async function readPreferredLanguage(storage) {
    const stored = await storage.get(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(stored[LANGUAGE_STORAGE_KEY]);
  }

  async function persistPreferredLanguage(storage, language) {
    const normalizedLanguage = normalizeLanguage(language);
    await storage.set({ [LANGUAGE_STORAGE_KEY]: normalizedLanguage });
    return normalizedLanguage;
  }

  async function resetContentData(storage, settingsKey, language) {
    const stored = await storage.get(settingsKey);
    const savedSettings = stored[settingsKey];

    await storage.clear();

    const restored = {
      [LANGUAGE_STORAGE_KEY]: normalizeLanguage(language),
    };
    if (savedSettings && typeof savedSettings === "object") {
      restored[settingsKey] = savedSettings;
    }
    await storage.set(restored);

    return savedSettings || null;
  }

  async function persistAndVerifySettings(storage, settingsKey, settings) {
    await storage.set({ [settingsKey]: settings });
    const stored = await storage.get(settingsKey);
    const verified = stored[settingsKey];
    if (
      !verified ||
      verified.aiApiKey !== settings.aiApiKey ||
      verified.minimaxApiKey !== settings.minimaxApiKey ||
      verified.customApiKey !== settings.customApiKey ||
      verified.asrApiKey !== settings.asrApiKey ||
      verified.whisperEndpoint !== settings.whisperEndpoint ||
      verified.whisperModel !== settings.whisperModel ||
      verified.whisperApiKey !== settings.whisperApiKey ||
      verified.supadataApiKey !== settings.supadataApiKey
    ) {
      throw new Error("SETTINGS_WRITE_VERIFICATION_FAILED");
    }
    return verified;
  }

  function updateLanguageButtonState(buttons, language) {
    const normalizedLanguage = normalizeLanguage(language);
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.language === normalizedLanguage),
      );
    }
  }

  function updateLocalizedPrompt(textarea, prompt) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectionDirection = textarea.selectionDirection;
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;

    textarea.value = prompt;

    if (
      Number.isInteger(selectionStart) &&
      Number.isInteger(selectionEnd) &&
      typeof textarea.setSelectionRange === "function"
    ) {
      textarea.setSelectionRange(
        Math.min(selectionStart, prompt.length),
        Math.min(selectionEnd, prompt.length),
        selectionDirection || "none",
      );
    }
    textarea.scrollTop = scrollTop;
    textarea.scrollLeft = scrollLeft;
  }

  function createPromptDrafts() {
    return {
      en: translate("en", "customizationPrompt"),
      "zh-CN": translate("zh-CN", "customizationPrompt"),
    };
  }

  function switchPromptDraft(
    drafts,
    currentLanguage,
    nextLanguage,
    currentValue,
  ) {
    const normalizedCurrentLanguage = normalizeLanguage(currentLanguage);
    const normalizedNextLanguage = normalizeLanguage(nextLanguage);
    drafts[normalizedCurrentLanguage] = String(currentValue ?? "");
    if (typeof drafts[normalizedNextLanguage] !== "string") {
      drafts[normalizedNextLanguage] = translate(
        normalizedNextLanguage,
        "customizationPrompt",
      );
    }
    return {
      language: normalizedNextLanguage,
      prompt: drafts[normalizedNextLanguage],
    };
  }

  async function copyPromptValue(clipboard, value) {
    await clipboard.writeText(value);
  }

  function getSafeLocalStorage(root) {
    try {
      return root.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function initialize(root = globalThis) {
    const doc = root.document;
    const settingsApi = root.YTD_SETTINGS;
    if (!doc || !settingsApi) return;

    const storage = createStorageAdapter(
      root.chrome,
      getSafeLocalStorage(root),
    );
    const form = doc.getElementById("settingsForm");
    const providerSelect = doc.getElementById("aiProviderSelect");
    const aiApiKeyInput = doc.getElementById("aiApiKey");
    const minimaxApiKeyInput = doc.getElementById("minimaxApiKey");
    const customApiKeyInput = doc.getElementById("customApiKey");
    const customBaseUrlInput = doc.getElementById("customBaseUrl");
    const customModelInput = doc.getElementById("customModel");
    const deepseekProviderGroup = doc.getElementById("deepseekProviderGroup");
    const minimaxProviderGroup = doc.getElementById("minimaxProviderGroup");
    const customProviderGroup = doc.getElementById("customProviderGroup");
    const asrApiKeyInput = doc.getElementById("asrApiKey");
    const asrProviderSelect = doc.getElementById("asrProviderSelect");
    const supadataApiKeyInput = doc.getElementById("supadataApiKey");
    const bailianAsrGroup = doc.getElementById("bailianAsrGroup");
    const minimaxAsrGroup = doc.getElementById("minimaxAsrGroup");
    const whisperAsrGroup = doc.getElementById("whisperAsrGroup");
    const whisperEndpointInput = doc.getElementById("whisperEndpoint");
    const whisperModelInput = doc.getElementById("whisperModel");
    const whisperApiKeyInput = doc.getElementById("whisperApiKey");
    const customizationPrompt = doc.getElementById("customizationPrompt");
    const copyCustomizationPromptBtn = doc.getElementById(
      "copyCustomizationPromptBtn",
    );
    const copyStatus = doc.getElementById("copyStatus");
    const saveStatus = doc.getElementById("saveStatus");
    const dataStatus = doc.getElementById("dataStatus");
    const languageButtons = [...doc.querySelectorAll("[data-language]")];
    const statusStates = new Map();
    const promptDrafts = createPromptDrafts();
    let currentLanguage = "en";

    function renderStatus(element) {
      const state = statusStates.get(element);
      element.textContent = state
        ? translate(currentLanguage, state.key, state.params)
        : "";
    }

    function applyProviderSelection(provider) {
      const normalized = settingsApi.isKnownProvider(provider)
        ? provider
        : settingsApi.DEFAULT_PROVIDER;
      providerSelect.value = normalized;
      deepseekProviderGroup.style.display =
        normalized === "deepseek" ? "" : "none";
      minimaxProviderGroup.style.display =
        normalized === "minimax" ? "" : "none";
      customProviderGroup.style.display =
        normalized === "custom" ? "" : "none";
    }
    function applyAsrProviderSelection(provider) {
      const normalized = settingsApi.isKnownAsrProvider(provider)
        ? provider
        : settingsApi.DEFAULT_ASR_PROVIDER;
      asrProviderSelect.value = normalized;
      bailianAsrGroup.style.display =
        normalized === "bailian" ? "" : "none";
      minimaxAsrGroup.style.display =
        normalized === "minimax" ? "" : "none";
      whisperAsrGroup.style.display =
        normalized === "whisper" ? "" : "none";
    }

    function setStatus(element, key, params = {}) {
      statusStates.set(element, { key, params });
      renderStatus(element);
    }

    function applyLanguage(language) {
      const nextDraft = switchPromptDraft(
        promptDrafts,
        currentLanguage,
        language,
        customizationPrompt.value,
      );
      currentLanguage = nextDraft.language;
      doc.documentElement.lang = currentLanguage;
      doc.title = translate(currentLanguage, "pageTitle");

      for (const element of doc.querySelectorAll("[data-i18n]")) {
        element.textContent = translate(
          currentLanguage,
          element.dataset.i18n,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-html]")) {
        element.innerHTML = translate(
          currentLanguage,
          element.dataset.i18nHtml,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute(
          "aria-label",
          translate(currentLanguage, element.dataset.i18nAriaLabel),
        );
      }

      updateLocalizedPrompt(
        customizationPrompt,
        nextDraft.prompt,
      );
      updateLanguageButtonState(languageButtons, currentLanguage);
      for (const element of statusStates.keys()) renderStatus(element);
    }

    async function loadSettings() {
      try {
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        const migration = settingsApi.migrateLegacyCustom(
          stored[settingsApi.STORAGE_KEY],
        );
        const settings = migration.settings;

        aiApiKeyInput.value = settings.aiApiKey;
        minimaxApiKeyInput.value = settings.minimaxApiKey;
        customApiKeyInput.value = settings.customApiKey;
        customBaseUrlInput.value = settings.customBaseUrl;
        customModelInput.value = settings.customModel;
        asrApiKeyInput.value = settings.asrApiKey;
        supadataApiKeyInput.value = settings.supadataApiKey;
        whisperEndpointInput.value = settings.whisperEndpoint;
        whisperModelInput.value = settings.whisperModel;
        whisperApiKeyInput.value = settings.whisperApiKey;
        applyProviderSelection(settings.provider);
        asrProviderSelect.value = settings.asrProvider;
        applyAsrProviderSelection(settings.asrProvider);
        if (migration.migrated) {
          await storage.set({ [settingsApi.STORAGE_KEY]: settings });
          setStatus(saveStatus, "migrationWarning");
        }
      } catch (_error) {
        setStatus(saveStatus, "settingsLoadFailed");
      }
    }

    async function loadOptions() {
      try {
        applyLanguage(await readPreferredLanguage(storage));
      } catch (_error) {
        applyLanguage("en");
      }
      await loadSettings();
    }

    async function saveSettings(event) {
      event.preventDefault();
      setStatus(saveStatus, "saving");

      const settings = settingsApi.normalize({
        provider: providerSelect.value,
        asrProvider: asrProviderSelect.value,
        aiApiKey: aiApiKeyInput.value,
        minimaxApiKey: minimaxApiKeyInput.value,
        customApiKey: customApiKeyInput.value,
        customBaseUrl: customBaseUrlInput.value,
        customModel: customModelInput.value,
        asrApiKey: asrApiKeyInput.value,
        supadataApiKey: supadataApiKeyInput.value,
        whisperEndpoint: whisperEndpointInput.value,
        whisperModel: whisperModelInput.value,
        whisperApiKey: whisperApiKeyInput.value,
      });

      if (
        settings.asrProvider === "whisper" &&
        !settingsApi.isValidWhisperEndpoint(settings.whisperEndpoint)
      ) {
        setStatus(saveStatus, "invalidWhisperEndpoint");
        return;
      }

      if (!settingsApi.resolveAiApiKey(settings)) {
        if (
          !settingsApi.isAsrProviderConfigured(settings) &&
          !settings.supadataApiKey
        ) {
          setStatus(saveStatus, "addDeepseekKey");
          return;
        }
      }

      try {
        await persistAndVerifySettings(
          storage,
          settingsApi.STORAGE_KEY,
          settings,
        );
        setStatus(saveStatus, "saved");
      } catch (_error) {
        setStatus(saveStatus, "saveFailed");
      }
    }

    async function copyCustomizationPrompt() {
      setStatus(copyStatus, "copying");
      try {
        await copyPromptValue(
          root.navigator.clipboard,
          customizationPrompt.value,
        );
        setStatus(copyStatus, "promptCopied");
      } catch (_error) {
        setStatus(copyStatus, "copyFailed");
      }
    }

    async function clearCachedSummaries() {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith("bilidown_"));
      if (keys.length) await storage.remove(keys);
      setStatus(dataStatus, "clearedSummaries", { count: keys.length });
    }

    async function clearNotes() {
      await storage.remove("ytd_notes");
      setStatus(dataStatus, "notesDeleted");
    }

    async function resetAllData() {
      const confirmed = root.confirm(
        translate(currentLanguage, "resetConfirm"),
      );
      if (!confirmed) return;

      await resetContentData(
        storage,
        settingsApi.STORAGE_KEY,
        currentLanguage,
      );
      await loadSettings();
      setStatus(dataStatus, "allDataDeleted");
    }

    form.addEventListener("submit", saveSettings);
    // Auto-save when a single-choice provider dropdown switches, since
    // mistaking a dropdown change for a persisted value is a common
    // footgun (UI shows the new provider, but the dispatch layer keeps
    // using the previous one until the user clicks Save). Other fields
    // still require an explicit Save click.
    providerSelect.addEventListener("change", () => {
      applyProviderSelection(providerSelect.value);
      form.requestSubmit();
    });
    asrProviderSelect.addEventListener("change", () => {
      applyAsrProviderSelection(asrProviderSelect.value);
      form.requestSubmit();
    });
    copyCustomizationPromptBtn.addEventListener(
      "click",
      copyCustomizationPrompt,
    );
    doc
      .getElementById("clearCacheBtn")
      .addEventListener("click", clearCachedSummaries);
    doc.getElementById("clearNotesBtn").addEventListener("click", clearNotes);
    doc.getElementById("resetBtn").addEventListener("click", resetAllData);
    for (const button of languageButtons) {
      button.addEventListener("click", async () => {
        const language = button.dataset.language;
        applyLanguage(language);
        await persistPreferredLanguage(storage, language);
      });
    }

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", loadOptions, { once: true });
    } else {
      void loadOptions();
    }
  }

  return {
    COPY,
    LANGUAGE_STORAGE_KEY,
    copyPromptValue,
    createPromptDrafts,
    createStorageAdapter,
    normalizeLanguage,
    persistPreferredLanguage,
    persistAndVerifySettings,
    readPreferredLanguage,
    resetContentData,
    translate,
    updateLanguageButtonState,
    updateLocalizedPrompt,
    switchPromptDraft,
    initialize,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_OPTIONS;
}

if (typeof document !== "undefined") {
  YTD_OPTIONS.initialize();
}
