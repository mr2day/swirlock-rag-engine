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
        width: min(90vw, 860px);
        margin: 0;
        padding: 0.85rem 0 1.75rem;
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
        padding: 1.25rem;
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
        max-width: 44rem;
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
        gap: 1.25rem;
        padding: 1rem;
        min-width: 0;
      }

      .content > * {
        width: 100%;
        min-width: 0;
      }

      .field-stack,
      .input-grid,
      .results-block {
        min-width: 0;
      }

      label {
        display: block;
        margin-bottom: 0.5rem;
        color: #cdd6e3;
        font-size: 0.9rem;
        font-weight: 600;
        letter-spacing: 0.01em;
      }

      textarea,
      select,
      input,
      button {
        font: inherit;
      }

      textarea,
      select,
      input {
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
      select:focus,
      input:focus {
        outline: none;
        border-color: #3794ff;
        background: #1d2330;
        box-shadow: 0 0 0 1px #3794ff, 0 0 0 4px rgba(55, 148, 255, 0.14);
      }

      textarea {
        min-height: 9rem;
        resize: vertical;
        line-height: 1.55;
      }

      .input-grid {
        display: grid;
        gap: 1rem;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }

      button {
        border: 0;
        border-radius: 10px;
        padding: 0.8rem 1.2rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition:
          transform 120ms ease,
          background 120ms ease,
          box-shadow 120ms ease,
          opacity 120ms ease;
      }

      button:hover:not(:disabled) {
        transform: translateY(-1px);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.72;
      }

      .button-primary {
        background: var(--accent);
        color: white;
        box-shadow: 0 10px 25px rgba(14, 99, 156, 0.28);
      }

      .button-primary:hover:not(:disabled) {
        background: var(--accent-hover);
      }

      .button-secondary {
        background: var(--panel-muted);
        color: var(--text);
        border: 1px solid var(--border-strong);
      }

      .button-secondary:hover:not(:disabled) {
        background: #2f3642;
      }

      .status {
        min-height: 1.2rem;
        color: var(--muted);
        font-size: 0.95rem;
      }

      .status.success {
        color: var(--success);
      }

      .status.error {
        color: var(--danger);
      }

      .hint {
        color: var(--muted);
        font-size: 0.95rem;
        margin: 0;
        padding: 0.9rem 1rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel-muted);
        line-height: 1.55;
      }

      code {
        padding: 0.15rem 0.4rem;
        border: 1px solid var(--border-strong);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--warning);
        font-family: Consolas, "Cascadia Code", "Courier New", monospace;
        font-size: 0.92em;
      }

      .results-header {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.45rem;
        margin-bottom: 0.65rem;
      }

      .results-caption {
        color: var(--muted);
        font-size: 0.85rem;
      }

      .process-view {
        display: grid;
        gap: 0.85rem;
      }

      .empty-state {
        margin: 0;
        padding: 1rem;
        border: 1px dashed var(--border-strong);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.02);
        color: var(--muted);
      }

      .provider-card {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel-elevated);
        overflow: hidden;
      }

      .provider-card.error {
        border-color: rgba(244, 135, 113, 0.45);
      }

      .provider-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.95rem 1rem;
        border-bottom: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.02);
      }

      .provider-header h3 {
        margin: 0;
        font-size: 1rem;
        text-transform: capitalize;
      }

      .provider-status {
        display: inline-flex;
        align-items: center;
        min-height: 1.75rem;
        padding: 0.15rem 0.6rem;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 600;
      }

      .provider-status.ok {
        background: rgba(137, 209, 133, 0.14);
        color: var(--success);
      }

      .provider-status.error {
        background: rgba(244, 135, 113, 0.14);
        color: var(--danger);
      }

      .provider-body {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }

      .metric-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.6rem;
      }

      .metric {
        padding: 0.7rem 0.8rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.02);
      }

      .metric-label {
        display: block;
        color: var(--muted);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .metric-value {
        display: block;
        margin-top: 0.25rem;
        color: var(--heading);
        font-size: 0.95rem;
        font-weight: 600;
      }

      .stage-block {
        display: grid;
        gap: 0.8rem;
      }

      .stage-title {
        margin: 0;
        color: var(--heading);
        font-size: 0.92rem;
      }

      .list {
        display: grid;
        gap: 0.65rem;
      }

      .list-item {
        padding: 0.8rem 0.9rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.02);
      }

      .list-item h4 {
        margin: 0 0 0.35rem;
        font-size: 0.92rem;
        line-height: 1.35;
      }

      .list-item p {
        margin: 0.25rem 0 0;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.45;
      }

      .content-preview {
        margin-top: 0.55rem;
        padding: 0.8rem 0.9rem;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.18);
        color: var(--text);
        font-family: Consolas, "Cascadia Code", "Courier New", monospace;
        font-size: 0.84rem;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .doc-meta {
        margin-top: 0.55rem;
        color: var(--muted);
        font-size: 0.8rem;
      }

      .error-text {
        margin: 0;
        color: var(--danger);
        line-height: 1.5;
      }

      pre {
        margin: 0;
        width: 100%;
        max-width: 100%;
        padding: 1.1rem 1.2rem;
        min-height: 22rem;
        height: min(50vh, 28rem);
        overflow-x: auto;
        overflow-y: auto;
        border-radius: 12px;
        border: 1px solid var(--border);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
          #11161d;
        color: #d4d4d4;
        font-family: Consolas, "Cascadia Code", "Courier New", monospace;
        font-size: 0.9rem;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      }

      a {
        color: #7cc7ff;
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      @media (min-width: 760px) {
        .page {
          width: min(90vw, 980px);
          padding-top: 1.25rem;
        }

        .hero {
          justify-content: space-between;
          text-align: left;
        }

        .hero-meta {
          justify-content: flex-end;
        }

        .input-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .metric-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .results-header {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
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
              Diagnostic UI for single-provider search and thin search-then-extract comparison.
              Use the compare flow to judge whether Tavily and Exa return enough usable content
              for the RAG engine.
            </p>
          </div>

          <div class="hero-meta">
            <span class="badge">/dev/search</span>
            <span class="badge">/dev/search/compare</span>
            <span class="badge">Search + extract</span>
          </div>
        </header>

        <section class="content">
          <div class="field-stack">
            <label for="query">Search query</label>
            <textarea
              id="query"
              name="query"
              placeholder="Example: latest developments in vector databases for RAG"
            ></textarea>
          </div>

          <div class="input-grid">
            <div>
              <label for="provider">Provider for single search</label>
              <select id="provider" name="provider">
                <option value="tavily">Tavily</option>
                <option value="exa">Exa</option>
              </select>
            </div>

            <div>
              <label for="searchLimit">Search results for compare</label>
              <input id="searchLimit" name="searchLimit" type="number" min="1" max="10" value="5" />
            </div>

            <div>
              <label for="extractLimit">URLs to extract per provider</label>
              <input id="extractLimit" name="extractLimit" type="number" min="1" max="5" value="3" />
            </div>
          </div>

          <div class="actions">
            <button id="searchButton" class="button-primary" type="button">Run single search</button>
            <button id="compareButton" class="button-secondary" type="button">Run search + extract compare</button>
            <span id="status" class="status"></span>
          </div>

          <p class="hint">
            Notes: Tavily requires <code>TAVILY_API_KEY</code>. Exa requires <code>EXA_API_KEY</code>.
            Compare mode searches both providers, then extracts content from the top URLs returned by each.
          </p>

          <div class="results-block">
            <div class="results-header">
              <label for="processView">Process view</label>
              <span class="results-caption">Structured summary of stages, latency, volume, and extracted content</span>
            </div>
            <div id="processView" class="process-view">
              <p class="empty-state">No diagnostic run yet.</p>
            </div>
          </div>

          <div class="results-block">
            <div class="results-header">
              <label for="result">Raw response</label>
              <span class="results-caption">JSON payload returned by the diagnostic endpoint</span>
            </div>
            <pre id="result">No response yet.</pre>
          </div>
        </section>
      </section>
    </main>

    <script>
      const queryField = document.getElementById('query');
      const providerField = document.getElementById('provider');
      const searchLimitField = document.getElementById('searchLimit');
      const extractLimitField = document.getElementById('extractLimit');
      const searchButton = document.getElementById('searchButton');
      const compareButton = document.getElementById('compareButton');
      const statusField = document.getElementById('status');
      const resultField = document.getElementById('result');
      const processView = document.getElementById('processView');

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatValue(value, fallback = 'n/a') {
        if (value === null || value === undefined || value === '') {
          return fallback;
        }

        return String(value);
      }

      function formatMillis(value) {
        if (value === null || value === undefined) {
          return 'n/a';
        }

        return value + ' ms';
      }

      function formatNumber(value) {
        if (value === null || value === undefined) {
          return 'n/a';
        }

        return new Intl.NumberFormat().format(value);
      }

      function formatScore(value) {
        if (value === null || value === undefined) {
          return 'n/a';
        }

        return Number(value).toFixed(3);
      }

      function makeExcerpt(value, limit = 1200) {
        const text = String(value || '').trim();

        if (!text) {
          return 'No extracted content returned.';
        }

        if (text.length <= limit) {
          return text;
        }

        return text.slice(0, limit - 3) + '...';
      }

      function setLoadingState(isLoading) {
        searchButton.disabled = isLoading;
        compareButton.disabled = isLoading;
      }

      function renderLoadingState(mode) {
        const modeLabel =
          mode === 'compare' ? 'Running search and extract stages for both providers...' : 'Running single-provider search...';

        processView.innerHTML = '<p class="empty-state">' + escapeHtml(modeLabel) + '</p>';
      }

      function renderMetric(label, value) {
        return (
          '<div class="metric">' +
            '<span class="metric-label">' + escapeHtml(label) + '</span>' +
            '<span class="metric-value">' + escapeHtml(value) + '</span>' +
          '</div>'
        );
      }

      function renderTopResults(results) {
        if (!Array.isArray(results) || results.length === 0) {
          return '<p class="empty-state">No search results returned.</p>';
        }

        return (
          '<div class="list">' +
            results.slice(0, 3).map((result, index) =>
              '<article class="list-item">' +
                '<h4>' + escapeHtml(String(index + 1) + '. ' + result.title) + '</h4>' +
                '<div class="doc-meta">' +
                  '<a href="' + escapeHtml(result.url) + '" target="_blank" rel="noreferrer noopener">' +
                    escapeHtml(result.url) +
                  '</a>' +
                '</div>' +
                '<p>' + escapeHtml(result.snippet || 'No snippet returned.') + '</p>' +
              '</article>'
            ).join('') +
          '</div>'
        );
      }

      function renderExtractedDocuments(documents, failedSources) {
        const docMarkup =
          Array.isArray(documents) && documents.length > 0
            ? (
                '<div class="list">' +
                  documents.slice(0, 2).map((document, index) =>
                    '<article class="list-item">' +
                      '<h4>' + escapeHtml(String(index + 1) + '. ' + document.title) + '</h4>' +
                      '<div class="content-preview">' +
                        escapeHtml(makeExcerpt(document.excerpt || document.content || '')) +
                      '</div>' +
                      '<div class="doc-meta">' +
                        '<a href="' + escapeHtml(document.url) + '" target="_blank" rel="noreferrer noopener">' +
                          escapeHtml(document.url) +
                        '</a>' +
                        (document.publishedAt ? ' | published: ' + escapeHtml(document.publishedAt) : '') +
                        ' | chars: ' + escapeHtml(formatNumber(document.contentLength)) +
                        ' | score: ' + escapeHtml(formatScore(document.score)) +
                      '</div>' +
                    '</article>'
                  ).join('') +
                '</div>'
              )
            : '<p class="empty-state">No extracted documents returned.</p>';

        const failedMarkup =
          Array.isArray(failedSources) && failedSources.length > 0
            ? (
                '<div class="list">' +
                  failedSources.map((source) =>
                    '<article class="list-item">' +
                      '<h4>' + escapeHtml(source.url) + '</h4>' +
                      '<p class="error-text">' + escapeHtml(source.error) + '</p>' +
                    '</article>'
                  ).join('') +
                '</div>'
              )
            : '';

        return docMarkup + failedMarkup;
      }

      function renderSingleSearchSummary(payload) {
        processView.innerHTML =
          '<article class="provider-card">' +
            '<div class="provider-header">' +
              '<h3>' + escapeHtml(payload.provider + ' search') + '</h3>' +
              '<span class="provider-status ok">ok</span>' +
            '</div>' +
            '<div class="provider-body">' +
              '<div class="metric-grid">' +
                renderMetric('Latency', formatMillis(payload.latencyMs)) +
                renderMetric('Results', formatNumber(payload.normalized ? payload.normalized.length : 0)) +
                renderMetric('Provider', payload.provider) +
                renderMetric('Query', payload.query) +
              '</div>' +
              '<section class="stage-block">' +
                '<h4 class="stage-title">Top results</h4>' +
                renderTopResults(payload.normalized || []) +
              '</section>' +
            '</div>' +
          '</article>';
      }

      function renderCompareSummary(payload) {
        processView.innerHTML = payload.providers.map((provider) => {
          if (provider.status !== 'ok') {
            return (
              '<article class="provider-card error">' +
                '<div class="provider-header">' +
                  '<h3>' + escapeHtml(provider.provider) + '</h3>' +
                  '<span class="provider-status error">error</span>' +
                '</div>' +
                '<div class="provider-body">' +
                  '<p class="error-text">' + escapeHtml(provider.error || 'Unknown provider failure.') + '</p>' +
                '</div>' +
              '</article>'
            );
          }

          const search = provider.search;
          const extract = provider.extract;

          return (
            '<article class="provider-card">' +
              '<div class="provider-header">' +
                '<h3>' + escapeHtml(provider.provider) + '</h3>' +
                '<span class="provider-status ok">ok</span>' +
              '</div>' +
              '<div class="provider-body">' +
                '<div class="metric-grid">' +
                  renderMetric('Total latency', formatMillis(provider.totalLatencyMs)) +
                  renderMetric('Search latency', formatMillis(search ? search.latencyMs : null)) +
                  renderMetric('Extract latency', formatMillis(extract ? extract.latencyMs : null)) +
                  renderMetric('Search type', search ? formatValue(search.resolvedSearchType) : 'n/a') +
                  renderMetric('Search results', search ? formatNumber(search.resultCount) : 'n/a') +
                  renderMetric('Extracted docs', extract ? formatNumber(extract.documentCount) : 'n/a') +
                  renderMetric('Extracted chars', extract ? formatNumber(extract.totalCharacters) : 'n/a') +
                  renderMetric(
                    'Credits / cost',
                    search && search.usageCredits !== null
                      ? formatNumber(search.usageCredits) + ' credits'
                      : extract && extract.usageCredits !== null
                        ? formatNumber(extract.usageCredits) + ' credits'
                        : search && search.costDollarsTotal !== null
                          ? '$' + String(search.costDollarsTotal)
                          : extract && extract.costDollarsTotal !== null
                            ? '$' + String(extract.costDollarsTotal)
                            : 'n/a'
                  ) +
                '</div>' +
                '<section class="stage-block">' +
                  '<h4 class="stage-title">Search stage</h4>' +
                  renderTopResults(search ? search.topResults : []) +
                '</section>' +
                '<section class="stage-block">' +
                  '<h4 class="stage-title">Extract stage</h4>' +
                  renderExtractedDocuments(extract ? extract.documents : [], extract ? extract.failedSources : []) +
                '</section>' +
              '</div>' +
            '</article>'
          );
        }).join('');
      }

      async function runRequest(mode) {
        const query = queryField.value.trim();
        const provider = providerField.value;

        if (!query) {
          statusField.textContent = 'Enter a search query first.';
          statusField.className = 'status error';
          queryField.focus();
          return;
        }

        setLoadingState(true);
        renderLoadingState(mode);
        statusField.textContent = mode === 'compare' ? 'Comparing providers...' : 'Searching...';
        statusField.className = 'status';
        resultField.textContent = 'Waiting for response...';

        const url = new URL(
          mode === 'compare' ? '/dev/search/compare' : '/dev/search',
          window.location.origin,
        );

        url.searchParams.set('q', query);

        if (mode === 'compare') {
          url.searchParams.set('searchLimit', searchLimitField.value || '5');
          url.searchParams.set('extractLimit', extractLimitField.value || '3');
        } else {
          url.searchParams.set('provider', provider);
        }

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

          if (mode === 'compare') {
            renderCompareSummary(payload);
            statusField.textContent = 'Comparison completed.';
          } else {
            renderSingleSearchSummary(payload);
            statusField.textContent = 'Single search completed.';
          }

          statusField.className = 'status success';
          resultField.textContent = JSON.stringify(payload, null, 2);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error.';

          statusField.textContent = message;
          statusField.className = 'status error';
          resultField.textContent = message;
          processView.innerHTML = '<p class="empty-state">' + escapeHtml(message) + '</p>';
        } finally {
          setLoadingState(false);
        }
      }

      searchButton.addEventListener('click', () => runRequest('search'));
      compareButton.addEventListener('click', () => runRequest('compare'));

      queryField.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          runRequest(event.shiftKey ? 'compare' : 'search');
        }
      });
    </script>
  </body>
</html>
`;
