import { createClient } from "@libsql/client";
import { applyMigrations, migrations, resetDatabase } from "./migrations.js";

describe("database migrations", () => {
  it("applies each migration once and records its version", async () => {
    const client = createClient({ url: "file::memory:" });

    await applyMigrations(client);
    await applyMigrations(client);

    const versions = await client.execute(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    expect(versions.rows).toEqual(
      migrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
      })),
    );
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'posts'",
    );
    expect(tables.rows).toHaveLength(1);
  });

  it("resets data and reapplies the canonical schema", async () => {
    const client = createClient({ url: "file::memory:" });
    await applyMigrations(client);
    await client.execute({
      sql: "INSERT INTO profiles (address, display_name, is_public, updated_at) VALUES (?, ?, ?, ?)",
      args: ["kaspatest:reset", "Reset", 1, 1_000_000],
    });

    await resetDatabase(client);

    const profile = await client.execute(
      "SELECT * FROM profiles WHERE address = 'kaspatest:reset'",
    );
    expect(profile.rows).toHaveLength(0);
    const versions = await client.execute("SELECT version FROM schema_migrations");
    expect(versions.rows).toHaveLength(migrations.length);
  });

  it("enforces media uniqueness per creator", async () => {
    const client = createClient({ url: "file::memory:" });
    await applyMigrations(client);
    const insert = (id: string, creator: string) =>
      client.execute({
        sql: "INSERT INTO posts (id,creator,caption,price_sompi,media_type,media_size,media_digest,media_key,published_at) VALUES (?,?,?,?,?,?,?,?,?)",
        args: [id, creator, "caption", "1", "image/jpeg", 10, "shared-digest", "key", 1],
      });

    await insert("post-a", "kaspatest:a");
    await insert("post-b", "kaspatest:b");
    await expect(insert("post-c", "kaspatest:a")).rejects.toThrow();
  });
});
