(() => {
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

  const state = {
    query: '',
    tags: new Set(),
    type: 'all',
    faqs: [],
    policies: []
  };

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
      (item.tags || []).forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort();
  };

  const matches = (item) => {
    const text = `${item.question || item.title || ''} ${item.answer || item.body || ''}`;
    const haystack = normalize(text);
    const queryMatch = !state.query || haystack.includes(state.query);
    const tags = new Set(item.tags || []);
    const tagMatch = state.tags.size === 0 || Array.from(state.tags).every((tag) => tags.has(tag));
    return queryMatch && tagMatch;
  };

  const renderTags = (tags) => {
    tagContainer.innerHTML = '';
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

  const buildAccordionItem = (title, body, meta) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'accordion-item';
    const button = document.createElement('button');
    button.className = 'accordion-button';
    button.type = 'button';
    button.innerHTML = `<span class="accordion-title">${title}</span>${meta || ''}`;
    const panel = document.createElement('div');
    panel.className = 'accordion-panel';
    panel.innerHTML = body;
    button.addEventListener('click', () => {
      wrapper.classList.toggle('open');
    });
    wrapper.appendChild(button);
    wrapper.appendChild(panel);
    return wrapper;
  };

  const renderList = (listEl, items, emptyMessage) => {
    listEl.innerHTML = '';
    const filtered = items.filter(matches);
    if (!filtered.length) {
      listEl.innerHTML = `<div>${emptyMessage}</div>`;
      return;
    }
    filtered.forEach((item) => {
      const title = item.question || item.title || 'Untitled';
      const body = item.answer || item.body || '';
      const metaParts = [];
      if (item.status) metaParts.push(item.status);
      if (item.effectiveDate) metaParts.push(`Effective ${formatDate(item.effectiveDate)}`);
      const metaLabel = metaParts.join(' · ');
      const meta = `<span class="accordion-meta"${metaLabel ? '' : ' aria-hidden=\"true\"'}>${metaLabel}</span>`;
      listEl.appendChild(buildAccordionItem(title, body, meta));
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
    const faqCount = renderList(faqList, state.faqs, 'No FAQs match this search.') || 0;
    const policyCount = renderList(policyList, state.policies, 'No policies match this search.') || 0;

    if (faqSection) {
      faqSection.style.display = state.type === 'policy' ? 'none' : '';
    }
    if (policySection) {
      policySection.style.display = state.type === 'faq' ? 'none' : '';
    }
    if (countEl) {
      if (state.type === 'faq') {
        countEl.textContent = `${faqCount} FAQ${faqCount === 1 ? '' : 's'} shown.`;
      } else if (state.type === 'policy') {
        countEl.textContent = `${policyCount} polic${policyCount === 1 ? 'y' : 'ies'} shown.`;
      } else {
        countEl.textContent = `${faqCount + policyCount} total entries shown.`;
      }
    }
    typeFilters.forEach((button) => {
      button.classList.toggle('active', button.dataset.typeFilter === state.type);
    });
    topicButtons.forEach((button) => {
      const topic = button.dataset.topic;
      const active = state.tags.size === 1 && state.tags.has(topic);
      button.classList.toggle('active', active);
    });
  };

  const init = async () => {
    const [faqRes, policyRes] = await Promise.all([
      fetch('/data/faq.json'),
      fetch('/data/policies.json')
    ]);
    state.faqs = faqRes.ok ? await faqRes.json() : [];
    state.policies = policyRes.ok ? await policyRes.json() : [];
    state.policies = state.policies.map((policy) => ({
      ...policy,
      tags: [...(policy.tags || []), policy.status || 'active'].filter(Boolean)
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
          faqSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        render();
      }
    });
  });

  init().catch(() => {
    faqList.innerHTML = '<div>FAQ data is not available.</div>';
    policyList.innerHTML = '<div>Policy data is not available.</div>';
  });
})();
