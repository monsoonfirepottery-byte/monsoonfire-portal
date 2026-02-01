(() => {
  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (el && value) {
      el.textContent = value;
    }
  };

  const setImage = (selector, src, alt) => {
    const img = document.querySelector(selector);
    if (img && src) {
      img.src = src;
      if (alt) img.alt = alt;
    }
  };

  const parseDate = (value, endOfDay = false) => {
    if (!value) return null;
    const parts = String(value).split('-').map(Number);
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      const [year, month, day] = parts;
      return endOfDay
        ? new Date(year, month - 1, day, 23, 59, 59, 999)
        : new Date(year, month - 1, day);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const getMonthLabel = (value) => {
    const date = parseDate(value);
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const isWithinRange = (now, start, end) => {
    const startDate = parseDate(start);
    const endDate = parseDate(end, true);
    if (!startDate || !endDate) return false;
    return now >= startDate && now <= endDate;
  };

  const selectFeaturedPotter = (data) => {
    if (!data) return { potter: {}, pieces: [], archive: [] };
    if (Array.isArray(data.potters) && data.potters.length) {
      const now = new Date();
      let featured = data.potters.find((potter) => isWithinRange(now, potter.start, potter.end)) || null;
      const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!featured && data.rotateMonthly) {
        featured = data.potters.find((potter) => potter.month === monthLabel) || null;
      }
      if (!featured) {
        featured = data.potters.find((potter) => potter.featured) || data.potters[0];
      }
      const archive = data.potters.filter((potter) => potter !== featured);
      const upcoming = data.potters
        .filter((potter) => potter.start && parseDate(potter.start) && parseDate(potter.start) > now)
        .sort((a, b) => parseDate(a.start) - parseDate(b.start))[0];
      return { potter: featured, pieces: featured.pieces || [], archive, upcoming };
    }
    return { potter: data.potter || {}, pieces: data.featuredPieces || [], archive: [], upcoming: null };
  };

  const updateHighlights = (data) => {
    if (!data) return;

    const { potter, pieces, archive, upcoming } = selectFeaturedPotter(data);
    const scheduledMonth = potter.month || getMonthLabel(potter.start) || data.month;
    setText('[data-highlight-month]', scheduledMonth);
    setText('[data-highlight-name]', potter.name);
    setText('[data-highlight-bio]', potter.bio);
    setText('[data-highlight-focus]', potter.focus);
    setText('[data-highlight-clay]', potter.clayBody);
    setText('[data-highlight-location]', potter.location);
    setImage('[data-highlight-image]', potter.image, potter.imageAlt || `Work by ${potter.name || 'featured potter'}`);

    const handleEl = document.querySelector('[data-highlight-handle]');
    if (handleEl) {
      if (potter.instagram) {
        const handle = potter.instagram.startsWith('@') ? potter.instagram : `@${potter.instagram}`;
        handleEl.textContent = handle;
        const handleValue = handle.replace('@', '');
        handleEl.href = potter.instagramUrl || `https://instagram.com/${handleValue}`;
        handleEl.style.display = '';
      } else {
        handleEl.style.display = 'none';
      }
    }

    const grid = document.querySelector('[data-highlight-grid]');
    if (grid && Array.isArray(pieces) && pieces.length) {
      grid.innerHTML = pieces
        .map((piece) => {
          const caption = piece.caption ? `<figcaption>${piece.caption}</figcaption>` : '';
          const alt = piece.alt || piece.caption || 'Featured work';
          return `
            <figure>
              <img src="${piece.image}" alt="${alt}" />
              ${caption}
            </figure>
          `;
        })
        .join('');
    }

    const archiveList = document.querySelector('[data-archive-list]');
    if (archiveList && Array.isArray(archive) && archive.length) {
      archiveList.innerHTML = archive
        .map((item) => {
          const focus = item.focus ? ` · ${item.focus}` : '';
          const location = item.location ? ` · ${item.location}` : '';
          const monthLabel = item.month || getMonthLabel(item.start) || 'Previous feature';
          return `
            <li class="archive-card">
              <span>${monthLabel}</span>
              <strong>${item.name || 'Featured potter'}</strong>
              <p>${focus}${location}</p>
            </li>
          `;
        })
        .join('');
    }

    const nextUp = document.querySelector('[data-next-up]');
    if (nextUp) {
      const labelEl = document.querySelector('[data-next-up-label]');
      if (upcoming) {
        const monthLabel = upcoming.month || getMonthLabel(upcoming.start) || 'Upcoming';
        const meta = `${upcoming.focus ? upcoming.focus : 'Pottery'}${upcoming.location ? ` · ${upcoming.location}` : ''}`;
        setText('[data-next-up-month]', monthLabel);
        setText('[data-next-up-name]', upcoming.name || 'Upcoming potter');
        setText('[data-next-up-meta]', meta);
        setImage('[data-next-up-image]', upcoming.image || '/assets/images/finished-work.jpg', upcoming.imageAlt || `Work by ${upcoming.name || 'upcoming potter'}`);
        if (labelEl) {
          labelEl.textContent = monthLabel;
        }
      } else {
        setText('[data-next-up-month]', 'Upcoming');
        setText('[data-next-up-name]', 'To be announced');
        setText('[data-next-up-meta]', 'Schedule a feature through the portal.');
        setImage('[data-next-up-image]', '/assets/images/finished-work.jpg', 'Upcoming potter work');
        if (labelEl) {
          labelEl.textContent = 'Next up';
        }
      }
    }

    const form = document.querySelector('[data-nomination-form]');
    if (form && data.nominationEmail) {
      form.dataset.email = data.nominationEmail;
    }
  };

  const bindNominationForm = () => {
    const form = document.querySelector('[data-nomination-form]');
    if (!form) return;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = data.get('name') || '';
      const email = data.get('email') || '';
      const potter = data.get('potter') || '';
      const links = data.get('links') || '';
      const note = data.get('note') || '';
      const body = `Name: ${name}\nEmail: ${email}\nPotter: ${potter}\nLinks: ${links}\n\nWhy: ${note}`;
      const subject = 'Potter of the Month Nomination';
      const recipient = form.dataset.email || 'support@monsoonfire.com';
      window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  };

  fetch('/data/highlights.json', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then(updateHighlights)
    .catch(() => {});

  bindNominationForm();
})();
