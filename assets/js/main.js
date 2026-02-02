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

  const resolveCtaLabel = (href) => {
    if (!href) return null;
    if (href.includes('monsoonfire.kilnfire.com')) return 'portal';
    if (href.startsWith('/kiln-firing')) return 'kiln_rentals';
    if (href.startsWith('/services/#studio-resources')) return 'studio_resources';
    if (href.startsWith('/services/#community') || href.startsWith('/faq')) return 'community_hub';
    return null;
  };

  document.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!link) return;
    if (!link.classList.contains('button') && !link.classList.contains('nav-portal')) return;
    const href = link.getAttribute('href');
    const label = resolveCtaLabel(href);
    if (!label || typeof window.gtag !== 'function') return;
    window.gtag('event', 'cta_click', {
      event_category: 'engagement',
      event_label: label,
      cta_text: link.textContent.trim(),
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
