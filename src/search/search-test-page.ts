export const searchTestPageHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Swirlock Search Test</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #111418;
        --bg-accent: #1a2028;
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
        --shadow: rgba(0, 0, 0, 0.34);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        justify-content: center;
        font-family: "Segoe UI", system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(14, 99, 156, 0.22) 0, transparent 22rem),
          radial-gradient(circle at top right, rgba(45, 212, 191, 0.08) 0, transparent 18rem),
          linear-gradient(180deg, #0f1216 0%, var(--bg) 100%);
        color: var(--text);
      }

      .page {
        width: min(90vw, 780px);
        margin: 0;
        padding: 1rem 0 2rem;
      }

      .panel {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
          var(--panel);
        border: 1px solid var(--border);
        border-radius: 16px;
        box-shadow: 0 24px 60px var(--shadow);
        overflow: hidden;
      }

      .hero {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        border-bottom: 1px solid var(--border);
        text-align: center;
        background:
          linear-gradient(135deg, rgba(14, 99, 156, 0.15), transparent 55%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0));
      }

      h1 {
        margin: 0 0 0.5rem;
        color: var(--heading);
        font-size: clamp(1.9rem, 3vw, 2.8rem);
        line-height: 1.05;
        letter-spacing: -0.03em;
      }

      .subtitle {
        margin: 0;
        max-width: 42rem;
        color: var(--muted);
        font-size: 0.98rem;
        line-height: 1.55;
      }

      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        justify-content: center;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 2rem;
        padding: 0.35rem 0.75rem;
        border: 1px solid var(--border-strong);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.03);
        color: #c8d1dc;
        font-size: 0.85rem;
        white-space: nowrap;
      }

      .content {
        display: grid;
        gap: 1.4rem;
        padding: 1.5rem;
      }

      label {
        display: block;
        margin-bottom: 0.5rem;
        color: #cdd6e3;
        font-size: 0.9rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        text-align: center;
      }

      textarea,
      select,
      button {
        font: inherit;
      }

      textarea,
      select {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 0.9rem 1rem;
        background: var(--panel-elevated);
        color: var(--text);
        transition:
          border-color 120ms ease,
          box-shadow 120ms ease,
          background 120ms ease;
      }

      textarea::placeholder {
        color: #7d8593;
      }

      textarea:focus,
      select:focus {
        outline: none;
        border-color: #3794ff;
        background: #1d2330;
        box-shadow: 0 0 0 1px #3794ff, 0 0 0 4px rgba(55, 148, 255, 0.14);
      }

      textarea {
        min-height: 10rem;
        resize: vertical;
        line-height: 1.55;
      }

      .controls {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr);
        justify-items: center;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        justify-content: center;
      }

      button {
        border: 0;
        border-radius: 10px;
        padding: 0.8rem 1.2rem;
        background: var(--accent);
        color: white;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition:
          transform 120ms ease,
          background 120ms ease,
          box-shadow 120ms ease;
        box-shadow: 0 10px 25px rgba(14, 99, 156, 0.28);
      }

      button:hover:not(:disabled) {
        background: var(--accent-hover);
        transform: translateY(-1px);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.72;
      }

      .status {
        min-height: 1.2rem;
        color: var(--muted);
        font-size: 0.95rem;
        text-align: center;
      }

      .status.success {
        color: var(--success);
      }

      .status.error {
        color: var(--danger);
      }

      pre {
        margin: 0;
        padding: 1.1rem 1.2rem;
        min-height: 22rem;
        overflow: auto;
        border-radius: 12px;
        border: 1px solid var(--border);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
          #11161d;
        color: #d4d4d4;
        font-family: Consolas, "Cascadia Code", "Courier New", monospace;
        font-size: 0.9rem;
        line-height: 1.45;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      }

      .hint {
        color: var(--muted);
        font-size: 0.95rem;
        margin: 0;
        padding: 0.9rem 1rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel-muted);
        text-align: center;
      }

      code {
        padding: 0.15rem 0.4rem;
        border: 1px solid var(--border-strong);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        color: #d7ba7d;
        font-family: Consolas, "Cascadia Code", "Courier New", monospace;
        font-size: 0.92em;
      }

      .results-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        margin-bottom: 0.5rem;
      }

      .results-caption {
        color: var(--muted);
        font-size: 0.85rem;
        text-align: center;
      }

      @media (min-width: 760px) {
        .page {
          width: min(90vw, 920px);
          padding-top: 1.5rem;
        }

        .hero {
          justify-content: space-between;
          text-align: left;
        }

        .hero-meta {
          justify-content: flex-end;
        }

        .controls {
          grid-template-columns: minmax(0, 1fr) 15rem;
          align-items: end;
          justify-items: stretch;
        }

        .actions {
          justify-content: flex-start;
        }

        .results-header {
          flex-direction: row;
          justify-content: space-between;
        }

        label,
        .status,
        .hint,
        .results-caption {
          text-align: left;
        }
      }

      @media (max-width: 759px) {
        .page {
          width: 90vw;
          padding: 0.75rem 0 1.5rem;
        }

        .hero,
        .content {
          padding: 1rem;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="panel">
        <header class="hero">
          <div>
            <h1>Swirlock Search Test</h1>
            <p class="subtitle">
              Diagnostic UI for the local search route. Enter a query, choose a
              provider, and inspect the returned JSON payload.
            </p>
          </div>

          <div class="hero-meta">
            <span class="badge">/dev/search</span>
            <span class="badge">Tavily + Exa</span>
            <span class="badge">JSON inspection</span>
          </div>
        </header>

        <section class="content">
          <div>
            <label for="query">Search query</label>
            <textarea
              id="query"
              name="query"
              placeholder="Example: latest developments in vector databases for RAG"
            ></textarea>
          </div>

          <div class="controls">
            <div>
              <label for="provider">Provider</label>
              <select id="provider" name="provider">
                <option value="tavily">Tavily</option>
                <option value="exa">Exa</option>
              </select>
            </div>

            <div class="actions">
              <button id="searchButton" type="button">Run search</button>
              <span id="status" class="status"></span>
            </div>
          </div>

          <p class="hint">
            Notes: Tavily requires <code>TAVILY_API_KEY</code>. Exa requires
            <code>EXA_API_KEY</code>.
          </p>

          <div>
            <div class="results-header">
              <label for="result">Response</label>
              <span class="results-caption">Raw JSON from the diagnostic endpoint</span>
            </div>
            <pre id="result">No response yet.</pre>
          </div>
        </section>
      </section>
    </main>

    <script>
      const queryField = document.getElementById('query');
      const providerField = document.getElementById('provider');
      const searchButton = document.getElementById('searchButton');
      const statusField = document.getElementById('status');
      const resultField = document.getElementById('result');

      async function runSearch() {
        const query = queryField.value.trim();
        const provider = providerField.value;

        if (!query) {
          statusField.textContent = 'Enter a search query first.';
          statusField.className = 'status error';
          queryField.focus();
          return;
        }

        searchButton.disabled = true;
        statusField.textContent = 'Searching...';
        statusField.className = 'status';
        resultField.textContent = 'Waiting for response...';

        const url = new URL('/dev/search', window.location.origin);
        url.searchParams.set('q', query);
        url.searchParams.set('provider', provider);

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
          });

          const payload = await response.json();

          if (!response.ok) {
            const message =
              payload && typeof payload.message === 'string'
                ? payload.message
                : 'Search request failed.';

            throw new Error(message);
          }

          statusField.textContent = 'Search completed.';
          statusField.className = 'status success';
          resultField.textContent = JSON.stringify(payload, null, 2);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error.';

          statusField.textContent = message;
          statusField.className = 'status error';
          resultField.textContent = message;
        } finally {
          searchButton.disabled = false;
        }
      }

      searchButton.addEventListener('click', runSearch);

      queryField.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          runSearch();
        }
      });
    </script>
  </body>
</html>
`;
