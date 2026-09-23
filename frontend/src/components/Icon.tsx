const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  plus: 'M12 5v14 M5 12h14', folder: 'M3 7V5h6l2 2h10v13H3z',
  chat: 'M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z M7 10h10 M7 14h6',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  code: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16', play: 'm8 4 13 8-13 8Z',
  arrow: 'M5 12h14 M13 6l6 6-6 6', check: 'm5 12 4 4L19 6', close: 'm6 6 12 12 M18 6 6 18',
  reset: 'M3 10a9 9 0 1 1 1 7 M3 4v6h6', leaf: 'M20 3C10 2 3 7 4 14c1 6 11 8 14 1 2-4 2-8 2-12Z M4 21 15 10',
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.grid} /></svg>; }
