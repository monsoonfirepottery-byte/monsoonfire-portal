(() => {
  const normalizePath = (value) => {
    if (!value) return '/';
    const cleaned = value.replace(/index\.html?$/i, '');
    return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
  };

  const body = document.body;
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
    toggle.addEventListener('click', () => {
      nav.classList.toggle('open');
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
    });

    nav.addEventListener('click', (event) => {
      if (event.target && event.target.matches('a')) {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const normalizeLabel = (value) => {
    if (!value) return '';
    return value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
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

  document.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!link || typeof window.gtag !== 'function') return;
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('javascript:')) return;

    const linkType = resolveLinkType(href);
    const isButton = link.classList.contains('button') || link.classList.contains('nav-portal');
    const location = resolveLocation(link);
    const explicitLabel = link.getAttribute('data-cta');
    const textLabel = normalizeLabel(explicitLabel || link.getAttribute('aria-label') || link.textContent.trim());
    const label = resolveCtaLabel(href) || textLabel;
    if (!label) return;

    const category = location === 'nav' ? 'navigation' : isButton ? 'cta' : linkType === 'outbound' || linkType === 'email' || linkType === 'phone' ? 'outbound' : 'link';

    window.gtag('event', 'cta_click', {
      event_category: category,
      event_label: label,
      link_text: link.textContent.trim(),
      link_url: href,
      link_type: linkType,
      link_location: location,
      page_path: window.location.pathname,
    });
  });

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const carousels = document.querySelectorAll('[data-auto-rotate="true"]');
  carousels.forEach((carousel) => {
    if (prefersReducedMotion) return;
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
        carousel.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        carousel.scrollBy({ left: scrollBy, behavior: 'smooth' });
      }
    };
    setInterval(tick, 4500);
  });
})();
