/**
 * Deterministic boilerplate stripping for scraped web/wiki text before
 * it hits the Utility LLM. Each pass is conservative enough to be safe
 * across languages; we only kill lines/spans that match well-known
 * noise patterns from CMS templates, cookie banners, comment widgets,
 * citation markers, and similar.
 *
 * Order matters: inline replacements run before line-level filtering
 * so that e.g. a `[citation needed]` marker inside an otherwise-real
 * sentence doesn't drag the whole sentence into the discard pile.
 */
export function cleanContent(dirty: string): string {
  let cleaned = dirty.replace(/\r\n/g, '\n');

  // --- Inline replacements ------------------------------------------

  // Unicode fixups (mojibake for the degree symbol)
  cleaned = cleaned.replace(/Â°/g, '°');

  // Markdown images, video/image placeholders, links → keep link text
  cleaned = cleaned.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
  cleaned = cleaned.replace(/\[(Image|Video)\s+\d+:[^\]]*]/gi, ' ');
  cleaned = cleaned.replace(/\[(Image|Video)\s+\d+]/gi, ' ');
  cleaned = cleaned.replace(/\[([^\]]+)]\(([^)]*)\)/g, '$1');

  // Bare URLs, table separators, markdown decoration
  cleaned = cleaned.replace(/https?:\/\/\S+/g, ' ');
  cleaned = cleaned.replace(/[|]{2,}/g, ' ');
  cleaned = cleaned.replace(/[#*_`>~]/g, ' ');

  // Encyclopedia structural markers:
  //   [edit] [1] [23] [citation needed] [verification needed] ...
  cleaned = cleaned.replace(/\[\d+\]/g, ' ');
  cleaned = cleaned.replace(
    /\[(citation needed|edit|verification needed|update|sic|by whom\?|when\?|who\?|original research\?|clarification needed)\]/gi,
    ' ',
  );

  // CMS / template debris
  cleaned = cleaned.replace(/\[CMS:[^\]]+\]/gi, ' ');
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, ' '); // HTML comments

  // JavaScript leftovers (when scrapers don't fully strip <script>)
  cleaned = cleaned.replace(
    /\bfunction\s*\([^)]*\)\s*\{[\s\S]{0,500}?\}/g,
    ' ',
  );
  cleaned = cleaned.replace(/\bvar\s+\w+\s*=[^;\n]{0,200};/g, ' ');
  cleaned = cleaned.replace(
    /\b(window|document|google_ad_\w+|_paq|gtag|dataLayer)\.\w+\s*=/g,
    ' ',
  );

  // Datelines that hover above/below the article body:
  //   "Updated 3 hours ago" / "Published Mar 15 2024 4:32 PM ET"
  cleaned = cleaned.replace(
    /\b(Updated|Published|Last updated|Posted)\b[^.\n]{0,80}\b(ago|AM|PM|EST|EDT|PST|PDT|UTC|GMT|ET|PT|CET)\b/gi,
    ' ',
  );

  // Author bylines: "By Jane Doe" or "By Jane Doe | Senior Reporter"
  cleaned = cleaned.replace(
    /^By\s+\p{Lu}[\p{L}.\- ]{1,40}(\s*\|\s*[\p{L} ,.-]+)?\s*$/gmu,
    ' ',
  );

  // --- Line-level filtering -----------------------------------------

  const discardLinePatterns = [
    // Original list — small-site nav labels
    /^advertisement$/i,
    /^around the globe$/i,
    /^top stories$/i,
    /^featured stories$/i,
    /^trending now$/i,
    /^trending today$/i,
    /^news$/i,
    /^news & features$/i,
    /^for business$/i,
    /^privacy promise$/i,
    /^accept customize settings$/i,
    /^use current location$/i,
    /^recent locations$/i,
    /^no results found\.?$/i,
    /^try searching for a city, zip code or point of interest\.?$/i,
    /^weather near .+$/i,
    /^more stories$/i,
    /^featured videos$/i,
    /^watch live$/i,
    /^company$/i,
    /^products & services$/i,
    /^apps & downloads$/i,
    /^subscription services$/i,
    /^more$/i,
    /^sign in$/i,
    /^settings$/i,
    /^press$/i,
    /^education$/i,
    /^feedback$/i,
    /^careers$/i,
    /^maps$/i,
    /^alerts$/i,
    /^life$/i,
    /^news & videos$/i,

    // Cookie / consent banners
    /^(accept|reject)\s+(all\s+)?cookies?\.?$/i,
    /^accept and continue\.?$/i,
    /^manage (cookies|preferences|consent)\.?$/i,
    /^cookie (settings|preferences|policy)\.?$/i,
    /^we (and our partners )?(use|store) cookies/i,
    /^this (site|website) uses cookies/i,
    /^by (clicking|continuing|using) [^,]+,? you (agree|consent)/i,

    // Newsletter sign-ups
    /^subscribe to (our )?(newsletter|the briefing)/i,
    /^sign up for (our )?(daily |weekly |the )?(newsletter|briefing|updates|alerts|digest)/i,
    /^(get|receive) (the latest|our|free) [^.]{0,60} (delivered|in your inbox|by email)/i,
    /^by signing up,? you (agree|confirm|acknowledge)/i,
    /^thanks for signing up\.?$/i,

    // Social-share strings
    /^share (this|on|with|the article)/i,
    /^tweet (this|it)\.?$/i,
    /^(facebook|twitter|x|linkedin|whatsapp|telegram|reddit|email|copy link|messenger|pinterest)\.?$/i,
    /^email this article\.?$/i,
    /^print (this )?(article|page)\.?$/i,

    // Related-article / read-more rails
    /^read more\.?$/i,
    /^related (articles?|stories|posts|reads?|content|news)\.?$/i,
    /^you may also (like|be interested in|enjoy)/i,
    /^more (articles?|stories|from|like this)/i,
    /^continue reading\.?$/i,
    /^next article\.?$/i,
    /^up next\.?$/i,
    /^also on the site\.?$/i,
    /^recommended (for you|articles?|stories)\.?$/i,

    // Comment-section preambles
    /^\d+ comments?\.?$/i,
    /^show (\d+ )?comments?\.?$/i,
    /^add (a )?comment\.?$/i,
    /^log in to comment\.?$/i,
    /^join the conversation\.?$/i,
    /^be the first to comment\.?$/i,
    /^view comments\.?$/i,

    // Copyright / ToS / policy footers
    /^©\s*\d{4}/,
    /^copyright\s*©?\s*\d{4}/i,
    /^all rights reserved\.?$/i,
    /^terms (of service|of use|& conditions)\.?$/i,
    /^privacy policy\.?$/i,
    /^contact us\.?$/i,
    /^about us\.?$/i,

    // Encyclopedia structural section headers
    /^\[edit\]\.?$/i,
    /^references\.?$/i,
    /^external links\.?$/i,
    /^see also\.?$/i,
    /^further reading\.?$/i,
    /^notes\.?$/i,
    /^bibliography\.?$/i,
    /^citations?\.?$/i,
  ];

  cleaned = cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^[-:| ]+$/.test(line))
    .filter((line) => !(line.split(/\s+/).length === 1 && line.length <= 2))
    .filter(
      (line) => !discardLinePatterns.some((pattern) => pattern.test(line)),
    )
    .join('\n');

  // --- Dedupe substantial repeated paragraphs ------------------------
  // CMS templating sometimes emits the same lede or boilerplate twice.
  // Short lines (headers, single-word labels) can legitimately repeat,
  // so only dedupe lines over a threshold.
  const seenSubstantial = new Set<string>();
  cleaned = cleaned
    .split('\n')
    .filter((line) => {
      if (line.length < 80) return true;
      const key = line.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenSubstantial.has(key)) return false;
      seenSubstantial.add(key);
      return true;
    })
    .join('\n');

  // Collapse triple+ newlines and trim.
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
