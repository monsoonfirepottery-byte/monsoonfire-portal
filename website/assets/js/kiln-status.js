(() => {
  const list = document.querySelector('[data-kiln-list]');
  const updated = document.querySelector('[data-kiln-updated]');
  if (!list) return;
  const STALE_AFTER_DAYS = 14;

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

  const renderStatusSummary = (kind, title, message) => {
    const summary = document.createElement('div');
    summary.className = 'kiln-info';

    const label = document.createElement('div');
    label.className = 'status-label';
    label.textContent = 'Board status';

    const pill = document.createElement('span');
    pill.className = `status-pill ${kind}`;
    pill.textContent = title;

    const note = document.createElement('div');
    note.className = 'kiln-notes';
    note.textContent = message;

    summary.append(label, pill, note);
    return summary;
  };

  const parseUpdatedAt = (data) => {
    const candidate = typeof data?.lastUpdatedIso === 'string' && data.lastUpdatedIso.trim()
      ? data.lastUpdatedIso
      : typeof data?.lastUpdated === 'string'
        ? data.lastUpdated
        : '';
    const parsed = candidate ? new Date(candidate) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  };

  const describeFreshness = (updatedAt) => {
    if (!updatedAt) {
      return {
        kind: 'state-offline',
        title: 'Manual board unavailable',
        message: 'The studio board did not include a usable timestamp, so treat this as a stale snapshot and check the portal for the live workflow.',
      };
    }

    const ageDays = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_AFTER_DAYS) {
      return {
        kind: 'state-offline',
        title: 'Manual board is stale',
        message: `The latest manual refresh is more than ${STALE_AFTER_DAYS} days old. Use the portal for the current queue and keep this page as a calm reference only.`,
      };
    }

    return {
      kind: 'state-idle',
      title: 'Manual board current',
      message: 'The studio board is in sync with the latest manual update.',
    };
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
    setEmptyState('Syncing kiln board. The latest manual status will appear here once it finishes loading.');

    const candidates = [
      '/data/kiln-status.json',
      '/api/websiteKilnBoard',
    ];

    try {
      let data = null;
      let lastError = null;
      let lastTriedEndpoint = null;
      for (const endpoint of candidates) {
        try {
          const response = await fetch(endpoint, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          data = await response.json();
          if (!data || !Array.isArray(data.kilns)) {
            throw new Error("Malformed kiln payload");
          }
          lastTriedEndpoint = endpoint;
          break;
        } catch (err) {
          lastTriedEndpoint = endpoint;
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      if (!data) {
        throw new Error(`${lastTriedEndpoint ?? 'none'}: ${lastError ?? "unavailable"}`);
      }

      list.replaceChildren();
      const kilnItems = Array.isArray(data?.kilns) ? data.kilns : [];
      if (kilnItems.length > 0) {
        const freshness = describeFreshness(parseUpdatedAt(data));
        const nodes = [renderStatusSummary(freshness.kind, freshness.title, freshness.message)];
        kilnItems.forEach((kiln) => {
          nodes.push(renderKiln(kiln));
        });
        list.replaceChildren(...nodes);
      } else {
        list.replaceChildren(
          renderStatusSummary(
            'state-offline',
            'Manual board empty',
            'No kiln loads are posted yet. The portal remains the source of truth for reservations, queue timing, and pickup readiness.'
          )
        );
      }

      if (updated && data?.lastUpdated) {
        updated.textContent = String(data.lastUpdated);
      }
    } catch (_err) {
      const message = _err instanceof Error ? _err.message : String(_err);
      list.replaceChildren(
        renderStatusSummary(
          'state-offline',
          'Manual board unavailable',
          `The studio status feed could not be loaded. ${message} Check the portal for the live operating view.`
        )
      );
      if (updated) {
        updated.textContent = 'Unavailable';
      }
    }
  };

  load();
})();
