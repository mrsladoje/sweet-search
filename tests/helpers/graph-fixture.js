/**
 * Code-graph test fixtures on the real schema (createGraphSchema).
 *
 * The full build fills the lexical FTS tables in bulk; fixtures that insert entity rows one
 * at a time add these triggers so every FTS table stays in sync with `entities`.
 */
import { createGraphSchema } from '../../core/graph/graph-extractor.js';

export function createGraphFixtureSchema(db) {
  createGraphSchema(db);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS entities_fixture_ai AFTER INSERT ON entities BEGIN
      INSERT INTO entities_fts(rowid, name, name_alias, signature, doc_comment)
      VALUES (NEW.rowid, NEW.name, NEW.name_alias, NEW.signature, NEW.doc_comment);
      INSERT INTO entities_code_fts(rowid, name, name_alias, signature)
      VALUES (NEW.rowid, NEW.name, NEW.name_alias, NEW.signature);
      INSERT INTO entities_trigram(rowid, name, signature)
      VALUES (NEW.rowid, NEW.name, NEW.signature);
    END;

    CREATE TRIGGER IF NOT EXISTS entities_fixture_ad AFTER DELETE ON entities BEGIN
      INSERT INTO entities_fts(entities_fts, rowid, name, name_alias, signature, doc_comment)
      VALUES('delete', OLD.rowid, OLD.name, OLD.name_alias, OLD.signature, OLD.doc_comment);
      INSERT INTO entities_code_fts(entities_code_fts, rowid, name, name_alias, signature)
      VALUES('delete', OLD.rowid, OLD.name, OLD.name_alias, OLD.signature);
      INSERT INTO entities_trigram(entities_trigram, rowid, name, signature)
      VALUES('delete', OLD.rowid, OLD.name, OLD.signature);
    END;
  `);
  return db;
}
