(() => {
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const prefersReducedMotion = () => reducedMotionQuery.matches;

  const faqList = document.querySelector('[data-faq-list]');
  const policyList = document.querySelector('[data-policy-list]');
  const tagContainer = document.querySelector('[data-tag-list]');
  const searchInput = document.querySelector('[data-faq-search]');
  const typeFilters = document.querySelectorAll('[data-type-filter]');
  const topicButtons = document.querySelectorAll('[data-topic]');
  const countEl = document.querySelector('[data-faq-count]');
  const faqSection = document.querySelector('[data-faq-section]');
  const policySection = document.querySelector('[data-policy-section]');
  if (!faqList || !policyList || !tagContainer || !searchInput) return;

  const parser = new DOMParser();
  const allowedTags = new Set(["P", "UL", "OL", "LI", "A", "STRONG", "B", "EM", "I", "BR", "SPAN"]);

  const normalize = (value) => String(value || '').toLowerCase();
  const formatDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const collectTags = (items) => {
    const tags = new Set();
    items.forEach((item) => {
      (item.tags || []).forEach((tag) => {
        if (typeof tag === 'string' && tag.trim()) tags.add(tag.trim());
      });
    });
    return Array.from(tags).sort();
  };

  const stripHtml = (value) => {
    const valueString = String(value || '');
    return valueString
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-zA-Z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const isSafeUrl = (value) => {
    if (!value || typeof value !== 'string') return false;
    const raw = value.trim();
    if (!raw || raw.startsWith('javascript:')) return false;
    try {
      const parsed = new URL(raw, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
    } catch {
      return false;
    }
  };

  const sanitizeNode = (node, out) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) out.appendChild(document.createTextNode(text));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toUpperCase();
    if (!allowedTags.has(tag)) {
      Array.from(node.childNodes).forEach((child) => sanitizeNode(child, out));
      return;
    }

    const element = document.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = node.getAttribute('href');
      if (isSafeUrl(href)) {
        element.setAttribute('href', href);
      }
      const rel = node.getAttribute('rel');
      if (rel) element.setAttribute('rel', rel);
      const target = node.getAttribute('target');
      if (target) element.setAttribute('target', target);
    }

    Array.from(node.childNodes).forEach((child) => sanitizeNode(child, element));
    out.appendChild(element);
  };

  const setSafeHtml = (el, value) => {
    const doc = parser.parseFromString(String(value || ''), 'text/html');
    const fragment = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach((node) => sanitizeNode(node, fragment));
    el.replaceChildren(fragment);
  };

  const setEmptyState = (el, message) => {
    el.replaceChildren();
    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    el.appendChild(messageEl);
  };

  const matches = (item) => {
    const text = `${item.question || item.title || ''} ${item.answer || item.body || ''}`;
    const haystack = stripHtml(text);
    const queryMatch = !state.query || haystack.includes(state.query);
    const tags = new Set(Array.isArray(item.tags) ? item.tags : []);
    const tagMatch = state.tags.size === 0 || Array.from(state.tags).every((tag) => tags.has(tag));
    return queryMatch && tagMatch;
  };

  const renderTags = (tags) => {
    tagContainer.replaceChildren();
    tags.forEach((tag) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tag';
      button.textContent = tag.replace(/-/g, ' ');
      if (state.tags.has(tag)) button.classList.add('active');
      button.addEventListener('click', () => {
        if (state.tags.has(tag)) {
          state.tags.delete(tag);
        } else {
          state.tags.add(tag);
        }
        render();
      });
      tagContainer.appendChild(button);
    });
  };

  const buildAccordionItem = (title, body, metaLabel) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'accordion-item';
    const button = document.createElement('button');
    button.className = 'accordion-button';
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');

    const titleEl = document.createElement('span');
    titleEl.className = 'accordion-title';
    titleEl.textContent = title;
    button.appendChild(titleEl);

    const meta = document.createElement('span');
    meta.className = 'accordion-meta';
    if (metaLabel) {
      meta.textContent = metaLabel;
    } else {
      meta.setAttribute('aria-hidden', 'true');
    }
    button.appendChild(meta);

    const panel = document.createElement('div');
    panel.className = 'accordion-panel';
    setSafeHtml(panel, body);

    button.addEventListener('click', () => {
      const isOpen = !wrapper.classList.contains('open');
      wrapper.classList.toggle('open', isOpen);
      button.setAttribute('aria-expanded', String(isOpen));
    });

    wrapper.appendChild(button);
    wrapper.appendChild(panel);
    return wrapper;
  };

  const renderList = (listEl, items, emptyMessage) => {
    listEl.replaceChildren();
    const filtered = items.filter(matches);
    if (!filtered.length) {
      setEmptyState(listEl, emptyMessage);
      return;
    }
    filtered.forEach((item) => {
      const title = item.question || item.title || 'Untitled';
      const body = item.answer || item.body || '';
      const metaParts = [];
      if (item.status) metaParts.push(item.status);
      if (item.effectiveDate) metaParts.push(`Effective ${formatDate(item.effectiveDate)}`);
      const metaLabel = metaParts.join(' · ');
      listEl.appendChild(buildAccordionItem(title, body, metaLabel));
    });
    return filtered.length;
  };

  const render = () => {
    const sourceItems = state.type === 'faq'
      ? state.faqs
      : state.type === 'policy'
        ? state.policies
        : [...state.faqs, ...state.policies];
    const tags = collectTags(sourceItems);
    state.tags = new Set(Array.from(state.tags).filter((tag) => tags.includes(tag)));
    renderTags(tags);

    const faqCount = renderList(faqList, state.faqs, 'No FAQs match this search.');
    const policyCount = renderList(policyList, state.policies, 'No policies match this search.');

    if (faqSection) {
      if (state.type === 'policy') {
        faqSection.classList.add('is-hidden');
      } else {
        faqSection.classList.remove('is-hidden');
      }
    }
    if (policySection) {
      if (state.type === 'faq') {
        policySection.classList.add('is-hidden');
      } else {
        policySection.classList.remove('is-hidden');
      }
    }
    const safeFaqCount = faqCount || 0;
    const safePolicyCount = policyCount || 0;

    if (countEl) {
      if (state.type === 'faq') {
        countEl.textContent = `${safeFaqCount} FAQ${safeFaqCount === 1 ? '' : 's'} shown.`;
      } else if (state.type === 'policy') {
        countEl.textContent = `${safePolicyCount} polic${safePolicyCount === 1 ? 'y' : 'ies'} shown.`;
      } else {
        countEl.textContent = `${safeFaqCount + safePolicyCount} total entries shown.`;
      }
    }

    typeFilters.forEach((button) => {
      const isActive = button.dataset.typeFilter === state.type;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    topicButtons.forEach((button) => {
      const topic = button.dataset.topic;
      const active = state.tags.size === 1 && state.tags.has(topic);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const state = {
    query: '',
    tags: new Set(),
    type: 'all',
    faqs: [],
    policies: []
  };

  const init = async () => {
    const [faqRes, policyRes] = await Promise.all([fetch('/data/faq.json'), fetch('/data/policies.json')]);
    state.faqs = faqRes.ok ? await faqRes.json() : [];
    state.policies = policyRes.ok ? await policyRes.json() : [];
    state.policies = state.policies.map((policy) => ({
      ...policy,
      tags: [...(Array.isArray(policy.tags) ? policy.tags : []), policy.status || 'active'].filter(Boolean)
    }));
    render();
  };

  searchInput.addEventListener('input', (event) => {
    state.query = normalize(event.target.value);
    render();
  });

  typeFilters.forEach((button) => {
    button.addEventListener('click', () => {
      state.type = button.dataset.typeFilter || 'all';
      render();
    });
  });

  topicButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const topic = button.dataset.topic;
      if (topic) {
        state.tags = new Set([topic]);
        state.type = 'all';
        state.query = '';
        searchInput.value = '';
        if (faqSection) {
          faqSection.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
        render();
      }
    });
  });

  init().catch(() => {
    setEmptyState(faqList, 'FAQ data is not available.');
    setEmptyState(policyList, 'Policy data is not available.');
  });
})();
