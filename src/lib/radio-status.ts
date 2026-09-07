export interface ParsedStatus {
  song: string | null;
  listeners: number | null;
}

export function parseIcecast(body: string, mount?: string): ParsedStatus {
  try {
    const json = JSON.parse(body);
    const stats = json?.icestats;
    if (!stats) return { song: null, listeners: null };
    let sources = stats.source;
    if (!sources) return { song: null, listeners: null };
    if (!Array.isArray(sources)) sources = [sources];
    let target = sources;
    if (mount) {
      const match = sources.find((s: { mount?: string }) => s.mount === mount);
      if (match) target = [match];
    }
    const first = target[0];
    if (!first) return { song: null, listeners: null };
    const song =
      typeof first.title === "string" && first.title.trim() && first.title !== "Untitled"
        ? first.title.trim()
        : null;
    const listeners = typeof first.listeners === "number" ? first.listeners : null;
    return { song, listeners };
  } catch {
    return { song: null, listeners: null };
  }
}

export function parseShoutcast7(body: string): ParsedStatus {
  // Classic DNAS v1: 0,current,peak,max,unique,bitrate,song
  const m = body.match(/^\s*(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(.*)$/);
  if (!m) return { song: null, listeners: null };
  const listeners = Number(m[2]);
  return { song: m[7]?.trim() || null, listeners: Number.isFinite(listeners) ? listeners : null };
}

export function parseShoutcastStats(body: string): ParsedStatus {
  try {
    const json = JSON.parse(body);
    const song = typeof json?.songtitle === "string" && json.songtitle.trim() ? json.songtitle.trim() : null;
    const raw = json?.currentlisteners ?? json?.listeners;
    const listeners = typeof raw === "number" ? raw : null;
    return { song, listeners };
  } catch {
    return { song: null, listeners: null };
  }
}