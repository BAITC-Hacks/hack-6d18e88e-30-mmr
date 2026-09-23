/** JSON.parse alone accepts duplicate keys and overflowing numeric literals. */
export function parseStrictAiJson(text: string): unknown {
  const stack: ({ keys: Set<string>; keyExpected: boolean } | null)[] = [];
  // Strings are consumed whole so braces, commas and escaped quotes inside them
  // cannot affect nesting or object-key detection. JSON.parse checks full syntax.
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^\s{}[\],:"]+/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    const current = stack.at(-1);
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? { keys: new Set(), keyExpected: true } : null);
      if (stack.length > 32) throw new Error('AI JSON exceeds nesting limit.');
    } else if (token === '}' || token === ']') {
      stack.pop();
    } else if (token === ',' && current) {
      current.keyExpected = true;
    } else if (token === ':' && current) {
      current.keyExpected = false;
    } else if (token.startsWith('"') && current?.keyExpected) {
      const key = JSON.parse(token) as string;
      if (current.keys.has(key)) throw new Error('AI JSON contains a duplicate key.');
      current.keys.add(key);
    }
  }
  const parsed: unknown = JSON.parse(text);
  const pending: unknown[] = [parsed];
  let nodes = 0;
  while (pending.length) {
    const value = pending.pop();
    if (++nodes > 10000) throw new Error('AI JSON exceeds node limit.');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('AI JSON contains a non-finite number.');
    if (typeof value === 'string') {
      for (const character of value) {
        const code = character.codePointAt(0)!;
        if (code >= 0xd800 && code <= 0xdfff) throw new Error('AI JSON contains invalid Unicode.');
      }
    } else if (value && typeof value === 'object') {
      if (Array.isArray(value)) pending.push(...value);
      else for (const [key, child] of Object.entries(value)) pending.push(key, child);
    }
  }
  return parsed;
}
