(() => {
  const root = document.documentElement;
  const themeKey = "mf:firingCarePreviewTheme";
  const a11yKey = "mf:firingCarePreviewA11y";

  const safeRead = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeWrite = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Persistence is optional; the visible state still updates.
    }
  };

  const safeRemove = (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Persistence is optional; the visible state still updates.
    }
  };

  const getPreferredTheme = () => {
    const stored = safeRead(themeKey);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const setTheme = (theme) => {
    root.dataset.theme = theme;
    safeWrite(themeKey, theme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
      button.setAttribute("title", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    });
  };

  const readA11y = () => {
    const fallback = { textSize: "normal", contrast: "normal", motion: "full", focus: "normal" };
    const raw = safeRead(a11yKey);
    if (!raw) return fallback;
    try {
      return { ...fallback, ...JSON.parse(raw) };
    } catch {
      return fallback;
    }
  };

  const setA11y = (settings) => {
    root.dataset.textSize = settings.textSize;
    root.dataset.contrast = settings.contrast;
    root.dataset.motion = settings.motion;
    root.dataset.focus = settings.focus;
    safeWrite(a11yKey, JSON.stringify(settings));
    document.querySelectorAll("[data-setting]").forEach((button) => {
      const setting = button.getAttribute("data-setting");
      const value = button.getAttribute("data-value");
      const active = (
        (setting === "text-size" && settings.textSize === value) ||
        (setting === "contrast" && settings.contrast === value) ||
        (setting === "motion" && settings.motion === value) ||
        (setting === "focus" && settings.focus === value)
      );
      button.setAttribute("aria-pressed", String(active));
    });
  };

  setTheme(getPreferredTheme());
  let a11y = readA11y();
  setA11y(a11y);

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
  });

  const panel = document.getElementById("preview-a11y-panel");
  document.querySelectorAll("[data-a11y-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!panel) return;
      const isOpen = !panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", isOpen);
      button.setAttribute("aria-expanded", String(!isOpen));
    });
  });

  document.querySelectorAll("[data-setting]").forEach((button) => {
    button.addEventListener("click", () => {
      const setting = button.getAttribute("data-setting");
      const value = button.getAttribute("data-value");
      if (setting === "text-size") a11y.textSize = a11y.textSize === value ? "normal" : value;
      if (setting === "contrast") a11y.contrast = a11y.contrast === value ? "normal" : value;
      if (setting === "motion") a11y.motion = a11y.motion === value ? "full" : value;
      if (setting === "focus") a11y.focus = a11y.focus === value ? "normal" : value;
      setA11y(a11y);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !panel || panel.hasAttribute("hidden")) return;
    panel.setAttribute("hidden", "");
    document.querySelectorAll("[data-a11y-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  });

  const updateScrolled = () => {
    document.body.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  updateScrolled();
  window.addEventListener("scroll", updateScrolled, { passive: true });

  const chatSessionKey = "mf:firingCarePreviewEmberSession";
  const chatTranscriptKey = "mf:firingCarePreviewEmberTranscript";
  const chatStateKey = "mf:firingCarePreviewEmberState";
  const chatDraftKey = "mf:firingCarePreviewEmberDraft";
  const trimValue = (node) => (node && typeof node.value === "string" ? node.value.trim() : "");
  const appendChatBubble = (log, text, role, isError = false) => {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role === "client" ? "client" : "ember"}${isError ? " error" : ""}`;
    if (role === "client") {
      bubble.textContent = text;
    } else {
      const avatar = document.createElement("span");
      avatar.className = "ember-bubble-avatar";
      avatar.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.textContent = `Ember: ${String(text || "").replace(/^Ember:\s*/i, "")}`;
      bubble.append(avatar, copy);
    }
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  };

  document.querySelectorAll("[data-ember-chat]").forEach((chat) => {
    const form = chat.querySelector("[data-ember-chat-form]");
    const input = chat.querySelector("[data-ember-chat-input]");
    const log = chat.querySelector("[data-ember-chat-log]");
    const status = chat.querySelector("[data-ember-chat-status]");
    const contactPanel = chat.querySelector("[data-ember-contact-panel]");
    const contactName = chat.querySelector("[data-ember-contact-name]");
    const contactEmail = chat.querySelector("[data-ember-contact-email]");
    const contactPhone = chat.querySelector("[data-ember-contact-phone]");
    const contactSend = chat.querySelector("[data-ember-contact-send]");
    const attachmentInput = chat.querySelector("[data-ember-attachment-input]");
    const attachmentStatus = chat.querySelector("[data-ember-attachment-status]");
    const threadCard = chat.querySelector("[data-ember-thread-card]");
    const threadState = chat.querySelector("[data-ember-thread-state]");
    const threadTitle = chat.querySelector("[data-ember-thread-title]");
    const threadDetail = chat.querySelector("[data-ember-thread-detail]");
    const checklistPanel = chat.querySelector("[data-ember-checklist-panel]");
    const checklistList = chat.querySelector("[data-ember-checklist]");
    const previewPanel = chat.querySelector("[data-ember-preview-panel]");
    const previewInput = chat.querySelector("[data-ember-preview-input]");
    const previewSend = chat.querySelector("[data-ember-preview-send]");
    const nextQuestionNode = chat.querySelector("[data-ember-next-question]");
    const attachmentList = chat.querySelector("[data-ember-attachment-list]");
    const attachmentItems = chat.querySelector("[data-ember-attachment-items]");
    const actionToast = chat.querySelector("[data-ember-action-toast]");
    const actionToastText = chat.querySelector("[data-ember-action-text]");
    const resetButton = chat.querySelector("[data-ember-reset]");
    const dock = document.querySelector("[data-ember-dock]");
    const dockState = dock && dock.querySelector("[data-ember-dock-state]");
    const sendButton = form.querySelector('button[type="submit"]');
    if (!form || !input || !log || !status) return;

    const endpoint = chat.getAttribute("data-chat-endpoint") || "https://us-central1-monsoonfire-portal.cloudfunctions.net/apiV1/v1/support.chat.message";
    const attachmentEndpoint = chat.getAttribute("data-attachment-endpoint") || endpoint.replace("support.chat.message", "support.chat.attachment");
    const initialEmberMessage = "Hi, I'm Ember. Tell me what would help: pickup timing, a ready check, a deadline, dropoff details, or reassurance. I'll make it clear for the studio.";
    const defaultPlaceholder = input.getAttribute("placeholder") || "";
    const promptButtons = Array.from(chat.querySelectorAll("[data-ember-prompt]"));
    const maxAttachmentBytes = 512 * 1024;
    let selectedTopic = null;
    let selectedPromptButton = null;
    let hasStaffNote = false;
    let transcript = [];
    let savedState = {};
    let chatMostlyVisible = true;
    let actionToastTimer = 0;
    const busyReasons = new Set();

    const setBusy = (reason, isBusy) => {
      if (isBusy) busyReasons.add(reason);
      else busyReasons.delete(reason);
      const busy = busyReasons.size > 0;
      chat.classList.toggle("is-sending", busyReasons.has("sending"));
      chat.classList.toggle("is-uploading", busyReasons.has("uploading"));
      chat.setAttribute("aria-busy", String(busy));
      [sendButton, contactSend, previewSend, attachmentInput, resetButton, ...promptButtons].forEach((control) => {
        if (control) control.disabled = busy;
      });
    };

    const normalizeTranscriptEntry = (entry) => ({
      role: entry && entry.role === "client" ? "client" : "ember",
      text: String((entry && entry.text) || "").slice(0, 1200),
      isError: Boolean(entry && entry.isError),
    });

    const saveTranscript = () => {
      if (!transcript.length) {
        safeRemove(chatTranscriptKey);
        return;
      }
      safeWrite(chatTranscriptKey, JSON.stringify(transcript.slice(-12)));
    };

    const readSavedState = () => {
      const raw = safeRead(chatStateKey);
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        safeRemove(chatStateKey);
        return {};
      }
    };

    const saveState = (nextState) => {
      savedState = {
        ...savedState,
        ...nextState,
        updatedAt: Date.now(),
      };
      safeWrite(chatStateKey, JSON.stringify(savedState));
    };

    const showActionToast = (message) => {
      if (!actionToast || !actionToastText || !message) return;
      window.clearTimeout(actionToastTimer);
      actionToastText.textContent = message;
      actionToast.hidden = false;
      window.requestAnimationFrame(() => actionToast.classList.add("is-visible"));
      actionToastTimer = window.setTimeout(() => {
        actionToast.classList.remove("is-visible");
        window.setTimeout(() => {
          if (!actionToast.classList.contains("is-visible")) actionToast.hidden = true;
        }, 180);
      }, 2600);
    };

    const formatBytes = (value) => {
      const bytes = Number(value);
      if (!Number.isFinite(bytes) || bytes <= 0) return "";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatExpiry = (value) => {
      if (!value) return "expires automatically";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "expires automatically";
      return `expires ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    };

    const normalizeAttachment = (entry) => {
      if (!entry || typeof entry !== "object") return null;
      const fileName = String(entry.fileName || "").trim();
      if (!fileName) return null;
      return {
        fileName,
        contentType: String(entry.contentType || "image").trim(),
        sizeBytes: Number(entry.sizeBytes) || 0,
        expiresAt: String(entry.expiresAt || "").trim(),
      };
    };

    const renderAttachmentList = () => {
      if (!attachmentList || !attachmentItems) return;
      const attachments = Array.isArray(savedState.attachments)
        ? savedState.attachments.map(normalizeAttachment).filter(Boolean).slice(-3)
        : [];
      attachmentList.toggleAttribute("hidden", attachments.length === 0);
      attachmentItems.replaceChildren();
      attachments.forEach((attachment) => {
        const item = document.createElement("li");
        const name = document.createElement("strong");
        const meta = document.createElement("span");
        name.textContent = attachment.fileName;
        meta.textContent = [formatBytes(attachment.sizeBytes), formatExpiry(attachment.expiresAt)].filter(Boolean).join(" - ");
        item.append(name, meta);
        attachmentItems.appendChild(item);
      });
    };

    const derivedChecklist = () => {
      const attachments = Array.isArray(savedState.attachments) ? savedState.attachments.filter(Boolean) : [];
      return [
        {
          key: "studio_handoff",
          label: "Studio handoff",
          state: savedState.supportRequestId ? "done" : "optional",
          detail: savedState.supportRequestId ? "Your note is saved." : "Send a note for staff.",
        },
        {
          key: "contact_method",
          label: "Contact method",
          state: savedState.contactAttached ? "done" : savedState.supportRequestId ? "needed" : "optional",
          detail: savedState.contactAttached ? "Staff can reply if needed." : "Add email or phone for a reply.",
        },
        {
          key: "attachments",
          label: "Photos",
          state: attachments.length ? "done" : "optional",
          detail: attachments.length ? `${attachments.length} photo${attachments.length === 1 ? "" : "s"} on the note.` : "Helpful for size, glaze, or fit.",
        },
      ];
    };

    const renderChecklist = () => {
      if (!checklistPanel || !checklistList) return;
      const rawItems = Array.isArray(savedState.threadChecklist) && savedState.threadChecklist.length
        ? savedState.threadChecklist
        : derivedChecklist();
      const items = rawItems
        .map((entry) => ({
          label: String(entry && entry.label || "").trim(),
          state: ["done", "needed", "optional"].includes(String(entry && entry.state)) ? String(entry.state) : "optional",
          detail: String(entry && entry.detail || "").trim(),
        }))
        .filter((entry) => entry.label)
        .slice(0, 6);
      const shouldShow = Boolean(savedState.supportRequestId || savedState.staffPreviewText || savedState.latestAttachment || items.some((entry) => entry.state === "needed"));
      checklistPanel.toggleAttribute("hidden", !shouldShow);
      checklistList.replaceChildren();
      items.forEach((entry) => {
        const item = document.createElement("li");
        const state = document.createElement("span");
        const copy = document.createElement("div");
        const label = document.createElement("strong");
        const detail = document.createElement("small");
        item.dataset.state = entry.state;
        state.textContent = entry.state === "done" ? "Done" : entry.state === "needed" ? "Needed" : "Optional";
        label.textContent = entry.label;
        detail.textContent = entry.detail;
        copy.append(label, detail);
        item.append(state, copy);
        checklistList.appendChild(item);
      });
    };

    const promptPresets = {
      default: [
        { label: "I'm ready for my stuff!", prompt: "I'm ready for pickup: ", topic: "pickup_timing", status: "Add your name/order and best pickup window.", placeholder: "I'm ready for pickup: Friday after 3, Sam Potter order" },
        { label: "Is my work ready?", prompt: "Can you check if my work is ready? ", topic: "ready_status", status: "Add your name/order and pieces.", placeholder: "Can you check if my work is ready? Sam Potter, 3 plates and 2 mugs" },
        { label: "I have a date coming up", prompt: "I have a date coming up: ", topic: "deadline_note", status: "Add the date and why it matters.", placeholder: "I have a date coming up: May 12 show, 2 bowls and a vase" },
        { label: "I have dropoff details", prompt: "I have dropoff details: ", topic: "dropoff_change", status: "Add count, size, materials, or a photo.", placeholder: "I have dropoff details: 3 plates, 2 mugs, cone 6 glaze" },
      ],
      pickup_timing: [
        { label: "My pickup window", prompt: "Pickup window: ", topic: "pickup_timing", status: "Add the day and window that would feel easiest.", placeholder: "Pickup window: Friday after 3" },
        { label: "My name/order", prompt: "Name/order: ", topic: "pickup_timing", status: "Add the name or order staff should match.", placeholder: "Name/order: Sam Potter" },
        { label: "My pieces", prompt: "Pieces: ", topic: "pickup_timing", status: "Add the pieces tied to this pickup note.", placeholder: "Pieces: 2 mugs and 3 plates" },
        { label: "Contact", action: "contact", status: "Add contact for a staff reply." },
      ],
      account_status: [
        { label: "My name/order", prompt: "Name/order: ", topic: "ready_status", status: "Add the name or order staff should match.", placeholder: "Name/order: Sam Potter" },
        { label: "My pieces", prompt: "Pieces: ", topic: "ready_status", status: "Add the pieces for the ready check.", placeholder: "Pieces: 3 plates and 2 mugs" },
        { label: "A pickup window", prompt: "Pickup window: ", topic: "pickup_timing", status: "Add a pickup window if it matters.", placeholder: "Pickup window: Saturday morning" },
        { label: "Contact", action: "contact", status: "Add contact for a staff reply." },
      ],
      deadline_note: [
        { label: "The date", prompt: "Deadline date: ", topic: "deadline_note", status: "Add the date staff should know.", placeholder: "Deadline date: May 12" },
        { label: "Why it matters", prompt: "Deadline reason: ", topic: "deadline_note", status: "Add the show, class, travel, or gift note.", placeholder: "Deadline reason: class critique" },
        { label: "The pieces", prompt: "Pieces: ", topic: "deadline_note", status: "Add the pieces tied to this date.", placeholder: "Pieces: 2 bowls and 1 vase" },
        { label: "Contact", action: "contact", status: "Add contact for a staff reply." },
      ],
      dropoff_change: [
        { label: "Piece count", prompt: "Piece count: ", topic: "dropoff_change", status: "Add what staff should expect.", placeholder: "Piece count: 3 plates, 2 mugs" },
        { label: "Size note", prompt: "Size note: ", topic: "dropoff_change", status: "Add wide, tall, or unusual fit notes.", placeholder: "Size note: one platter is wide and one vase is tall" },
        { label: "Photo note", prompt: "Photo note: ", topic: "dropoff_change", status: "Describe the photo or angle.", placeholder: "Photo note: top view on the size mat, side view for height" },
        { label: "Contact", action: "contact", status: "Add contact for a staff reply." },
      ],
      pricing_fit: [
        { label: "Regular pieces", prompt: "Fit estimate: ", topic: "dropoff_change", status: "List the regular pieces in the batch.", placeholder: "Fit estimate: 3 plates and 2 mugs" },
        { label: "Wide/tall", prompt: "Wide or tall piece: ", topic: "dropoff_change", status: "Add the piece that needs room.", placeholder: "Wide or tall piece: one 14 inch platter" },
        { label: "Piece count", prompt: "Piece count: ", topic: "dropoff_change", status: "Add the total pieces staff should expect.", placeholder: "Piece count: 6 total pieces" },
        { label: "Dropoff note", prompt: "Dropoff note: ", topic: "dropoff_change", status: "Add any packing or arrival detail.", placeholder: "Dropoff note: packed in towels, ready for crates" },
      ],
      handoff: [
        { label: "Edit note", action: "summary", status: "Review the note before sending an update." },
        { label: "Add contact", action: "contact", status: "Add contact for a staff reply." },
        { label: "More detail", prompt: "More detail: ", topic: "support_preview_update", status: "Add one more detail.", placeholder: "More detail: I can be flexible within 30 minutes" },
        { label: "New thread", action: "reset", status: "Start a clean Ember thread." },
      ],
    };

    const promptPresetKey = (value) => {
      const key = String(value || "").toLowerCase().replace(/[-\s]+/g, "_");
      if (key === "ready_status") return "account_status";
      if (key === "support_preview_update" || key === "contact_followup") return "handoff";
      return Object.prototype.hasOwnProperty.call(promptPresets, key) ? key : "default";
    };

    const applyPromptPreset = (value) => {
      const preset = promptPresets[promptPresetKey(value)];
      promptButtons.forEach((button, index) => {
        const config = preset[index] || promptPresets.default[index];
        button.textContent = config.label;
        button.setAttribute("data-ember-prompt", config.prompt || "");
        button.setAttribute("data-status", config.status || "Edit, then send.");
        button.setAttribute("data-placeholder", config.placeholder || defaultPlaceholder);
        if (config.topic) button.setAttribute("data-topic", config.topic);
        else button.removeAttribute("data-topic");
        if (config.action) button.setAttribute("data-ember-action", config.action);
        else button.removeAttribute("data-ember-action");
      });
    };

    const hasPersistentThread = () => Boolean(safeRead(chatSessionKey) || transcript.length || savedState.supportRequestId);

    const shortSupportId = (value) => {
      const raw = String(value || "").trim();
      return raw ? raw.slice(0, 8) : "";
    };

    const updateThreadCard = () => {
      if (!threadCard || !threadState || !threadTitle || !threadDetail) return;
      const supportId = shortSupportId(savedState.supportRequestId);
      if (supportId) {
        threadCard.hidden = false;
        if (savedState.thread && savedState.thread.title) {
          threadState.textContent = savedState.contactAttached ? "Contact attached" : savedState.thread.state === "sent_to_studio" ? "Sent to studio" : "Saved for staff";
          threadTitle.textContent = savedState.thread.title;
          threadDetail.textContent = savedState.thread.detail || `Ref ${supportId}. Staff confirms timing, readiness, and anything unusual.`;
        } else if (savedState.contactAttached) {
          threadState.textContent = "Contact attached";
          threadTitle.textContent = "Staff has the note and your contact.";
          threadDetail.textContent = `Ref ${supportId}. Staff confirms timing, readiness, and anything unusual.`;
        } else if (savedState.supportEmailQueued) {
          threadState.textContent = "Sent to studio";
          threadTitle.textContent = "Studio note is with staff.";
          threadDetail.textContent = `Ref ${supportId}. Add contact for a reply, or edit the summary.`;
        } else {
          threadState.textContent = "Saved for staff";
          threadTitle.textContent = "Studio note is saved.";
          threadDetail.textContent = `Ref ${supportId}. Open the studio account for private account details.`;
        }
        return;
      }
      if (transcript.length) {
        threadCard.hidden = false;
        threadState.textContent = "Thread saved";
        threadTitle.textContent = "Ember is still here.";
        threadDetail.textContent = "This browser remembers the latest notes while you stay on the preview.";
        return;
      }
      threadCard.hidden = true;
    };

    const updatePreviewPanel = () => {
      if (!previewPanel || !previewInput) return;
      const previewText = String(savedState.staffPreviewText || "");
      previewPanel.toggleAttribute("hidden", !previewText);
      if (previewText && !previewInput.dataset.userEdited) previewInput.value = previewText;
      if (nextQuestionNode) {
        const nextQuestion = String(savedState.nextQuestion || "");
        nextQuestionNode.textContent = nextQuestion;
        nextQuestionNode.toggleAttribute("hidden", !nextQuestion);
      }
    };

    const updateDock = () => {
      if (!dock) return;
      const hasThread = hasPersistentThread();
      const hasDraft = Boolean(input.value.trim());
      dock.toggleAttribute("hidden", chatMostlyVisible || (!hasThread && !hasDraft));
      if (dockState) {
        if (savedState.contactAttached) dockState.textContent = "Contact attached";
        else if (savedState.supportEmailQueued) dockState.textContent = "Sent to studio";
        else if (hasStaffNote) dockState.textContent = "Staff note";
        else if (savedState.nextQuestion) dockState.textContent = "Needs detail";
        else if (hasDraft) dockState.textContent = "Draft ready";
        else dockState.textContent = hasThread ? "Thread here" : "Still here";
      }
      if (resetButton) resetButton.toggleAttribute("hidden", !hasThread && !hasDraft);
      updateThreadCard();
      updatePreviewPanel();
      renderAttachmentList();
      renderChecklist();
    };

    const addBubble = (text, role, isError = false, persist = true) => {
      appendChatBubble(log, text, role, isError);
      if (!persist) return;
      transcript.push(normalizeTranscriptEntry({ role, text, isError }));
      transcript = transcript.slice(-12);
      saveTranscript();
      updateDock();
    };

    const resetLog = () => {
      log.replaceChildren();
      appendChatBubble(log, initialEmberMessage, "ember");
    };

    const clearPromptSelection = () => {
      if (selectedPromptButton) selectedPromptButton.classList.remove("is-selected");
      selectedPromptButton = null;
      selectedTopic = null;
      input.setAttribute("placeholder", defaultPlaceholder);
    };

    const clearThread = () => {
      transcript = [];
      safeRemove(chatSessionKey);
      safeRemove(chatTranscriptKey);
      safeRemove(chatStateKey);
      safeRemove(chatDraftKey);
      savedState = {};
      hasStaffNote = false;
      input.value = "";
      clearPromptSelection();
      applyPromptPreset("default");
      setContactVisible(false);
      if (actionToast) {
        actionToast.classList.remove("is-visible");
        actionToast.hidden = true;
      }
      if (previewInput) {
        previewInput.value = "";
        delete previewInput.dataset.userEdited;
      }
      [contactName, contactEmail, contactPhone].forEach((node) => {
        if (node) node.value = "";
      });
      if (attachmentInput) attachmentInput.value = "";
      if (attachmentStatus) attachmentStatus.textContent = "No photo attached";
      resetLog();
      status.textContent = "New thread ready. Ember is still here.";
      updateDock();
    };

    const restoreTranscript = () => {
      const raw = safeRead(chatTranscriptKey);
      if (!raw) return;
      try {
        const stored = JSON.parse(raw);
        if (!Array.isArray(stored) || !stored.length) return;
        transcript = stored.map(normalizeTranscriptEntry).filter((entry) => entry.text);
        if (!transcript.length) return;
        log.replaceChildren();
        transcript.forEach((entry) => appendChatBubble(log, entry.text, entry.role, entry.isError));
        status.textContent = "Thread restored. Ember is still here.";
        updatePreviewPanel();
        updateDock();
      } catch {
        safeRemove(chatTranscriptKey);
      }
    };

    const restoreDraft = () => {
      const draft = safeRead(chatDraftKey);
      if (!draft || input.value.trim()) return;
      input.value = draft;
      status.textContent = "Draft restored. Ember is still here.";
    };

    const setContactVisible = (visible) => {
      if (!contactPanel) return;
      contactPanel.toggleAttribute("hidden", !visible);
    };

    const collectContact = () => {
      const contact = {
        name: trimValue(contactName),
        email: trimValue(contactEmail),
        phone: trimValue(contactPhone),
      };
      const hasContact = Boolean(contact.name || contact.email || contact.phone);
      return {
        hasContact,
        contact,
        consentToContact: hasContact,
      };
    };

    const postChatMessage = async ({ message, topic, includeContact = false, echo = true, clientEcho }) => {
      if (!message) return null;
      if (echo) addBubble(clientEcho || message, "client");
      setBusy("sending", true);
      status.textContent = "Ember is turning that into a studio note.";

      try {
        const contactPayload = includeContact ? collectContact() : { hasContact: false, contact: {}, consentToContact: false };
        const body = {
          sessionId: safeRead(chatSessionKey),
          message,
          pagePath: window.location.pathname,
          topic,
          consentToContact: contactPayload.consentToContact,
        };
        if (contactPayload.hasContact) body.contact = contactPayload.contact;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": `ember_${Date.now().toString(36)}`,
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          const err = new Error(payload.message || "Ember chat is unavailable.");
          err.status = response.status;
          err.code = payload.code || null;
          err.retryAfter = response.headers.get("Retry-After");
          throw err;
        }
        const data = payload.data || payload;
        if (data.sessionId) safeWrite(chatSessionKey, data.sessionId);
        if (data.supportRequestId) hasStaffNote = true;
        saveState({
          sessionId: data.sessionId || safeRead(chatSessionKey),
          supportRequestId: data.supportRequestId || savedState.supportRequestId || null,
          supportRequestShortId: data.supportRequestShortId || savedState.supportRequestShortId || null,
          supportEmailQueued: Boolean(data.supportEmailQueued || savedState.supportEmailQueued),
          contactAttached: Boolean(data.contactAttached || savedState.contactAttached),
          contactRequested: Boolean(data.contactRequested),
          staffPreviewText: data.staffPreviewText || savedState.staffPreviewText || "",
          attachments: Array.isArray(data.attachments) ? data.attachments.slice(-3) : savedState.attachments || [],
          threadChecklist: Array.isArray(data.threadChecklist) ? data.threadChecklist.slice(0, 6) : savedState.threadChecklist || [],
          nextQuestion: data.nextQuestion || "",
          thread: data.thread || savedState.thread || null,
          personaVersion: data.personaVersion || savedState.personaVersion || null,
          opsLabels: Array.isArray(data.opsLabels) ? data.opsLabels.slice(0, 16) : savedState.opsLabels || [],
          modelDrafting: data.modelDrafting || savedState.modelDrafting || null,
          replyMode: data.replyMode || savedState.replyMode || null,
          handoffStatus: data.handoffStatus || savedState.handoffStatus || null,
          nextAction: data.nextAction || savedState.nextAction || null,
          triage: data.triage || savedState.triage || null,
        });
        addBubble(data.emberMessage || "I can help gather that for the studio.", "ember");
        updatePreviewPanel();
        applyPromptPreset(data.supportRequestId ? "handoff" : (data.triage && data.triage.intent) || topic || selectedTopic || "default");

        const actionMessage = data.contactAttached
          ? "Contact attached for staff."
          : topic === "support_preview_update"
            ? data.supportEmailQueued ? "Updated note sent to studio." : "Summary updated."
            : data.supportEmailQueued
              ? "Sent to studio."
              : data.supportRequestId
                ? "Saved for staff."
                : "";
        showActionToast(actionMessage);

        if (data.contactAttached) {
          status.textContent = "Contact is attached. Ember is still here.";
          setContactVisible(false);
        } else if (data.nextQuestion) {
          status.textContent = data.nextQuestion;
          if (data.contactRequested || data.supportRequestId) setContactVisible(true);
        } else if (data.contactRequested || data.supportRequestId) {
          status.textContent = "Your note is saved. You can add contact or edit the summary.";
          setContactVisible(true);
        } else if (data.nextAction === "open_studio_account") {
          status.textContent = "Use the studio account for private status. Ember can still help shape the note.";
        } else {
          status.textContent = "Ready for the next detail. Ember is still here.";
        }
        updateDock();
        return data;
      } catch (error) {
        const retryText = error && error.retryAfter ? ` Give it about ${error.retryAfter} seconds and try again.` : "";
        const message = error && (error.status === 429 || error.code === "RATE_LIMITED" || error.code === "EMAIL_RATE_LIMITED")
          ? `I hit a temporary send limit while protecting the support inbox.${retryText}`
          : error && error.message && error.status
            ? error.message
            : "I can't reach the studio support link from this preview. Open the studio account so staff can keep the request tied together.";
        addBubble(message, "ember", true);
        status.textContent = error && error.status ? "Ember could not send that note." : "Studio account is the fallback. This thread stays here.";
        return null;
      } finally {
        setBusy("sending", false);
      }
    };

    const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read image."));
      reader.readAsDataURL(blob);
    });

    const loadImageFromFile = (file) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not open that image."));
      };
      image.src = url;
    });

    const canvasToBlob = (canvas, quality) => new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not compress that image."));
      }, "image/jpeg", quality);
    });

    const prepareAttachmentImage = async (file) => {
      if (!file || !/^image\/(?:jpe?g|png|webp)$/i.test(file.type || "")) {
        throw new Error("Use a JPEG, PNG, or WebP photo.");
      }
      if (file.size > 8 * 1024 * 1024) {
        throw new Error("That photo is too large for the preview uploader.");
      }
      const image = await loadImageFromFile(file);
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare that photo.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      let blob = null;
      for (const quality of [0.76, 0.64, 0.52, 0.44]) {
        blob = await canvasToBlob(canvas, quality);
        if (blob.size <= maxAttachmentBytes) break;
      }
      if (!blob || blob.size > maxAttachmentBytes) {
        throw new Error("That photo still compresses too large for this preview.");
      }
      const dataUrl = await blobToDataUrl(blob);
      const dataBase64 = dataUrl.split(",")[1] || "";
      const baseName = String(file.name || "ember-support-photo")
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w.\- ]+/g, "")
        .trim()
        .slice(0, 100) || "ember-support-photo";
      return {
        fileName: `${baseName}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: blob.size,
        dataBase64,
        width,
        height,
      };
    };

    const uploadAttachment = async (file) => {
      if (!file) return null;
      setBusy("uploading", true);
      if (attachmentStatus) attachmentStatus.textContent = "Preparing photo.";
      status.textContent = "Ember is getting that photo ready.";

      try {
        const image = await prepareAttachmentImage(file);
        if (attachmentStatus) attachmentStatus.textContent = "Sending photo.";
        const body = {
          sessionId: safeRead(chatSessionKey),
          supportRequestId: savedState.supportRequestId || null,
          pagePath: window.location.pathname,
          fileName: image.fileName,
          contentType: image.contentType,
          sizeBytes: image.sizeBytes,
          dataBase64: image.dataBase64,
          note: input.value.trim().slice(0, 300),
        };
        const response = await fetch(attachmentEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": `ember_attachment_${Date.now().toString(36)}`,
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          const err = new Error(payload.message || "Ember could not attach that photo.");
          err.status = response.status;
          err.code = payload.code || null;
          err.retryAfter = response.headers.get("Retry-After");
          throw err;
        }
        const data = payload.data || payload;
        const attachment = data.attachment || null;
        if (data.sessionId) safeWrite(chatSessionKey, data.sessionId);
        const nextAttachments = attachment
          ? [...(Array.isArray(savedState.attachments) ? savedState.attachments : []), attachment].slice(-3)
          : savedState.attachments || [];
        saveState({
          sessionId: data.sessionId || safeRead(chatSessionKey),
          latestAttachment: attachment,
          attachments: nextAttachments,
          attachmentStore: data.attachmentStore || "studio-brain-postgres",
          threadChecklist: Array.isArray(data.threadChecklist) ? data.threadChecklist.slice(0, 6) : savedState.threadChecklist || [],
        });
        addBubble(`Photo added for staff: ${attachment && attachment.fileName ? attachment.fileName : image.fileName}`, "client");
        addBubble(data.emberMessage || "I added that photo to the studio note.", "ember");
        if (attachmentStatus) attachmentStatus.textContent = attachment && attachment.fileName ? attachment.fileName : "Photo attached";
        showActionToast("Photo added.");
        status.textContent = "Photo is attached. Ember is still here.";
        updateDock();
        return data;
      } catch (error) {
        const retryText = error && error.retryAfter ? ` Give it about ${error.retryAfter} seconds and try again.` : "";
        const message = error && (error.status === 429 || error.code === "ATTACHMENT_RATE_LIMITED")
          ? `I hit the photo limit for this thread.${retryText}`
          : error && error.message
            ? error.message
            : "I could not attach that photo from this preview.";
        addBubble(message, "ember", true);
        if (attachmentStatus) attachmentStatus.textContent = "Photo not attached";
        status.textContent = "Photo was not attached.";
        return null;
      } finally {
        setBusy("uploading", false);
        if (attachmentInput) attachmentInput.value = "";
      }
    };

    promptButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-ember-action") || "";
        if (action) {
          clearPromptSelection();
          selectedPromptButton = button;
          button.classList.add("is-selected");
          status.textContent = button.getAttribute("data-status") || "Edit, then send.";
          if (action === "contact") {
            setContactVisible(true);
            (contactEmail || contactPhone || contactName || input).focus();
          } else if (action === "summary") {
            updatePreviewPanel();
            if (previewPanel && previewPanel.hasAttribute("hidden")) {
              status.textContent = "Send a support note first, then edit the summary.";
            } else if (previewInput) {
              previewInput.focus();
            }
          } else if (action === "reset") {
            clearThread();
          }
          updateDock();
          return;
        }
        clearPromptSelection();
        selectedPromptButton = button;
        button.classList.add("is-selected");
        input.value = button.getAttribute("data-ember-prompt") || "";
        safeWrite(chatDraftKey, input.value);
        selectedTopic = button.getAttribute("data-topic") || null;
        input.setAttribute("placeholder", button.getAttribute("data-placeholder") || defaultPlaceholder);
        status.textContent = button.getAttribute("data-status") || "Edit, then send.";
        applyPromptPreset(selectedTopic || "default");
        updateDock();
        input.focus();
      });
    });

    input.addEventListener("input", () => {
      if (input.value.trim()) safeWrite(chatDraftKey, input.value);
      else safeRemove(chatDraftKey);
      updateDock();
    });
    if (attachmentInput) {
      attachmentInput.addEventListener("change", async () => {
        const file = attachmentInput.files && attachmentInput.files[0] ? attachmentInput.files[0] : null;
        await uploadAttachment(file);
      });
    }
    if (previewInput) {
      previewInput.addEventListener("input", () => {
        previewInput.dataset.userEdited = "true";
        saveState({ staffPreviewText: previewInput.value.trim() });
        updateDock();
      });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      safeRemove(chatDraftKey);
      await postChatMessage({
        message,
        topic: selectedTopic,
        includeContact: Boolean(contactPanel && !contactPanel.hasAttribute("hidden")),
      });
      clearPromptSelection();
      updateDock();
    });

    if (contactSend) {
      contactSend.addEventListener("click", async () => {
        const contactPayload = collectContact();
        if (!hasStaffNote) {
          status.textContent = "Send a support note first, then attach contact.";
          return;
        }
        if (!contactPayload.hasContact) {
          status.textContent = "Add an email, phone, or name before attaching contact.";
          return;
        }
        await postChatMessage({
          message: "Please add my contact details to this studio note.",
          topic: "contact_followup",
          includeContact: true,
          clientEcho: "I added my contact details for staff.",
        });
      });
    }

    if (previewSend) {
      previewSend.addEventListener("click", async () => {
        const summary = previewInput ? previewInput.value.trim() : "";
        if (!hasStaffNote) {
          status.textContent = "Send a support note first, then update the summary.";
          return;
        }
        if (!summary) {
          status.textContent = "Add a short summary before sending the update.";
          return;
        }
        await postChatMessage({
          message: summary,
          topic: "support_preview_update",
          includeContact: false,
          clientEcho: "I updated the staff summary.",
        });
        if (previewInput) delete previewInput.dataset.userEdited;
      });
    }

    savedState = readSavedState();
    hasStaffNote = Boolean(savedState.supportRequestId);
    applyPromptPreset(savedState.supportRequestId ? "handoff" : savedState.triage && savedState.triage.intent ? savedState.triage.intent : "default");
    restoreTranscript();
    restoreDraft();
    updateDock();

    if (resetButton) {
      resetButton.addEventListener("click", clearThread);
    }

    if (dock) {
      dock.addEventListener("click", () => {
        chat.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => input.focus({ preventScroll: true }), 260);
      });
    }

    const updateChatVisibility = () => {
      const rect = chat.getBoundingClientRect();
      chatMostlyVisible = rect.top < window.innerHeight * 0.82 && rect.bottom > window.innerHeight * 0.18;
      updateDock();
    };

    if ("IntersectionObserver" in window) {
      const chatObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          chatMostlyVisible = entry.isIntersecting && entry.intersectionRatio > 0.45;
          updateDock();
        });
      }, { threshold: [0, 0.45, 0.8] });
      chatObserver.observe(chat);
    } else {
      updateChatVisibility();
      window.addEventListener("scroll", updateChatVisibility, { passive: true });
      window.addEventListener("resize", updateChatVisibility);
    }
  });

  const revealItems = Array.from(document.querySelectorAll([
    ".section",
    ".card",
    ".proof-card",
    ".price-card",
    ".policy-card",
    ".agent-card",
    ".guided-step",
    ".lane-card",
    ".account-card",
    ".conversation-card",
    ".ember-chat-card",
    ".request-panel",
    ".timeline-item",
  ].join(",")));

  revealItems.forEach((item, index) => {
    item.dataset.reveal = "";
    item.style.setProperty("--reveal-delay", `${Math.min((index % 5) * 55, 220)}ms`);
  });

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

  revealItems.forEach((item) => revealObserver.observe(item));
})();
