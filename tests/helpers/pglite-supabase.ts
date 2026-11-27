/**
 * A minimal stand-in for the Supabase (PostgREST) client, backed by PGlite, so the REAL ingestion
 * code can run against a real Postgres in tests. It implements only what ingestion and settings
 * use: from(t).select / insert / upsert / update / delete, the eq / neq / lt / lte / gt / gte / in /
 * is filters, order, limit, range, single and maybeSingle, with PostgREST's result shape
 * ({ data, error }) and its semantics:
 *   - upsert = INSERT ... ON CONFLICT (onConflict) DO UPDATE SET every sent column;
 *   - a bulk write sends the union of keys, and a row missing a key writes NULL (defaultToNull);
 *   - nothing is returned unless .select() is chained after a write;
 *   - single() errors unless exactly one row; maybeSingle() allows zero.
 * Unsupported calls throw loudly, so a test can never silently pass on a missing feature.
 */
import type { PGlite } from "@electric-sql/pglite";

type Row = Record<string, unknown>;

/** Round-trips made through the adapter (lets tests check that work is batched). */
export const adapterStats = { queries: 0 };
type Op = "select" | "insert" | "upsert" | "update" | "delete";
interface Result { data: unknown; error: { message: string; code?: string } | null }

const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`pglite-supabase: unsupported identifier "${name}"`);
  return `"${name}"`;
};

const columnList = (cols: string): string =>
  cols.trim() === "*" ? "*" : cols.split(",").map((c) => ident(c.trim())).join(", ");

/** JSON-ish values go to jsonb columns as text; PostgREST returns dates/bigints as JSON. */
const toParam = (v: unknown): unknown =>
  v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;

const fromDb = (row: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : v;
  }
  return out;
};

class Query implements PromiseLike<Result> {
  private op: Op | null = null;
  private returning: string | null = null;
  private rows: Row[] = [];
  private patch: Row = {};
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private filters: Array<{ sql: (p: (v: unknown) => string) => string }> = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private cardinality: "many" | "single" | "maybe" = "many";

  private db: PGlite;
  private table: string;

  constructor(db: PGlite, table: string) {
    this.db = db;
    this.table = table;
  }

  select(cols = "*"): this {
    if (this.op === null) this.op = "select";
    this.returning = cols;
    return this;
  }
  insert(values: Row | Row[]): this {
    this.op = "insert";
    this.rows = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = "upsert";
    this.rows = Array.isArray(values) ? values : [values];
    this.onConflict = opts.onConflict ?? null;
    this.ignoreDuplicates = opts.ignoreDuplicates ?? false;
    return this;
  }
  update(values: Row): this {
    this.op = "update";
    this.patch = values;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  private cmp(col: string, op: string, value: unknown): this {
    this.filters.push({ sql: (p) => `${ident(col)} ${op} ${p(value)}` });
    return this;
  }
  eq(c: string, v: unknown) { return this.cmp(c, "=", v); }
  neq(c: string, v: unknown) { return this.cmp(c, "<>", v); }
  lt(c: string, v: unknown) { return this.cmp(c, "<", v); }
  lte(c: string, v: unknown) { return this.cmp(c, "<=", v); }
  gt(c: string, v: unknown) { return this.cmp(c, ">", v); }
  gte(c: string, v: unknown) { return this.cmp(c, ">=", v); }
  in(col: string, values: unknown[]): this {
    this.filters.push({
      sql: (p) => (values.length === 0 ? "FALSE" : `${ident(col)} IN (${values.map((v) => p(v)).join(", ")})`),
    });
    return this;
  }
  is(col: string, value: null | boolean): this {
    this.filters.push({ sql: () => `${ident(col)} IS ${value === null ? "NULL" : value ? "TRUE" : "FALSE"}` });
    return this;
  }
  order(col: string, opts: { ascending?: boolean; referencedTable?: string } = {}): this {
    if (opts.referencedTable) throw new Error("pglite-supabase: embedded ordering is not supported");
    this.orders.push(`${ident(col)} ${opts.ascending === false ? "DESC" : "ASC"}`);
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }
  single(): this {
    this.cardinality = "single";
    return this;
  }
  maybeSingle(): this {
    this.cardinality = "maybe";
    return this;
  }
  /** Not supported (and not used by ingestion): fail loudly. */
  or(): never {
    throw new Error("pglite-supabase: .or() is not supported");
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<Result> {
    const params: unknown[] = [];
    const p = (v: unknown): string => {
      params.push(toParam(v));
      return `$${params.length}`;
    };
    const where = this.filters.length ? ` WHERE ${this.filters.map((f) => f.sql(p)).join(" AND ")}` : "";
    const t = ident(this.table);
    let sql: string;

    switch (this.op) {
      case "select":
        sql =
          `SELECT ${columnList(this.returning ?? "*")} FROM ${t}${where}` +
          (this.orders.length ? ` ORDER BY ${this.orders.join(", ")}` : "") +
          (this.limitN !== null ? ` LIMIT ${this.limitN}` : "") +
          (this.offsetN !== null ? ` OFFSET ${this.offsetN}` : "");
        break;
      case "insert":
      case "upsert": {
        if (this.rows.length === 0) return { data: [], error: null };
        const cols = Array.from(new Set(this.rows.flatMap((r) => Object.keys(r))));
        const values = this.rows
          .map((r) => `(${cols.map((c) => (c in r ? p(r[c]) : "NULL")).join(", ")})`)
          .join(", ");
        sql = `INSERT INTO ${t} (${cols.map(ident).join(", ")}) VALUES ${values}`;
        if (this.op === "upsert") {
          const conflict = (this.onConflict ?? "id").split(",").map((c) => ident(c.trim())).join(", ");
          sql += this.ignoreDuplicates
            ? ` ON CONFLICT (${conflict}) DO NOTHING`
            : ` ON CONFLICT (${conflict}) DO UPDATE SET ${cols.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(", ")}`;
        }
        if (this.returning) sql += ` RETURNING ${columnList(this.returning)}`;
        break;
      }
      case "update": {
        // SET placeholders must come before the WHERE ones, so build it on its own.
        const built = this.buildUpdate();
        return this.run(built.sql, built.params);
      }
      case "delete":
        sql = `DELETE FROM ${t}${where}` + (this.returning ? ` RETURNING ${columnList(this.returning)}` : "");
        break;
      default:
        throw new Error("pglite-supabase: no operation chosen");
    }
    return this.run(sql, params);
  }

  private buildUpdate(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const p = (v: unknown): string => {
      params.push(toParam(v));
      return `$${params.length}`;
    };
    const sets = Object.entries(this.patch).map(([c, v]) => `${ident(c)} = ${p(v)}`).join(", ");
    const whereSql = this.filters.length ? ` WHERE ${this.filters.map((f) => f.sql(p)).join(" AND ")}` : "";
    const sql =
      `UPDATE ${ident(this.table)} SET ${sets}${whereSql}` +
      (this.returning ? ` RETURNING ${columnList(this.returning)}` : "");
    return { sql, params };
  }

  private async run(sql: string, params: unknown[]): Promise<Result> {
    adapterStats.queries++;
    try {
      const res = await this.db.query<Row>(sql, params);
      const rows = res.rows.map(fromDb);
      const wantsRows = this.op === "select" || this.returning !== null;
      if (!wantsRows) return { data: null, error: null };
      if (this.cardinality === "many") return { data: rows, error: null };
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0 && this.cardinality === "maybe") return { data: null, error: null };
      return {
        data: null,
        error: { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned (${rows.length})` },
      };
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string };
      return { data: null, error: { message: e.message ?? String(err), code: e.code } };
    }
  }
}

/**
 * rpc() for functions returning a single value (or void), as PostgREST does: named arguments,
 * the scalar as `data`. Set-returning functions are not supported here.
 */
async function rpc(db: PGlite, fn: string, args: Record<string, unknown> = {}): Promise<Result> {
  const names = Object.keys(args);
  const params = names.map((n) => toParam(args[n]));
  const call = `${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ")})`;
  adapterStats.queries++;
  try {
    const res = await db.query<{ result: unknown }>(`SELECT ${call} AS result`, params);
    const value = res.rows[0]?.result;
    return { data: value === undefined || value === "" ? null : value, error: null };
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string };
    return { data: null, error: { message: e.message ?? String(err), code: e.code } };
  }
}

/** Something shaped enough like a SupabaseClient for ingestion; cast at the call site. */
export function pgliteSupabase(db: PGlite): {
  from: (table: string) => Query;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<Result>;
} {
  return { from: (table: string) => new Query(db, table), rpc: (fn, args) => rpc(db, fn, args) };
}
