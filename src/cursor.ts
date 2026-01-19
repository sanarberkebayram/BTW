export interface CursorKey {
  repo_id: string;
  id: string;
}

export function decodeCursorKey(cursor?: string | null): CursorKey | null {
  if (!cursor) {
    return null;
  }
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<CursorKey>;
    if (
      typeof parsed.repo_id !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.repo_id.length === 0 ||
      parsed.id.length === 0
    ) {
      return null;
    }
    return { repo_id: parsed.repo_id, id: parsed.id };
  } catch {
    return null;
  }
}

export function encodeCursorKey(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString("base64");
}

export function compareCursorKeys(a: CursorKey, b: CursorKey): number {
  if (a.repo_id < b.repo_id) {
    return -1;
  }
  if (a.repo_id > b.repo_id) {
    return 1;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}
