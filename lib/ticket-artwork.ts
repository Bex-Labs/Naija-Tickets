// Keep line breaks in the artwork itself so screen, print and image export
// cannot independently reflow the ticket. Long words are split, never dropped.
function lineWidth(value: string) {
  return Array.from(value).reduce(
    (sum, character) =>
      sum +
      (/[WM@%]/.test(character)
        ? 1.6
        : (character.codePointAt(0) || 0) > 0x024f
          ? 1.8
          : 1),
    0,
  );
}

export function ticketTextLines(value: string, limit: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const chunks = Array.from(word).reduce<string[]>((parts, character) => {
      if (
        !parts.length ||
        lineWidth(parts[parts.length - 1] + character) > limit
      )
        parts.push(character);
      else parts[parts.length - 1] += character;
      return parts;
    }, []);
    for (const chunk of chunks) {
      if (lineWidth(line ? `${line} ${chunk}` : chunk) > limit) {
        lines.push(line);
        line = chunk;
      } else line = line ? `${line} ${chunk}` : chunk;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
