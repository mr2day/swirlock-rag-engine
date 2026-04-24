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
  ];

  let cleaned = dirty.replace(/\r\n/g, '\n');

  cleaned = cleaned.replace(/\u00c2\u00b0/g, '\u00b0');
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
    .filter((line) => !/^[-:| ]+$/.test(line))
    .filter((line) => !(line.split(/\s+/).length === 1 && line.length <= 2))
    .filter(
      (line) => !discardLinePatterns.some((pattern) => pattern.test(line)),
    )
    .join('\n');

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
