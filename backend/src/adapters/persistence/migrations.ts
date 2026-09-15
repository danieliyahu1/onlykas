import type { Client } from "@libsql/client";

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "canonical_schema",
    statements: [
      `CREATE TABLE auth_challenges (
        id TEXT PRIMARY KEY NOT NULL,
        nonce TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL,
        origin TEXT NOT NULL,
        network TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0),
        consumed_at INTEGER
      )`,
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        address TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0)
      )`,
      `CREATE TABLE profiles (
        address TEXT PRIMARY KEY NOT NULL,
        display_name TEXT,
        is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
        updated_at INTEGER NOT NULL CHECK (updated_at > 0)
      )`,
      `CREATE TABLE posts (
        id TEXT PRIMARY KEY NOT NULL,
        creator TEXT NOT NULL,
        caption TEXT NOT NULL,
        price_sompi TEXT NOT NULL,
        media_type TEXT NOT NULL,
        media_size INTEGER NOT NULL CHECK (media_size > 0),
        media_digest TEXT NOT NULL UNIQUE,
        media_key TEXT NOT NULL,
        published_at INTEGER NOT NULL CHECK (published_at > 0)
      )`,
      `CREATE TABLE purchases (
        post_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        transaction_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (post_id, buyer)
      )`,
      `CREATE TABLE creator_covenants (
        creator TEXT PRIMARY KEY NOT NULL,
        covenant_id TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE membership_purchases (
        transaction_id TEXT PRIMARY KEY NOT NULL,
        buyer TEXT NOT NULL
      )`,
      `CREATE TABLE prepared_payments (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        amount_sompi TEXT NOT NULL,
        creator TEXT NOT NULL,
        post_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0)
      )`,
      `CREATE TABLE prepared_memberships (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        covenant_id TEXT NOT NULL,
        sign_inputs TEXT NOT NULL,
        member_output_index INTEGER,
        creator TEXT NOT NULL,
        buyer TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('offer', 'purchase')),
        expires_at INTEGER NOT NULL CHECK (expires_at > 0)
      )`,
      "CREATE INDEX posts_creator_date ON posts (creator, published_at DESC)",
      "CREATE INDEX purchases_buyer ON purchases (buyer)",
      "CREATE INDEX membership_purchases_buyer ON membership_purchases (buyer)",
      "CREATE INDEX auth_challenges_expiry ON auth_challenges (expires_at)",
      "CREATE INDEX sessions_expiry ON sessions (expires_at)",
      "CREATE INDEX prepared_payments_expiry ON prepared_payments (expires_at)",
      "CREATE INDEX prepared_memberships_expiry ON prepared_memberships (expires_at)",
    ],
  },
  {
    version: 2,
    name: "pending_publications",
    statements: [
      `CREATE TABLE pending_publications (
        post_id TEXT PRIMARY KEY NOT NULL,
        media_digest TEXT NOT NULL UNIQUE,
        media_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0)
      )`,
      "CREATE INDEX pending_publications_expiry ON pending_publications (expires_at)",
    ],
  },
  {
    version: 3,
    name: "payment_workflows",
    statements: [
      `CREATE TABLE payment_workflows (
        prepared_payment_id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
        transaction_id TEXT NOT NULL,
        rejection TEXT
      )`,
    ],
  },
  {
    version: 4,
    name: "membership_workflows",
    statements: [
      `CREATE TABLE membership_workflows (
        prepared_membership_id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('SUBMITTED', 'CONFIRMED', 'REJECTED')),
        transaction_id TEXT NOT NULL,
        rejection TEXT
      )`,
    ],
  },
  {
    version: 5,
    name: "feedback_outbox",
    statements: [
      `CREATE TABLE feedback_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        message TEXT NOT NULL,
        received_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER
      )`,
      "CREATE INDEX feedback_outbox_delivery ON feedback_outbox (lease_until, received_at)",
    ],
  },
];

export async function applyMigrations(client: Client): Promise<void> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = await client.execute(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const versions = new Set(
    applied.rows.map((row) => requireInteger(row.version, "migration version")),
  );

  for (const migration of migrations) {
    if (versions.has(migration.version)) continue;
    const statements = migration.statements.map((sql) => ({
      sql,
      args: [],
    }));
    await client.batch(
      [
        ...statements,
        {
          sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          args: [migration.version, migration.name, Date.now()],
        },
      ],
      "write",
    );
  }
}

export async function resetDatabase(client: Client): Promise<void> {
  const tables = [
    "feedback_outbox",
    "membership_workflows",
    "payment_workflows",
    "pending_publications",
    "prepared_memberships",
    "prepared_payments",
    "membership_purchases",
    "creator_covenants",
    "purchases",
    "posts",
    "profiles",
    "sessions",
    "auth_challenges",
    "schema_migrations",
  ];
  await client.batch(
    tables.map((table) => ({ sql: `DROP TABLE IF EXISTS ${table}`, args: [] })),
    "write",
  );
  await applyMigrations(client);
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`INVALID_${label.toUpperCase().replaceAll(" ", "_")}`);
  }
  return value;
}
