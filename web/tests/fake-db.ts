// A small stand-in for PostgREST, for tests that run lib functions end to end.
//
// It keeps rows in memory and answers the chains the lib functions use:
// select (with one level of embedded children, `promotion_products(product_id)`),
// insert, update, upsert and delete, filtered by eq and in, ordered, limited
// and ranged, ending in a plain await, single() or maybeSingle(). Like
// PostgREST, an update or delete that matches nothing succeeds with no rows.
// `refuse` makes a table answer one operation the way a refusal does, so the
// callers' handling of it can be checked.

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "upsert" | "delete";

export type FakeDb = {
  tables: Record<string, Row[]>;
  /** "table:op" → the error that operation answers with. */
  refuse: Map<string, { message: string; code?: string; hint?: string }>;
  userId: string | null;
  writes: { table: string; op: Op; rows: Row[] }[];
};

export function fakeDb(tables: Record<string, Row[]>, userId: string | null = "user-1"): FakeDb {
  return { tables, refuse: new Map(), userId, writes: [] };
}

let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

/** The child tables a select embeds: `promotion_products(product_id)` → "promotion_products". */
function embeds(select: string): string[] {
  return [...select.matchAll(/(\w+)\([^)]*\)/g)].map((m) => m[1]);
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: Op = "select";
  private columns = "*";
  private payload: Row[] = [];
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private cap: number | null = null;
  private from_ = 0;
  private to_: number | null = null;
  private returning = false;
  private one: "single" | "maybe" | null = null;
  private conflict: string | null = null;

  private db: FakeDb;
  private table: string;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(columns = "*") {
    if (this.op === "select") this.columns = columns;
    else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = opts?.onConflict ?? "id";
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = [values];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.cap = n;
    return this;
  }
  range(from: number, to: number) {
    this.from_ = from;
    this.to_ = to;
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }

  private run(): { data: unknown; error: unknown } {
    const refused = this.db.refuse.get(`${this.table}:${this.op}`);
    if (refused) return { data: null, error: refused };
    let out: Row[];
    if (this.op === "select") {
      out = this.rows().filter((r) => this.filters.every((f) => f(r)));
      for (const o of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[o.col] as string | number | boolean;
          const y = b[o.col] as string | number | boolean;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      out = out.slice(this.from_, this.to_ === null ? undefined : this.to_ + 1);
      if (this.cap !== null) out = out.slice(0, this.cap);
      const nested = embeds(this.columns);
      if (nested.length) {
        const fk = `${this.table.replace(/s$/, "")}_id`;
        out = out.map((r) => ({
          ...r,
          ...Object.fromEntries(nested.map((n) => [n, (this.db.tables[n] ?? []).filter((c) => c[fk] === r.id)])),
        }));
      }
    } else if (this.op === "insert" || this.op === "upsert") {
      out = [];
      for (const p of this.payload) {
        const key = this.conflict;
        const existing = key ? this.rows().find((r) => r[key] === p[key]) : undefined;
        if (existing && this.op === "upsert") {
          Object.assign(existing, p);
          out.push(existing);
        } else {
          const row = { id: newId(), created_at: "2026-10-25T08:00:00Z", updated_at: "2026-10-25T08:00:00Z", ...p };
          this.rows().push(row);
          out.push(row);
        }
      }
      this.db.writes.push({ table: this.table, op: this.op, rows: out });
    } else if (this.op === "update") {
      out = this.rows().filter((r) => this.filters.every((f) => f(r)));
      for (const r of out) Object.assign(r, this.payload[0], { updated_at: "2026-10-25T09:00:00Z" });
      this.db.writes.push({ table: this.table, op: "update", rows: out });
    } else {
      out = this.rows().filter((r) => this.filters.every((f) => f(r)));
      this.db.tables[this.table] = this.rows().filter((r) => !out.includes(r));
      this.db.writes.push({ table: this.table, op: "delete", rows: out });
    }
    const data = this.op === "select" || this.returning ? out.map((r) => ({ ...r })) : null;
    if (this.one) {
      const list = (data ?? []) as Row[];
      if (this.one === "single" && list.length !== 1) return { data: null, error: { message: "not one row" } };
      return { data: list[0] ?? null, error: null };
    }
    return { data, error: null };
  }

  then<A = { data: unknown; error: unknown }, B = never>(
    ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

/** The client the lib functions are handed. */
export function fakeClient(db: FakeDb) {
  return {
    from: (table: string) => new Query(db, table),
    auth: { getUser: async () => ({ data: { user: db.userId ? { id: db.userId } : null }, error: null }) },
  } as never;
}
