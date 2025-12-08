import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// sql.js-fts5 is API-compatible with sql.js but includes FTS5 support
// @ts-ignore - Using sql.js types for sql.js-fts5
import initSqlJs from 'sql.js-fts5';
import type { Database, SqlValue } from 'sql.js';

const DB_PATH = path.join(app.getPath('userData'), 'icecubes.db');
// Use bundled WASM file with FTS5 support (from sql.js-fts5)
const WASM_PATHS = [
  path.join(__dirname, '..', 'renderer', 'assets', 'wasm', 'sql-wasm.wasm'), // Production
  path.join(__dirname, '../../assets/wasm/sql-wasm.wasm'), // Development
  path.join(__dirname, '../../node_modules/sql.js-fts5/dist/sql-wasm.wasm'), // Fallback
];

// Types
export interface Note {
  id: string;
  title: string;
  provider: string;
  date: string;
  transcript: string; // JSON string
  notes: string;
  enhancedNotes: string | null;
  audioPath: string | null;
  calendarEventId: string | null;
  startTime: string | null;
  folderId: string | null;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: number;
  name: string;
  email: string | null;
}

export interface Company {
  id: number;
  name: string;
  domain: string | null;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  icon: string;
  description?: string;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sections: string; // JSON string
  isBuiltIn: boolean;
  createdAt: string;
}

class DatabaseService {
  private db: Database | null = null;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isDirty = false;

  async initialize(): Promise<boolean> {
    try {
      console.log('[Database] Initializing sql.js...');
      
      // Initialize sql.js with WASM (with FTS5 support)
      const SQL = await initSqlJs({
        locateFile: (file: string) => {
          if (file === 'sql-wasm.wasm') {
            // Try multiple paths for bundled WASM with FTS5
            for (const p of WASM_PATHS) {
              if (fs.existsSync(p)) {
                console.log('[Database] Found WASM at:', p);
                return p;
              }
            }
            // Also try resourcesPath for packaged app
            const resourcePath = path.join(process.resourcesPath || '', 'assets', 'wasm', 'sql-wasm.wasm');
            if (fs.existsSync(resourcePath)) {
              console.log('[Database] Found WASM at:', resourcePath);
              return resourcePath;
            }
            // Fallback to CDN (requires network)
            console.log('[Database] Using CDN for WASM');
            return `https://sql.js.org/dist/${file}`;
          }
          return file;
        }
      });

      // Load existing database or create new one
      if (fs.existsSync(DB_PATH)) {
        console.log('[Database] Loading existing database from:', DB_PATH);
        const buffer = fs.readFileSync(DB_PATH);
        this.db = new SQL.Database(buffer);
      } else {
        console.log('[Database] Creating new database');
        this.db = new SQL.Database();
      }

      // Create tables
      this.createTables();
      
      // Set up auto-save
      this.setupAutoSave();

      console.log('[Database] ✅ Initialized successfully');
      return true;
    } catch (error) {
      console.error('[Database] ❌ Failed to initialize:', error);
      return false;
    }
  }

  private createTables(): void {
    if (!this.db) return;

    // Notes table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT DEFAULT 'manual',
        date TEXT NOT NULL,
        transcript TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        enhanced_notes TEXT,
        audio_path TEXT,
        calendar_event_id TEXT,
        start_time TEXT,
        folder_id TEXT,
        template_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // People table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        email TEXT
      )
    `);

    // Companies table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        domain TEXT
      )
    `);

    // Note-People junction table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS note_people (
        note_id TEXT NOT NULL,
        person_id INTEGER NOT NULL,
        PRIMARY KEY (note_id, person_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
      )
    `);

    // Note-Companies junction table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS note_companies (
        note_id TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        PRIMARY KEY (note_id, company_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )
    `);

    // Folders table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#6366f1',
        icon TEXT DEFAULT '📁',
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add description column if it doesn't exist (for existing databases)
    try {
      this.db.run(`ALTER TABLE folders ADD COLUMN description TEXT DEFAULT ''`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Templates table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        prompt TEXT DEFAULT '',
        sections TEXT DEFAULT '[]',
        is_built_in INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Full-text search virtual table for notes (FTS5)
    // This enables fast text search across all note content
    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          note_id,
          title,
          notes_content,
          enhanced_notes,
          transcript_text
        )
      `);
      console.log('[Database] FTS5 table created');
    } catch (ftsError) {
      console.log('[Database] FTS5 not available, using LIKE search:', ftsError);
    }

    // Create indexes for faster search
    this.db.run('CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_notes_calendar ON notes(calendar_event_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_note_people_note ON note_people(note_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_note_people_person ON note_people(person_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_note_companies_note ON note_companies(note_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_note_companies_company ON note_companies(company_id)');

    console.log('[Database] Tables and indexes created');
  }

  private setupAutoSave(): void {
    // Save every 5 seconds if there are changes
    setInterval(() => {
      if (this.isDirty) {
        this.saveToDisk();
      }
    }, 5000);
  }

  private markDirty(): void {
    this.isDirty = true;
  }

  saveToDisk(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
      this.isDirty = false;
      console.log('[Database] Saved to disk');
    } catch (error) {
      console.error('[Database] Failed to save:', error);
    }
  }

  // ============================================================================
  // NOTES CRUD
  // ============================================================================

  saveNote(note: Partial<Note> & { id: string }): string {
    if (!this.db) throw new Error('Database not initialized');

    const existing = this.getNote(note.id);
    const now = new Date().toISOString();

    if (existing) {
      // Update
      this.db.run(`
        UPDATE notes SET
          title = ?,
          provider = ?,
          date = ?,
          transcript = ?,
          notes = ?,
          enhanced_notes = ?,
          audio_path = ?,
          calendar_event_id = ?,
          start_time = ?,
          folder_id = ?,
          template_id = ?,
          updated_at = ?
        WHERE id = ?
      `, [
        note.title ?? existing.title,
        note.provider ?? existing.provider,
        note.date ?? existing.date,
        typeof note.transcript === 'string' ? note.transcript : JSON.stringify(note.transcript ?? JSON.parse(existing.transcript)),
        note.notes ?? existing.notes,
        note.enhancedNotes ?? existing.enhancedNotes,
        note.audioPath ?? existing.audioPath,
        note.calendarEventId ?? existing.calendarEventId,
        note.startTime ?? existing.startTime,
        note.folderId ?? existing.folderId,
        note.templateId ?? existing.templateId,
        now,
        note.id
      ]);
    } else {
      // Insert
      this.db.run(`
        INSERT INTO notes (id, title, provider, date, transcript, notes, enhanced_notes, audio_path, calendar_event_id, start_time, folder_id, template_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        note.id,
        note.title ?? 'Untitled',
        note.provider ?? 'manual',
        note.date ?? new Date().toISOString().split('T')[0],
        typeof note.transcript === 'string' ? note.transcript : JSON.stringify(note.transcript ?? []),
        note.notes ?? '',
        note.enhancedNotes ?? null,
        note.audioPath ?? null,
        note.calendarEventId ?? null,
        note.startTime ?? null,
        note.folderId ?? null,
        note.templateId ?? null,
        now,
        now
      ]);
    }

    // Update FTS5 index
    this.indexNoteForSearch(note.id, 
      note.title ?? existing?.title ?? '', 
      note.notes ?? existing?.notes ?? '',
      note.enhancedNotes ?? existing?.enhancedNotes ?? '',
      typeof note.transcript === 'string' ? note.transcript : JSON.stringify(note.transcript ?? [])
    );

    this.markDirty();
    return note.id;
  }

  private indexNoteForSearch(noteId: string, title: string, notes: string, enhancedNotes: string, transcript: string): void {
    if (!this.db) return;
    try {
      // Delete existing FTS entry
      this.db.run(`DELETE FROM notes_fts WHERE note_id = ?`, [noteId]);
      // Insert new FTS entry
      this.db.run(`
        INSERT INTO notes_fts (note_id, title, notes_content, enhanced_notes, transcript_text)
        VALUES (?, ?, ?, ?, ?)
      `, [noteId, title, notes, enhancedNotes, transcript]);
    } catch (e) {
      // FTS5 might not be available, ignore
    }
  }

  getNote(id: string): Note | null {
    if (!this.db) return null;
    try {
      const stmt = this.db.prepare(`SELECT * FROM notes WHERE id = ?`);
      stmt.bind([id]);
      if (stmt.step()) {
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        stmt.free();
        return this.rowToNote(columns, values as SqlValue[]);
      }
      stmt.free();
      return null;
    } catch (e) {
      console.error('[Database] getNote error:', e);
      return null;
    }
  }

  getAllNotes(): Note[] {
    if (!this.db) return [];
    const result = this.db.exec(`SELECT * FROM notes ORDER BY date DESC, created_at DESC`);
    if (result.length === 0) return [];
    return result[0].values.map((row: SqlValue[]) => this.rowToNote(result[0].columns, row));
  }

  deleteNote(id: string): boolean {
    if (!this.db) return false;
    this.db.run(`DELETE FROM notes WHERE id = ?`, [id]);
    this.db.run(`DELETE FROM note_people WHERE note_id = ?`, [id]);
    this.db.run(`DELETE FROM note_companies WHERE note_id = ?`, [id]);
    // Also remove from FTS index
    try {
      this.db.run(`DELETE FROM notes_fts WHERE note_id = ?`, [id]);
    } catch (e) {
      // FTS5 might not be available
    }
    this.markDirty();
    return true;
  }

  private rowToNote(columns: string[], values: SqlValue[]): Note {
    const obj: Record<string, SqlValue> = {};
    columns.forEach((col, i) => {
      // Convert snake_case to camelCase
      const key = col.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      obj[key] = values[i];
    });
    return obj as unknown as Note;
  }

  // ============================================================================
  // PEOPLE & COMPANIES
  // ============================================================================

  addPersonToNote(noteId: string, name: string, email?: string): void {
    if (!this.db) return;

    // Insert or get person
    this.db.run(`INSERT OR IGNORE INTO people (name, email) VALUES (?, ?)`, [name, email ?? null]);
    const stmt = this.db.prepare(`SELECT id FROM people WHERE name = ?`);
    stmt.bind([name]);
    if (!stmt.step()) { stmt.free(); return; }
    const personId = stmt.get()[0] as number;
    stmt.free();

    // Link to note
    this.db.run(`INSERT OR IGNORE INTO note_people (note_id, person_id) VALUES (?, ?)`, [noteId, personId]);
    this.markDirty();
  }

  addCompanyToNote(noteId: string, name: string, domain?: string): void {
    if (!this.db) return;

    // Insert or get company
    this.db.run(`INSERT OR IGNORE INTO companies (name, domain) VALUES (?, ?)`, [name, domain ?? null]);
    const stmtC = this.db.prepare(`SELECT id FROM companies WHERE name = ?`);
    stmtC.bind([name]);
    if (!stmtC.step()) { stmtC.free(); return; }
    const companyId = stmtC.get()[0] as number;
    stmtC.free();

    // Link to note
    this.db.run(`INSERT OR IGNORE INTO note_companies (note_id, company_id) VALUES (?, ?)`, [noteId, companyId]);
    this.markDirty();
  }

  getPeopleForNote(noteId: string): Person[] {
    if (!this.db) return [];
    const results: Person[] = [];
    const stmt = this.db.prepare(`
      SELECT p.* FROM people p
      JOIN note_people np ON p.id = np.person_id
      WHERE np.note_id = ?
    `);
    stmt.bind([noteId]);
    while (stmt.step()) {
      const row = stmt.get();
      results.push({
        id: row[0] as number,
        name: row[1] as string,
        email: row[2] as string | null
      });
    }
    stmt.free();
    return results;
  }

  getCompaniesForNote(noteId: string): Company[] {
    if (!this.db) return [];
    const results: Company[] = [];
    const stmt = this.db.prepare(`
      SELECT c.* FROM companies c
      JOIN note_companies nc ON c.id = nc.company_id
      WHERE nc.note_id = ?
    `);
    stmt.bind([noteId]);
    while (stmt.step()) {
      const row = stmt.get();
      results.push({
        id: row[0] as number,
        name: row[1] as string,
        domain: row[2] as string | null
      });
    }
    stmt.free();
    return results;
  }

  getAllPeople(): { name: string; email: string | null; noteCount: number; noteIds: string[]; lastNoteDate: string | null }[] {
    if (!this.db) return [];
    const result = this.db.exec(`
      SELECT 
        p.name,
        p.email,
        COUNT(np.note_id) as note_count,
        GROUP_CONCAT(np.note_id) as note_ids,
        MAX(n.date) as last_note_date
      FROM people p
      JOIN note_people np ON p.id = np.person_id
      JOIN notes n ON np.note_id = n.id
      GROUP BY p.id
      ORDER BY last_note_date DESC
    `);
    if (result.length === 0) return [];
    return result[0].values.map((row: SqlValue[]) => ({
      name: row[0] as string,
      email: row[1] as string | null,
      noteCount: row[2] as number,
      noteIds: (row[3] as string || '').split(',').filter(Boolean),
      lastNoteDate: row[4] as string | null
    }));
  }

  getAllCompanies(): { name: string; domain: string | null; noteCount: number; noteIds: string[]; lastNoteDate: string | null }[] {
    if (!this.db) return [];
    const result = this.db.exec(`
      SELECT 
        c.name,
        c.domain,
        COUNT(nc.note_id) as note_count,
        GROUP_CONCAT(nc.note_id) as note_ids,
        MAX(n.date) as last_note_date
      FROM companies c
      JOIN note_companies nc ON c.id = nc.company_id
      JOIN notes n ON nc.note_id = n.id
      GROUP BY c.id
      ORDER BY last_note_date DESC
    `);
    if (result.length === 0) return [];
    return result[0].values.map((row: SqlValue[]) => ({
      name: row[0] as string,
      domain: row[1] as string | null,
      noteCount: row[2] as number,
      noteIds: (row[3] as string || '').split(',').filter(Boolean),
      lastNoteDate: row[4] as string | null
    }));
  }

  getNotesByPerson(personName: string): Note[] {
    if (!this.db) return [];
    const results: Note[] = [];
    const stmt = this.db.prepare(`
      SELECT n.* FROM notes n
      JOIN note_people np ON n.id = np.note_id
      JOIN people p ON np.person_id = p.id
      WHERE p.name = ?
      ORDER BY n.date DESC
    `);
    stmt.bind([personName]);
    const columns = stmt.getColumnNames();
    while (stmt.step()) {
      results.push(this.rowToNote(columns, stmt.get() as SqlValue[]));
    }
    stmt.free();
    return results;
  }

  getNotesByCompany(companyName: string): Note[] {
    if (!this.db) return [];
    const results: Note[] = [];
    const stmt = this.db.prepare(`
      SELECT n.* FROM notes n
      JOIN note_companies nc ON n.id = nc.note_id
      JOIN companies c ON nc.company_id = c.id
      WHERE c.name = ?
      ORDER BY n.date DESC
    `);
    stmt.bind([companyName]);
    const columns = stmt.getColumnNames();
    while (stmt.step()) {
      results.push(this.rowToNote(columns, stmt.get() as SqlValue[]));
    }
    stmt.free();
    return results;
  }

  // ============================================================================
  // FOLDERS
  // ============================================================================

  saveFolder(folder: Folder): void {
    if (!this.db) return;
    this.db.run(`
      INSERT OR REPLACE INTO folders (id, name, color, icon, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [folder.id, folder.name, folder.color || '#6366f1', folder.icon || '📁', folder.description || '', folder.createdAt || new Date().toISOString()]);
    this.markDirty();
  }

  getAllFolders(): Folder[] {
    if (!this.db) return [];
    const result = this.db.exec(`SELECT id, name, color, icon, description, created_at FROM folders ORDER BY created_at`);
    if (result.length === 0) return [];
    return result[0].values.map((row: SqlValue[]) => ({
      id: row[0] as string,
      name: row[1] as string,
      color: row[2] as string,
      icon: row[3] as string,
      description: row[4] as string || '',
      createdAt: row[5] as string
    }));
  }

  deleteFolder(id: string): void {
    if (!this.db) return;
    // Remove folder assignment from notes
    this.db.run(`UPDATE notes SET folder_id = NULL WHERE folder_id = ?`, [id]);
    this.db.run(`DELETE FROM folders WHERE id = ?`, [id]);
    this.markDirty();
  }

  getNotesInFolder(folderId: string): Note[] {
    if (!this.db) return [];
    const results: Note[] = [];
    const stmt = this.db.prepare(`SELECT * FROM notes WHERE folder_id = ? ORDER BY date DESC`);
    stmt.bind([folderId]);
    const columns = stmt.getColumnNames();
    while (stmt.step()) {
      results.push(this.rowToNote(columns, stmt.get() as SqlValue[]));
    }
    stmt.free();
    return results;
  }

  addNoteToFolder(noteId: string, folderId: string): void {
    if (!this.db) return;
    this.db.run(`UPDATE notes SET folder_id = ? WHERE id = ?`, [folderId, noteId]);
    this.markDirty();
  }

  removeNoteFromFolder(noteId: string): void {
    if (!this.db) return;
    this.db.run(`UPDATE notes SET folder_id = NULL WHERE id = ?`, [noteId]);
    this.markDirty();
  }

  // ============================================================================
  // TEMPLATES
  // ============================================================================

  saveTemplate(template: Partial<Template> & { id: string }): void {
    if (!this.db) return;
    const existing = this.getTemplate(template.id);
    
    if (existing) {
      this.db.run(`
        UPDATE templates SET
          name = ?,
          description = ?,
          prompt = ?,
          sections = ?,
          is_built_in = ?
        WHERE id = ?
      `, [
        template.name ?? existing.name,
        template.description ?? existing.description,
        template.prompt ?? existing.prompt,
        typeof template.sections === 'string' ? template.sections : JSON.stringify(template.sections ?? JSON.parse(existing.sections)),
        template.isBuiltIn !== undefined ? (template.isBuiltIn ? 1 : 0) : existing.isBuiltIn ? 1 : 0,
        template.id
      ]);
    } else {
      this.db.run(`
        INSERT INTO templates (id, name, description, prompt, sections, is_built_in, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        template.id,
        template.name ?? 'Untitled Template',
        template.description ?? '',
        template.prompt ?? '',
        typeof template.sections === 'string' ? template.sections : JSON.stringify(template.sections ?? []),
        template.isBuiltIn ? 1 : 0,
        new Date().toISOString()
      ]);
    }
    this.markDirty();
  }

  getTemplate(id: string): Template | null {
    if (!this.db) return null;
    try {
      const stmt = this.db.prepare(`SELECT * FROM templates WHERE id = ?`);
      stmt.bind([id]);
      if (stmt.step()) {
        const row = stmt.get();
        stmt.free();
        return {
          id: row[0] as string,
          name: row[1] as string,
          description: row[2] as string,
          prompt: row[3] as string,
          sections: row[4] as string,
          isBuiltIn: (row[5] as number) === 1,
          createdAt: row[6] as string
        };
      }
      stmt.free();
      return null;
    } catch (e) {
      console.error('[Database] getTemplate error:', e);
      return null;
    }
  }

  getAllTemplates(): Template[] {
    if (!this.db) return [];
    const result = this.db.exec(`SELECT * FROM templates ORDER BY is_built_in DESC, created_at`);
    if (result.length === 0) return [];
    return result[0].values.map((row: SqlValue[]) => ({
      id: row[0] as string,
      name: row[1] as string,
      description: row[2] as string,
      prompt: row[3] as string,
      sections: row[4] as string,
      isBuiltIn: (row[5] as number) === 1,
      createdAt: row[6] as string
    }));
  }

  deleteTemplate(id: string): void {
    if (!this.db) return;
    this.db.run(`DELETE FROM templates WHERE id = ?`, [id]);
    this.markDirty();
  }

  // ============================================================================
  // FULL-TEXT SEARCH
  // ============================================================================

  searchNotes(query: string, limit: number = 50): Note[] {
    if (!this.db || !query.trim()) return [];
    
    // Try FTS5 first (much faster for large datasets)
    try {
      const searchTerm = query.replace(/['"]/g, '').trim();
      const results: Note[] = [];
      const stmt = this.db.prepare(`
        SELECT n.* FROM notes n
        JOIN notes_fts fts ON n.id = fts.note_id
        WHERE notes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      stmt.bind([searchTerm, limit]);
      const columns = stmt.getColumnNames();
      while (stmt.step()) {
        results.push(this.rowToNote(columns, stmt.get() as SqlValue[]));
      }
      stmt.free();
      
      if (results.length > 0) {
        console.log('[Database] FTS5 search found', results.length, 'results');
        return results;
      }
    } catch (ftsError) {
      // FTS5 not available or error, fall back to LIKE
      console.log('[Database] FTS5 search failed, using LIKE:', ftsError);
    }
    
    // Fallback to LIKE search
    const searchTerm = `%${query}%`;
    const likeResults: Note[] = [];
    const likeStmt = this.db.prepare(`
      SELECT * FROM notes 
      WHERE title LIKE ? OR notes LIKE ? OR enhanced_notes LIKE ? OR transcript LIKE ?
      ORDER BY date DESC
      LIMIT ?
    `);
    likeStmt.bind([searchTerm, searchTerm, searchTerm, searchTerm, limit]);
    const likeColumns = likeStmt.getColumnNames();
    while (likeStmt.step()) {
      likeResults.push(this.rowToNote(likeColumns, likeStmt.get() as SqlValue[]));
    }
    likeStmt.free();
    return likeResults;
  }

  // Search people by name
  searchPeople(query: string, limit: number = 10): { name: string; email: string | null; noteCount: number }[] {
    if (!this.db || !query.trim()) return [];
    const searchTerm = `%${query}%`;
    const results: { name: string; email: string | null; noteCount: number }[] = [];
    const stmt = this.db.prepare(`
      SELECT 
        p.name,
        p.email,
        COUNT(np.note_id) as note_count
      FROM people p
      LEFT JOIN note_people np ON p.id = np.person_id
      WHERE p.name LIKE ?
      GROUP BY p.id
      ORDER BY note_count DESC
      LIMIT ?
    `);
    stmt.bind([searchTerm, limit]);
    while (stmt.step()) {
      const row = stmt.get();
      results.push({
        name: row[0] as string,
        email: row[1] as string | null,
        noteCount: row[2] as number
      });
    }
    stmt.free();
    return results;
  }

  // Search companies by name
  searchCompanies(query: string, limit: number = 10): { name: string; domain: string | null; noteCount: number }[] {
    if (!this.db || !query.trim()) return [];
    const searchTerm = `%${query}%`;
    const results: { name: string; domain: string | null; noteCount: number }[] = [];
    const stmt = this.db.prepare(`
      SELECT 
        c.name,
        c.domain,
        COUNT(nc.note_id) as note_count
      FROM companies c
      LEFT JOIN note_companies nc ON c.id = nc.company_id
      WHERE c.name LIKE ?
      GROUP BY c.id
      ORDER BY note_count DESC
      LIMIT ?
    `);
    stmt.bind([searchTerm, limit]);
    while (stmt.step()) {
      const row = stmt.get();
      results.push({
        name: row[0] as string,
        domain: row[1] as string | null,
        noteCount: row[2] as number
      });
    }
    stmt.free();
    return results;
  }

  // Search folders by name
  searchFolders(query: string, limit: number = 10): Folder[] {
    if (!this.db || !query.trim()) return [];
    const searchTerm = `%${query}%`;
    const results: Folder[] = [];
    const stmt = this.db.prepare(`
      SELECT * FROM folders
      WHERE name LIKE ?
      ORDER BY name
      LIMIT ?
    `);
    stmt.bind([searchTerm, limit]);
    while (stmt.step()) {
      const row = stmt.get();
      results.push({
        id: row[0] as string,
        name: row[1] as string,
        color: row[2] as string,
        icon: row[3] as string,
        description: row[4] as string || '',
        createdAt: row[5] as string
      });
    }
    stmt.free();
    return results;
  }

  // ============================================================================
  // MIGRATION
  // ============================================================================

  async migrateFromJSON(): Promise<{ notes: number; folders: number; templates: number; people: number; companies: number }> {
    const stats = { notes: 0, folders: 0, templates: 0, people: 0, companies: 0 };
    const userData = app.getPath('userData');

    // Migrate notes
    const notesDir = path.join(userData, 'notes');
    if (fs.existsSync(notesDir)) {
      const files = fs.readdirSync(notesDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const note = JSON.parse(fs.readFileSync(path.join(notesDir, file), 'utf-8'));
          this.saveNote({
            id: note.id,
            title: note.title,
            provider: note.provider,
            date: note.date,
            transcript: JSON.stringify(note.transcript || []),
            notes: note.notes || '',
            enhancedNotes: note.enhancedNotes,
            audioPath: note.audioPath,
            calendarEventId: note.calendarEventId,
            startTime: note.startTime,
            folderId: note.folderId,
            templateId: note.templateId
          });

          // Migrate people
          if (note.people && Array.isArray(note.people)) {
            for (const person of note.people) {
              this.addPersonToNote(note.id, person);
              stats.people++;
            }
          }

          // Migrate companies
          if (note.companies && Array.isArray(note.companies)) {
            for (const company of note.companies) {
              this.addCompanyToNote(note.id, company);
              stats.companies++;
            }
          }

          stats.notes++;
        } catch (e) {
          console.error('[Database] Failed to migrate note:', file, e);
        }
      }
    }

    // Migrate folders
    const foldersFile = path.join(userData, 'folders.json');
    if (fs.existsSync(foldersFile)) {
      try {
        const folders = JSON.parse(fs.readFileSync(foldersFile, 'utf-8'));
        for (const folder of folders) {
          this.saveFolder(folder);
          stats.folders++;
        }
      } catch (e) {
        console.error('[Database] Failed to migrate folders:', e);
      }
    }

    // Migrate templates
    const templatesFile = path.join(userData, 'templates.json');
    if (fs.existsSync(templatesFile)) {
      try {
        const templates = JSON.parse(fs.readFileSync(templatesFile, 'utf-8'));
        for (const template of templates) {
          this.saveTemplate({
            id: template.id,
            name: template.name,
            description: template.description,
            prompt: template.prompt,
            sections: JSON.stringify(template.sections || []),
            isBuiltIn: template.isBuiltIn
          });
          stats.templates++;
        }
      } catch (e) {
        console.error('[Database] Failed to migrate templates:', e);
      }
    }

    this.saveToDisk();
    console.log('[Database] Migration complete:', stats);
    return stats;
  }

  // Close database
  close(): void {
    if (this.db) {
      this.saveToDisk();
      this.db.close();
      this.db = null;
    }
  }
}

export const databaseService = new DatabaseService();

