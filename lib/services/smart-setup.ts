/**
 * Smart-paste parser for the Settings "Connect Apify" box.
 *
 * Lets an admin paste ANYTHING (a bare token, a .env snippet, a console URL, a
 * chat message) and extracts the credentials/IDs inside it. Pure and
 * deterministic: secrets are never sent to a third-party LLM.
 */

export interface DetectedCredentials {
  apifyToken?: string;
  taskId?: string;
  /** Actor IDs or "username/actor-name" slugs found in the text. */
  actorIds: string[];
  /** Human-readable list of what was recognised (never contains secret values). */
  recognised: string[];
}

const PLACEHOLDER = /^(your-|<|\[|changeme|placeholder|example|not-configured|xxx)/i;

function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().replace(/^["'`]+|["'`,;]+$/g, "");
  if (!v || PLACEHOLDER.test(v)) return undefined;
  return v;
}

const RESERVED_SEGMENTS = new Set(["tasks", "runs", "actors", "store", "schedules", "integrations", "settings"]);

export function detectCredentials(rawText: string): DetectedCredentials {
  const text = rawText.slice(0, 20_000); // hard cap: this is user-supplied
  const recognised: string[] = [];
  const result: DetectedCredentials = { actorIds: [], recognised };

  // --- API token -------------------------------------------------------------
  const envToken = clean(text.match(/APIFY_API_TOKEN\s*[=:]\s*(\S+)/i)?.[1]);
  const bareToken = text.match(/apify_api_[A-Za-z0-9]{20,}/)?.[0];
  const token = bareToken ?? envToken;
  if (token) {
    result.apifyToken = token;
    recognised.push("Apify API token");
  }

  // --- Task ID -------------------------------------------------------------------
  const taskFromEnv = clean(text.match(/APIFY_TASK_ID\s*[=:]\s*(\S+)/i)?.[1]);
  const taskFromUrl =
    text.match(/console\.apify\.com\/actors\/tasks\/([A-Za-z0-9]{8,32})/i)?.[1] ??
    text.match(/api\.apify\.com\/v2\/actor-tasks\/([A-Za-z0-9~._-]{8,64})/i)?.[1];
  const taskId = taskFromEnv ?? taskFromUrl;
  if (taskId) {
    result.taskId = taskId;
    recognised.push("Apify Task ID");
  }

  // --- Actor IDs / slugs -----------------------------------------------------------
  const actors = new Set<string>();
  const envActor = clean(text.match(/APIFY_(?:INSTAGRAM_)?ACTOR_ID\s*[=:]\s*(\S+)/i)?.[1]);
  if (envActor) actors.add(envActor);

  for (const m of text.matchAll(/console\.apify\.com\/actors\/([A-Za-z0-9]{8,32})(?![A-Za-z0-9])/gi)) {
    if (!RESERVED_SEGMENTS.has(m[1].toLowerCase())) actors.add(m[1]);
  }
  for (const m of text.matchAll(/api\.apify\.com\/v2\/acts\/([A-Za-z0-9~._-]{3,64})/gi)) {
    actors.add(m[1].replace("~", "/"));
  }
  for (const m of text.matchAll(/(?<![\w.-])apify\.com\/([a-z0-9_-]+)\/([a-z0-9_-]+)/gi)) {
    if (!RESERVED_SEGMENTS.has(m[1].toLowerCase())) actors.add(`${m[1]}/${m[2]}`);
  }
  result.actorIds = Array.from(actors);
  if (result.actorIds.length > 0) recognised.push(`${result.actorIds.length} Actor reference(s)`);

  return result;
}

/**
 * Picks the most likely Instagram-scraper Task from an account's task list.
 * Returns the single best candidate, or null when the choice is ambiguous.
 */
export interface TaskSummary {
  id: string;
  actId: string;
  name: string;
  title?: string;
}

export function pickInstagramTask(
  tasks: TaskSummary[],
  knownInstagramActorId: string
): { picked: TaskSummary | null; candidates: TaskSummary[] } {
  const candidates = tasks.filter(
    (t) =>
      t.actId === knownInstagramActorId ||
      /insta/i.test(t.name) ||
      /insta/i.test(t.title ?? "")
  );
  return { picked: candidates.length === 1 ? candidates[0] : null, candidates };
}
