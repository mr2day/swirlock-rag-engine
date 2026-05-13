export const devRetrievalPageHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Swirlock RAG Engine — v4 Retrieval Test</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1216;
        --panel: #181c22;
        --panel-elevated: #1f242d;
        --panel-muted: #252b36;
        --border: #313846;
        --border-strong: #40495b;
        --text: #d4d4d4;
        --muted: #9ca3af;
        --heading: #f3f4f6;
        --accent: #0e639c;
        --accent-hover: #1177bb;
        --accent-soft: rgba(14, 99, 156, 0.16);
        --success: #89d185;
        --danger: #f48771;
        --warning: #d7ba7d;
        --shadow: rgba(0, 0, 0, 0.34);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", system-ui, sans-serif;
        background: linear-gradient(180deg, #0f1216 0%, var(--bg) 100%);
        color: var(--text);
        display: flex;
        justify-content: center;
      }
      .page {
        width: min(96vw, 1100px);
        margin: 0;
        padding: 1rem 0 2rem;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        box-shadow: 0 16px 40px var(--shadow);
        margin-bottom: 1rem;
        overflow: hidden;
      }
      .hero {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        justify-content: space-between;
        padding: 1.1rem 1.2rem;
        border-bottom: 1px solid var(--border);
      }
      h1 {
        margin: 0;
        color: var(--heading);
        font-size: 1.35rem;
        letter-spacing: -0.01em;
      }
      .subtitle {
        margin: 0.2rem 0 0;
        color: var(--muted);
        font-size: 0.85rem;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.7rem;
        border: 1px solid var(--border-strong);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.03);
        color: #c8d1dc;
        font-size: 0.8rem;
      }
      .badge .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--muted);
        transition: background 0.2s;
      }
      .badge.connected .dot { background: var(--success); box-shadow: 0 0 0 3px rgba(137, 209, 133, 0.18); }
      .badge.connecting .dot { background: var(--warning); }
      .badge.error .dot { background: var(--danger); }
      .content { padding: 1rem 1.2rem; display: grid; gap: 1rem; }
      label.field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.85rem;
        color: var(--muted);
      }
      input[type="text"], textarea, select {
        background: var(--panel-muted);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.6rem 0.75rem;
        color: var(--text);
        font: inherit;
      }
      textarea {
        resize: vertical;
        min-height: 5rem;
        font-family: inherit;
      }
      input[type="number"] {
        width: 5.5rem;
        background: var(--panel-muted);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.55rem 0.7rem;
        color: var(--text);
        font: inherit;
      }
      .controls-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.85rem;
        align-items: end;
      }
      .controls-row > * { min-width: 0; }
      .checkboxes {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        align-items: center;
      }
      .checkboxes label {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.65rem;
        background: var(--panel-muted);
        border: 1px solid var(--border);
        border-radius: 8px;
        font-size: 0.85rem;
        color: var(--text);
        cursor: pointer;
        user-select: none;
      }
      .checkboxes input { accent-color: var(--accent); }
      button.primary {
        background: var(--accent);
        color: #fff;
        border: none;
        padding: 0.65rem 1.1rem;
        font: inherit;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
      }
      button.primary:hover:not(:disabled) { background: var(--accent-hover); }
      button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
      button.ghost {
        background: transparent;
        border: 1px solid var(--border-strong);
        color: var(--text);
        padding: 0.55rem 0.9rem;
        border-radius: 8px;
        font: inherit;
        cursor: pointer;
      }
      button.ghost:hover { background: var(--panel-muted); }
      .section-title {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin: 0;
      }
      .phases ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
      .phase-row {
        display: grid;
        grid-template-columns: 1.4rem 1fr auto;
        align-items: center;
        gap: 0.55rem;
        padding: 0.45rem 0.65rem;
        background: var(--panel-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        font-size: 0.88rem;
      }
      .phase-row.running { border-color: var(--warning); }
      .phase-row.done { border-color: rgba(137, 209, 133, 0.4); }
      .phase-row.failed { border-color: var(--danger); }
      .phase-icon { font-size: 1rem; }
      .phase-label { color: var(--text); }
      .phase-meta { color: var(--muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
      .evidence-grid { display: grid; gap: 0.6rem; }
      .evidence-card {
        background: var(--panel-elevated);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.75rem 0.85rem;
      }
      .evidence-card-head {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.4rem;
      }
      .evidence-title {
        font-weight: 600;
        color: var(--heading);
      }
      .evidence-title a { color: inherit; text-decoration: none; border-bottom: 1px dashed rgba(255, 255, 255, 0.2); }
      .evidence-title a:hover { border-bottom-color: var(--accent-hover); }
      .evidence-meta { color: var(--muted); font-size: 0.78rem; }
      .evidence-body {
        white-space: pre-wrap;
        color: var(--text);
        font-size: 0.86rem;
        line-height: 1.45;
        max-height: 14rem;
        overflow: auto;
      }
      .raw-log {
        background: #0a0d12;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 0.75rem;
        font-family: "Cascadia Code", Consolas, monospace;
        font-size: 0.78rem;
        white-space: pre-wrap;
        max-height: 20rem;
        overflow: auto;
        color: #c5cad3;
      }
      details > summary {
        cursor: pointer;
        color: var(--muted);
        font-size: 0.85rem;
        padding: 0.2rem 0;
      }
      details[open] > summary { color: var(--text); }
      .empty {
        padding: 0.8rem 1rem;
        color: var(--muted);
        font-style: italic;
        font-size: 0.85rem;
        background: var(--panel-elevated);
        border: 1px dashed var(--border);
        border-radius: 8px;
        text-align: center;
      }
      .pill {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        font-size: 0.75rem;
        background: var(--accent-soft);
        color: #9bd3ff;
      }
      .pill.warn { background: rgba(215, 186, 125, 0.15); color: #e7d29a; }
      .pill.err { background: rgba(244, 135, 113, 0.15); color: #f9a691; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="panel">
        <div class="hero">
          <div>
            <h1>Swirlock RAG Engine — v4 Retrieval Test</h1>
            <p class="subtitle">
              Drives <code>ws://&lt;host&gt;/v5/retrieval</code> with the v5 envelope. Streams every progress event back live.
            </p>
          </div>
          <span id="connection-badge" class="badge"><span class="dot"></span><span id="connection-text">Idle</span></span>
        </div>

        <div class="content">
          <label class="field">
            <span>Query</span>
            <textarea id="query-input" placeholder="What is the current weather in Bucharest?">What is the current weather in Bucharest?</textarea>
          </label>

          <div class="controls-row">
            <label class="field" style="flex: 0 0 9rem;">
              <span>Freshness</span>
              <select id="freshness">
                <option value="low">low</option>
                <option value="medium" selected>medium</option>
                <option value="high">high</option>
                <option value="realtime">realtime</option>
              </select>
            </label>

            <label class="field" style="flex: 0 0 8rem;">
              <span>Max chunks</span>
              <input id="max-chunks" type="number" min="1" max="20" value="6" />
            </label>

            <div class="field" style="flex: 1 1 auto;">
              <span>Allowed modes</span>
              <div class="checkboxes">
                <label><input type="checkbox" id="mode-local" /> local_rag</label>
                <label><input type="checkbox" id="mode-live" checked /> live_web</label>
                <label><input type="checkbox" id="skip-summaries" /> skipUtilitySummaries</label>
              </div>
            </div>
          </div>

          <div class="controls-row" style="justify-content: flex-end;">
            <button id="cancel-btn" class="ghost" disabled>Cancel</button>
            <button id="run-btn" class="primary">Run retrieval</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="content">
          <p class="section-title">Phases</p>
          <div class="phases">
            <ul id="phase-list">
              <li class="empty">No retrieval run yet. Click <strong>Run retrieval</strong> to start.</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="content">
          <p class="section-title">Evidence chunks</p>
          <div id="evidence-grid" class="evidence-grid">
            <div class="empty">Evidence will appear here as <code>evidence.chunk</code> events arrive.</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="content">
          <details>
            <summary>Raw envelopes (request + every server frame)</summary>
            <pre id="raw-log" class="raw-log">(empty)</pre>
          </details>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const PHASE_LABELS = {
          'retrieval.started': 'Starting retrieval',
          'utility_llm.retrieval_support.started': 'Planning the search',
          'utility_llm.retrieval_support.completed': 'Search plan ready',
          'query.normalized': 'Refining the query',
          'embedding.query.started': 'Generating query embedding',
          'embedding.query.completed': 'Query embedding ready',
          'retrieval.policy.decided': 'Retrieval policy decided',
          'local.search.started': 'Searching local knowledge',
          'local.search.completed': 'Local search done',
          'live.search.started': 'Searching the web',
          'live.search.completed': 'Web search done',
          'live.extract.started': 'Reading sources',
          'live.extract.completed': 'Sources read',
          'utility_llm.extraction_summaries.started': 'Summarizing sources',
          'utility_llm.extraction_summaries.completed': 'Summaries ready',
          'evidence.chunk': 'Evidence chunk',
          'retrieval.completed': 'Retrieval complete',
          'retrieval.failed': 'Retrieval failed',
        };

        const PAIRS = {
          'utility_llm.retrieval_support.completed': 'utility_llm.retrieval_support.started',
          'embedding.query.completed': 'embedding.query.started',
          'local.search.completed': 'local.search.started',
          'live.search.completed': 'live.search.started',
          'live.extract.completed': 'live.extract.started',
          'utility_llm.extraction_summaries.completed': 'utility_llm.extraction_summaries.started',
        };

        const queryInput = document.getElementById('query-input');
        const freshnessSelect = document.getElementById('freshness');
        const maxChunksInput = document.getElementById('max-chunks');
        const modeLocal = document.getElementById('mode-local');
        const modeLive = document.getElementById('mode-live');
        const skipSummaries = document.getElementById('skip-summaries');
        const runBtn = document.getElementById('run-btn');
        const cancelBtn = document.getElementById('cancel-btn');
        const phaseList = document.getElementById('phase-list');
        const evidenceGrid = document.getElementById('evidence-grid');
        const rawLog = document.getElementById('raw-log');
        const connectionBadge = document.getElementById('connection-badge');
        const connectionText = document.getElementById('connection-text');

        let socket = null;
        let activeCorrelationId = null;
        let runStartedAt = 0;
        const phaseRowsByCorrelation = new Map();

        function setBadge(state, text) {
          connectionBadge.classList.remove('connected', 'connecting', 'error');
          if (state) connectionBadge.classList.add(state);
          connectionText.textContent = text;
        }

        function appendRaw(direction, frame) {
          const line = direction + ' ' + JSON.stringify(frame, null, 0);
          if (rawLog.textContent === '(empty)') rawLog.textContent = '';
          rawLog.textContent += (rawLog.textContent ? '\\n' : '') + line;
          rawLog.scrollTop = rawLog.scrollHeight;
        }

        function uuidV4() {
          if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
          }
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
        }

        function ensureSocket() {
          if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
          if (socket && socket.readyState === WebSocket.CONNECTING) {
            return new Promise(function (resolve, reject) {
              socket.addEventListener('open', function () { resolve(socket); }, { once: true });
              socket.addEventListener('error', function (err) { reject(err); }, { once: true });
            });
          }
          const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/v5/retrieval';
          setBadge('connecting', 'Connecting…');
          socket = new WebSocket(wsUrl);
          socket.addEventListener('open', function () { setBadge('connected', 'Connected'); });
          socket.addEventListener('close', function () {
            setBadge('error', 'Disconnected');
            socket = null;
            if (activeCorrelationId) {
              const id = activeCorrelationId;
              activeCorrelationId = null;
              runBtn.disabled = false;
              cancelBtn.disabled = true;
              markPhaseFailed(id, 'WebSocket closed before completion.');
            }
          });
          socket.addEventListener('error', function () { setBadge('error', 'Socket error'); });
          socket.addEventListener('message', function (event) {
            let parsed;
            try { parsed = JSON.parse(event.data); } catch (err) { return; }
            appendRaw('<-', parsed);
            handleEnvelope(parsed);
          });
          return new Promise(function (resolve, reject) {
            socket.addEventListener('open', function () { resolve(socket); }, { once: true });
            socket.addEventListener('error', function (err) { reject(err); }, { once: true });
          });
        }

        function clearPhases() {
          phaseList.innerHTML = '';
          phaseRowsByCorrelation.clear();
        }

        function clearEvidence() {
          evidenceGrid.innerHTML = '';
        }

        function getRowMap(correlationId) {
          let rows = phaseRowsByCorrelation.get(correlationId);
          if (!rows) {
            rows = new Map();
            phaseRowsByCorrelation.set(correlationId, rows);
          }
          return rows;
        }

        function appendPhaseRow(correlationId, key, label, statusClass, meta) {
          const rows = getRowMap(correlationId);
          let row = rows.get(key);
          if (!row) {
            row = document.createElement('li');
            row.className = 'phase-row';
            const icon = document.createElement('span');
            icon.className = 'phase-icon';
            const labelEl = document.createElement('span');
            labelEl.className = 'phase-label';
            const metaEl = document.createElement('span');
            metaEl.className = 'phase-meta';
            row.appendChild(icon);
            row.appendChild(labelEl);
            row.appendChild(metaEl);
            row._icon = icon;
            row._label = labelEl;
            row._meta = metaEl;
            row._startedAt = Date.now();
            phaseList.appendChild(row);
            rows.set(key, row);
          }
          row.classList.remove('running', 'done', 'failed');
          if (statusClass) row.classList.add(statusClass);
          row._icon.textContent = statusClass === 'running' ? '⏳' : statusClass === 'done' ? '✓' : statusClass === 'failed' ? '✗' : '•';
          row._label.textContent = label;
          if (meta !== undefined) row._meta.textContent = meta;
          return row;
        }

        function markPhaseFailed(correlationId, message) {
          appendPhaseRow(correlationId, 'error', 'Error: ' + message, 'failed', '');
        }

        function recordPhaseEvent(correlationId, type, payload) {
          const data = (payload && payload.data) || {};
          if (type.endsWith('.started')) {
            appendPhaseRow(correlationId, type, PHASE_LABELS[type] || type, 'running', '');
            return;
          }
          if (type.endsWith('.completed') || type === 'retrieval.completed') {
            const startKey = PAIRS[type] || (type === 'retrieval.completed' ? 'retrieval.started' : null);
            const rows = getRowMap(correlationId);
            const startRow = startKey ? rows.get(startKey) : null;
            const elapsed = startRow ? (Date.now() - startRow._startedAt) : null;
            const metaParts = [];
            if (elapsed !== null) metaParts.push(elapsed + ' ms');
            if (typeof data.resultCount === 'number') metaParts.push(data.resultCount + ' results');
            if (typeof data.documentCount === 'number') metaParts.push(data.documentCount + ' docs');
            if (typeof data.evidenceChunkCount === 'number') metaParts.push(data.evidenceChunkCount + ' chunks');
            if (typeof data.summaryCount === 'number') metaParts.push(data.summaryCount + ' summaries');
            if (startRow) {
              startRow.classList.remove('running');
              startRow.classList.add('done');
              startRow._icon.textContent = '✓';
              startRow._label.textContent = PHASE_LABELS[startKey] || startKey;
              if (metaParts.length) startRow._meta.textContent = metaParts.join(' · ');
            } else {
              appendPhaseRow(correlationId, type, PHASE_LABELS[type] || type, 'done', metaParts.join(' · '));
            }
            return;
          }
          if (type === 'retrieval.failed') {
            appendPhaseRow(correlationId, type, PHASE_LABELS[type] || type, 'failed', JSON.stringify(data));
            return;
          }
          if (type === 'retrieval.policy.decided') {
            appendPhaseRow(correlationId, type, PHASE_LABELS[type], 'done', data.mode + (data.reason ? ' — ' + data.reason : ''));
            return;
          }
          if (type === 'query.normalized') {
            appendPhaseRow(correlationId, type, PHASE_LABELS[type], 'done', data.intent ? 'intent=' + data.intent : '');
            return;
          }
        }

        function renderEvidenceChunk(chunk) {
          if (!evidenceGrid.querySelector('.evidence-card')) evidenceGrid.innerHTML = '';
          const card = document.createElement('div');
          card.className = 'evidence-card';
          const head = document.createElement('div');
          head.className = 'evidence-card-head';
          const title = document.createElement('div');
          title.className = 'evidence-title';
          if (chunk.url) {
            const a = document.createElement('a');
            a.href = chunk.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = chunk.title || chunk.url;
            title.appendChild(a);
          } else {
            title.textContent = chunk.title || '(untitled)';
          }
          head.appendChild(title);
          const sourceTypePill = document.createElement('span');
          sourceTypePill.className = 'pill';
          sourceTypePill.textContent = chunk.sourceType || 'evidence';
          head.appendChild(sourceTypePill);
          if (typeof chunk.relevanceScore === 'number') {
            const meta = document.createElement('span');
            meta.className = 'evidence-meta';
            meta.textContent = 'rel ' + chunk.relevanceScore.toFixed(2);
            if (typeof chunk.freshnessScore === 'number') {
              meta.textContent += ' · fresh ' + chunk.freshnessScore.toFixed(2);
            }
            head.appendChild(meta);
          }
          card.appendChild(head);
          const body = document.createElement('div');
          body.className = 'evidence-body';
          body.textContent = chunk.content || '';
          card.appendChild(body);
          evidenceGrid.appendChild(card);
        }

        function handleEnvelope(envelope) {
          if (!envelope || envelope.correlationId !== activeCorrelationId) return;
          if (envelope.type === 'error') {
            const message = (envelope.error && envelope.error.message) || 'Unknown error';
            markPhaseFailed(envelope.correlationId, message);
            runBtn.disabled = false;
            cancelBtn.disabled = true;
            activeCorrelationId = null;
            return;
          }
          if (envelope.type === 'heartbeat') return;
          if (envelope.type === 'evidence.chunk') {
            const chunk = envelope.payload && envelope.payload.data && envelope.payload.data.chunk;
            if (chunk) renderEvidenceChunk(chunk);
            return;
          }
          if (envelope.type === 'retrieval.completed') {
            recordPhaseEvent(envelope.correlationId, envelope.type, envelope.payload);
            runBtn.disabled = false;
            cancelBtn.disabled = true;
            activeCorrelationId = null;
            return;
          }
          if (envelope.type === 'retrieval.failed') {
            recordPhaseEvent(envelope.correlationId, envelope.type, envelope.payload);
            runBtn.disabled = false;
            cancelBtn.disabled = true;
            activeCorrelationId = null;
            return;
          }
          recordPhaseEvent(envelope.correlationId, envelope.type, envelope.payload);
        }

        async function runRetrieval() {
          const text = (queryInput.value || '').trim();
          if (!text) return;
          const allowedModes = [];
          if (modeLocal.checked) allowedModes.push('local_rag');
          if (modeLive.checked) allowedModes.push('live_web');
          const maxEvidenceChunks = Math.max(1, Math.min(20, Number.parseInt(maxChunksInput.value, 10) || 6));
          const correlationId = uuidV4();
          activeCorrelationId = correlationId;
          runStartedAt = Date.now();
          clearPhases();
          clearEvidence();
          rawLog.textContent = '(empty)';

          const envelope = {
            type: 'retrieve_evidence',
            correlationId,
            payload: {
              request: {
                requestContext: {
                  callerService: 'rag-engine-dev-ui',
                  priority: 'interactive',
                  requestedAt: new Date().toISOString(),
                  timeoutMs: 60000,
                },
                query: {
                  parts: [{ type: 'text', text }],
                  freshness: freshnessSelect.value,
                  allowedModes,
                  maxEvidenceChunks,
                  skipUtilitySummaries: skipSummaries.checked,
                },
              },
            },
          };
          try {
            const ws = await ensureSocket();
            runBtn.disabled = true;
            cancelBtn.disabled = false;
            appendRaw('->', envelope);
            ws.send(JSON.stringify(envelope));
          } catch (err) {
            markPhaseFailed(correlationId, 'Failed to open WebSocket: ' + (err && err.message ? err.message : err));
            runBtn.disabled = false;
            cancelBtn.disabled = true;
            activeCorrelationId = null;
          }
        }

        function cancelRetrieval() {
          if (!socket || socket.readyState !== WebSocket.OPEN || !activeCorrelationId) return;
          const cancelEnvelope = { type: 'cancel', correlationId: activeCorrelationId };
          appendRaw('->', cancelEnvelope);
          socket.send(JSON.stringify(cancelEnvelope));
        }

        runBtn.addEventListener('click', function () { void runRetrieval(); });
        cancelBtn.addEventListener('click', function () { cancelRetrieval(); });
        queryInput.addEventListener('keydown', function (event) {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void runRetrieval();
          }
        });

        void ensureSocket().catch(function () { /* badge already shows error */ });
      })();
    </script>
  </body>
</html>`;
