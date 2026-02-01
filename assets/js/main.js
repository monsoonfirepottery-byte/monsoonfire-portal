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
})();
