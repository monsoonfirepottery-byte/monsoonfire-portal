"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderKilnCommandPage = renderKilnCommandPage;
const queueOptions = [
    { value: "intake", label: "Intake" },
    { value: "staged", label: "Staged" },
    { value: "ready_for_program", label: "Ready for program" },
    { value: "ready_for_start", label: "Ready for local start" },
    { value: "firing", label: "Firing" },
    { value: "cooling", label: "Cooling" },
    { value: "ready_for_unload", label: "Ready for unload" },
    { value: "complete", label: "Complete" },
    { value: "exception", label: "Exception" },
];
function esc(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
function jsonScript(value) {
    return JSON.stringify(value)
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("&", "\\u0026");
}
function formatTemp(value) {
    return value === null ? "n/a" : `${Math.round(value)}°F`;
}
function formatDuration(seconds) {
    if (seconds === null)
        return "n/a";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours <= 0)
        return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}
function formatNumber(value, digits = 2) {
    return value === null ? "unknown" : value.toFixed(digits);
}
function formatTimestamp(value) {
    if (!value)
        return "n/a";
    const ms = Date.parse(value);
    if (!Number.isFinite(ms))
        return value;
    return new Date(ms).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
function selectedQueueOption(value) {
    return queueOptions
        .map((option) => `<option value="${esc(option.value)}"${option.value === value ? " selected" : ""}>${esc(option.label)}</option>`)
        .join("");
}
function renderTelemetryTail(model) {
    if (!model.currentRunTelemetry.length) {
        return "<li>No telemetry captured for the current run yet.</li>";
    }
    return model.currentRunTelemetry
        .slice(-4)
        .map((point) => `<li>${esc(formatTimestamp(point.ts))} · primary ${esc(formatTemp(point.tempPrimary))} · set ${esc(formatTemp(point.setPoint))} · seg ${esc(point.segment ?? "n/a")}</li>`)
        .join("");
}
function renderCurrentRunEvents(model) {
    if (!model.currentRunEvents.length) {
        return "<li>No current-run events captured yet.</li>";
    }
    return model.currentRunEvents
        .slice(-6)
        .map((event) => `<li>${esc(formatTimestamp(event.ts))} · ${esc(event.eventType)} · ${esc(event.severity)} · ${esc(event.confidence)}</li>`)
        .join("");
}
function renderRecentActions(model) {
    if (!model.recentOperatorActions.length) {
        return "<li>No operator acknowledgements recorded yet.</li>";
    }
    return model.recentOperatorActions
        .slice(0, 6)
        .map((action) => `<li>${esc(action.actionType)} · ${esc(formatTimestamp(action.completedAt ?? action.requestedAt))} · ${esc(action.notes ?? "Recorded without notes.")}</li>`)
        .join("");
}
function renderArtifacts(model) {
    if (!model.recentArtifacts.length) {
        return "<li>No raw artifacts stored yet.</li>";
    }
    return model.recentArtifacts
        .slice(0, 6)
        .map((artifact) => `<li><a href="/api/kiln/artifacts/${encodeURIComponent(artifact.id)}/content">${esc(artifact.filename)}</a> · ${esc(artifact.sourceLabel ?? artifact.artifactKind)} · ${esc(formatTimestamp(artifact.observedAt))}</li>`)
        .join("");
}
function renderRequiredActions(model) {
    if (!model.requiredActions.length) {
        return "<li>No immediate human checkpoints recorded for this kiln.</li>";
    }
    return model.requiredActions
        .slice(0, 6)
        .map((action) => `<li>${esc(action.actionType)} · ${esc(action.notes ?? "Operator acknowledgement required.")}</li>`)
        .join("");
}
function renderQuickActionButtons(model) {
    const runId = model.currentRun?.id ?? "";
    const runDisabled = runId ? "" : " disabled";
    return [
        { actionType: "loaded_kiln", label: "Record load", runScoped: true },
        { actionType: "verified_clearance", label: "Record clearance", runScoped: true },
        { actionType: "pressed_start", label: "Record local Start pressed", runScoped: true },
        { actionType: "opened_kiln", label: "Record kiln opened", runScoped: true },
        { actionType: "completed_unload", label: "Record unload complete", runScoped: true },
    ]
        .map((action) => `<button type="button" class="button"${action.runScoped ? runDisabled : ""} data-quick-action="${esc(action.actionType)}" data-kiln-id="${esc(model.kiln?.id ?? "")}" data-run-id="${esc(runId)}">${esc(action.label)}</button>`)
        .join("");
}
function renderKilnCommandPage(model) {
    const cards = model.kilnDetails
        .map((detail) => {
        const run = detail.currentRun;
        return `
      <article class="kiln-card">
        <div class="kiln-card__head">
          <div>
            <h2>${esc(detail.kiln?.displayName ?? "Unknown kiln")}</h2>
            <p>${esc(run ? `${run.status} · ${run.queueState}` : "No active run")} · ${esc(detail.kiln?.kilnModel ?? "Unknown model")}</p>
          </div>
          <span class="badge badge--posture">${esc(model.overview.kilns.find((entry) => entry.kilnId === detail.kiln?.id)?.controlPosture ?? "Observed only")}</span>
        </div>

        <dl class="stats">
          <div><dt>Current temp</dt><dd>${esc(formatTemp(model.overview.kilns.find((entry) => entry.kilnId === detail.kiln?.id)?.currentTemp ?? null))}</dd></div>
          <div><dt>Set point</dt><dd>${esc(formatTemp(model.overview.kilns.find((entry) => entry.kilnId === detail.kiln?.id)?.setPoint ?? run?.finalSetPoint ?? null))}</dd></div>
          <div><dt>Segment</dt><dd>${esc(model.overview.kilns.find((entry) => entry.kilnId === detail.kiln?.id)?.segment ?? run?.currentSegment ?? "n/a")}</dd></div>
          <div><dt>Zone spread</dt><dd>${esc(model.overview.kilns.find((entry) => entry.kilnId === detail.kiln?.id)?.zoneSpread === null ? "n/a" : `${Math.round(model.overview.kilns.find((entry) => entry.kilnId === detail.kiln?.id)?.zoneSpread ?? 0)}°F`)}</dd></div>
          <div><dt>Program</dt><dd>${esc(run?.programName ?? "None queued")}</dd></div>
          <div><dt>Running</dt><dd>${esc(formatDuration(model.overview.kilns.find((entry) => entry.kilnId === detail.kiln?.id)?.timeRunningSec ?? null))}</dd></div>
          <div><dt>Firmware</dt><dd>${esc(detail.kiln?.firmwareVersion ?? "unknown")}</dd></div>
          <div><dt>Zones</dt><dd>${esc(detail.kiln?.zoneCount ?? "n/a")}</dd></div>
        </dl>

        <p class="control-note">Buttons below record operator acknowledgements inside Studio Brain. They do not send controller commands to Genesis.</p>

        <div class="button-row">
          ${renderQuickActionButtons(detail)}
        </div>

        <form class="subpanel" data-custom-action-form data-kiln-id="${esc(detail.kiln?.id ?? "")}" data-run-id="${esc(run?.id ?? "")}">
          <h3>Log note, maintenance, or exception</h3>
          <div class="field-grid">
            <label>
              <span>Action</span>
              <select name="actionType">
                <option value="manual_note">Manual note</option>
                <option value="observed_error_code">Observed error code</option>
                <option value="relay_replaced">Relay replaced</option>
                <option value="thermocouple_replaced">Thermocouple replaced</option>
              </select>
            </label>
            <label class="field--wide">
              <span>Notes</span>
              <textarea name="notes" rows="3" placeholder="Observed code, maintenance detail, or operator note"></textarea>
            </label>
          </div>
          <button type="submit" class="button button--secondary">Record action</button>
        </form>

        <div class="subpanel-grid">
          <section class="subpanel">
            <h3>Current run</h3>
            <ul>
              <li>Run ID: ${esc(run?.id ?? "none")}</li>
              <li>Status: ${esc(run?.status ?? "idle")}</li>
              <li>Queue state: ${esc(run?.queueState ?? "idle")}</li>
              <li>Local acknowledgement: ${esc(formatTimestamp(run?.operatorConfirmationAt ?? null))}</li>
            </ul>
          </section>
          <section class="subpanel">
            <h3>Required operator actions</h3>
            <ul>${renderRequiredActions(detail)}</ul>
          </section>
          <section class="subpanel">
            <h3>Telemetry tail</h3>
            <ul>${renderTelemetryTail(detail)}</ul>
          </section>
          <section class="subpanel">
            <h3>Current run events</h3>
            <ul>${renderCurrentRunEvents(detail)}</ul>
          </section>
          <section class="subpanel">
            <h3>Recent operator actions</h3>
            <ul>${renderRecentActions(detail)}</ul>
          </section>
          <section class="subpanel">
            <h3>Raw evidence</h3>
            <ul>${renderArtifacts(detail)}</ul>
          </section>
          <section class="subpanel">
            <h3>Health summary</h3>
            <ul>
              <li>Relay health: ${esc(detail.healthSnapshot?.relayHealth ?? "unknown")}</li>
              <li>Zone imbalance: ${esc(formatNumber(detail.healthSnapshot?.zoneImbalanceScore ?? null))}</li>
              <li>Thermocouple drift: ${esc(detail.healthSnapshot?.thermocoupleDriftEstimate === null || detail.healthSnapshot?.thermocoupleDriftEstimate === undefined ? "unknown" : `${detail.healthSnapshot.thermocoupleDriftEstimate.toFixed(1)}°F`)}</li>
              <li>Warnings: ${esc((detail.healthSnapshot?.warnings ?? []).join(" | ") || "No active warnings.")}</li>
            </ul>
          </section>
          <section class="subpanel">
            <h3>Recent runs</h3>
            <ul>
              ${detail.recentRuns.length
            ? detail.recentRuns
                .slice(0, 6)
                .map((recentRun) => `<li>${esc(recentRun.programName ?? "Program")} · ${esc(recentRun.status)} · ${esc(recentRun.queueState)} · ${esc(formatTimestamp(recentRun.startTime))}</li>`)
                .join("")
            : "<li>No firing history captured yet.</li>"}
            </ul>
          </section>
        </div>
      </article>`;
    })
        .join("");
    const requiredActions = model.overview.requiredOperatorActions
        .map((action) => `<li><strong>${esc(action.actionType)}</strong> · kiln ${esc(action.kilnId)} · ${esc(action.notes ?? "Operator acknowledgement required.")}</li>`)
        .join("");
    const recentFirings = model.overview.recentFirings
        .map((run) => `<li>${esc(run.programName ?? "Program")} · ${esc(run.status)} · ${esc(run.queueState)} · kiln ${esc(run.kilnId)}</li>`)
        .join("");
    const maintenanceFlags = model.overview.maintenanceFlags
        .map((entry) => `<li>${esc(entry.kilnId)} · ${esc(entry.warnings.join(" | ") || entry.confidenceNotes.join(" | ") || "No current maintenance warnings.")}</li>`)
        .join("");
    const initialJson = jsonScript(model);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Kiln Command</title>
    <style>
      :root { color-scheme: light; --bg: #f4ead6; --ink: #1b1a17; --muted: #5d5649; --panel: rgba(255,255,255,0.78); --line: rgba(58,47,34,0.18); --warn: #9f4d34; --accent: #214d42; --accent-2: #8f6936; }
      body { margin: 0; font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif; background: radial-gradient(circle at top, #f7f0e0, #ead9b8 55%, #dcc49d); color: var(--ink); }
      main { max-width: 1320px; margin: 0 auto; padding: 24px; }
      .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
      .hero h1 { margin: 0 0 8px; font-size: 2.3rem; }
      .hero p { margin: 0; color: var(--muted); max-width: 760px; }
      .hero__stats { display: grid; grid-template-columns: repeat(3, minmax(110px, 1fr)); gap: 12px; width: min(380px, 100%); }
      .hero__stats article, .panel, .kiln-card, .subpanel { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 14px 32px rgba(70,53,29,0.12); backdrop-filter: blur(8px); }
      .hero__stats article { padding: 14px 16px; }
      .hero__stats dt { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; }
      .hero__stats dd { margin: 8px 0 0; font-size: 1.4rem; font-weight: 700; }
      .ops-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
      .panel, .kiln-card, .subpanel { padding: 18px; }
      .panel h2, .kiln-card h2, .subpanel h3, section h2 { margin: 0 0 12px; }
      .panel p, .subpanel p { margin: 0 0 12px; color: var(--muted); }
      .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .field-grid label, .stack label { display: grid; gap: 6px; }
      .field--wide { grid-column: 1 / -1; }
      .stack { display: grid; gap: 12px; }
      input, select, textarea, button { font: inherit; }
      input, select, textarea { width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid rgba(58,47,34,0.24); background: rgba(255,255,255,0.88); padding: 10px 12px; color: var(--ink); }
      textarea { resize: vertical; min-height: 84px; }
      .button, button { border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer; background: var(--accent); color: #f6f0e6; font-weight: 700; }
      .button[disabled], button[disabled] { cursor: not-allowed; opacity: 0.45; }
      .button--secondary { background: rgba(33,77,66,0.12); color: var(--accent); border: 1px solid rgba(33,77,66,0.24); }
      .button--ghost { background: rgba(143,105,54,0.12); color: #5d4020; border: 1px solid rgba(143,105,54,0.22); }
      .button-row, .pill-row, .toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
      .toolbar { margin-top: 16px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
      .kiln-card { display: grid; gap: 16px; }
      .kiln-card__head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .kiln-card__head h2 { margin: 0 0 4px; font-size: 1.35rem; }
      .kiln-card__head p { margin: 0; color: var(--muted); }
      .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; }
      .stats dt { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
      .stats dd { margin: 4px 0 0; font-weight: 700; }
      .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; background: rgba(33,77,66,0.1); color: var(--accent); font-size: 0.8rem; font-weight: 700; border: 1px solid rgba(33,77,66,0.2); }
      .badge--warn { background: rgba(159,77,52,0.12); color: var(--warn); border-color: rgba(159,77,52,0.24); }
      .badge--posture { white-space: nowrap; }
      .subpanel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
      ul { margin: 0; padding-left: 18px; }
      li { margin: 6px 0; }
      .meta, .control-note { color: var(--muted); font-size: 0.92rem; }
      .ops-message { margin-bottom: 16px; padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(33,77,66,0.2); background: rgba(255,255,255,0.68); display: none; }
      .ops-message[data-state="success"] { display: block; border-color: rgba(33,77,66,0.24); color: var(--accent); }
      .ops-message[data-state="error"] { display: block; border-color: rgba(159,77,52,0.28); color: var(--warn); }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      section { margin-top: 24px; }
      @media (max-width: 900px) { .hero { flex-direction: column; } .hero__stats { width: 100%; } .field-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <div>
          <h1>Kiln Command</h1>
          <p>Studio Brain is operating as an overlay plane. Genesis remains the control authority; this surface helps staff stage runs, record local actions, import evidence, and supervise the firing workflow without implying unsupported remote writes.</p>
          <p class="meta">Last refreshed ${esc(model.generatedAt)}</p>
          <div class="toolbar">
            <button type="button" class="button button--ghost" id="refresh-surface">Refresh surface</button>
          </div>
        </div>
        <dl class="hero__stats">
          <article><dt>Kilns</dt><dd id="stat-kilns">${esc(model.overview.fleet.kilnCount)}</dd></article>
          <article><dt>Active runs</dt><dd id="stat-active">${esc(model.overview.fleet.activeRuns)}</dd></article>
          <article><dt>Attention</dt><dd id="stat-attention">${esc(model.overview.fleet.attentionCount)}</dd></article>
        </dl>
      </header>

      <div class="ops-message" id="ops-message"></div>

      <section>
        <h2>Control desk</h2>
        <div class="ops-grid">
          <form class="panel stack" id="create-run-form">
            <div>
              <h2>Stage a firing run</h2>
              <p>Create queue state and job context here, then have the operator load and start the kiln locally at Genesis.</p>
            </div>
            <div class="field-grid">
              <label>
                <span>Kiln</span>
                <select name="kilnId" required>
                  <option value="">Select kiln</option>
                  ${model.kilnDetails
        .map((detail) => `<option value="${esc(detail.kiln?.id ?? "")}">${esc(detail.kiln?.displayName ?? "Unknown kiln")}</option>`)
        .join("")}
                </select>
              </label>
              <label>
                <span>Queue state</span>
                <select name="queueState">${selectedQueueOption("ready_for_program")}</select>
              </label>
              <label>
                <span>Program name</span>
                <input name="programName" placeholder="Cone 6 Glaze" />
              </label>
              <label>
                <span>Program type</span>
                <input name="programType" placeholder="glaze, bisque, luster" />
              </label>
              <label>
                <span>Cone target</span>
                <input name="coneTarget" placeholder="6" />
              </label>
              <label>
                <span>Speed</span>
                <input name="speed" placeholder="slow, medium, fast" />
              </label>
            </div>
            <button type="submit">Create staged run</button>
          </form>

          <form class="panel stack" id="upload-log-form">
            <div>
              <h2>Import Genesis evidence</h2>
              <p>Upload an exported Genesis log. Raw bytes are preserved before normalization. Upload limit: ${esc(Math.round(model.uploadMaxBytes / 1024))} KB.</p>
            </div>
            <div class="field-grid">
              <label>
                <span>Kiln override</span>
                <select name="kilnId">
                  <option value="">Auto-detect from log</option>
                  ${model.kilnDetails
        .map((detail) => `<option value="${esc(detail.kiln?.id ?? "")}">${esc(detail.kiln?.displayName ?? "Unknown kiln")}</option>`)
        .join("")}
                </select>
              </label>
              <label>
                <span>Source label</span>
                <input name="sourceLabel" value="operator_upload" />
              </label>
              <label class="field--wide">
                <span>Genesis log file</span>
                <input type="file" name="artifact" accept=".txt,.log,.json,text/plain,application/json" required />
              </label>
            </div>
            <button type="submit">Import log and refresh</button>
          </form>
        </div>
      </section>

      <section>
        <h2>Fleet command surface</h2>
        <div class="grid">${cards || '<div class="panel"><p>No kilns have been registered yet. Import a Genesis log or add a run once a kiln exists in the overlay store.</p></div>'}</div>
      </section>

      <section>
        <h2>Cross-kiln checkpoints</h2>
        <div class="ops-grid">
          <div class="panel"><ul id="required-actions">${requiredActions || "<li>No pending operator actions.</li>"}</ul></div>
          <div class="panel"><ul id="recent-firings">${recentFirings || "<li>No firing history yet.</li>"}</ul></div>
          <div class="panel"><ul id="maintenance-flags">${maintenanceFlags || "<li>No current maintenance flags.</li>"}</ul></div>
        </div>
      </section>
    </main>
    <script id="kiln-command-model" type="application/json">${initialJson}</script>
    <script>
      const model = JSON.parse(document.getElementById("kiln-command-model").textContent || "{}");
      const messageEl = document.getElementById("ops-message");

      function showMessage(text, state) {
        messageEl.textContent = text;
        messageEl.dataset.state = state;
      }

      async function postJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {}
        if (!response.ok || !payload || payload.ok !== true) {
          throw new Error(payload && payload.message ? payload.message : "Request failed.");
        }
        return payload;
      }

      function reloadSoon(message) {
        showMessage(message, "success");
        window.setTimeout(() => window.location.reload(), 600);
      }

      function setPending(target, pending) {
        if (!target) return;
        if ("disabled" in target) {
          target.disabled = pending;
        }
      }

      async function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = "";
        for (let index = 0; index < bytes.length; index += chunkSize) {
          const chunk = bytes.subarray(index, index + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
      }

      document.getElementById("refresh-surface").addEventListener("click", () => window.location.reload());

      document.getElementById("create-run-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submitter = form.querySelector('button[type="submit"]');
        setPending(submitter, true);
        showMessage("Creating staged run...", "success");
        try {
          const data = new FormData(form);
          await postJson("/api/kiln/runs", {
            kilnId: data.get("kilnId"),
            queueState: data.get("queueState"),
            programName: data.get("programName"),
            programType: data.get("programType"),
            coneTarget: data.get("coneTarget"),
            speed: data.get("speed"),
          });
          reloadSoon("Staged run created. Genesis still needs a local operator start.");
        } catch (error) {
          showMessage(error instanceof Error ? error.message : String(error), "error");
        } finally {
          setPending(submitter, false);
        }
      });

      document.getElementById("upload-log-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submitter = form.querySelector('button[type="submit"]');
        setPending(submitter, true);
        showMessage("Uploading Genesis log...", "success");
        try {
          const data = new FormData(form);
          const file = data.get("artifact");
          if (!(file instanceof File)) {
            throw new Error("Select a Genesis log file first.");
          }
          const contentBase64 = await arrayBufferToBase64(await file.arrayBuffer());
          await postJson("/api/kiln/imports/genesis", {
            kilnId: data.get("kilnId") || undefined,
            filename: file.name,
            contentType: file.type || "text/plain",
            contentBase64,
            sourceLabel: data.get("sourceLabel"),
          });
          reloadSoon("Genesis evidence imported.");
        } catch (error) {
          showMessage(error instanceof Error ? error.message : String(error), "error");
        } finally {
          setPending(submitter, false);
        }
      });

      document.querySelectorAll("[data-quick-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          const actionType = button.getAttribute("data-quick-action");
          const kilnId = button.getAttribute("data-kiln-id");
          const runId = button.getAttribute("data-run-id");
          if (!actionType || !kilnId) return;
          setPending(button, true);
          showMessage("Recording operator acknowledgement...", "success");
          try {
            const body = runId
              ? { actionType }
              : { kilnId, actionType };
            const url = runId
              ? "/api/kiln/runs/" + encodeURIComponent(runId) + "/ack"
              : "/api/kiln/operator-actions";
            await postJson(url, body);
            reloadSoon("Operator acknowledgement recorded.");
          } catch (error) {
            showMessage(error instanceof Error ? error.message : String(error), "error");
          } finally {
            setPending(button, false);
          }
        });
      });

      document.querySelectorAll("[data-custom-action-form]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const submitter = form.querySelector('button[type="submit"]');
          setPending(submitter, true);
          showMessage("Recording action...", "success");
          try {
            const data = new FormData(form);
            const kilnId = form.getAttribute("data-kiln-id");
            const runId = form.getAttribute("data-run-id");
            const body = {
              kilnId,
              firingRunId: runId || undefined,
              actionType: data.get("actionType"),
              notes: data.get("notes"),
            };
            const url = runId
              ? "/api/kiln/runs/" + encodeURIComponent(runId) + "/ack"
              : "/api/kiln/operator-actions";
            await postJson(url, body);
            reloadSoon("Kiln action recorded.");
          } catch (error) {
            showMessage(error instanceof Error ? error.message : String(error), "error");
          } finally {
            setPending(submitter, false);
          }
        });
      });
    </script>
  </body>
</html>`;
}
