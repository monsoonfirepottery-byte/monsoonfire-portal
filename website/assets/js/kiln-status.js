(() => {
  const list = document.querySelector('[data-kiln-list]');
  const updated = document.querySelector('[data-kiln-updated]');
  if (!list) return;

  const renderFieldRow = (label, value, parent) => {
    const row = document.createElement('div');
    row.className = 'kiln-detail';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;

    const valueEl = document.createElement('strong');
    valueEl.textContent = value;

    row.append(labelEl, valueEl);
    parent.appendChild(row);
  };

  const renderKiln = (kiln) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'kiln-info';

    const name = typeof kiln?.name === 'string' && kiln.name.trim() ? kiln.name : 'Kiln';
    const controller = typeof kiln?.controller === 'string' && kiln.controller.trim() ? kiln.controller : '—';
    const nextFireType = typeof kiln?.nextFireType === 'string' && kiln.nextFireType.trim() ? kiln.nextFireType : '—';
    const planned = typeof kiln?.nextFirePlanned === 'string' && kiln.nextFirePlanned.trim() ? kiln.nextFirePlanned : '—';
    const ready = typeof kiln?.readyForPickup === 'string' && kiln.readyForPickup.trim() ? kiln.readyForPickup : '—';
    const notes = typeof kiln?.notes === 'string' && kiln.notes.trim() ? kiln.notes : '';

    const nameEl = document.createElement('div');
    nameEl.className = 'kiln-name';
    nameEl.textContent = name;
    wrapper.appendChild(nameEl);

    renderFieldRow('Controller', controller, wrapper);
    renderFieldRow('Next fire', nextFireType, wrapper);
    renderFieldRow('Planned', planned, wrapper);
    renderFieldRow('Ready for pickup', ready, wrapper);

    if (notes) {
      const notesEl = document.createElement('div');
      notesEl.className = 'kiln-notes';
      notesEl.textContent = notes;
      wrapper.appendChild(notesEl);
    }

    return wrapper;
  };

  const setEmptyState = (message) => {
    list.replaceChildren();
    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    list.appendChild(messageEl);
  };

  const load = async () => {
    try {
      const res = await fetch('/data/kiln-status.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Kiln status not available');
      const data = await res.json();

      list.replaceChildren();
      const kilnItems = Array.isArray(data?.kilns) ? data.kilns : [];
      if (kilnItems.length > 0) {
        kilnItems.forEach((kiln) => {
          list.appendChild(renderKiln(kiln));
        });
      } else {
        setEmptyState('Manual status is not set yet.');
      }

      if (updated && data?.lastUpdated) {
        updated.textContent = String(data.lastUpdated);
      }
    } catch (_err) {
      setEmptyState('Manual status is currently unavailable.');
    }
  };

  load();
})();
