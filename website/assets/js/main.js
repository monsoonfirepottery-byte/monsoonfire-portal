(() => {
  const RUNTIME_BANNER_HOST_ID = "mf-runtime-banner-host";
  const RUNTIME_BANNER_STYLE_ID = "mf-runtime-banner-style";
  const normalizePath = (value) => {
    if (!value) return '/';
    const cleaned = value.replace(/index\.html?$/i, '');
    return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
  };

  const body = document.body;
  const main = document.getElementById('main');
  if (body && main && !document.querySelector('.skip-link')) {
    const skipLink = document.createElement('a');
    skipLink.className = 'skip-link';
    skipLink.href = '#main';
    skipLink.textContent = 'Skip to main content';
    body.insertBefore(skipLink, body.firstChild);
  }

  const runtimeHost = body ? ensureRuntimeBannerHost(body) : null;
  if (runtimeHost) {
    ensureRuntimeBannerStyles();
  }
  let offlineVisible = false;
  let runtimeDismissed = false;
  let clearRuntimeTimer = null;

  const createSupportCode = () => {
    const stamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `web-${stamp}-${random}`;
  };

  const isChunkLoadError = (value) => {
    const lower = String(value || '').toLowerCase();
    return (
      lower.includes('loading chunk') ||
      lower.includes('chunkloaderror') ||
      lower.includes('failed to load chunk') ||
      lower.includes('dynamically imported module') ||
      lower.includes('imported module')
    );
  };

  const renderRuntimeBanner = (kind, message, details) => {
    if (!runtimeHost) return;
    runtimeHost.innerHTML = '';

    const banner = document.createElement('section');
    banner.className = `site-runtime-banner ${kind === 'error' ? 'is-error' : 'is-offline'}`;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    const code = createSupportCode();
    const title = document.createElement('strong');
    title.className = 'site-runtime-title';
    title.textContent =
      kind === 'error'
        ? 'Something went wrong while loading this page.'
        : 'You appear to be offline.';

    const copy = document.createElement('p');
    copy.className = 'site-runtime-copy';
    copy.textContent = message;

    const support = document.createElement('p');
    support.className = 'site-runtime-support';
    support.textContent = `Support code: ${code}`;

    const actions = document.createElement('div');
    actions.className = 'site-runtime-actions';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Try again';
    retryButton.addEventListener('click', () => {
      window.location.reload();
    });
    actions.appendChild(retryButton);

    if (kind === 'error') {
      const dismissButton = document.createElement('button');
      dismissButton.type = 'button';
      dismissButton.className = 'site-runtime-dismiss';
      dismissButton.textContent = 'Dismiss';
      dismissButton.addEventListener('click', () => {
        runtimeDismissed = true;
        runtimeHost.innerHTML = '';
      });
      actions.appendChild(dismissButton);
    }

    banner.appendChild(title);
    banner.appendChild(copy);
    banner.appendChild(support);
    banner.appendChild(actions);

    if (details) {
      const info = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Technical details';
      const pre = document.createElement('pre');
      pre.textContent = String(details);
      info.appendChild(summary);
      info.appendChild(pre);
      banner.appendChild(info);
    }

    runtimeHost.appendChild(banner);
  };

  const showOfflineBanner = () => {
    offlineVisible = true;
    renderRuntimeBanner(
      'offline',
      'Reconnect to continue browsing. Your existing page content is still available.',
      null
    );
  };

  const clearOfflineBanner = () => {
    offlineVisible = false;
    if (!runtimeHost) return;
    runtimeHost.innerHTML = '';
  };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    showOfflineBanner();
  }

  window.addEventListener('online', () => {
    clearOfflineBanner();
  });

  window.addEventListener('offline', () => {
    showOfflineBanner();
  });

  window.addEventListener('error', (event) => {
    if (offlineVisible || runtimeDismissed) return;
    const details = event?.message || 'Unhandled runtime error';
    const message = isChunkLoadError(details)
      ? 'A page module failed to load, likely due to a recent update or weak network. Reload to recover.'
      : 'Please try again. If it keeps happening, contact support with this code.';
    renderRuntimeBanner(
      'error',
      message,
      details
    );
    if (clearRuntimeTimer) {
      window.clearTimeout(clearRuntimeTimer);
    }
    clearRuntimeTimer = window.setTimeout(() => {
      if (runtimeHost && !offlineVisible) runtimeHost.innerHTML = '';
    }, 12000);
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (offlineVisible || runtimeDismissed) return;
    const reason = event?.reason instanceof Error ? event.reason.message : String(event?.reason ?? 'Promise rejection');
    const message = isChunkLoadError(reason)
      ? 'A page module failed to load in the background. Reload to recover.'
      : 'A background request failed. Try again in a moment.';
    renderRuntimeBanner(
      'error',
      message,
      reason
    );
  });

  const contactTitleNodes = Array.from(document.querySelectorAll('.footer .footer-title'));
  contactTitleNodes.forEach((titleNode) => {
    if (!titleNode || !titleNode.textContent) return;
    if (titleNode.textContent.trim().toLowerCase() !== 'contact') return;
    const contactContainer = titleNode.parentElement;
    if (!contactContainer) return;
    if (contactContainer.querySelector('a[href="/policies/accessibility/"]')) return;

    const line = document.createElement('p');
    const link = document.createElement('a');
    link.href = '/policies/accessibility/';
    link.textContent = 'Accessibility statement';
    line.appendChild(link);
    contactContainer.appendChild(line);
  });

  const parentPath = body ? body.getAttribute('data-nav-parent') : null;
  const currentPath = normalizePath(parentPath || window.location.pathname);
  document.querySelectorAll('[data-nav-links] a').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    if (normalizePath(href) === currentPath) {
      link.setAttribute('aria-current', 'page');
    }
  });

  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-nav-links]');
  if (toggle && nav) {
    if (!nav.id) {
      nav.id = 'site-nav-links';
    }
    toggle.setAttribute('aria-controls', nav.id);
    toggle.setAttribute('aria-label', 'Open menu');

    const setMenuState = (isOpen) => {
      nav.classList.toggle('open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    };

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      setMenuState(!expanded);
    });

    nav.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('a')) setMenuState(false);
    });

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (nav.contains(target) || toggle.contains(target)) return;
      setMenuState(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      setMenuState(false);
      toggle.focus();
    });

    const desktopMedia = window.matchMedia('(min-width: 981px)');
    const collapseOnDesktop = (media) => {
      if (media.matches) {
        setMenuState(false);
      }
    };
    collapseOnDesktop(desktopMedia);
    if (typeof desktopMedia.addEventListener === 'function') {
      desktopMedia.addEventListener('change', collapseOnDesktop);
    } else if (typeof desktopMedia.addListener === 'function') {
      desktopMedia.addListener(collapseOnDesktop);
    }
  }

  const normalizeLabel = (value) => {
    if (!value) return '';
    return value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  };

  const normalizeUrlHost = (hostname) => String(hostname || '').toLowerCase().replace(/^www\./, '');
  const canonicalCampaignHosts = ['monsoonfire.kilnfire.com', 'portal.monsoonfire.com', 'instagram.com', 'discord.com', 'discord.gg', 'phoenixcenterforthearts.org'];

  const isCampaignHost = (hostname) => {
    const normalizedHost = normalizeUrlHost(hostname);
    return canonicalCampaignHosts.some((host) => normalizedHost === host || normalizedHost.endsWith(`.${host}`));
  };

  const deriveUtmCampaign = (label, location) => {
    const pathKey = normalizeLabel(window.location.pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '_')) || 'home';
    const labelKey = normalizeLabel(label) || 'cta';
    const locationKey = normalizeLabel(location) || 'body';
    return `${pathKey}_${labelKey}_${locationKey}_2026q1`;
  };

  const annotateCampaignHref = (link, href, label, location) => {
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return {
        href,
        autoTagged: false,
        utm: {
          source: null,
          medium: null,
          campaign: null,
        },
      };
    }

    try {
      const parsed = new URL(href, window.location.origin);
      if (parsed.origin === window.location.origin || !isCampaignHost(parsed.hostname)) {
        return {
          href,
          autoTagged: false,
          utm: {
            source: parsed.searchParams.get('utm_source'),
            medium: parsed.searchParams.get('utm_medium'),
            campaign: parsed.searchParams.get('utm_campaign'),
          },
        };
      }

      let mutated = false;
      const ensureParam = (key, value) => {
        if (parsed.searchParams.get(key)) return;
        parsed.searchParams.set(key, value);
        mutated = true;
      };

      ensureParam('utm_source', 'monsoonfire_website');
      ensureParam('utm_medium', 'referral');
      ensureParam('utm_campaign', deriveUtmCampaign(label, location));

      const finalHref = parsed.toString();
      if (mutated && link) {
        link.setAttribute('href', finalHref);
      }

      return {
        href: finalHref,
        autoTagged: mutated,
        utm: {
          source: parsed.searchParams.get('utm_source'),
          medium: parsed.searchParams.get('utm_medium'),
          campaign: parsed.searchParams.get('utm_campaign'),
        },
      };
    } catch {
      return {
        href,
        autoTagged: false,
        utm: {
          source: null,
          medium: null,
          campaign: null,
        },
      };
    }
  };

  const resolveCtaLabel = (href) => {
    if (!href) return null;
    const cleaned = href.toLowerCase();
    if (cleaned.includes('monsoonfire.kilnfire.com')) return 'login';
    if (cleaned.startsWith('mailto:')) return 'email';
    if (cleaned.startsWith('tel:')) return 'phone';
    if (cleaned.includes('discord')) return 'discord';
    if (cleaned.includes('instagram')) return 'instagram';
    if (cleaned.includes('calendar.google.com')) return 'calendar_embed';
    if (cleaned.startsWith('/kiln-firing')) return 'kiln_firing';
    if (cleaned.startsWith('/services')) return 'services';
    if (cleaned.startsWith('/memberships')) return 'memberships';
    if (cleaned.startsWith('/support')) return 'support';
    if (cleaned.startsWith('/faq')) return 'community_hub';
    if (cleaned.startsWith('/contact')) return 'contact';
    if (cleaned.startsWith('/gallery')) return 'gallery';
    if (cleaned.startsWith('/highlights')) return 'highlights';
    if (cleaned.startsWith('/supplies')) return 'supplies';
    if (cleaned.startsWith('/policies')) return 'policies';
    if (cleaned.startsWith('/classes') || cleaned.includes('workshop')) return 'workshops';
    if (cleaned.startsWith('/calendar')) return 'calendar_page';
    return null;
  };

  const resolveLocation = (link) => {
    if (link.closest('[data-nav-links]')) return 'nav';
    if (link.closest('header')) return 'header';
    if (link.closest('footer')) return 'footer';
    return 'body';
  };

  const resolveLinkType = (href) => {
    if (!href) return 'unknown';
    if (href.startsWith('#')) return 'anchor';
    if (href.startsWith('mailto:')) return 'email';
    if (href.startsWith('tel:')) return 'phone';
    if (/^https?:\/\//i.test(href)) {
      return href.includes(window.location.hostname) ? 'internal' : 'outbound';
    }
    return 'internal';
  };

  const resolveDeviceClass = () => window.matchMedia('(max-width: 820px)').matches ? 'mobile' : 'desktop';

  const emitCanonicalEvent = (eventName, details) => {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, {
      page: window.location.pathname,
      page_path: window.location.pathname,
      locale: document.documentElement.lang || 'en',
      device: resolveDeviceClass(),
      ...details,
    });
  };

  document.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!link || typeof window.gtag !== 'function') return;
    const originalHref = link.getAttribute('href') || '';
    if (!originalHref || originalHref.startsWith('javascript:')) return;

    const linkType = resolveLinkType(originalHref);
    const isButton = link.classList.contains('button') || link.classList.contains('nav-portal');
    const isPrimaryButton = link.classList.contains('button-primary');
    const location = resolveLocation(link);
    const explicitLabel = link.getAttribute('data-cta');
    const textLabel = normalizeLabel(explicitLabel || link.getAttribute('aria-label') || link.textContent.trim());
    const label = resolveCtaLabel(originalHref) || textLabel;
    if (!label) return;
    const hrefWithCampaign = annotateCampaignHref(link, originalHref, label, location);
    const trackedHref = hrefWithCampaign.href;

    const category = location === 'nav' ? 'navigation' : isButton ? 'cta' : linkType === 'outbound' || linkType === 'email' || linkType === 'phone' ? 'outbound' : 'link';

    window.gtag('event', 'cta_click', {
      event_category: category,
      event_label: label,
      link_text: link.textContent.trim(),
      link_url: trackedHref,
      link_type: linkType,
      link_location: location,
      page_path: window.location.pathname,
      utm_source: hrefWithCampaign.utm.source,
      utm_medium: hrefWithCampaign.utm.medium,
      utm_campaign: hrefWithCampaign.utm.campaign,
      campaign_autotag_applied: hrefWithCampaign.autoTagged,
    });

    const canonicalPayload = {
      source: hrefWithCampaign.utm.source || 'direct',
      campaign: hrefWithCampaign.utm.campaign || 'unattributed',
      trigger_surface: location,
      event_label: label,
      link_type: linkType,
      link_url: trackedHref,
    };

    if (isPrimaryButton) {
      emitCanonicalEvent('cta_primary_click', {
        ...canonicalPayload,
        goal_name: 'quote_start',
        funnel_step: 'landing_cta',
      });
    }

    const loweredHref = trackedHref.toLowerCase();
    if (linkType === 'email') {
      emitCanonicalEvent('contact_email_click', {
        ...canonicalPayload,
        goal_name: 'contact_intent',
        funnel_step: 'alt_contact',
      });
    }
    if (linkType === 'phone') {
      emitCanonicalEvent('contact_phone_click', {
        ...canonicalPayload,
        goal_name: 'contact_intent',
        funnel_step: 'alt_contact',
      });
    }
    if (loweredHref.includes('whatsapp') || loweredHref.includes('wa.me')) {
      emitCanonicalEvent('whatsapp_click', {
        ...canonicalPayload,
        goal_name: 'contact_intent',
        funnel_step: 'alt_contact',
      });
    }
  });

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const prefersReducedMotion = () => reducedMotionQuery.matches;
  const carousels = document.querySelectorAll('[data-auto-rotate="true"]');
  carousels.forEach((carousel) => {
    if (prefersReducedMotion()) return;
    const items = carousel.querySelectorAll('.chip-card');
    if (!items.length) return;
    const getGap = () => {
      const styles = window.getComputedStyle(carousel);
      return parseFloat(styles.columnGap || styles.gap || '0');
    };
    const tick = () => {
      if (carousel.matches(':hover') || carousel.matches(':focus-within')) return;
      const gap = getGap();
      const itemWidth = items[0].offsetWidth + gap;
      const perView = Math.max(1, Math.round(carousel.clientWidth / itemWidth));
      const scrollBy = itemWidth * perView;
      const maxScroll = carousel.scrollWidth - carousel.clientWidth;
      if (carousel.scrollLeft + scrollBy >= maxScroll - 4) {
        carousel.scrollTo({ left: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      } else {
        carousel.scrollBy({ left: scrollBy, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    };
    setInterval(tick, 4500);
  });

  function ensureRuntimeBannerHost(rootBody) {
    let host = document.getElementById(RUNTIME_BANNER_HOST_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = RUNTIME_BANNER_HOST_ID;
    host.className = 'site-runtime-banner-host';
    rootBody.insertBefore(host, rootBody.firstChild);
    return host;
  }

  function ensureRuntimeBannerStyles() {
    if (document.getElementById(RUNTIME_BANNER_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = RUNTIME_BANNER_STYLE_ID;
    style.textContent = `
      .site-runtime-banner-host{position:sticky;top:0;z-index:160;display:grid;gap:8px;padding:8px 12px 0}
      .site-runtime-banner{border-radius:12px;border:1px solid var(--border);background:var(--surface,#fff);color:var(--ink-900,#1b1a17);box-shadow:var(--shadow-1);padding:10px 12px}
      .site-runtime-banner.is-offline{border-color:rgba(180,79,53,.45);background:rgba(180,79,53,.1)}
      .site-runtime-banner.is-error{border-color:rgba(183,64,42,.54);background:rgba(183,64,42,.12)}
      .site-runtime-title{display:block;font-family:var(--font-ui,inherit);font-size:var(--text-sm,14px)}
      .site-runtime-copy{margin:5px 0 0;font-size:var(--text-sm,14px)}
      .site-runtime-support{margin:6px 0 0;font-size:var(--text-xs,12px)}
      .site-runtime-actions{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
      .site-runtime-actions button{min-height:36px;border:1px solid var(--border);border-radius:9px;background:rgba(255,255,255,.85);color:inherit;font-family:var(--font-ui,inherit);font-size:var(--text-xs,12px);padding:6px 10px;cursor:pointer}
      .site-runtime-dismiss{background:transparent;text-decoration:underline}
      .site-runtime-banner details{margin-top:8px}
      .site-runtime-banner pre{margin:6px 0 0;border:1px solid var(--border);border-radius:9px;background:rgba(255,255,255,.72);padding:8px;max-height:120px;overflow:auto;font-size:var(--text-xs,12px);white-space:pre-wrap;word-break:break-word}
    `;
    document.head.appendChild(style);
  }
})();
