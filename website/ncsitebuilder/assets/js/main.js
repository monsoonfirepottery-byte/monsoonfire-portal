(() => {
  const STORAGE_KEYS = {
    theme: "mf:websiteTheme",
    accessibility: "mf:websiteAccessibility",
  };
  const legacyPortalHost = "monsoonfire.kilnfire.com";
  const portalHost = "portal.monsoonfire.com";
  const root = document.documentElement;
  const body = document.body;
  const header = document.querySelector(".site-header");
  const main = document.getElementById("main");
  const previewPrefix = resolvePreviewPrefix(window.location.pathname);
  const prefersDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const defaultAccessibility = {
    textSize: "normal",
    contrast: "normal",
    motion: "normal",
    focus: "normal",
  };
  let themeButton = null;
  let themeButtonLabelLong = null;
  let themeButtonLabelShort = null;
  let a11yButton = null;
  let a11yButtonLabelLong = null;
  let a11yButtonLabelShort = null;
  let a11yPanel = null;
  let a11yStatus = null;
  const textSizeButtons = new Map();
  const toggleButtons = {
    contrast: null,
    motion: null,
    focus: null,
  };

  const normalizePath = (value) => {
    if (!value) return "/";
    const stripped = stripPreviewPrefix(value);
    const cleaned = stripped.replace(/index\.html?$/i, "");
    return cleaned.endsWith("/") ? cleaned : `${cleaned}/`;
  };

  const normalizePortalLinks = () => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("/") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) {
        return;
      }
      try {
        const parsed = new URL(href, window.location.origin);
        if (parsed.hostname === legacyPortalHost) {
          parsed.hostname = portalHost;
          link.setAttribute("href", parsed.toString());
        }
      } catch {
        // Ignore malformed URLs and keep existing href value.
      }
    });
  };

  const ensureSkipLink = () => {
    if (!body || !main || document.querySelector(".skip-link")) return;
    const skipLink = document.createElement("a");
    skipLink.className = "skip-link";
    skipLink.href = "#main";
    skipLink.textContent = "Skip to content";
    body.insertBefore(skipLink, body.firstChild);
  };

  const ensureLandmarks = () => {
    const primaryNav = document.querySelector("[data-nav-links]");
    if (primaryNav && !primaryNav.getAttribute("aria-label")) {
      primaryNav.setAttribute("aria-label", "Primary");
    }
    if (main && !main.hasAttribute("tabindex")) {
      main.setAttribute("tabindex", "-1");
    }
    const contactStatusNodes = document.querySelectorAll("[data-contact-error], [data-contact-success]");
    contactStatusNodes.forEach((node) => {
      if (!node.hasAttribute("aria-live")) {
        node.setAttribute("aria-live", "polite");
      }
    });
  };

  const ensureAccessibilityStatementLink = () => {
    const contactTitleNodes = Array.from(document.querySelectorAll(".footer .footer-title"));
    contactTitleNodes.forEach((titleNode) => {
      if (!titleNode || !titleNode.textContent) return;
      if (titleNode.textContent.trim().toLowerCase() !== "contact") return;
      const contactContainer = titleNode.parentElement;
      if (!contactContainer) return;
      if (contactContainer.querySelector('a[href*="/policies/accessibility/"]')) return;

      const line = document.createElement("p");
      const link = document.createElement("a");
      link.href = withPreviewPrefix("/policies/accessibility/");
      link.textContent = "Accessibility statement";
      line.appendChild(link);
      contactContainer.appendChild(line);
    });
  };

  const resolveThemePreference = () => {
    const stored = safeRead(STORAGE_KEYS.theme);
    if (stored === "light" || stored === "dark") {
      return { value: stored, persisted: true };
    }
    return { value: prefersDarkQuery.matches ? "dark" : "light", persisted: false };
  };

  const resolveAccessibilityPreference = () => {
    const stored = safeRead(STORAGE_KEYS.accessibility);
    if (!stored) return { ...defaultAccessibility };
    try {
      const parsed = JSON.parse(stored);
      return {
        textSize: isOneOf(parsed.textSize, ["normal", "large", "x-large"]) ? parsed.textSize : defaultAccessibility.textSize,
        contrast: isOneOf(parsed.contrast, ["normal", "high"]) ? parsed.contrast : defaultAccessibility.contrast,
        motion: isOneOf(parsed.motion, ["normal", "reduced"]) ? parsed.motion : defaultAccessibility.motion,
        focus: isOneOf(parsed.focus, ["normal", "high"]) ? parsed.focus : defaultAccessibility.focus,
      };
    } catch {
      return { ...defaultAccessibility };
    }
  };

  let themeState = resolveThemePreference();
  let accessibilityState = resolveAccessibilityPreference();
  let hasUserThemePreference = themeState.persisted;

  const setTheme = (nextTheme, persist) => {
    const normalized = nextTheme === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", normalized);
    root.style.colorScheme = normalized;
    themeState = { value: normalized, persisted: persist };
    hasUserThemePreference = persist;
    if (persist) {
      safeWrite(STORAGE_KEYS.theme, normalized);
    }
  };

  const applyAccessibilityState = (persist) => {
    const effectiveMotion = accessibilityState.motion === "reduced" || reducedMotionQuery.matches ? "reduced" : "normal";
    root.setAttribute("data-text-size", accessibilityState.textSize);
    root.setAttribute("data-contrast", accessibilityState.contrast);
    root.setAttribute("data-focus", accessibilityState.focus);
    root.setAttribute("data-motion", effectiveMotion);
    if (persist) {
      safeWrite(STORAGE_KEYS.accessibility, JSON.stringify(accessibilityState));
    }
  };

  setTheme(themeState.value, hasUserThemePreference);
  applyAccessibilityState(false);

  if (typeof prefersDarkQuery.addEventListener === "function") {
    prefersDarkQuery.addEventListener("change", (event) => {
      if (hasUserThemePreference) return;
      setTheme(event.matches ? "dark" : "light", false);
      updateThemeControls();
    });
  } else if (typeof prefersDarkQuery.addListener === "function") {
    prefersDarkQuery.addListener((event) => {
      if (hasUserThemePreference) return;
      setTheme(event.matches ? "dark" : "light", false);
      updateThemeControls();
    });
  }

  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", () => {
      applyAccessibilityState(false);
      updateA11yControls();
    });
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(() => {
      applyAccessibilityState(false);
      updateA11yControls();
    });
  }

  ensureSkipLink();
  ensureLandmarks();
  ensureAccessibilityStatementLink();
  normalizePortalLinks();
  syncCurrentNavState();
  setupMenuToggle();
  setupHeaderScrollState();
  setupAnalyticsCapture();
  setupCarouselRotation();
  setupSiteTools();

  function syncCurrentNavState() {
    const parentPath = body ? body.getAttribute("data-nav-parent") : null;
    const currentPath = normalizePath(parentPath || window.location.pathname);
    document.querySelectorAll("[data-nav-links] a").forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;
      const path = extractPathname(href);
      if (!path) return;
      if (normalizePath(path) === currentPath) {
        link.setAttribute("aria-current", "page");
      }
    });
  }

  function setupMenuToggle() {
    const toggle = document.querySelector("[data-menu-toggle]");
    const nav = document.querySelector("[data-nav-links]");
    if (!toggle || !nav) return;

    if (!nav.id) {
      nav.id = "site-nav-links";
    }
    toggle.setAttribute("aria-controls", nav.id);
    toggle.setAttribute("aria-label", "Open menu");

    const setMenuState = (isOpen) => {
      nav.classList.toggle("open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    };

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      setMenuState(!expanded);
    });

    nav.addEventListener("click", (event) => {
      if (event.target && event.target.matches("a")) {
        setMenuState(false);
      }
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (nav.contains(target) || toggle.contains(target)) return;
      setMenuState(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (toggle.getAttribute("aria-expanded") !== "true") return;
      setMenuState(false);
      toggle.focus();
    });

    const desktopMedia = window.matchMedia("(min-width: 981px)");
    const collapseOnDesktop = (media) => {
      if (media.matches) {
        setMenuState(false);
      }
    };
    collapseOnDesktop(desktopMedia);
    if (typeof desktopMedia.addEventListener === "function") {
      desktopMedia.addEventListener("change", collapseOnDesktop);
    } else if (typeof desktopMedia.addListener === "function") {
      desktopMedia.addListener(collapseOnDesktop);
    }
  }

  function setupHeaderScrollState() {
    if (!header) return;
    const sync = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
  }

  function setupSiteTools() {
    const navbar = document.querySelector(".navbar");
    if (!navbar || !body) return;

    const tools = document.createElement("div");
    tools.className = "site-tools";

    themeButton = document.createElement("button");
    themeButton.className = "button button-ghost theme-toggle site-switch";
    themeButton.type = "button";
    themeButton.setAttribute("aria-label", "Toggle color theme");
    themeButton.setAttribute("data-theme-toggle", "true");
    themeButtonLabelLong = document.createElement("span");
    themeButtonLabelLong.className = "site-switch-label-long";
    themeButtonLabelShort = document.createElement("span");
    themeButtonLabelShort.className = "site-switch-label-short";
    themeButton.append(themeButtonLabelLong, themeButtonLabelShort, buildSwitchTrack());
    themeButton.addEventListener("click", () => {
      const nextTheme = themeState.value === "dark" ? "light" : "dark";
      setTheme(nextTheme, true);
      updateThemeControls();
      announceStatus(`Theme set to ${nextTheme}.`);
    });
    tools.appendChild(themeButton);

    a11yButton = document.createElement("button");
    a11yButton.className = "button button-ghost a11y-toggle site-switch";
    a11yButton.type = "button";
    a11yButtonLabelLong = document.createElement("span");
    a11yButtonLabelLong.className = "site-switch-label-long";
    a11yButtonLabelLong.textContent = "Accessibility";
    a11yButtonLabelShort = document.createElement("span");
    a11yButtonLabelShort.className = "site-switch-label-short";
    a11yButtonLabelShort.textContent = "A";
    a11yButton.append(a11yButtonLabelLong, a11yButtonLabelShort, buildSwitchTrack());
    a11yButton.setAttribute("aria-label", "Open accessibility toolbar");
    a11yButton.setAttribute("aria-expanded", "false");
    a11yButton.setAttribute("aria-pressed", "false");
    a11yButton.setAttribute("aria-controls", "site-a11y-panel");
    a11yButton.addEventListener("click", () => {
      const shouldOpen = a11yPanel ? a11yPanel.hidden : true;
      setA11yPanelOpen(shouldOpen);
    });
    tools.appendChild(a11yButton);

    const menuToggle = document.querySelector("[data-menu-toggle]");
    if (menuToggle && menuToggle.parentElement === navbar) {
      navbar.insertBefore(tools, menuToggle);
    } else {
      navbar.appendChild(tools);
    }

    a11yPanel = createAccessibilityPanel();
    body.appendChild(a11yPanel);
    bindA11yGlobalEvents();
    updateThemeControls();
    updateA11yControls();
  }

  function createAccessibilityPanel() {
    const panel = document.createElement("section");
    panel.className = "a11y-panel";
    panel.id = "site-a11y-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Accessibility settings");
    panel.hidden = true;

    const headerWrap = document.createElement("div");
    headerWrap.className = "a11y-panel-header";

    const heading = document.createElement("h2");
    heading.textContent = "Accessibility";
    headerWrap.appendChild(heading);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "button button-ghost a11y-close";
    closeButton.setAttribute("aria-label", "Close accessibility toolbar");
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => setA11yPanelOpen(false));
    headerWrap.appendChild(closeButton);

    panel.appendChild(headerWrap);

    const intro = document.createElement("p");
    intro.textContent = "Adjust readability, motion, and focus styles.";
    panel.appendChild(intro);

    const textSizeSection = document.createElement("div");
    textSizeSection.className = "a11y-section";
    const textSizeTitle = document.createElement("p");
    textSizeTitle.className = "a11y-section-title";
    textSizeTitle.textContent = "Text size";
    textSizeSection.appendChild(textSizeTitle);
    const textSizeOptions = document.createElement("div");
    textSizeOptions.className = "a11y-options";
    textSizeOptions.setAttribute("role", "group");
    textSizeOptions.setAttribute("aria-label", "Text size controls");
    const textSizeDefs = [
      { key: "normal", label: "Normal" },
      { key: "large", label: "Large" },
      { key: "x-large", label: "Extra large" },
    ];
    textSizeDefs.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "a11y-option";
      button.dataset.setting = "text-size";
      button.dataset.value = entry.key;
      button.textContent = entry.label;
      button.addEventListener("click", () => {
        accessibilityState.textSize = entry.key;
        applyAccessibilityState(true);
        updateA11yControls();
        announceStatus(`Text size set to ${entry.label.toLowerCase()}.`);
      });
      textSizeButtons.set(entry.key, button);
      textSizeOptions.appendChild(button);
    });
    textSizeSection.appendChild(textSizeOptions);
    panel.appendChild(textSizeSection);

    const toggleSection = document.createElement("div");
    toggleSection.className = "a11y-section";
    const toggleTitle = document.createElement("p");
    toggleTitle.className = "a11y-section-title";
    toggleTitle.textContent = "Display and focus";
    toggleSection.appendChild(toggleTitle);
    const toggleOptions = document.createElement("div");
    toggleOptions.className = "a11y-options";

    toggleButtons.contrast = buildToggleButton("contrast", "High contrast", () => {
      accessibilityState.contrast = accessibilityState.contrast === "high" ? "normal" : "high";
      applyAccessibilityState(true);
      updateA11yControls();
      announceStatus(`High contrast ${accessibilityState.contrast === "high" ? "enabled" : "disabled"}.`);
    });
    toggleButtons.motion = buildToggleButton("motion", "Reduced motion", () => {
      if (reducedMotionQuery.matches && accessibilityState.motion !== "reduced") {
        accessibilityState.motion = "reduced";
      } else {
        accessibilityState.motion = accessibilityState.motion === "reduced" ? "normal" : "reduced";
      }
      applyAccessibilityState(true);
      updateA11yControls();
      if (reducedMotionQuery.matches && accessibilityState.motion === "normal") {
        announceStatus("System reduced motion is active. Reduced motion remains enabled.");
      } else {
        announceStatus(`Reduced motion ${accessibilityState.motion === "reduced" ? "enabled" : "disabled"}.`);
      }
    });
    toggleButtons.focus = buildToggleButton("focus", "Focus highlight", () => {
      accessibilityState.focus = accessibilityState.focus === "high" ? "normal" : "high";
      applyAccessibilityState(true);
      updateA11yControls();
      announceStatus(`Focus highlight ${accessibilityState.focus === "high" ? "enabled" : "disabled"}.`);
    });

    Object.values(toggleButtons).forEach((button) => {
      if (button) toggleOptions.appendChild(button);
    });
    toggleSection.appendChild(toggleOptions);
    panel.appendChild(toggleSection);

    const actionRow = document.createElement("div");
    actionRow.className = "a11y-actions";

    const resetButton = document.createElement("button");
    resetButton.className = "button button-ghost a11y-reset";
    resetButton.type = "button";
    resetButton.textContent = "Reset preferences";
    resetButton.addEventListener("click", () => {
      accessibilityState = { ...defaultAccessibility };
      applyAccessibilityState(true);
      safeRemove(STORAGE_KEYS.theme);
      hasUserThemePreference = false;
      setTheme(prefersDarkQuery.matches ? "dark" : "light", false);
      updateThemeControls();
      updateA11yControls();
      announceStatus("Accessibility preferences reset.");
    });
    actionRow.appendChild(resetButton);

    const panelSkipLink = document.createElement("a");
    panelSkipLink.className = "a11y-skip";
    panelSkipLink.href = "#main";
    panelSkipLink.textContent = "Skip to main content";
    panelSkipLink.addEventListener("click", () => setA11yPanelOpen(false));
    actionRow.appendChild(panelSkipLink);

    panel.appendChild(actionRow);

    a11yStatus = document.createElement("p");
    a11yStatus.className = "a11y-status";
    a11yStatus.setAttribute("aria-live", "polite");
    a11yStatus.setAttribute("role", "status");
    panel.appendChild(a11yStatus);

    return panel;
  }

  function buildToggleButton(name, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "a11y-option";
    button.dataset.setting = name;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function buildSwitchTrack() {
    const track = document.createElement("span");
    track.className = "site-switch-track";
    track.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("span");
    thumb.className = "site-switch-thumb";
    track.appendChild(thumb);
    return track;
  }

  function bindA11yGlobalEvents() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!a11yPanel || a11yPanel.hidden) return;
      setA11yPanelOpen(false);
      if (a11yButton) {
        a11yButton.focus();
      }
    });

    document.addEventListener("click", (event) => {
      if (!a11yPanel || a11yPanel.hidden) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (a11yPanel.contains(target)) return;
      if (a11yButton && a11yButton.contains(target)) return;
      setA11yPanelOpen(false);
    });
  }

  function setA11yPanelOpen(isOpen) {
    if (!a11yPanel || !a11yButton) return;
    a11yPanel.hidden = !isOpen;
    a11yButton.setAttribute("aria-expanded", String(isOpen));
    a11yButton.setAttribute("aria-pressed", String(isOpen));
    a11yButton.setAttribute("aria-label", isOpen ? "Close accessibility toolbar" : "Open accessibility toolbar");
    if (isOpen) {
      const firstInteractive = a11yPanel.querySelector("button, a");
      if (firstInteractive instanceof HTMLElement) {
        firstInteractive.focus();
      }
    }
  }

  function updateThemeControls() {
    if (!themeButton || !themeButtonLabelLong || !themeButtonLabelShort) return;
    const isDark = themeState.value === "dark";
    const currentLong = isDark ? "Dark" : "Light";
    const currentShort = isDark ? "D" : "L";
    themeButtonLabelLong.textContent = currentLong;
    themeButtonLabelShort.textContent = currentShort;
    themeButton.setAttribute("aria-pressed", String(isDark));
    themeButton.setAttribute("aria-label", `Theme ${currentLong}. Switch to ${isDark ? "light" : "dark"} theme`);
    themeButton.setAttribute("title", `Switch to ${isDark ? "light" : "dark"} theme`);
  }

  function updateA11yControls() {
    textSizeButtons.forEach((button, key) => {
      button.setAttribute("aria-pressed", String(accessibilityState.textSize === key));
    });
    if (toggleButtons.contrast) {
      toggleButtons.contrast.setAttribute("aria-pressed", String(accessibilityState.contrast === "high"));
    }
    if (toggleButtons.focus) {
      toggleButtons.focus.setAttribute("aria-pressed", String(accessibilityState.focus === "high"));
    }
    if (toggleButtons.motion) {
      const motionEnabled = accessibilityState.motion === "reduced" || reducedMotionQuery.matches;
      toggleButtons.motion.setAttribute("aria-pressed", String(motionEnabled));
      toggleButtons.motion.textContent = reducedMotionQuery.matches ? "Reduced motion (System)" : "Reduced motion";
    }
  }

  function announceStatus(message) {
    if (!a11yStatus) return;
    a11yStatus.textContent = "";
    window.setTimeout(() => {
      if (!a11yStatus) return;
      a11yStatus.textContent = message;
    }, 20);
  }

  function setupAnalyticsCapture() {
    const normalizeLabel = (value) => {
      if (!value) return "";
      return value
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    };

    const resolveCtaLabel = (href) => {
      if (!href) return null;
      const cleanedPath = resolveLocalPathForLabel(href);
      const cleanedUrl = href.toLowerCase();
      if (cleanedUrl.includes(legacyPortalHost) || cleanedUrl.includes(portalHost)) return "login";
      if (cleanedUrl.startsWith("mailto:")) return "email";
      if (cleanedUrl.startsWith("tel:")) return "phone";
      if (cleanedUrl.includes("discord")) return "discord";
      if (cleanedUrl.includes("instagram")) return "instagram";
      if (cleanedUrl.includes("calendar.google.com")) return "calendar_embed";
      if (cleanedPath.startsWith("/kiln-firing")) return "kiln_firing";
      if (cleanedPath.startsWith("/services")) return "services";
      if (cleanedPath.startsWith("/memberships")) return "memberships";
      if (cleanedPath.startsWith("/support")) return "support";
      if (cleanedPath.startsWith("/faq")) return "community_hub";
      if (cleanedPath.startsWith("/contact")) return "contact";
      if (cleanedPath.startsWith("/gallery")) return "gallery";
      if (cleanedPath.startsWith("/highlights")) return "highlights";
      if (cleanedPath.startsWith("/supplies")) return "supplies";
      if (cleanedPath.startsWith("/policies")) return "policies";
      if (cleanedPath.startsWith("/classes") || cleanedPath.includes("workshop")) return "workshops";
      if (cleanedPath.startsWith("/calendar")) return "calendar_page";
      return null;
    };

    const resolveLocation = (link) => {
      if (link.closest("[data-nav-links]")) return "nav";
      if (link.closest("header")) return "header";
      if (link.closest("footer")) return "footer";
      if (link.closest(".a11y-panel")) return "a11y_panel";
      return "body";
    };

    const resolveLinkType = (href) => {
      if (!href) return "unknown";
      if (href.startsWith("#")) return "anchor";
      if (href.startsWith("mailto:")) return "email";
      if (href.startsWith("tel:")) return "phone";
      if (/^https?:\/\//i.test(href)) {
        return href.includes(window.location.hostname) ? "internal" : "outbound";
      }
      return "internal";
    };

    document.addEventListener("click", (event) => {
      const link = event.target && event.target.closest ? event.target.closest("a") : null;
      if (!link || typeof window.gtag !== "function") return;
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("javascript:")) return;

      const linkType = resolveLinkType(href);
      const isButton = link.classList.contains("button") || link.classList.contains("nav-portal");
      const location = resolveLocation(link);
      const explicitLabel = link.getAttribute("data-cta");
      const textLabel = normalizeLabel(explicitLabel || link.getAttribute("aria-label") || link.textContent.trim());
      const label = resolveCtaLabel(href) || textLabel;
      if (!label) return;

      const category = location === "nav" ? "navigation" : isButton ? "cta" : linkType === "outbound" || linkType === "email" || linkType === "phone" ? "outbound" : "link";

      window.gtag("event", "cta_click", {
        event_category: category,
        event_label: label,
        link_text: link.textContent.trim(),
        link_url: href,
        link_type: linkType,
        link_location: location,
        page_path: stripPreviewPrefix(window.location.pathname),
      });
    });
  }

  function setupCarouselRotation() {
    const prefersReducedMotion = () => reducedMotionQuery.matches || root.getAttribute("data-motion") === "reduced";
    const carousels = document.querySelectorAll('[data-auto-rotate="true"]');
    carousels.forEach((carousel) => {
      if (prefersReducedMotion()) return;
      const items = carousel.querySelectorAll(".chip-card");
      if (!items.length) return;
      const getGap = () => {
        const styles = window.getComputedStyle(carousel);
        return parseFloat(styles.columnGap || styles.gap || "0");
      };
      const tick = () => {
        if (carousel.matches(":hover") || carousel.matches(":focus-within")) return;
        if (prefersReducedMotion()) return;
        const gap = getGap();
        const itemWidth = items[0].offsetWidth + gap;
        const perView = Math.max(1, Math.round(carousel.clientWidth / itemWidth));
        const scrollBy = itemWidth * perView;
        const maxScroll = carousel.scrollWidth - carousel.clientWidth;
        if (carousel.scrollLeft + scrollBy >= maxScroll - 4) {
          carousel.scrollTo({ left: 0, behavior: "smooth" });
        } else {
          carousel.scrollBy({ left: scrollBy, behavior: "smooth" });
        }
      };
      window.setInterval(tick, 4500);
    });
  }

  function resolvePreviewPrefix(pathname) {
    const match = String(pathname || "").match(/^\/__preview\/[^/]+/);
    return match ? match[0] : "";
  }

  function stripPreviewPrefix(value) {
    const raw = String(value || "");
    if (!previewPrefix) return raw;
    if (raw === previewPrefix || raw === `${previewPrefix}/`) return "/";
    if (raw.startsWith(`${previewPrefix}/`)) {
      return raw.slice(previewPrefix.length) || "/";
    }
    return raw;
  }

  function withPreviewPrefix(path) {
    if (!previewPrefix) return path;
    if (!path || !path.startsWith("/")) return path;
    if (path === previewPrefix || path.startsWith(`${previewPrefix}/`)) return path;
    return `${previewPrefix}${path}`;
  }

  function extractPathname(href) {
    try {
      const parsed = new URL(href, window.location.origin);
      if (parsed.origin !== window.location.origin) return null;
      return parsed.pathname;
    } catch {
      return href.startsWith("/") ? href : null;
    }
  }

  function resolveLocalPathForLabel(href) {
    const pathname = extractPathname(href);
    if (!pathname) return "";
    return stripPreviewPrefix(pathname).toLowerCase();
  }

  function safeRead(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeWrite(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore storage errors.
    }
  }

  function safeRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage errors.
    }
  }

  function isOneOf(value, allowed) {
    return allowed.includes(value);
  }
})();
