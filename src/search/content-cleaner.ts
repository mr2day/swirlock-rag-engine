export function cleanContent(dirty: string): string {
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
    .join('\n');

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
