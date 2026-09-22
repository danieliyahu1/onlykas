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
      `CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY NOT NULL,
        nonce TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL,
        origin TEXT NOT NULL,
        network TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0),
        consumed_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        address TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0)
      )`,
      `CREATE TABLE IF NOT EXISTS profiles (
        address TEXT PRIMARY KEY NOT NULL,
        display_name TEXT,
        is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
        updated_at INTEGER NOT NULL CHECK (updated_at > 0)
      )`,
      `CREATE TABLE IF NOT EXISTS posts (
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
      `CREATE TABLE IF NOT EXISTS purchases (
        post_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        transaction_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (post_id, buyer)
      )`,
      `CREATE TABLE IF NOT EXISTS creator_covenants (
        creator TEXT PRIMARY KEY NOT NULL,
        covenant_id TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS membership_purchases (
        transaction_id TEXT PRIMARY KEY NOT NULL,
        buyer TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS prepared_payments (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        amount_sompi TEXT NOT NULL,
        creator TEXT NOT NULL,
        post_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0)
      )`,
      `CREATE TABLE IF NOT EXISTS prepared_memberships (
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
      "CREATE INDEX IF NOT EXISTS posts_creator_date ON posts (creator, published_at DESC)",
      "CREATE INDEX IF NOT EXISTS purchases_buyer ON purchases (buyer)",
      "CREATE INDEX IF NOT EXISTS membership_purchases_buyer ON membership_purchases (buyer)",
      "CREATE INDEX IF NOT EXISTS auth_challenges_expiry ON auth_challenges (expires_at)",
      "CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at)",
      "CREATE INDEX IF NOT EXISTS prepared_payments_expiry ON prepared_payments (expires_at)",
      "CREATE INDEX IF NOT EXISTS prepared_memberships_expiry ON prepared_memberships (expires_at)",
    ],
  },
  {
    version: 2,
    name: "pending_publications",
    statements: [
      `CREATE TABLE IF NOT EXISTS pending_publications (
        post_id TEXT PRIMARY KEY NOT NULL,
        media_digest TEXT NOT NULL UNIQUE,
        media_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0)
      )`,
      "CREATE INDEX IF NOT EXISTS pending_publications_expiry ON pending_publications (expires_at)",
    ],
  },
  {
    version: 3,
    name: "payment_workflows",
    statements: [
      `CREATE TABLE IF NOT EXISTS payment_workflows (
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
      `CREATE TABLE IF NOT EXISTS membership_workflows (
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
      `CREATE TABLE IF NOT EXISTS feedback_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        message TEXT NOT NULL,
        received_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER
      )`,
      "CREATE INDEX IF NOT EXISTS feedback_outbox_delivery ON feedback_outbox (lease_until, received_at)",
    ],
  },
  {
    version: 6,
    name: "per_creator_media_dedupe",
    statements: [
      `CREATE TABLE posts_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        creator TEXT NOT NULL,
        caption TEXT NOT NULL,
        price_sompi TEXT NOT NULL,
        media_type TEXT NOT NULL,
        media_size INTEGER NOT NULL CHECK (media_size > 0),
        media_digest TEXT NOT NULL,
        media_key TEXT NOT NULL,
        published_at INTEGER NOT NULL CHECK (published_at > 0),
        UNIQUE (creator, media_digest)
      )`,
      `INSERT INTO posts_v2 (id,creator,caption,price_sompi,media_type,media_size,media_digest,media_key,published_at)
        SELECT id,creator,caption,price_sompi,media_type,media_size,media_digest,media_key,published_at FROM posts`,
      "DROP TABLE posts",
      "ALTER TABLE posts_v2 RENAME TO posts",
      "CREATE INDEX IF NOT EXISTS posts_creator_date ON posts (creator, published_at DESC)",
      "DROP TABLE pending_publications",
      `CREATE TABLE pending_publications (
        post_id TEXT PRIMARY KEY NOT NULL,
        creator TEXT NOT NULL,
        media_digest TEXT NOT NULL,
        media_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > 0),
        UNIQUE (creator, media_digest)
      )`,
      "CREATE INDEX IF NOT EXISTS pending_publications_expiry ON pending_publications (expires_at)",
    ],
  },
  {
    version: 7,
    name: "membership_receipt_creator",
    statements: [
      "ALTER TABLE membership_purchases ADD COLUMN creator TEXT",
      "DROP INDEX IF EXISTS membership_purchases_buyer",
      "CREATE INDEX IF NOT EXISTS membership_purchases_buyer_creator ON membership_purchases (buyer, creator)",
    ],
  },
  {
    version: 8,
    name: "versioned_membership_offers",
    statements: [
      "ALTER TABLE creator_covenants ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE creator_covenants ADD COLUMN price_sompi TEXT",
      "ALTER TABLE creator_covenants ADD COLUMN status TEXT NOT NULL DEFAULT 'LEGACY'",
      "ALTER TABLE prepared_memberships ADD COLUMN price_sompi TEXT",
      "ALTER TABLE prepared_memberships ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE membership_purchases ADD COLUMN covenant_id TEXT",
      "ALTER TABLE membership_purchases ADD COLUMN version INTEGER",
    ],
  },
  {
    version: 9,
    name: "membership_price_updates",
    statements: [
      `CREATE TABLE prepared_memberships_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        covenant_id TEXT NOT NULL,
        sign_inputs TEXT NOT NULL,
        member_output_index INTEGER,
        creator TEXT NOT NULL,
        buyer TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('offer', 'purchase', 'update')),
        expires_at INTEGER NOT NULL CHECK (expires_at > 0),
        price_sompi TEXT,
        version INTEGER NOT NULL DEFAULT 1
      )`,
      `INSERT INTO prepared_memberships_v2 SELECT * FROM prepared_memberships`,
      "DROP TABLE prepared_memberships",
      "ALTER TABLE prepared_memberships_v2 RENAME TO prepared_memberships",
      "CREATE INDEX IF NOT EXISTS prepared_memberships_expiry ON prepared_memberships (expires_at)",
    ],
  },
  {
    version: 10,
    name: "membership_cancellation_history",
    statements: [
      `CREATE TABLE creator_covenant_history (
        creator TEXT NOT NULL,
        covenant_id TEXT NOT NULL,
        price_sompi TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELED')),
        PRIMARY KEY (creator, covenant_id),
        UNIQUE (covenant_id)
      )`,
      `INSERT INTO creator_covenant_history (creator,covenant_id,price_sompi,status)
        SELECT creator,covenant_id,COALESCE(price_sompi,'0'),
          CASE WHEN status='CANCELED' THEN 'CANCELED' ELSE 'ACTIVE' END
        FROM creator_covenants`,
      `UPDATE creator_covenants SET status='ACTIVE' WHERE status='LEGACY'`,
      `CREATE TABLE prepared_memberships_v3 (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        covenant_id TEXT NOT NULL,
        sign_inputs TEXT NOT NULL,
        member_output_index INTEGER,
        creator TEXT NOT NULL,
        buyer TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('offer', 'purchase', 'update', 'cancel')),
        expires_at INTEGER NOT NULL CHECK (expires_at > 0),
        price_sompi TEXT,
        version INTEGER NOT NULL DEFAULT 1
      )`,
      `INSERT INTO prepared_memberships_v3 SELECT * FROM prepared_memberships`,
      "DROP TABLE prepared_memberships",
      "ALTER TABLE prepared_memberships_v3 RENAME TO prepared_memberships",
      "CREATE INDEX IF NOT EXISTS prepared_memberships_expiry ON prepared_memberships (expires_at)",
    ],
  },
  {
    version: 11,
    name: "backfill_covenant_prices",
    statements: [
      `UPDATE creator_covenants
       SET price_sompi = COALESCE(
         (SELECT h.price_sompi
          FROM creator_covenant_history h
          WHERE h.creator = creator_covenants.creator
            AND h.covenant_id = creator_covenants.covenant_id),
         '0'
       )
       WHERE price_sompi IS NULL`,
    ],
  },
  {
    version: 12,
    name: "workflow_reconciliation",
    statements: [
      "ALTER TABLE payment_workflows ADD COLUMN submitted_at INTEGER",
      "ALTER TABLE payment_workflows ADD COLUMN finalized_at INTEGER",
      "ALTER TABLE membership_workflows ADD COLUMN submitted_at INTEGER",
      "ALTER TABLE membership_workflows ADD COLUMN finalized_at INTEGER",
      "UPDATE payment_workflows SET submitted_at = 0 WHERE submitted_at IS NULL",
      "UPDATE membership_workflows SET submitted_at = 0 WHERE submitted_at IS NULL",
      "CREATE INDEX IF NOT EXISTS payment_workflows_reconcile ON payment_workflows (state, submitted_at)",
      "CREATE INDEX IF NOT EXISTS membership_workflows_reconcile ON membership_workflows (state, submitted_at)",
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
    "creator_covenant_history",
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
