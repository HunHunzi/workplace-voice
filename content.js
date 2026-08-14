(() => {
  "use strict";

  const READY_TTL_MS = 5 * 60 * 1000;
  const editorStates = new WeakMap();
  let enabled = true;
  let processingEditor = null;
  let toastTimer = null;

  chrome.storage.local.get({ enabled: true }, (settings) => {
    enabled = settings.enabled;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.enabled) {
      enabled = changes.enabled.newValue;
    }
  });

  document.addEventListener("input", handleEditorInput, true);
  document.addEventListener("keydown", handleKeyDown, true);

  function handleEditorInput(event) {
    const editor = findEditor(event.target);
    if (!editor) {
      return;
    }

    const state = editorStates.get(editor);
    if (state?.ready && !getEditorText(editor).trim()) {
      editorStates.delete(editor);
    }
  }

  async function handleKeyDown(event) {
    if (!shouldHandleShortcut(event) || !enabled || !isMessengerPage()) {
      return;
    }

    const editor = findEditor(event.target);
    if (!editor || !isLikelyMessageEditor(editor)) {
      return;
    }

    const state = editorStates.get(editor);
    if (state?.ready && state.expiresAt > Date.now()) {
      editorStates.delete(editor);
      showToast("已确认，正在发送", "success");
      return;
    }

    if (state) {
      editorStates.delete(editor);
    }

    stopEvent(event);

    if (processingEditor) {
      showToast("正在整理，请稍候", "info");
      return;
    }

    const originalText = getEditorText(editor).trim();
    if (!originalText) {
      showToast("请先输入消息内容", "error");
      return;
    }

    processingEditor = editor;
    setEditorBusy(editor, true);
    showToast("正在整理消息...", "info", true);

    try {
      const response = await sendRuntimeMessage({
        type: "ORGANIZE_TEXT",
        text: originalText,
      });

      if (!response?.ok) {
        throw new Error(response?.error || "整理失败，请稍后重试");
      }

      replaceEditorText(editor, response.text);
      editorStates.set(editor, {
        ready: true,
        expiresAt: Date.now() + READY_TTL_MS,
      });
      showToast("已整理，检查后再次按 ⌘ Enter 发送", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "整理失败，请稍后重试";
      showToast(message, "error");
    } finally {
      setEditorBusy(editor, false);
      processingEditor = null;
    }
  }

  function shouldHandleShortcut(event) {
    return (
      event.key === "Enter" &&
      event.metaKey &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.repeat &&
      !event.isComposing
    );
  }

  function isMessengerPage() {
    const paths = [window.location.pathname];
    try {
      paths.push(window.top.location.pathname);
    } catch {
      // Cross-origin frames cannot expose the top-level route.
    }
    try {
      if (document.referrer) {
        paths.push(new URL(document.referrer).pathname);
      }
    } catch {
      // An invalid or opaque referrer does not affect the current frame route.
    }
    return paths.some((path) => /(^|\/)messenger(\/|$)/i.test(path));
  }

  function findEditor(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest('textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  }

  function isLikelyMessageEditor(editor) {
    if (!isVisible(editor)) {
      return false;
    }

    const rect = editor.getBoundingClientRect();
    const isMultiline = editor.tagName === "TEXTAREA" || editor.getAttribute("aria-multiline") !== "false";
    return isMultiline && rect.width >= 160 && rect.height >= 24 && rect.bottom >= window.innerHeight * 0.55;
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getEditorText(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return editor.value;
    }
    return editor.innerText || editor.textContent || "";
  }

  function replaceEditorText(editor, text) {
    editor.focus();

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const prototype = editor instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      valueSetter?.call(editor, text);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    // execCommand remains the most compatible way to notify rich-text editors of a user-like edit.
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }

    const endRange = document.createRange();
    endRange.selectNodeContents(editor);
    endRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(endRange);
  }

  function setEditorBusy(editor, busy) {
    if (busy) {
      editor.setAttribute("aria-busy", "true");
      editor.classList.add("fmo-editor-busy");
      return;
    }

    editor.removeAttribute("aria-busy");
    editor.classList.remove("fmo-editor-busy");
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("扩展连接失败，请刷新飞书页面后重试"));
          return;
        }
        resolve(response);
      });
    });
  }

  function showToast(message, type, persistent = false) {
    let toast = document.getElementById("fmo-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "fmo-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.documentElement.appendChild(toast);
    }

    window.clearTimeout(toastTimer);
    toast.className = `fmo-toast fmo-toast-${type}`;
    toast.textContent = message;
    toast.dataset.visible = "true";

    if (!persistent) {
      toastTimer = window.setTimeout(() => {
        toast.dataset.visible = "false";
      }, type === "error" ? 5_000 : 3_200);
    }
  }
})();
