/**
 * SIDE PANEL LOGIC
 *
 * Handles the UI for dk-bilidown: video detection, transcript analysis,
 * rendering results, and export features.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// STATE
// ============================================================

let currentVideoId = null;
const BILIDOWN_CACHE_SCHEMA_VERSION = 4;
let generation = 0;
let currentVideoUrl = null;
let currentAnalysis = null;
let currentTranscript = null;
let currentTranscriptText = null; // Plain text (for display/export)
let currentTranscriptTimestamped = null; // With timestamps for AI analysis
let currentTranscriptLanguage = null;
let currentTranscriptSource = null;
let currentVideoTitle = "";
let currentChannelName = "";
let currentVideoDescription = "";
let currentVideoDuration = 0;
let isAnalysisLoading = false; // Track if analysis is in progress
let currentSummary = null; // Full-note summary (Markdown text) for this video
let isSummaryLoading = false; // Track if summary is in progress
let bilibiliTabId = null; // Store the Bilibili tab ID for reliable messaging
let errorAction = null;

// --- Translation state ---
// The public transcript control intentionally supports only the original
// subtitles, Chinese, and an aligned source + Chinese view.
let currentTranscriptMode = "original";
let translationGeneration = 0; // Invalidates responses from older UI modes/videos.
let translationWorkCount = 0;
let transcriptScrollObserver = null;
// Stable keys include the video, source mode, language, and semantic segment ID.
let transcriptParagraphCache = new Map();
const TRANSLATION_MESSAGE_TIMEOUT_MS = 130_000;

/**
 * Prevent a stopped service worker or dead message channel from leaving the
 * transcript queue stuck forever. The underlying Chrome message cannot be
 * cancelled, so settled guards deliberately ignore any late response.
 */
function sendTranslationMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };

    timeoutId = setTimeout(() => {
      finish(
        reject,
        new Error(
          "Translation request timed out after 130 seconds. Please Retry.",
        ),
      );
    }, TRANSLATION_MESSAGE_TIMEOUT_MS);

    let messagePromise;
    try {
      messagePromise = chrome.runtime.sendMessage(message);
    } catch (error) {
      finish(reject, error);
      return;
    }

    Promise.resolve(messagePromise).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

// --- Auto-scroll state (follow video playback in transcript) ---
let autoScrollEnabled = true; // True = scroll transcript to follow video playback
let autoScrollInterval = null; // setInterval ID for polling video time
let lastAutoScrollTime = 0; // Timestamp of last programmatic scroll (ignores scroll events within 1s)

// ============================================================
// TRANSCRIPT GROUPING
// ============================================================

const TRANSCRIPT_SEGMENT_LIMITS = Object.freeze({
  minChars: 60,
  idealChars: 180,
  maxChars: 320,
  maxSeconds: 20,
});

function normalizeCaptionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .replace(/([，。；：！？])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .trim();
}

/**
 * Splits a single oversized thought at the strongest nearby punctuation.
 * Word boundaries are the final safety valve for captions with no punctuation.
 */
function splitOversizedThought(text, maxChars) {
  const parts = [];
  let rest = normalizeCaptionText(text);

  while (rest.length > maxChars) {
    const windowText = rest.slice(0, maxChars + 1);
    const lowerBound = Math.floor(maxChars * 0.55);
    let cut = -1;

    for (const pattern of [/[;:；：]\s*/g, /[,，]\s*/g, /\s/g]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(windowText))) {
        if (match.index >= lowerBound) cut = match.index + match[0].length;
      }
      if (cut > 0) break;
    }

    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Reconstructs complete sentences across raw caption boundaries. Each segment
 * keeps the timestamp of the first caption that contributed text. Character
 * and time limits prevent a malformed Supadata entry from becoming one giant
 * row while punctuation remains the preferred boundary.
 */
function groupTranscriptEntries(entries, limits = TRANSCRIPT_SEGMENT_LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const pieces = [];
  entries.forEach((entry, entryIndex) => {
    const text = normalizeCaptionText(entry?.text);
    if (!text) return;
    const start = Number.isFinite(Number(entry.start)) ? Number(entry.start) : 0;
    const duration = Math.max(0, Number(entry.duration) || 0);
    const sentenceParts =
      text.match(/[^.!?;:,。！？；：，]+(?:[.!?;:,。！？；：，]+["')\]”’）】」』]*|$)/g) ||
      [text];
    let consumedChars = 0;

    sentenceParts.forEach((sentencePart) => {
      const cleanPart = normalizeCaptionText(sentencePart);
      if (!cleanPart) return;
      const oversizedParts = splitOversizedThought(cleanPart, limits.maxChars);
      oversizedParts.forEach((part, partIndex) => {
        const ratio = text.length ? Math.min(1, consumedChars / text.length) : 0;
        pieces.push({
          text: part,
          start: start + duration * ratio,
          semanticEnd:
            /[.!?。！？]["')\]”’）】」』]*$/.test(part) ||
            oversizedParts.length > 1,
          clauseEnd: /[;:,；：，]["')\]”’）】」』]*$/.test(part),
          sourceOrder: `${entryIndex}:${partIndex}`,
        });
        consumedChars += part.length + 1;
      });
    });
  });

  const grouped = [];
  let current = null;

  const flush = () => {
    if (!current || !current.text.trim()) return;
    const index = grouped.length;
    const text = normalizeCaptionText(current.text);
    grouped.push({
      id: `segment-${index}-${Math.round(current.start * 1000)}`,
      start: current.start,
      text,
      texts: [text],
    });
    current = null;
  };

  pieces.forEach((piece) => {
    if (!current) current = { start: piece.start, text: "" };
    current.text = normalizeCaptionText(`${current.text} ${piece.text}`);
    const elapsed = Math.max(0, piece.start - current.start);
    const comfortablySized = current.text.length >= limits.minChars;
    const reachedIdeal = current.text.length >= limits.idealChars;
    const atNaturalBoundary =
      piece.semanticEnd ||
      (piece.clauseEnd &&
        (reachedIdeal ||
          current.text.length >= limits.maxChars ||
          elapsed >= limits.maxSeconds));
    const reachedGuardrail =
      atNaturalBoundary &&
      (current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds);
    const reachedHardGuardrail =
      current.text.length >= Math.round(limits.maxChars * 1.2) ||
      elapsed >= limits.maxSeconds + 5;

    if (
      (atNaturalBoundary && (comfortablySized || elapsed >= 8)) ||
      (atNaturalBoundary && reachedIdeal) ||
      reachedGuardrail ||
      reachedHardGuardrail
    ) {
      flush();
    }
  });
  flush();

  return grouped;
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await evictOldCacheEntries(20);

  const configStatus = await chrome.runtime.sendMessage({
    action: "checkConfig",
  });

  if (!configStatus.hasSupadataKey || !configStatus.hasAiKey) {
    showConfigError(configStatus);
    return;
  }

  await checkCurrentTab();
});

// Listen for messages from the bilidown button on Bilibili page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startBilidownFromButton") {
    // Load the digest for the current video. Served from cache when we've
    // seen this video before (no API calls); fetched fresh otherwise.
    // (This used to force-clear the cache on every click, which silently
    // burned a transcript credit + analysis tokens per click.)
    checkCurrentTab();
    sendResponse({ success: true });
  }
  if (message.action === "bilibiliNavigation") {
    handleFrontTabUrl(message.url);
    sendResponse({ success: true });
  }
  if (message.action === "transcriptProgress") {
    // Background is telling us the transcript fetch status changed
    updateLoading(message.title, message.subtitle);
    sendResponse({ success: true });
  }
  if (message.action === "noteSaved") {
    // Refresh notes list when a new note is saved
    const filterAll = document
      .getElementById("notesFilterAll")
      ?.classList.contains("active");
    loadNotes(filterAll ? null : currentVideoId);
    sendResponse({ success: true });
  }
  return false;
});

// ============================================================
// FOLLOW THE ACTIVE TAB
// ============================================================
// The panel watches which tab is in front of it and reacts:
//   - Front tab is NOT Bilibili  -> the panel closes itself (window.close()).
//     We do this OURSELVES rather than relying only on the background
//     script's per-tab enable/disable, because Chrome doesn't reliably
//     apply per-tab panel state to tabs spawned in unusual ways (e.g. a
//     link opened from another app) — which let the panel linger on
//     non-Bilibili pages.
//   - Front tab IS Bilibili but on a different video -> refresh the digest.
//     Bilibili is a single-page app (clicking a video swaps content without
//     a reload), so we track URL changes; startBilidown() caches per video,
//     making re-checks instant and free for already-digested videos.
//
// Everything is scoped to the window this panel lives in: tab switches in
// OTHER browser windows must not close this panel or hijack its content.

let navigationRefreshTimer = null;
let panelWindowId = null;
chrome.windows.getCurrent().then((w) => {
  panelWindowId = w.id;
});

function scheduleBilidownRefresh() {
  // Small delay lets Bilibili finish rendering the new video's title and
  // description before we read them. Also collapses rapid-fire URL events
  // into a single refresh.
  clearTimeout(navigationRefreshTimer);
  navigationRefreshTimer = setTimeout(() => {
    checkCurrentTab();
  }, 600);
}

function panelIsShowingResults() {
  const results = document.getElementById("resultsState");
  return results && results.style.display !== "none";
}

/**
 * Reacts to the URL now in front of the panel: close on non-Bilibili,
 * refresh the digest when the video changed.
 */
function handleFrontTabUrl(url) {
  if (!/^https:\/\/www\.bilibili\.com\/video\//.test(url || "")) {
    // Panel is a Bilibili-only tool — remove itself from non-Bilibili tabs.
    window.close();
    return;
  }

  const newVideoId = extractVideoId(url);
  // Refresh when the video changed, or when we're not currently showing
  // results (e.g. user went home, then clicked back into the same video).
  if (newVideoId !== currentVideoId || !panelIsShowingResults()) {
    scheduleBilidownRefresh();
  }
}

// Fires when a tab's URL changes — including Bilibili's no-reload navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.active) return;
  if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
  handleFrontTabUrl(changeInfo.url);
});

// Fires when a different tab comes to the front — switching tabs, or a new
// tab being opened (including ones opened by clicking links in other apps).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (panelWindowId !== null && windowId !== panelWindowId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Brand-new tabs may not have committed their URL yet — fall back to
    // the pending one so we judge where the tab is actually going.
    handleFrontTabUrl(tab.url || tab.pendingUrl || "");
  } catch (e) {
    // Tab closed before we could read it — nothing to do.
  }
});

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Error retry
  document.getElementById("errorBtn").addEventListener("click", () => {
    if (errorAction) {
      errorAction();
      return;
    }
    if (currentVideoId) {
      startBilidown(currentVideoId, currentVideoUrl);
    }
  });

  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptions" });
  });

  // Transcript actions
  document
    .getElementById("copyTranscriptBtn")
    ?.addEventListener("click", copyTranscript);
  document
    .getElementById("saveTranscriptNoteBtn")
    ?.addEventListener("click", saveTranscriptAsNote);
  document
    .getElementById("exportTranscriptBtn")
    ?.addEventListener("click", exportTranscript);
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleTranscriptModeChange(button.dataset.transcriptMode);
    });
  });

  // Follow playback button — re-enables auto-scroll after user scrolled away
  document
    .getElementById("followPlaybackBtn")
    ?.addEventListener("click", () => {
      autoScrollEnabled = true;
      document.getElementById("followPlaybackBtn").style.display = "none";
      // Jump straight back to the line currently being spoken. We scroll
      // directly (not via playbackTrackingTick) because the tick skips
      // entries that are already highlighted — and the current line almost
      // always IS highlighted, which made this button appear to do nothing.
      if (!scrollToActiveEntry()) {
        playbackTrackingTick(); // No highlight yet — let a tick establish one
      }
    });

  // Summary tab actions
  document.getElementById("copySummaryBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("copySummaryBtn");
    const original = btn.textContent;
    if (!currentSummary) {
      btn.textContent = "暂无内容";
      setTimeout(() => (btn.textContent = original), 1500);
      return;
    }
    const ok = await copyToClipboard(currentSummary);
    btn.textContent = ok ? "✓ 已复制" : "复制失败";
    setTimeout(() => (btn.textContent = original), 2000);
  });

  // Summary tab: save full note, export
  document
    .getElementById("saveSummaryNoteBtn")
    ?.addEventListener("click", saveFullSummaryAsNote);
  document
    .getElementById("exportSummaryBtn")
    ?.addEventListener("click", exportSummary);

  // Notes filter buttons
  document.getElementById("notesFilterThis")?.addEventListener("click", () => {
    setNotesFilter(false);
    loadNotes(currentVideoId);
  });
  document.getElementById("notesFilterAll")?.addEventListener("click", () => {
    setNotesFilter(true);
    loadNotes(null); // Load all notes
  });
}

function setNotesFilter(showAll) {
  const thisVideoButton = document.getElementById("notesFilterThis");
  const allNotesButton = document.getElementById("notesFilterAll");
  thisVideoButton?.classList.toggle("active", !showAll);
  thisVideoButton?.setAttribute("aria-pressed", String(!showAll));
  allNotesButton?.classList.toggle("active", showAll);
  allNotesButton?.setAttribute("aria-pressed", String(showAll));
}

// ============================================================
// VIDEO DETECTION
// ============================================================

async function checkCurrentTab() {
  try {
    // Try multiple strategies to find the Bilibili tab
    let tab = null;
    const diagnostics = [];

    // Strategy 1: Active tab in last focused window
    let tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    diagnostics.push(
      "活动标签页: " + (tabs[0]?.url || "(无 URL 权限或非网页)")
    );
    if (tabs[0]?.url?.includes("bilibili.com/video/")) {
      tab = tabs[0];
    }

    // Strategy 2: Any active Bilibili tab
    if (!tab) {
      tabs = await chrome.tabs.query({
        url: "https://www.bilibili.com/video/*",
        active: true,
      });
      if (tabs[0]) tab = tabs[0];
    }

    // Strategy 3: Any Bilibili tab (last resort)
    if (!tab) {
      tabs = await chrome.tabs.query({ url: "https://www.bilibili.com/video/*" });
      if (tabs[0]) tab = tabs[0];
    }

    debugLog("[dk-bilidown Panel] Found tab:", tab?.id, tab?.url);

    if (!tab?.url) {
      showWelcome(
        "未检测到 B 站视频。\n" +
          diagnostics.join("\n") +
          "\n提示：需要打开 https://www.bilibili.com/video/BV… 格式的视频页面。"
      );
      return;
    }

    // Store the tab ID for reliable messaging later
    bilibiliTabId = tab.id;

    const videoId = extractVideoId(tab.url);

    if (videoId) {
      currentVideoUrl = tab.url;

      try {
        // Route through background script for reliable message passing
        const result = await chrome.runtime.sendMessage({
          action: "relayToContent",
          payload: { action: "getVideoInfo" },
        });
        debugLog("[dk-bilidown Panel] getVideoInfo result:", result);
        if (result.success && result.response) {
          currentVideoTitle = result.response.title || "";
          currentChannelName = result.response.channelName || "";
          currentVideoDescription = result.response.description || "";
          currentVideoDuration = result.response.duration || 0;
        }
      } catch (e) {
        console.error("[dk-bilidown Panel] getVideoInfo error:", e);
        currentVideoTitle = "";
        currentChannelName = "";
        currentVideoDescription = "";
        currentVideoDuration = 0;
      }

      startBilidown(videoId, tab.url);
    } else {
      showWelcome(
        "未匹配到 B 站视频地址。\n当前页面: " +
          (tab.url || "(无 URL)") +
          "\n提示：需要 https://www.bilibili.com/video/BV… 格式（暂不支持番剧/直播页）。"
      );
    }
  } catch (error) {
    console.error("Tab check error:", error);
    showWelcome("检测出错: " + (error?.message || error));
  }
}

function extractVideoId(url) {
  try {
    const urlObj = new URL(url);

    const match = urlObj.pathname.match(/\/video\/(BV[A-Za-z0-9]{10})/i);
    if (urlObj.hostname.endsWith("bilibili.com") && match) {
      const part = Math.max(1, Number(urlObj.searchParams.get("p")) || 1);
      return `${match[1]}@p${part}`;
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// BILIDOWN PIPELINE
// ============================================================

async function startBilidown(videoId, videoUrl) {
  const gen = ++generation;
  // Check if we already have this video loaded in memory
  if (videoId === currentVideoId && currentAnalysis) {
    showState("results");
    return;
  }

  // Every video change invalidates observer work and in-flight translations.
  if (videoId !== currentVideoId) {
    translationGeneration += 1;
    if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
    transcriptScrollObserver = null;
  }

  // Check cache for this video
  const cached = await loadFromCache(videoId);
  if (gen !== generation) return;
  if (cached) {
    debugLog("Loading from cache:", videoId);
    currentVideoId = videoId;
    currentVideoUrl = videoUrl;
    currentAnalysis = cached.analysis || null;
    currentSummary = cached.summary || null;
    currentTranscript = cached.transcript;
    currentTranscriptText = cached.transcriptText;
    currentTranscriptTimestamped = cached.transcriptTimestamped;
    currentTranscriptLanguage = cached.transcriptLanguage || null;
    currentTranscriptSource = cached.transcriptSource || null;
    updateTranscriptLanguageModes();
    isAnalysisLoading = false;

    // Restore semantic-segment translations from persistent storage.
    if (cached.paragraphCache) {
      for (const [key, value] of Object.entries(cached.paragraphCache)) {
        transcriptParagraphCache.set(key, value);
      }
    }

    if (currentVideoTitle || currentChannelName) {
      const videoInfo = document.getElementById("videoInfo");
      document.getElementById("videoTitle").textContent = currentVideoTitle;
      document.getElementById("videoChannel").textContent = currentChannelName;
      videoInfo.style.display = "block";
    }

    // Always render transcript first
    renderTranscript();

    // Render analysis if we have it cached
    if (currentAnalysis) {
      renderAnalysisResults(currentAnalysis);
      highlightMomentsOnPage(currentAnalysis.keyMoments);
    }

    // Render summary if we have it cached
    if (currentSummary) {
      renderSummaryResults(currentSummary);
    }

    showState("results");
    document.getElementById("tabsNav").style.display = "flex";

    // Load notes for this video
    loadNotes(videoId);

    // Setup explain feature
    setupExplainFeature();
    if (currentTranscriptMode !== "original") translateTranscript();
    return;
  }

  currentVideoId = videoId;
  currentVideoUrl = videoUrl;
  currentAnalysis = null;
  currentSummary = null;
  currentTranscript = null;
  currentTranscriptText = null;
  currentTranscriptTimestamped = null;
  currentTranscriptLanguage = null;
  currentTranscriptSource = null;
  isAnalysisLoading = false;

  if (currentVideoTitle || currentChannelName) {
    const videoInfo = document.getElementById("videoInfo");
    document.getElementById("videoTitle").textContent = currentVideoTitle;
    document.getElementById("videoChannel").textContent = currentChannelName;
    videoInfo.style.display = "block";
  }

  showState("loading");
  updateLoading("正在获取字幕", "");

  const transcriptResult = await chrome.runtime.sendMessage({
    action: "fetchTranscript",
    videoId: videoId.split("@p")[0],
    pageNumber: Math.max(
      1,
      Number(String(videoId.split("@p")[1] || "1").replace(/^p/i, "")) || 1,
    ),
    videoUrl: videoUrl,
  });
  if (gen !== generation || videoId !== currentVideoId) return;

  if (!transcriptResult.success) {
    const detail = transcriptResult.message || transcriptResult.error;
    showError(
      String(detail).includes("百炼") || String(detail).includes("音轨")
        ? "语音识别失败"
        : "没有找到可靠字幕",
      detail,
    );
    errorAction = async () => {
      await chrome.storage.local.remove(`bilidown_${videoId}`);
      currentVideoId = null;
      startBilidown(videoId, videoUrl);
    };
    return;
  }

  currentTranscript = transcriptResult.transcript;
  currentTranscriptText = transcriptResult.transcriptText;
  currentTranscriptTimestamped = transcriptResult.transcriptTextTimestamped;
  currentTranscriptLanguage = transcriptResult.language || null;
  currentTranscriptSource = transcriptResult.source || "bilibili-subtitle";
  updateTranscriptLanguageModes();

  // Render transcript immediately (no LLM needed)
  renderTranscript();
  showState("results");
  document.getElementById("tabsNav").style.display = "flex";

  // Load notes for this video
  loadNotes(videoId);

  // Setup explain feature for text selection
  setupExplainFeature();
  if (currentTranscriptMode !== "original") translateTranscript();

  // Save transcript to cache (without analysis)
  await saveToCache(videoId);

  // DON'T run LLM analysis automatically - wait for user to click Overview tab
  // This saves tokens when user just wants to see the transcript
}

// ============================================================
// RENDERING
// ============================================================

/**
 * Renders the analysis results into the Overview tab.
 * Shows chapters and key quotes only.
 */
function renderAnalysisResults(analysis) {
  // Chapters
  const chapterList = document.getElementById("chapterList");
  chapterList.innerHTML = "";
  (analysis.chapters || []).forEach((chapter) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.dataset.seconds = chapter.timestampSeconds;
    li.innerHTML = `
      <span class="chapter-timestamp">${escapeHtml(chapter.timestamp)}</span>
      <div class="chapter-content">
        <span class="chapter-title">${escapeHtml(chapter.title)}</span>
        <span class="chapter-summary">${escapeHtml(chapter.summary || "")}</span>
      </div>
    `;
    li.addEventListener("click", () => {
      debugLog(
        "[dk-bilidown Panel] Chapter clicked:",
        chapter.timestamp,
        chapter.timestampSeconds,
      );
      seekTo(chapter.timestampSeconds);
    });
    chapterList.appendChild(li);
  });

  // Quotes - sort by timestamp (chronological order)
  const quotesList = document.getElementById("quotesList");
  quotesList.innerHTML = "";
  const sortedQuotes = [...(analysis.keyQuotes || [])].sort(
    (a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0),
  );
  sortedQuotes.forEach((quote) => {
    const div = document.createElement("div");
    div.className = "quote-item";
    div.dataset.seconds = quote.timestampSeconds;
    div.innerHTML = `
      <div class="quote-text">${escapeHtml(quote.quote)}</div>
      <div class="quote-meta">
        <span class="quote-timestamp">${escapeHtml(quote.timestamp)}</span>
        <div class="quote-actions">
          <button class="quote-save-note-btn" title="保存为笔记">📝 笔记</button>
          <button class="quote-copy-btn" title="复制观点">⧉ 复制</button>
        </div>
      </div>
    `;
    div.addEventListener("click", () => {
      debugLog(
        "[dk-bilidown Panel] Quote clicked:",
        quote.timestamp,
        quote.timestampSeconds,
      );
      seekTo(quote.timestampSeconds);
    });

    const quoteCopyBtn = div.querySelector(".quote-copy-btn");
    quoteCopyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(quote.quote);
        quoteCopyBtn.textContent = "✓ 已复制";
        setTimeout(() => {
          quoteCopyBtn.textContent = "⧉ 复制";
        }, 1500);
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });

    const quoteSaveNoteBtn = div.querySelector(".quote-save-note-btn");
    quoteSaveNoteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveQuoteAsNote(quote, quoteSaveNoteBtn);
    });

    quotesList.appendChild(div);
  });
}

/**
 * Saves a key quote as a timestamped note.
 */
async function saveQuoteAsNote(quote, btn) {
  if (!currentVideoId) return;

  const originalText = btn.textContent;
  btn.textContent = "保存中…";
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: currentVideoId,
      timestamp: quote.timestampSeconds,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
    });

    if (result.success) {
      btn.textContent = "✓ 已保存";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
      // Refresh notes list if on Notes tab
      loadNotes(currentVideoId);
    } else {
      console.error("[dk-bilidown] Save quote as note failed:", result.error);
      btn.textContent = "失败";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
    }
  } catch (error) {
    console.error("[dk-bilidown] Save quote as note error:", error);
    btn.textContent = "失败";
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1500);
  }
}

/**
 * Legacy function for backwards compatibility with cached data.
 * Renders both transcript and analysis.
 */
function renderResults(analysis) {
  renderAnalysisResults(analysis);

  renderTranscript();

  document.getElementById("tabsNav").style.display = "flex";

  // Setup explain feature for text selection
  setupExplainFeature();
}

/**
 * Returns true while the user has a range of text selected.
 * Transcript row clicks must not seek in that state: the click emitted after
 * selection mouseup belongs to the selection/explain interaction, not playback.
 */
function hasNonCollapsedTextSelection() {
  const selection = window.getSelection();
  return Boolean(
    selection && selection.rangeCount > 0 && !selection.isCollapsed,
  );
}

/**
 * Preserves normal row-click seeking while keeping text selection inert.
 */
function seekFromTranscriptEntryClick(event, seconds) {
  if (hasNonCollapsedTextSelection()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  seekTo(seconds);
}

function renderTranscript() {
  if (!currentTranscript) return;

  const transcriptList = document.getElementById("transcriptList");
  transcriptList.innerHTML = "";

  // Show a small badge indicating the transcript came from the video's
  // existing subtitles. (We no longer AI-transcribe audio, so subtitles
  // are the only source.)
  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();

  const badge = document.createElement("div");
  badge.id = "transcriptSourceBadge";
  badge.className = "transcript-source-badge";
  const sourceLabel = currentTranscriptSource === "aliyun-fun-asr"
    ? "阿里云 Fun-ASR 语音识别"
    : "B站视频字幕";
  badge.innerHTML = `<span class="source-dot source-dot--subs"></span> ${sourceLabel} · ${escapeHtml(getOriginalTranscriptLabel())}`;
  transcriptList.parentElement.insertBefore(badge, transcriptList);

  // Group entries using smart sentence-boundary + time-guardrail logic
  const grouped = groupTranscriptEntries(currentTranscript);

  grouped.forEach((group) => {
    const div = document.createElement("div");
    div.className = "transcript-entry";
    div.dataset.seconds = group.start;

    const minutes = Math.floor(group.start / 60);
    const seconds = Math.floor(group.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      <span class="transcript-text">${renderSubtitleInlineMarkup(group.text)}</span>
    `;

    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, group.start),
    );
    transcriptList.appendChild(div);
  });

  // Start tracking video playback for auto-scroll
  startPlaybackTracking();
}

function currentCanonicalVideoUrl() {
  const [bvid, partToken] = String(currentVideoId || "").split("@p");
  return `https://www.bilibili.com/video/${bvid}${Number(partToken) > 1 ? `?p=${Number(partToken)}` : ""}`;
}

function timestampLabel(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = Math.floor(safe % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function exportTranscriptEntries() {
  return groupTranscriptEntries(currentTranscript || []).map((entry) => ({
    ...entry,
    timestamp: timestampLabel(entry.start),
    url: `${currentCanonicalVideoUrl()}${currentCanonicalVideoUrl().includes("?") ? "&" : "?"}t=${Math.floor(entry.start)}s`,
  }));
}

function buildMarkdownExport() {
  const lines = [
    `# ${currentVideoTitle || "B站视频学习笔记"}`,
    "",
    `- **UP主：** ${currentChannelName || "未知"}`,
    `- **视频链接：** ${currentCanonicalVideoUrl()}`,
    `- **字幕语言：** ${currentTranscriptLanguage || "未知"}`,
  ];
  if (currentVideoDescription) lines.push("", "## 视频简介", "", currentVideoDescription);
  if (currentAnalysis?.chapters?.length) {
    lines.push("", "## AI 章节", "");
    currentAnalysis.chapters.forEach((chapter) => {
      lines.push(`### [${chapter.timestamp}] ${chapter.title}`, "", chapter.summary || "", "");
    });
  }
  if (currentAnalysis?.keyQuotes?.length) {
    lines.push("## 关键观点", "");
    currentAnalysis.keyQuotes.forEach((quote) => lines.push(`> **${quote.timestamp}** ${quote.quote}`, ""));
  }
  lines.push("## 完整字幕", "");
  exportTranscriptEntries().forEach((entry) => lines.push(`- [${entry.timestamp}](${entry.url}) ${entry.text}`));
  lines.push("", "---", "由 bilidown · dk 二次开发版导出");
  return lines.join("\n");
}

function buildHtmlExport() {
  const entries = exportTranscriptEntries();
  const chapters = (currentAnalysis?.chapters || []).map((chapter) => `
    <article class="chapter"><a href="${escapeHtml(currentCanonicalVideoUrl())}?t=${Number(chapter.timestampSeconds) || 0}s">${escapeHtml(chapter.timestamp)}</a><div><strong>${escapeHtml(chapter.title)}</strong><p>${escapeHtml(chapter.summary || "")}</p></div></article>`).join("");
  const quotes = (currentAnalysis?.keyQuotes || []).map((quote) => `
    <blockquote><b>${escapeHtml(quote.timestamp)}</b>${escapeHtml(quote.quote)}</blockquote>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(currentVideoTitle || "B站视频学习笔记")}</title><style>
  :root{--pink:#fb7299;--blue:#00aeec;--ink:#18191c;--muted:#61666d;--line:#e3e5e7}*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:var(--ink);font:15px/1.75 system-ui,-apple-system,"Segoe UI",sans-serif}.page{width:min(900px,calc(100% - 28px));margin:32px auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:clamp(22px,5vw,54px);box-shadow:0 12px 36px rgba(24,25,28,.07)}h1{line-height:1.3;margin:0 0 14px}h2{margin-top:38px;padding-bottom:10px;border-bottom:2px solid rgba(251,114,153,.18)}.meta{color:var(--muted)}a{color:var(--pink);text-decoration:none}.chapter{display:flex;gap:18px;padding:14px 0;border-bottom:1px solid var(--line)}.chapter a{flex:0 0 54px;font-weight:700}.chapter p{margin:4px 0;color:var(--muted)}blockquote{margin:12px 0;padding:14px 18px;border-left:4px solid var(--pink);background:rgba(251,114,153,.06);border-radius:0 10px 10px 0}blockquote b{margin-right:12px;color:var(--pink)}.line{display:grid;grid-template-columns:62px 1fr;gap:14px;padding:11px 0;border-bottom:1px solid var(--line)}.time{font-family:ui-monospace,monospace;font-weight:700}.footer{margin-top:38px;color:#9499a0;font-size:12px}@media(max-width:560px){.line{grid-template-columns:52px 1fr}.page{margin:12px auto}}
  </style></head><body><main class="page"><h1>${escapeHtml(currentVideoTitle || "B站视频学习笔记")}</h1><div class="meta">UP主：${escapeHtml(currentChannelName || "未知")} · <a href="${escapeHtml(currentCanonicalVideoUrl())}">打开原视频</a></div>${currentVideoDescription ? `<h2>视频简介</h2><p>${escapeHtml(currentVideoDescription)}</p>` : ""}${chapters ? `<h2>AI 章节</h2>${chapters}` : ""}${quotes ? `<h2>关键观点</h2>${quotes}` : ""}<h2>完整字幕</h2>${entries.map((entry) => `<div class="line"><a class="time" href="${escapeHtml(entry.url)}">${escapeHtml(entry.timestamp)}</a><div>${escapeHtml(entry.text)}</div></div>`).join("")}<div class="footer">由 bilidown · dk 二次开发版导出</div></main></body></html>`;
}

/**
 * Copies the full transcript (plain text, no timestamps) to the clipboard.
 */
async function copyTranscript() {
  const btn = document.getElementById("copyTranscriptBtn");
  const original = btn.textContent;
  const text =
    currentTranscriptText ||
    (currentTranscript || []).map((entry) => entry.text).join(" ") ||
    "";
  if (!text.trim()) {
    btn.textContent = "暂无内容";
    setTimeout(() => (btn.textContent = original), 1500);
    return;
  }
  const ok = await copyToClipboard(text);
  btn.textContent = ok ? "✓ 已复制" : "复制失败";
  setTimeout(() => (btn.textContent = original), 2000);
}

/**
 * Saves the full transcript as a single note entry (visible in the Notes
 * tab). Reuses the same storage path as the summary note.
 */
async function saveTranscriptAsNote() {
  const btn = document.getElementById("saveTranscriptNoteBtn");
  const original = btn.textContent;
  const text =
    currentTranscriptText ||
    (currentTranscript || []).map((entry) => entry.text).join(" ") ||
    "";
  if (!text.trim()) {
    btn.textContent = "暂无内容";
    setTimeout(() => (btn.textContent = original), 1500);
    return;
  }
  if (!currentVideoId) {
    btn.textContent = "缺少视频信息";
    setTimeout(() => (btn.textContent = original), 1500);
    return;
  }
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveSummaryNote",
      videoId: currentVideoId,
      videoTitle: currentVideoTitle || "",
      channelName: currentChannelName || "",
      summaryText: text,
    });
    if (result?.success) {
      btn.textContent = "✓ 已保存至笔记";
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = "保存失败";
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 2500);
      console.error("[dk-bilidown] Save transcript note failed:", result?.error);
    }
  } catch (error) {
    btn.textContent = "保存失败";
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2500);
    console.error("[dk-bilidown] Save transcript note error:", error);
  }
}

function exportTranscript() {
  const format = document.getElementById("exportFormat")?.value || "md";
  const baseName = sanitizeFilename(currentVideoTitle) || "bilidown";
  if (format === "html") {
    downloadTextFile(buildHtmlExport(), `${baseName}.html`, "text/html;charset=utf-8");
  } else {
    downloadTextFile(buildMarkdownExport(), `${baseName}.md`, "text/markdown;charset=utf-8");
  }
}

// ============================================================
// SUMMARY TAB: EXPORT / SAVE-AS-NOTE
// ============================================================

/**
 * Builds the Markdown export for the Summary tab: video header + full note.
 */
function buildSummaryMarkdownExport() {
  const lines = [
    `# ${currentVideoTitle || "B站视频学习笔记"}`,
    "",
    `- **UP主：** ${currentChannelName || "未知"}`,
    `- **视频链接：** ${currentCanonicalVideoUrl()}`,
  ];
  if (currentVideoDescription) lines.push("", "## 视频简介", "", currentVideoDescription);
  lines.push("", currentSummary || "（暂无总结内容）", "", "---", "由 bilidown · dk 二次开发版导出");
  return lines.join("\n");
}

/**
 * Builds the HTML export for the Summary tab, reusing the transcript
 * export's visual style but rendering the Markdown note body.
 */
function buildSummaryHtmlExport() {
  const body = currentSummary ? renderMarkdown(currentSummary) : "<p>（暂无总结内容）</p>";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(currentVideoTitle || "B站视频学习笔记")}</title><style>
  :root{--pink:#fb7299;--blue:#00aeec;--ink:#18191c;--muted:#61666d;--line:#e3e5e7}*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:var(--ink);font:15px/1.75 system-ui,-apple-system,"Segoe UI",sans-serif}.page{width:min(900px,calc(100% - 28px));margin:32px auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:clamp(22px,5vw,54px);box-shadow:0 12px 36px rgba(24,25,28,.07)}h1{line-height:1.3;margin:0 0 14px}.meta{color:var(--muted)}a{color:var(--pink);text-decoration:none}.note h1,.note h2,.note h3,.note h4{line-height:1.35;margin:22px 0 8px}.note h1{font-size:22px}.note h2{font-size:19px;padding-bottom:8px;border-bottom:2px solid rgba(251,114,153,.18)}.note h3{font-size:16px}.note p{margin:8px 0}.note ul,.note ol{margin:8px 0;padding-left:22px}.note li{margin:3px 0}.note blockquote{margin:12px 0;padding:14px 18px;border-left:4px solid var(--pink);background:rgba(251,114,153,.06);border-radius:0 10px 10px 0;color:var(--muted)}.note code{font-family:ui-monospace,monospace;font-size:.9em;background:rgba(24,25,28,.05);border-radius:4px;padding:1px 5px}.note pre{margin:12px 0;padding:14px 16px;background:rgba(24,25,28,.04);border:1px solid var(--line);border-radius:10px;overflow-x:auto}.note pre code{background:none;padding:0}.note hr{border:none;border-top:1px solid var(--line);margin:20px 0}.note strong{color:var(--ink)}.footer{margin-top:38px;color:#9499a0;font-size:12px}@media(max-width:560px){.page{margin:12px auto}}
  </style></head><body><main class="page"><h1>${escapeHtml(currentVideoTitle || "B站视频学习笔记")}</h1><div class="meta">UP主：${escapeHtml(currentChannelName || "未知")} · <a href="${escapeHtml(currentCanonicalVideoUrl())}">打开原视频</a></div>${currentVideoDescription ? `<h2>视频简介</h2><p>${escapeHtml(currentVideoDescription)}</p>` : ""}<div class="note">${body}</div><div class="footer">由 bilidown · dk 二次开发版导出</div></main></body></html>`;
}

/**
 * Downloads the summary note in the selected format (Markdown or HTML).
 */
function exportSummary() {
  const format = document.getElementById("summaryExportFormat")?.value || "md";
  const baseName = (sanitizeFilename(currentVideoTitle) || "bilidown") + "-总结";
  if (format === "html") {
    downloadTextFile(buildSummaryHtmlExport(), `${baseName}.html`, "text/html;charset=utf-8");
  } else {
    downloadTextFile(buildSummaryMarkdownExport(), `${baseName}.md`, "text/markdown;charset=utf-8");
  }
}

/**
 * Saves the whole summary note as a single note entry (visible in the
 * Notes tab). Sends the raw Markdown so no AI cleanup is re-run.
 */
async function saveFullSummaryAsNote() {
  const btn = document.getElementById("saveSummaryNoteBtn");
  const original = btn.textContent;
  if (!currentSummary) {
    btn.textContent = "暂无内容";
    setTimeout(() => (btn.textContent = original), 1500);
    return;
  }
  if (!currentVideoId) {
    btn.textContent = "缺少视频信息";
    setTimeout(() => (btn.textContent = original), 1500);
    return;
  }
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveSummaryNote",
      videoId: currentVideoId,
      videoTitle: currentVideoTitle || "",
      channelName: currentChannelName || "",
      summaryText: currentSummary,
    });
    if (result?.success) {
      btn.textContent = "✓ 已保存至笔记";
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = "保存失败";
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 2500);
      console.error("[dk-bilidown] Save summary note failed:", result?.error);
    }
  } catch (error) {
    btn.textContent = "保存失败";
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2500);
    console.error("[dk-bilidown] Save summary note error:", error);
  }
}

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

function showWelcome(message) {
  const hint = document.getElementById("welcomeHint");
  if (hint) {
    hint.style.display = message ? "block" : "none";
    hint.textContent = message || "";
  }
  showState("welcome");
}

function showState(state) {
  document.getElementById("welcomeState").style.display =
    state === "welcome" ? "flex" : "none";
  document.getElementById("loadingState").style.display =
    state === "loading" ? "block" : "none";
  document.getElementById("errorState").style.display =
    state === "error" ? "block" : "none";
  const uploadEl = document.getElementById("uploadState");
  if (uploadEl) uploadEl.style.display = "none"; // Upload state removed — always hidden
  document.getElementById("resultsState").style.display =
    state === "results" ? "block" : "none";

  // The tab bar only belongs on the results view. We toggle it HERE, in one
  // place, so it tracks the view automatically. Previously each caller had to
  // remember to re-show it after showState("results"), and one path forgot —
  // which is why the tabs could vanish when re-opening an already-analyzed video.
  document.getElementById("tabsNav").style.display =
    state === "results" ? "flex" : "none";

  if (state !== "results") {
    stopPlaybackTracking();
  }
}

function updateLoading(title, subtitle) {
  document.getElementById("loadingText").textContent = title;
  document.getElementById("loadingSubtext").textContent = subtitle;
}

function showError(title, message) {
  errorAction = null;
  showState("error");
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorBtn").textContent = "重新尝试";
}

function showConfigError(configStatus) {
  const missingKeys = [];
  if (!configStatus.hasAiKey) missingKeys.push("DeepSeek API 密钥");

  showState("error");
  document.getElementById("errorTitle").textContent = "还没有配置 API 密钥";
  document.getElementById("errorMessage").textContent =
    `请先在 bilidown 设置中填写${missingKeys.join("和")}。`;
  document.getElementById("errorBtn").textContent = "打开设置";
  errorAction = () => chrome.runtime.sendMessage({ action: "openOptions" });
}

// ============================================================
// TAB SWITCHING
// ============================================================

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });

  // Start/stop playback tracking based on which tab is active
  if (tabName === "transcript") {
    startPlaybackTracking();
  } else {
    stopPlaybackTracking();
  }

  // Lazy-load LLM analysis when user switches to Overview tab
  if (tabName === "overview" && !currentAnalysis && !isAnalysisLoading) {
    triggerAnalysis();
  }

  // Lazy-load LLM summary when user switches to Summary tab
  if (tabName === "summary" && !currentSummary && !isSummaryLoading) {
    triggerSummary();
  }
}

/**
 * Triggers the LLM analysis (lazy-loaded when user clicks Overview or Quotes tab).
 * This saves tokens by not running analysis until needed.
 */
async function triggerAnalysis() {
  if (!currentTranscriptTimestamped || isAnalysisLoading || currentAnalysis)
    return;

  isAnalysisLoading = true;

  // Show loading indicators in the Overview tab
  const chapterList = document.getElementById("chapterList");
  const quotesList = document.getElementById("quotesList");

  if (chapterList)
    chapterList.innerHTML =
      '<li class="chapter-item" style="color: var(--text-muted); border: none;">正在生成章节…</li>';
  if (quotesList)
    quotesList.innerHTML =
      '<div class="quote-item" style="color: var(--text-muted); border-left-color: var(--border);">正在提取关键观点…</div>';

  try {
    const analysisResult = await chrome.runtime.sendMessage({
      action: "analyzeTranscript",
      transcriptText: currentTranscriptTimestamped,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      videoDescription: currentVideoDescription,
      videoDuration: currentVideoDuration,
    });

    if (!analysisResult.success) {
      if (chapterList)
        chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">Analysis failed: ${escapeHtml(analysisResult.error || "Unknown error")}</li>`;
      isAnalysisLoading = false;
      return;
    }

    currentAnalysis = analysisResult.analysis;
    renderAnalysisResults(currentAnalysis);
    highlightMomentsOnPage(currentAnalysis.keyMoments);

    // Save to cache now that we have analysis
    await saveToCache(currentVideoId);
  } catch (error) {
    console.error("[dk-bilidown Panel] Analysis error:", error);
    if (chapterList)
      chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">Error: ${escapeHtml(error.message)}</li>`;
  }

  isAnalysisLoading = false;
}

/**
 * Triggers the LLM summary (lazy-loaded when user clicks the Summary tab).
 * Converts the full transcript into a complete, structured study note.
 */
async function triggerSummary() {
  if (!currentTranscriptTimestamped || isSummaryLoading || currentSummary)
    return;

  isSummaryLoading = true;
  const summaryContent = document.getElementById("summaryContent");

  if (summaryContent) {
    summaryContent.innerHTML =
      '<div class="summary-placeholder" style="color: var(--text-muted);">正在根据完整字幕整理笔记…</div>';
  }

  try {
    const summaryResult = await chrome.runtime.sendMessage({
      action: "summaryTranscript",
      transcriptText: currentTranscriptTimestamped,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
    });

    if (!summaryResult.success) {
      if (summaryContent) {
        summaryContent.innerHTML = `<div class="summary-error">Summary failed: ${escapeHtml(summaryResult.error || "Unknown error")}</div>`;
      }
      isSummaryLoading = false;
      return;
    }

    currentSummary = summaryResult.markdown || "";
    renderSummaryResults(currentSummary);

    // Save to cache now that we have summary
    await saveToCache(currentVideoId);
  } catch (error) {
    console.error("[dk-bilidown Panel] Summary error:", error);
    if (summaryContent) {
      summaryContent.innerHTML = `<div class="summary-error">Error: ${escapeHtml(error.message)}</div>`;
    }
  }

  isSummaryLoading = false;
}

/**
 * Renders the summary Markdown into the Summary tab.
 */
function renderSummaryResults(markdown) {
  const summaryContent = document.getElementById("summaryContent");
  if (!summaryContent) return;
  if (!markdown) {
    summaryContent.innerHTML =
      '<div class="summary-placeholder" style="color: var(--text-muted);">没有生成内容。</div>';
    return;
  }
  summaryContent.innerHTML = renderMarkdown(markdown);
}

/**
 * Minimal, dependency-free Markdown -> HTML renderer for AI-generated notes.
 * Input is escaped first, so only the allowlisted syntax below can become
 * markup — no raw HTML, no attributes, no scripts.
 *
 * Supported: #..###### headings, ordered/unordered lists, blockquotes,
 * code fences, inline code, **bold**, *italic*, [text](url), --- rule,
 * line breaks and paragraphs.
 */
function renderMarkdown(markdown) {
  if (!markdown) return "";
  let lines = String(markdown).replace(/\r\n/g, "\n").split("\n");

  const escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  };

  // Inline formatting, applied AFTER escaping. Only run on escaped text.
  const inline = (text) =>
    text
      .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      );

  const html = [];
  let inFence = false;
  let fenceBuf = [];
  let listType = null; // "ul" | "ol"

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (let raw of lines) {
    const line = raw;

    // Code fence
    if (/^```/.test(line)) {
      if (inFence) {
        html.push(`<pre><code>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`);
        fenceBuf = [];
        inFence = false;
      } else {
        closeList();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      html.push("");
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(
        `<h${level}>${inline(escapeHtml(headingMatch[2]))}</h${level}>`,
      );
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      closeList();
      html.push("<hr>");
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      closeList();
      html.push(`<blockquote>${inline(escapeHtml(trimmed.replace(/^>\s?/, "")))}</blockquote>`);
      continue;
    }

    // Unordered list
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inline(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (olMatch) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inline(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Plain paragraph
    closeList();
    html.push(`<p>${inline(escapeHtml(trimmed))}</p>`);
  }

  if (inFence && fenceBuf.length) {
    html.push(`<pre><code>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`);
  }
  closeList();

  return html.join("\n");
}

// ============================================================
// TIMESTAMP / SEEK
// ============================================================

async function seekTo(seconds) {
  debugLog("[dk-bilidown Panel] seekTo called with:", seconds);
  if (seconds === undefined || seconds === null) {
    debugLog("[dk-bilidown Panel] seekTo aborted - no seconds value");
    return;
  }

  const payload = {
    action: "seekTo",
    seconds: Number(seconds),
  };

  try {
    // Try direct messaging to the stored Bilibili tab first (fastest/reliable)
    if (bilibiliTabId) {
      try {
        await chrome.tabs.sendMessage(bilibiliTabId, payload);
        debugLog("[dk-bilidown Panel] seekTo direct success");
        return;
      } catch (directErr) {
        debugLog(
          "[dk-bilidown Panel] Direct seekTo failed, falling back to relay:",
          directErr.message,
        );
      }
    }

    // Fallback: route through background script
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload,
    });
    debugLog("[dk-bilidown Panel] seekTo relay result:", result);
  } catch (error) {
    console.error("[dk-bilidown Panel] seekTo error:", error);
  }
}

/**
 * Plays a saved note at its timestamp.
 * - If the note belongs to the video currently open, we seek the player in place.
 * - If it belongs to a DIFFERENT video (e.g. viewing "All Notes"), seeking the
 *   current player would jump to the wrong content, so we open that video in a
 *   new tab at the right timestamp instead.
 */
function playNote(note) {
  if (note.videoId && note.videoId === currentVideoId) {
    seekTo(note.timestampSeconds);
  } else {
    // note.timestampedUrl already includes the &t=<seconds>s anchor
    chrome.tabs.create({ url: note.timestampedUrl });
  }
}

async function highlightMomentsOnPage(moments) {
  if (!moments || !moments.length) return;

  try {
    // Route through background script for reliable message passing
    await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: {
        action: "highlightMoments",
        moments: moments,
        videoDuration: currentVideoDuration,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);
  }
}

// ============================================================
// UTILITY
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

/**
 * Renders the small subset of inline formatting commonly present in subtitle
 * tracks and model translations. Everything is escaped first; only exact,
 * attribute-free allowlisted tags are restored as markup afterwards.
 */
function renderSubtitleInlineMarkup(text) {
  return escapeHtml(text).replace(
    /&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi,
    (_match, closing, tagName) =>
      tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>",
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Copy failed:", error);
    return false;
  }
}

async function copyToClipboardWithFeedback(text, buttonId) {
  const btn = document.getElementById(buttonId);
  const original = btn.textContent;

  const success = await copyToClipboard(text);
  if (success) {
    btn.textContent = "✓ Copied";
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  }
}

function downloadTextFile(text, filename, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(str) {
  return (str || "untitled")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    .toLowerCase();
}

// ============================================================
// TEXT SELECTION — EXPLAIN FEATURE
// ============================================================

/**
 * Sets up text selection handling in the transcript.
 * When user selects text, shows an "Explain" button.
 */
function setupExplainFeature() {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  // Remove existing tooltip if any
  const existingTooltip = document.getElementById("explainTooltip");
  if (existingTooltip) existingTooltip.remove();

  // Create the explain tooltip/button
  const tooltip = document.createElement("div");
  tooltip.id = "explainTooltip";
  tooltip.className = "explain-tooltip";
  tooltip.innerHTML = `<button class="explain-btn">💡 Explain</button>`;
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  let selectedText = "";

  // Interacting with Explain must preserve the transcript selection and stay
  // isolated from document/row click behavior.
  tooltip.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  tooltip.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });
  tooltip.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  // Listen for text selection
  document.addEventListener("mouseup", (e) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    // Only show if selecting within transcript
    const isInTranscript = transcriptList.contains(selection.anchorNode);

    // Allow any selection length (removed 10+ char requirement)
    if (text.length > 0 && isInTranscript) {
      selectedText = text;

      // Position the tooltip near the selection
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      tooltip.style.display = "block";
      tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
    } else {
      tooltip.style.display = "none";
    }
  });

  // Hide tooltip when clicking elsewhere
  document.addEventListener("mousedown", (e) => {
    if (!tooltip.contains(e.target)) {
      tooltip.style.display = "none";
    }
  });

  // Handle explain button click
  tooltip
    .querySelector(".explain-btn")
    .addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedText) return;

      tooltip.style.display = "none";
      await showExplanation(selectedText);
    });
}

/**
 * Shows the explanation modal and fetches it from the configured AI provider.
 */
async function showExplanation(selectedText) {
  // Create modal
  const modal = document.createElement("div");
  modal.id = "explainModal";
  modal.className = "explain-modal-overlay";
  modal.innerHTML = `
    <div class="explain-modal">
      <div class="explain-modal-header">
        <div class="explain-modal-title">Explain</div>
        <button class="explain-modal-close" id="closeExplain">✕</button>
      </div>
      <div class="explain-selected-text">"${escapeHtml(selectedText.substring(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div>
      <div class="explain-modal-content" id="explanationContent">
        <div class="explain-loading">
          <div class="loading-bar"></div>
          <span>Analyzing...</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  document
    .getElementById("closeExplain")
    .addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  // Get some context around the selection from the transcript
  const transcriptContext = getTranscriptContext(selectedText);

  // Fetch explanation
  try {
    const result = await chrome.runtime.sendMessage({
      action: "explainSelection",
      selectedText: selectedText,
      transcriptContext: transcriptContext,
      videoTitle: currentVideoTitle,
    });

    const contentDiv = document.getElementById("explanationContent");
    if (result.success) {
      contentDiv.innerHTML = `<div class="explain-text">${escapeHtml(result.explanation).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</div>`;
    } else {
      contentDiv.innerHTML = `<div class="explain-error">Failed to get explanation: ${escapeHtml(result.error)}</div>`;
    }
  } catch (error) {
    const contentDiv = document.getElementById("explanationContent");
    contentDiv.innerHTML = `<div class="explain-error">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Gets surrounding context from the transcript for the selected text.
 */
function getTranscriptContext(selectedText) {
  const fullText = currentTranscriptText || "";
  const index = fullText.indexOf(selectedText);

  if (index === -1) return "";

  // Get 200 chars before and after
  const start = Math.max(0, index - 200);
  const end = Math.min(fullText.length, index + selectedText.length + 200);

  return fullText.substring(start, end);
}

// ============================================================
// CACHING
// ============================================================

/**
 * Saves the current digest results to persistent local storage.
 * Results survive browser restarts — reopening the same video loads from cache
 * without consuming API tokens or Supadata calls.
 * Cache expires after 30 days. Oldest entries evicted when > 20 videos cached.
 */
async function saveToCache(videoId) {
  if (!videoId || !currentTranscript) return;

  try {
    // Persist semantic-segment translations for this video.
    const paragraphCacheForVideo = {};
    for (const [key, value] of transcriptParagraphCache.entries()) {
      if (key.startsWith(`${videoId}:`)) {
        paragraphCacheForVideo[key] = value;
      }
    }

    const cacheData = {
      schemaVersion: BILIDOWN_CACHE_SCHEMA_VERSION,
      videoId,
      analysis: currentAnalysis, // May be null if not yet analyzed
      summary: currentSummary, // May be null if not yet summarized
      transcript: currentTranscript,
      transcriptText: currentTranscriptText,
      transcriptTimestamped: currentTranscriptTimestamped,
      transcriptLanguage: currentTranscriptLanguage,
      transcriptSource: currentTranscriptSource,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      paragraphCache: paragraphCacheForVideo,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [`bilidown_${videoId}`]: cacheData });
    debugLog(
      "Saved to cache:",
      videoId,
      currentAnalysis ? "(with analysis)" : "(transcript only)",
    );

    // Evict old entries if we have more than 20 videos cached
    await evictOldCacheEntries(20);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

/**
 * Keeps the cache from growing unbounded.
 * Removes the oldest entries when we exceed maxEntries videos.
 *
 * @param {number} maxEntries - Maximum number of cached videos to keep
 */
async function evictOldCacheEntries(maxEntries) {
  try {
    const allData = await chrome.storage.local.get(null);
    let bilidownKeys = Object.keys(allData).filter((k) =>
      k.startsWith("bilidown_"),
    );
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const expired = bilidownKeys.filter((key) => {
      const timestamp = Number(allData[key]?.timestamp) || 0;
      return Date.now() - timestamp > THIRTY_DAYS;
    });
    if (expired.length) {
      await chrome.storage.local.remove(expired);
      const expiredSet = new Set(expired);
      bilidownKeys = bilidownKeys.filter((key) => !expiredSet.has(key));
    }

    if (bilidownKeys.length <= maxEntries) return;

    // Sort by timestamp (oldest first) and remove excess
    const sorted = bilidownKeys
      .map((k) => ({ key: k, ts: allData[k]?.timestamp || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const toRemove = sorted
      .slice(0, sorted.length - maxEntries)
      .map((e) => e.key);
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      debugLog(`[dk-bilidown] Evicted ${toRemove.length} old cache entries`);
    }
  } catch (error) {
    console.error("Cache eviction error:", error);
  }
}

/**
 * Loads digest results from persistent local storage.
 * Returns null if not cached or expired (30-day expiry).
 */
async function loadFromCache(videoId) {
  if (!videoId) return null;

  try {
    const result = await chrome.storage.local.get(`bilidown_${videoId}`);
    const cached = result[`bilidown_${videoId}`];

    if (!cached) return null;

    const storedSettings = await chrome.storage.local.get(YTD_SETTINGS.STORAGE_KEY);
    const wantsAsr = !!YTD_SETTINGS.normalize(
      storedSettings[YTD_SETTINGS.STORAGE_KEY],
    ).asrApiKey;
    if (wantsAsr && cached.transcriptSource !== "aliyun-fun-asr") {
      await chrome.storage.local.remove(`bilidown_${videoId}`);
      return null;
    }

    // Earlier Bilibili builds parsed "@p2" with Number("p2"), silently
    // fetching P1 and caching that transcript under another part. Never reuse
    // those records after the part-routing fix.
    if (
      cached.schemaVersion !== BILIDOWN_CACHE_SCHEMA_VERSION ||
      cached.videoId !== videoId
    ) {
      await chrome.storage.local.remove(`bilidown_${videoId}`);
      return null;
    }

    // Cache expires after 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - cached.timestamp > THIRTY_DAYS) {
      await chrome.storage.local.remove(`bilidown_${videoId}`);
      return null;
    }

    return cached;
  } catch (error) {
    console.error("Cache load error:", error);
    return null;
  }
}

/**
 * Updates the cache after enhance or translation operations.
 */
async function updateCache() {
  if (currentVideoId) {
    await saveToCache(currentVideoId);
  }
}

// ============================================================
// NOTES
// ============================================================

/**
 * Loads and renders notes from storage.
 * @param {string|null} videoId - Filter by video ID, or null for all notes
 */
async function loadNotes(videoId) {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "getNotes",
      videoId: videoId,
    });

    if (result.success) {
      renderNotes(result.notes, videoId);
    }
  } catch (error) {
    console.error("[dk-bilidown Panel] Load notes error:", error);
  }
}

/**
 * Renders the notes list in the Notes tab.
 */
function renderNotes(notes, filteredVideoId) {
  const notesList = document.getElementById("notesList");
  const notesIntro = document.getElementById("notesIntro");

  if (!notesList) return;

  notesList.innerHTML = "";

  if (!notes || notes.length === 0) {
    notesIntro.style.display = "block";
    notesIntro.textContent = filteredVideoId
      ? "No notes for this video yet. Hover over the video and click 📝 Note to save."
      : "No notes saved yet. Hover over a video and click 📝 Note to save.";
    return;
  }

  notesIntro.style.display = "none";

  notes.forEach((note) => {
    const noteEl = document.createElement("div");
    noteEl.className = "note-item" + (note.isFullNote ? " note-item--full" : "");
    const isFullNote = !!note.isFullNote;
    noteEl.innerHTML = `
      <div class="note-header">
        ${isFullNote
          ? `<span class="note-badge-full">📄 整篇笔记</span>`
          : `<span class="note-timestamp" data-url="${escapeHtml(note.timestampedUrl)}" data-seconds="${Number(note.timestampSeconds) || 0}">${escapeHtml(note.timestamp)}</span>`}
        ${!filteredVideoId ? `<span class="note-video-title">${escapeHtml(note.videoTitle)}</span>` : ""}
        <button class="note-delete" data-id="${escapeHtml(note.id)}" title="Delete note">✕</button>
      </div>
      ${isFullNote
        ? `<div class="note-text note-text-full">${renderMarkdown(note.text)}</div>`
        : `<div class="note-text">"${escapeHtml(note.text)}"</div>`}
      <div class="note-actions">
        <button class="note-action-btn note-copy-text">⧉ Copy text</button>
        ${isFullNote ? "" : `<button class="note-action-btn note-copy-link" data-url="${escapeHtml(note.timestampedUrl)}">🔗 Copy timestamp</button>
        <button class="note-action-btn note-play" data-seconds="${Number(note.timestampSeconds) || 0}">▶ Play</button>`}
      </div>
    `;

    // Timestamp click - play from this point (in this tab or a new one)
    const tsEl = noteEl.querySelector(".note-timestamp");
    if (tsEl) {
      tsEl.addEventListener("click", () => {
        playNote(note);
      });
    }

    // Delete button
    noteEl
      .querySelector(".note-delete")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteNote(note.id);
        loadNotes(filteredVideoId);
      });

    // Copy text button — copies just the note's text
    noteEl
      .querySelector(".note-copy-text")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.text);
          const btn = noteEl.querySelector(".note-copy-text");
          btn.textContent = "✓ Copied!";
          setTimeout(() => {
            btn.textContent = "⧉ Copy text";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Copy timestamp button — copies the timestamped Bilibili link
    const copyLinkBtn = noteEl.querySelector(".note-copy-link");
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.timestampedUrl);
          copyLinkBtn.textContent = "✓ Copied!";
          setTimeout(() => {
            copyLinkBtn.textContent = "🔗 Copy timestamp";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });
    }

    // Play button (in this tab if it's the current video, else a new tab)
    const playBtn = noteEl.querySelector(".note-play");
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        playNote(note);
      });
    }

    notesList.appendChild(noteEl);
  });
}

/**
 * Deletes a note by ID.
 */
async function deleteNote(noteId) {
  try {
    await chrome.runtime.sendMessage({
      action: "deleteNote",
      noteId: noteId,
    });
  } catch (error) {
    console.error("[dk-bilidown Panel] Delete note error:", error);
  }
}

// ============================================================
// AUTO-SCROLL — Follow video playback in transcript
// ============================================================
// While a video plays, the transcript automatically scrolls to show which
// 30-second chunk is currently being spoken. If the user manually scrolls
// (e.g., to read ahead), auto-scroll pauses and a "Follow playback" button
// appears so they can resume it. Highlight always stays active regardless.

/**
 * Starts polling the video's current time and highlighting/scrolling
 * to the matching transcript entry.
 */
function startPlaybackTracking() {
  if (!currentTranscript || !currentTranscript.length) return;

  // Don't restart if already tracking (preserves user's auto-scroll state)
  if (autoScrollInterval) return;

  autoScrollEnabled = true;
  document.getElementById("followPlaybackBtn").style.display = "none";

  // Poll video time every 500ms
  autoScrollInterval = setInterval(() => playbackTrackingTick(), 500);

  // Listen for manual scrolls on the content area
  const contentArea = document.getElementById("contentArea");
  contentArea.removeEventListener("scroll", onContentAreaScroll);
  contentArea.addEventListener("scroll", onContentAreaScroll);
}

/**
 * Stops playback tracking entirely. Called when leaving transcript tab,
 * starting a new digest, or leaving results state.
 */
function stopPlaybackTracking() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  autoScrollEnabled = true; // Reset for next time
  lastAutoScrollTime = 0;
  document.getElementById("followPlaybackBtn").style.display = "none";

  // Remove active highlights
  document
    .querySelectorAll(".transcript-entry.active-playback")
    .forEach((el) => {
      el.classList.remove("active-playback");
    });
}

/**
 * One tick of the playback tracker. Gets current video time from the
 * Bilibili tab and highlights + scrolls to the matching transcript entry.
 */
async function playbackTrackingTick() {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: { action: "getCurrentTime" },
    });

    if (!result.success || !result.response) return;

    const currentTime = result.response.currentTime || 0;
    highlightActiveEntry(currentTime);
  } catch (error) {
    // Silently ignore — Bilibili tab might be closed or navigated away
  }
}

/**
 * Scrolls the transcript to the entry currently being spoken (the one
 * carrying the active-playback highlight). Returns false if nothing is
 * highlighted yet. Stamps lastAutoScrollTime BEFORE scrolling so the scroll
 * events from our own smooth animation aren't mistaken for the user
 * scrolling away (which would re-disable auto-scroll immediately).
 */
function scrollToActiveEntry() {
  const activeEntry = document.querySelector(
    "#transcriptList .transcript-entry.active-playback",
  );
  if (!activeEntry) return false;

  lastAutoScrollTime = Date.now();
  activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/**
 * Finds the transcript entry matching the current playback time,
 * highlights it, and scrolls to it (if auto-scroll is enabled).
 *
 * @param {number} currentSeconds - Current video playback time in seconds
 */
function highlightActiveEntry(currentSeconds) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  const entries = transcriptList.querySelectorAll(".transcript-entry");
  if (entries.length === 0) return;

  // Find the entry whose time range contains the current playback time
  let activeEntry = null;
  entries.forEach((entry, index) => {
    const entrySeconds = parseInt(entry.dataset.seconds);
    const nextEntry = entries[index + 1];
    const nextSeconds = nextEntry
      ? parseInt(nextEntry.dataset.seconds)
      : Infinity;

    if (currentSeconds >= entrySeconds && currentSeconds < nextSeconds) {
      activeEntry = entry;
    }
  });

  if (!activeEntry) return;

  // Skip if this entry is already highlighted (no DOM thrashing)
  if (activeEntry.classList.contains("active-playback")) return;

  // Remove old highlight, add new one
  entries.forEach((e) => e.classList.remove("active-playback"));
  activeEntry.classList.add("active-playback");

  // Only scroll if auto-scroll is enabled
  if (autoScrollEnabled) {
    lastAutoScrollTime = Date.now();
    activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/**
 * Scroll event handler for the content area.
 * Detects manual scrolling and disables auto-scroll so the user
 * can read at their own pace without being yanked back.
 */
function onContentAreaScroll() {
  // Ignore scroll events within 1 second of a programmatic scroll
  // (smooth scroll animations can last longer than a simple boolean flag)
  if (Date.now() - lastAutoScrollTime < 1000) return;

  // User scrolled manually — disable auto-scroll and show the button
  if (autoScrollEnabled && autoScrollInterval) {
    autoScrollEnabled = false;
    document.getElementById("followPlaybackBtn").style.display = "block";
  }
}

// ============================================================
// TRANSCRIPT MODE UI — Original / Chinese / aligned bilingual
// ============================================================

function getOriginalTranscriptLabel() {
  const language = String(currentTranscriptLanguage || "").trim();
  return /^[A-Za-z0-9-]{1,20}$/.test(language)
    ? `Original (${language})`
    : "Original";
}

function originalTranscriptIsChinese() {
  return /^(zh|zh-|ai-zh|cn)/i.test(String(currentTranscriptLanguage || ""));
}

function updateTranscriptLanguageModes() {
  const chineseSource = originalTranscriptIsChinese();
  document
    .querySelectorAll('[data-transcript-mode="zh"], [data-transcript-mode="bilingual"]')
    .forEach((button) => {
      button.hidden = chineseSource;
    });
  const originalButton = document.querySelector('[data-transcript-mode="original"]');
  if (originalButton) {
    originalButton.textContent = chineseSource ? "中文字幕" : getOriginalTranscriptLabel();
  }
  if (chineseSource && currentTranscriptMode !== "original") {
    currentTranscriptMode = "original";
    setTranscriptModeButtons("original");
  }
}

function getActiveTranscriptSegments() {
  return groupTranscriptEntries(currentTranscript || []);
}

function transcriptTranslationCacheKey(segment) {
  return `${currentVideoId}:zh:semantic:${segment.id}`;
}

function setTranscriptModeButtons(mode) {
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    const active = button.dataset.transcriptMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function handleTranscriptModeChange(mode) {
  if (!["original", "zh", "bilingual"].includes(mode)) return;
  if (originalTranscriptIsChinese() && mode !== "original") return;
  if (mode === currentTranscriptMode) return;

  currentTranscriptMode = mode;
  translationGeneration += 1;
  translationWorkCount = 0;
  setTranslatingSpinner(false);
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  transcriptScrollObserver = null;
  setTranscriptModeButtons(mode);

  if (mode === "original") {
    renderTranscript();
    return;
  }

  await translateTranscript();
}

function renderTranscriptSegmentContent(segment, mode, translated, error) {
  const original = renderSubtitleInlineMarkup(segment.text);
  let translationHtml = "";
  if (translated) {
    translationHtml = renderSubtitleInlineMarkup(translated);
  } else if (error) {
    translationHtml = `${escapeHtml(error)}<button class="translation-retry-btn" type="button">Retry</button>`;
  } else {
    translationHtml = "Waiting for translation…";
  }

  if (mode === "bilingual") {
    return `<span class="transcript-copy"><span class="transcript-original">${original}</span><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
  }

  return `<span class="transcript-copy"><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
}

function renderTranscriptModeRows(segments, mode) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return [];
  transcriptList.innerHTML = "";

  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();
  const badge = document.createElement("div");
  badge.id = "transcriptSourceBadge";
  badge.className = "transcript-source-badge";
  const originalLabel = getOriginalTranscriptLabel();
  const modeLabel =
    mode === "bilingual"
      ? `${originalLabel} + 简体中文`
      : `简体中文 · translated from ${originalLabel}`;
  badge.innerHTML = `<span class="source-dot source-dot--subs"></span> From video subtitles · ${modeLabel}`;
  transcriptList.parentElement.insertBefore(badge, transcriptList);

  const rows = [];
  segments.forEach((segment, index) => {
    const div = document.createElement("div");
    const cached = transcriptParagraphCache.get(
      transcriptTranslationCacheKey(segment),
    );
    div.className = `transcript-entry ${cached ? "translated" : "translating"}`;
    div.dataset.seconds = segment.start;
    div.dataset.segmentId = segment.id;
    div.dataset.segmentIndex = index;

    const minutes = Math.floor(segment.start / 60);
    const seconds = Math.floor(segment.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      ${renderTranscriptSegmentContent(segment, mode, cached, "")}
    `;
    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, segment.start),
    );
    transcriptList.appendChild(div);
    rows.push(div);
  });

  startPlaybackTracking();
  return rows;
}

/**
 * Rebuilds a provider response in source order. Unknown IDs are ignored and
 * missing IDs remain explicit errors, never positional guesses.
 */
function alignTranslatedSegmentBatch(sourceSegments, responseSegments) {
  const translatedById = new Map();
  if (Array.isArray(responseSegments)) {
    responseSegments.forEach((item) => {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string")
        return;
      const text = item.text.trim();
      if (text && !translatedById.has(item.id)) {
        translatedById.set(item.id, text);
      }
    });
  }

  return sourceSegments.map((segment) => ({
    id: segment.id,
    text: translatedById.get(segment.id) || "",
    error: translatedById.has(segment.id) ? "" : "Translation unavailable.",
  }));
}

function updateTranslatedRow(segment, index, alignedItem, generation) {
  if (generation !== translationGeneration) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  if (!row) return;

  if (alignedItem.text) {
    transcriptParagraphCache.set(
      transcriptTranslationCacheKey(segment),
      alignedItem.text,
    );
  }

  const copy = row.querySelector(".transcript-copy");
  if (copy) {
    copy.outerHTML = renderTranscriptSegmentContent(
      segment,
      currentTranscriptMode,
      alignedItem.text,
      alignedItem.error,
    );
  }
  row.classList.toggle("translated", !!alignedItem.text);
  row.classList.toggle("translating", false);
  row.classList.toggle("translation-failed", !alignedItem.text);

  const retry = row.querySelector(".translation-retry-btn");
  if (retry) {
    ["mousedown", "mouseup"].forEach((eventName) => {
      retry.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      retryTranslationSegment(index, generation);
    });
  }
}

let activeTranslationQueue = null;

async function requestTranscriptTranslationBatch(
  indices,
  segments,
  generation,
  videoId,
  mode,
) {
  const sourceBatch = indices.map((index) => segments[index]);
  setTranslatingSpinner(true);
  try {
    const result = await sendTranslationMessage({
      action: "translateContent",
      content: {
        segments: sourceBatch.map(({ id, text }) => ({ id, text })),
      },
      contentType: "transcriptBatch",
      targetLanguage: "zh",
      videoTitle: currentVideoTitle,
    });

    const isStale =
      generation !== translationGeneration ||
      videoId !== currentVideoId ||
      mode !== currentTranscriptMode;
    if (isStale) return;

    const responseSegments = result?.success
      ? result.translatedContent?.segments
      : [];
    const aligned = alignTranslatedSegmentBatch(sourceBatch, responseSegments);
    aligned.forEach((item, batchIndex) => {
      if (!result?.success) {
        item.error = result?.error || "Translation failed.";
      }
      updateTranslatedRow(
        sourceBatch[batchIndex],
        indices[batchIndex],
        item,
        generation,
      );
    });
    await updateCache();
  } catch (error) {
    if (generation !== translationGeneration) return;
    sourceBatch.forEach((segment, batchIndex) => {
      updateTranslatedRow(
        segment,
        indices[batchIndex],
        { id: segment.id, text: "", error: error.message || "Translation failed." },
        generation,
      );
    });
  } finally {
    setTranslatingSpinner(false);
  }
}

function retryTranslationSegment(index, generation) {
  if (generation !== translationGeneration || !activeTranslationQueue) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-index="${index}"]`,
  );
  if (row) {
    row.classList.add("translating");
    row.classList.remove("translation-failed");
    const translation = row.querySelector(".transcript-translation");
    if (translation) {
      translation.className = "transcript-translation translation-pending";
      translation.textContent = "Retrying…";
    }
  }
  activeTranslationQueue.enqueue(index, true);
}

/**
 * Renders immediately, translates the first small batch, then observes the
 * remaining rows. Batches are sequential so the provider is never flooded.
 */
async function translateTranscript() {
  const segments = getActiveTranscriptSegments();
  if (!segments.length || currentTranscriptMode === "original") return;

  translationGeneration += 1;
  const generation = translationGeneration;
  const videoId = currentVideoId;
  const mode = currentTranscriptMode;
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();

  const rows = renderTranscriptModeRows(segments, mode);
  const queue = [];
  const queued = new Set();
  let processing = false;

  const processNext = async () => {
    if (processing || queue.length === 0 || generation !== translationGeneration)
      return;
    processing = true;
    const indices = queue.splice(0, 3);
    indices.forEach((index) => queued.delete(index));
    try {
      await requestTranscriptTranslationBatch(
        indices,
        segments,
        generation,
        videoId,
        mode,
      );
    } finally {
      processing = false;
      if (queue.length && generation === translationGeneration) processNext();
    }
  };

  const enqueue = (index, force = false) => {
    if (!Number.isInteger(index) || !segments[index]) return;
    const cached = transcriptParagraphCache.has(
      transcriptTranslationCacheKey(segments[index]),
    );
    if ((!force && cached) || queued.has(index)) return;
    queue.push(index);
    queued.add(index);
    // Let all entries reported in the same viewport turn collect before the
    // worker starts, producing one small contextual multi-segment request.
    Promise.resolve().then(processNext);
  };
  activeTranslationQueue = { enqueue };

  transcriptScrollObserver = new IntersectionObserver(
    (observerEntries) => {
      observerEntries
        .filter((entry) => entry.isIntersecting)
        .sort(
          (a, b) =>
            Number(a.target.dataset.segmentIndex) -
            Number(b.target.dataset.segmentIndex),
        )
        .forEach((entry) => enqueue(Number(entry.target.dataset.segmentIndex)));
    },
    {
      root: document.getElementById("contentArea"),
      rootMargin: "320px 0px",
      threshold: 0,
    },
  );

  rows.forEach((row, index) => {
    if (!row.classList.contains("translated")) transcriptScrollObserver.observe(row);
    if (index < 3) enqueue(index);
  });
}

function setTranslatingSpinner(show) {
  if (show) translationWorkCount += 1;
  else translationWorkCount = Math.max(0, translationWorkCount - 1);
  const isTranslating = translationWorkCount > 0;
  const spinner = document.getElementById("langSpinner");
  if (spinner) spinner.classList.toggle("visible", isTranslating);
}

// Pure helpers are exposed for the repository's Node tests. The extension does
// not read this object at runtime.
globalThis.__YTD_TRANSCRIPT_TESTING__ = {
  sendTranslationMessage,
  groupTranscriptEntries,
  splitOversizedThought,
  alignTranslatedSegmentBatch,
  renderSubtitleInlineMarkup,
  renderTranscriptSegmentContent,
};
