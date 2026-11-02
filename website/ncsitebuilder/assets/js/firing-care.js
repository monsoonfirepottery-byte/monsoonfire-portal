(() => {
  const root = document.documentElement;
  const themeKey = "mf:firingCareTheme";
  const a11yKey = "mf:firingCareA11y";

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

  const defaultA11y = { textSize: "normal", contrast: "normal", motion: "full" };

  const readA11y = () => {
    const raw = safeRead(a11yKey);
    if (!raw) return { ...defaultA11y };
    try {
      const parsed = JSON.parse(raw);
      return {
        textSize: parsed?.textSize === "large" ? "large" : "normal",
        contrast: parsed?.contrast === "high" ? "high" : "normal",
        motion: parsed?.motion === "reduced" ? "reduced" : "full",
      };
    } catch {
      return { ...defaultA11y };
    }
  };

  const settingProperty = {
    "text-size": "textSize",
    contrast: "contrast",
    motion: "motion",
  };

  const getPanel = () => document.getElementById("site-a11y-panel");

  const setA11y = (settings) => {
    root.dataset.textSize = settings.textSize;
    root.dataset.contrast = settings.contrast;
    root.dataset.motion = settings.motion;
    delete root.dataset.focus;
    safeWrite(a11yKey, JSON.stringify(settings));
    document.querySelectorAll("[data-setting]").forEach((button) => {
      const setting = button.getAttribute("data-setting");
      const value = button.getAttribute("data-value");
      const property = settingProperty[setting];
      const active = Boolean(property && settings[property] === value);
      button.setAttribute("aria-pressed", String(active));
      const state = button.querySelector("[data-setting-state]");
      if (state) state.textContent = active ? "On" : "Off";
    });
    const usingDefaults = Object.entries(defaultA11y).every(([key, value]) => settings[key] === value);
    document.querySelectorAll("[data-a11y-reset]").forEach((button) => {
      button.disabled = usingDefaults;
    });
  };

  let lastPanelTrigger = null;

  const setPanelOpen = (open, { focusFirst = false, restoreFocus = false } = {}) => {
    const panel = getPanel();
    if (!panel) return;
    panel.toggleAttribute("hidden", !open);
    document.querySelectorAll("[data-a11y-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Close display options" : "Open display options");
      button.setAttribute("title", open ? "Close display options" : "Display options");
    });
    if (open && focusFirst) {
      window.requestAnimationFrame(() => panel.querySelector("[data-setting]")?.focus());
    }
    if (!open && restoreFocus) lastPanelTrigger?.focus({ preventScroll: true });
  };

  const announceA11y = (message) => {
    document.querySelectorAll("[data-a11y-status]").forEach((status) => {
      status.textContent = "";
      window.requestAnimationFrame(() => {
        status.textContent = message;
      });
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

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest?.("[data-a11y-toggle]");
    if (toggle) {
      const panel = getPanel();
      if (!panel) return;
      lastPanelTrigger = toggle;
      const willOpen = panel.hasAttribute("hidden");
      setPanelOpen(willOpen, { focusFirst: willOpen, restoreFocus: !willOpen });
      return;
    }

    const close = event.target.closest?.("[data-a11y-close]");
    if (close) {
      setPanelOpen(false, { restoreFocus: true });
      return;
    }

    const reset = event.target.closest?.("[data-a11y-reset]");
    if (reset) {
      a11y = { ...defaultA11y };
      setA11y(a11y);
      announceA11y("Display options reset to defaults.");
      return;
    }

    const settingButton = event.target.closest?.("[data-setting]");
    if (settingButton) {
      const setting = settingButton.getAttribute("data-setting");
      const value = settingButton.getAttribute("data-value");
      const property = settingProperty[setting];
      if (!property) return;
      a11y = {
        ...a11y,
        [property]: a11y[property] === value ? defaultA11y[property] : value,
      };
      setA11y(a11y);
      const label = settingButton.querySelector("[data-setting-label]")?.textContent?.trim() || "Display option";
      announceA11y(`${label} ${settingButton.getAttribute("aria-pressed") === "true" ? "on" : "off"}.`);
      return;
    }

    const panel = getPanel();
    if (panel && !panel.hasAttribute("hidden") && !panel.contains(event.target)) {
      setPanelOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    const panel = getPanel();
    if (event.key !== "Escape" || !panel || panel.hasAttribute("hidden")) return;
    event.preventDefault();
    setPanelOpen(false, { restoreFocus: true });
  });

  document.addEventListener("focusin", (event) => {
    const panel = getPanel();
    if (!panel || panel.hasAttribute("hidden")) return;
    if (panel.contains(event.target) || event.target.closest?.("[data-a11y-toggle]")) return;
    setPanelOpen(false);
  });

  window.addEventListener("mf:display-options-ready", () => {
    setA11y(a11y);
    setPanelOpen(false);
  });

  const updateScrolled = () => {
    document.body.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  updateScrolled();
  window.addEventListener("scroll", updateScrolled, { passive: true });

  const analyticsSource = "monsoonfire_website";
  const analyticsMedium = "referral";
  const analyticsCampaign = "firing_care_v2_1_4";
  const resolveDeviceClass = () => window.matchMedia("(max-width: 820px)").matches ? "mobile" : "desktop";
  const normalizeAnalyticsLabel = (value, fallback = "link") => {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    return text ? text.slice(0, 120) : fallback;
  };
  const resolveLinkType = (href) => {
    const value = String(href || "").trim().toLowerCase();
    if (value.startsWith("mailto:")) return "email";
    if (value.startsWith("tel:")) return "phone";
    if (value.includes("whatsapp") || value.includes("wa.me")) return "whatsapp";
    if (value.startsWith("http")) return "outbound";
    if (value.startsWith("#")) return "anchor";
    return "internal";
  };
  const emitAnalyticsEvent = (eventName, details) => {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", eventName, {
      page: window.location.pathname,
      page_path: window.location.pathname,
      locale: document.documentElement.lang || "en",
      device: resolveDeviceClass(),
      source: analyticsSource,
      campaign: analyticsCampaign,
      utm_source: analyticsSource,
      utm_medium: analyticsMedium,
      utm_campaign: analyticsCampaign,
      ...details,
    });
  };

  document.addEventListener("click", (event) => {
    const link = event.target && event.target.closest ? event.target.closest("a") : null;
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("javascript:")) return;

    const linkType = resolveLinkType(href);
    const linkText = normalizeAnalyticsLabel(link.textContent, href);
    const isPrimaryCta = link.classList.contains("button-primary") || Boolean(link.dataset.portalTarget);
    const payload = {
      event_category: isPrimaryCta ? "cta" : linkType === "internal" || linkType === "anchor" ? "navigation" : "outbound",
      event_label: link.dataset.portalTarget || linkText,
      link_text: linkText,
      link_url: href,
      link_type: linkType,
      link_location: link.closest("header") ? "header" : link.closest("footer") ? "footer" : "main",
    };

    emitAnalyticsEvent("cta_click", payload);
    if (isPrimaryCta) {
      emitAnalyticsEvent("cta_primary_click", {
        ...payload,
        goal_name: "studio_account_start",
        funnel_step: "account_handoff",
      });
    }
    if (linkType === "email") {
      emitAnalyticsEvent("contact_email_click", {
        ...payload,
        goal_name: "contact_intent",
        funnel_step: "alt_contact",
      });
    }
    if (linkType === "phone") {
      emitAnalyticsEvent("contact_phone_click", {
        ...payload,
        goal_name: "contact_intent",
        funnel_step: "alt_contact",
      });
    }
    if (linkType === "whatsapp") {
      emitAnalyticsEvent("whatsapp_click", {
        ...payload,
        goal_name: "contact_intent",
        funnel_step: "alt_contact",
      });
    }
  });

  document.addEventListener("click", async (event) => {
    const target = event.target && event.target.closest ? event.target.closest("[data-share-url]") : null;
    if (!target) return;
    event.preventDefault();
    const url = target.getAttribute("data-share-url") || window.location.href;
    const title = target.getAttribute("data-share-title") || document.title;
    const statusNode = target.closest("[data-share-root]")?.querySelector("[data-share-status]");
    const setStatus = (message) => {
      if (statusNode) statusNode.textContent = message;
    };
    try {
      if (target.hasAttribute("data-native-share") && navigator.share) {
        await navigator.share({ title, url });
        setStatus("Share sheet opened.");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setStatus("Copied link.");
        return;
      }
      setStatus(url);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setStatus(error?.message || "Could not share this note.");
    }
  });

  document.querySelectorAll("[data-print-document]").forEach((button) => {
    button.addEventListener("click", () => window.print());
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

