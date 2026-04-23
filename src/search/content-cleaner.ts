export function cleanContent(dirty: string): string {
  const discardLinePatterns = [
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
  ];

  let cleaned = dirty.replace(/\r\n/g, '\n');

  cleaned = cleaned.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
  cleaned = cleaned.replace(/\[(Image|Video)\s+\d+:[^\]]*]/gi, ' ');
  cleaned = cleaned.replace(/\[(Image|Video)\s+\d+]/gi, ' ');
  cleaned = cleaned.replace(/\[([^\]]+)]\(([^)]*)\)/g, '$1');
  cleaned = cleaned.replace(/https?:\/\/\S+/g, ' ');
  cleaned = cleaned.replace(/[|]{2,}/g, ' ');
  cleaned = cleaned.replace(/[#*_`>~]/g, ' ');

  cleaned = cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !discardLinePatterns.some((pattern) => pattern.test(line)))
    .join('\n');

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
