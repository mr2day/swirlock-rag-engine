export const searchTestPageHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Swirlock Search Test</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1e8;
        --panel: #fffdf8;
        --border: #d7d0c2;
        --text: #1e1b16;
        --muted: #6b6254;
        --accent: #2f6fed;
        --accent-hover: #2456b8;
        --danger: #b42318;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, #fff6db 0, transparent 28rem),
          linear-gradient(180deg, #f8f3e8 0%, var(--bg) 100%);
        color: var(--text);
      }

      .page {
        width: min(960px, calc(100vw - 2rem));
        margin: 2rem auto;
        padding: 1.5rem;
      }

      .panel {
        background: color-mix(in srgb, var(--panel) 92%, white);
        border: 1px solid var(--border);
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(48, 36, 16, 0.08);
        overflow: hidden;
      }

      .hero {
        padding: 1.5rem 1.5rem 1rem;
        border-bottom: 1px solid var(--border);
        background: linear-gradient(135deg, rgba(255, 244, 210, 0.8), rgba(255, 255, 255, 0.9));
      }

      h1 {
        margin: 0 0 0.5rem;
        font-size: clamp(1.8rem, 3vw, 2.6rem);
        line-height: 1.05;
      }

      .subtitle {
        margin: 0;
        max-width: 52rem;
        color: var(--muted);
        font-size: 1rem;
      }

      .content {
        display: grid;
        gap: 1.25rem;
        padding: 1.5rem;
      }

      label {
        display: block;
        margin-bottom: 0.45rem;
        font-weight: 700;
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
        border-radius: 12px;
        padding: 0.9rem 1rem;
        background: #fff;
        color: var(--text);
      }

      textarea {
        min-height: 9rem;
        resize: vertical;
      }

      .controls {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 0.8rem 1.3rem;
        background: var(--accent);
        color: white;
        font-weight: 700;
        cursor: pointer;
        transition:
          transform 120ms ease,
          background 120ms ease;
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
      }

      .status.error {
        color: var(--danger);
      }

      pre {
        margin: 0;
        padding: 1rem;
        min-height: 20rem;
        overflow: auto;
        border-radius: 14px;
        border: 1px solid #1f26331a;
        background: #161a22;
        color: #dce6f7;
        font-family: Consolas, "Courier New", monospace;
        font-size: 0.9rem;
        line-height: 1.45;
      }

      .hint {
        color: var(--muted);
        font-size: 0.95rem;
      }

      @media (min-width: 700px) {
        .controls {
          grid-template-columns: minmax(0, 1fr) 15rem;
          align-items: end;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="panel">
        <header class="hero">
          <h1>Swirlock Search Test</h1>
          <p class="subtitle">
            Diagnostic UI for the local search route. Enter a query, choose a
            provider, and inspect the returned JSON payload.
          </p>
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
                <option value="ddg">DuckDuckGo</option>
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
            <code>EXA_API_KEY</code>. DuckDuckGo works without API keys.
          </p>

          <div>
            <label for="result">Response</label>
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
          statusField.className = 'status';
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
