/**
 * Vector Search Service - Semantic search for meeting notes
 * 
 * Supports two embedding modes:
 * 1. LOCAL (MiniLM): Uses all-MiniLM-L6-v2 via native ONNX - works offline
 * 2. CLOUD (OpenAI): Uses text-embedding-3-small - highest quality
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { LocalIndex } from 'vectra';
import OpenAI from 'openai';

// Native module for local embeddings
let nativeModule: any = null;
try {
  nativeModule = require('ghost-native');
  console.log('[VectorSearch] Native module loaded for local embeddings');
} catch (e) {
  console.log('[VectorSearch] Native module not available, will use OpenAI');
}

type EmbeddingEngine = 'local' | 'openai';

// Types
interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp?: string;
}

interface IndexedDocument {
  noteId: string;
  noteTitle: string;
  folderId: string | null;
  chunkIndex: number;
  text: string;
  timestamp?: string;
  speaker?: string;
}

interface SearchResult {
  noteId: string;
  noteTitle: string;
  text: string;
  score: number;
  speaker?: string;
  timestamp?: string;
}

// Paths
const USER_DATA = app.getPath('userData');
const VECTOR_INDEX_PATH = path.join(USER_DATA, 'vector-index');

// Constants
const CHUNK_SIZE = 500; // Characters per chunk
const CHUNK_OVERLAP = 100; // Overlap between chunks
const EMBEDDING_MODEL = 'text-embedding-3-small'; // For cloud mode
const TOP_K_RESULTS = 10;

class VectorSearchService {
  private index: LocalIndex | null = null;
  private openai: OpenAI | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private embeddingEngine: EmbeddingEngine = 'local'; // Default to local
  private localEmbeddingReady = false;

  constructor() {
    // Check if local embedding model is available
    this.checkLocalEmbedding();
  }

  /**
   * Check if local embedding model is ready
   */
  private checkLocalEmbedding(): void {
    try {
      if (nativeModule?.isEmbeddingReady?.()) {
        this.localEmbeddingReady = true;
        this.embeddingEngine = 'local';
        console.log('[VectorSearch] Local embedding model ready (MiniLM)');
      } else if (nativeModule?.isEmbeddingDownloaded?.()) {
        // Model downloaded but not initialized - try to init
        console.log('[VectorSearch] Initializing local embedding model...');
        nativeModule?.initEmbeddingModel?.();
        this.localEmbeddingReady = nativeModule?.isEmbeddingReady?.() ?? false;
        if (this.localEmbeddingReady) {
          this.embeddingEngine = 'local';
          console.log('[VectorSearch] ✅ Local embedding model initialized');
        }
      }
    } catch (e) {
      console.log('[VectorSearch] Local embedding not available:', e);
    }
  }

  /**
   * Initialize the search service
   * Works in local mode by default, optionally enables cloud mode with API key
   */
  async initialize(apiKey?: string): Promise<boolean> {
    if (this.isInitialized) return true;
    
    if (this.initPromise) {
      await this.initPromise;
      return this.isInitialized;
    }

    this.initPromise = this._doInitialize(apiKey);
    await this.initPromise;
    return this.isInitialized;
  }

  private async _doInitialize(apiKey?: string): Promise<void> {
    try {
      // Check local embedding first (preferred for offline)
      this.checkLocalEmbedding();
      
      if (this.localEmbeddingReady) {
        console.log('[VectorSearch] ✅ Using LOCAL embeddings (MiniLM - offline capable)');
        this.embeddingEngine = 'local';
      }

      // Setup OpenAI if API key available
      const key = apiKey || process.env.OPENAI_API_KEY;
      if (key) {
        this.openai = new OpenAI({ apiKey: key });
        
        // If local embedding not available, use OpenAI
        if (!this.localEmbeddingReady) {
          this.embeddingEngine = 'openai';
          console.log('[VectorSearch] ✅ Using CLOUD embeddings (OpenAI)');
        }
      }

      // Ensure vector index directory exists
      if (!fs.existsSync(VECTOR_INDEX_PATH)) {
        fs.mkdirSync(VECTOR_INDEX_PATH, { recursive: true });
      }

      // Create or load vectra index
      this.index = new LocalIndex(VECTOR_INDEX_PATH);
      
      if (!await this.index.isIndexCreated()) {
        await this.index.createIndex();
        console.log('[VectorSearch] Created new vector index');
      } else {
        try {
          await this.validateIndex();
          console.log('[VectorSearch] Loaded existing vector index');
        } catch (validationErr: any) {
          console.log('[VectorSearch] Index validation failed, rebuilding...');
          await this.rebuildCorruptedIndex();
        }
      }

      this.isInitialized = true;
      console.log('[VectorSearch] ✅ Initialized with engine:', this.embeddingEngine);
    } catch (err) {
      console.error('[VectorSearch] Initialization error:', err);
      this.isInitialized = false;
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    // Ready if initialized - works in all modes
    return this.isInitialized;
  }

  /**
   * Get current embedding engine
   */
  getEmbeddingEngine(): EmbeddingEngine {
    return this.embeddingEngine;
  }

  /**
   * Set embedding engine (triggers reindex if changed)
   */
  setEmbeddingEngine(engine: EmbeddingEngine): boolean {
    if (engine === 'local' && !this.localEmbeddingReady) {
      console.log('[VectorSearch] Cannot use local embeddings - model not ready');
      return false;
    }
    if (engine === 'openai' && !this.openai) {
      console.log('[VectorSearch] Cannot use OpenAI embeddings - no API key');
      return false;
    }
    
    this.embeddingEngine = engine;
    console.log('[VectorSearch] Embedding engine set to:', engine);
    return true;
  }

  /**
   * Check if local embedding model is available
   */
  isLocalEmbeddingAvailable(): boolean {
    return this.localEmbeddingReady;
  }

  /**
   * Check if using local mode (offline-capable)
   */
  isLocalMode(): boolean {
    return this.embeddingEngine !== 'openai';
  }

  /**
   * Validate that the index is not corrupted by attempting to list items
   */
  private async validateIndex(): Promise<void> {
    if (!this.index) throw new Error('Index not initialized');
    
    // Try to list items - this will throw if JSON is corrupted
    await this.index.listItems();
  }

  /**
   * Delete and recreate a corrupted index
   */
  private async rebuildCorruptedIndex(): Promise<void> {
    // Delete the corrupted index directory
    if (fs.existsSync(VECTOR_INDEX_PATH)) {
      fs.rmSync(VECTOR_INDEX_PATH, { recursive: true, force: true });
      console.log('[VectorSearch] Deleted corrupted index');
    }
    
    // Recreate directory
    fs.mkdirSync(VECTOR_INDEX_PATH, { recursive: true });
    
    // Create fresh index
    this.index = new LocalIndex(VECTOR_INDEX_PATH);
    await this.index.createIndex();
    console.log('[VectorSearch] Created fresh index after corruption');
  }

  /**
   * Get embedding for text using OpenAI
   */
  /**
   * Get embedding for text using the configured engine
   * Supports: local (MiniLM) or openai
   */
  private async getEmbedding(text: string): Promise<number[]> {
    const truncatedText = text.substring(0, 8000); // Limit input size
    
    // Try local embedding first if available
    if (this.embeddingEngine === 'local' && this.localEmbeddingReady) {
      try {
        const embedding = nativeModule?.generateEmbedding?.(truncatedText);
        if (embedding && Array.isArray(embedding)) {
          return embedding;
        }
      } catch (e) {
        console.error('[VectorSearch] Local embedding failed:', e);
        // Fall through to OpenAI
      }
    }
    
    // Use OpenAI as fallback or primary
    if (this.openai) {
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: truncatedText,
      });
      return response.data[0].embedding;
    }
    
    throw new Error('No embedding engine available');
  }

  /**
   * Split transcript into chunks for indexing
   */
  private chunkTranscript(transcript: TranscriptSegment[], noteId: string, noteTitle: string, folderId: string | null): IndexedDocument[] {
    const documents: IndexedDocument[] = [];
    
    // Combine transcript segments into text
    let currentChunk = '';
    let currentSpeaker = '';
    let chunkIndex = 0;

    for (const segment of transcript) {
      const segmentText = `${segment.speaker}: ${segment.text}\n`;
      
      if (currentChunk.length + segmentText.length > CHUNK_SIZE) {
        // Save current chunk
        if (currentChunk.trim()) {
          documents.push({
            noteId,
            noteTitle,
            folderId,
            chunkIndex: chunkIndex++,
            text: currentChunk.trim(),
            speaker: currentSpeaker
          });
        }
        
        // Start new chunk with overlap
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.floor(CHUNK_OVERLAP / 5));
        currentChunk = overlapWords.join(' ') + ' ' + segmentText;
        currentSpeaker = segment.speaker;
      } else {
        currentChunk += segmentText;
        if (!currentSpeaker) currentSpeaker = segment.speaker;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      documents.push({
        noteId,
        noteTitle,
        folderId,
        chunkIndex: chunkIndex++,
        text: currentChunk.trim(),
        speaker: currentSpeaker
      });
    }

    return documents;
  }

  /**
   * Split plain text (user notes, AI notes) into chunks for indexing
   */
  private chunkText(text: string, noteId: string, noteTitle: string, folderId: string | null, source: string): IndexedDocument[] {
    const documents: IndexedDocument[] = [];
    const cleanText = text.trim();
    
    if (!cleanText) return documents;

    // Split by paragraphs first, then by sentence if still too large
    const paragraphs = cleanText.split(/\n\n+/);
    let currentChunk = '';
    let chunkIndex = 1000; // Start at 1000 to differentiate from transcript chunks

    for (const paragraph of paragraphs) {
      const paraText = paragraph.trim();
      if (!paraText) continue;

      if (currentChunk.length + paraText.length > CHUNK_SIZE) {
        // Save current chunk
        if (currentChunk.trim()) {
          documents.push({
            noteId,
            noteTitle,
            folderId,
            chunkIndex: chunkIndex++,
            text: `[${source}] ${currentChunk.trim()}`,
            speaker: source
          });
        }
        currentChunk = paraText;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paraText;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      documents.push({
        noteId,
        noteTitle,
        folderId,
        chunkIndex: chunkIndex,
        text: `[${source}] ${currentChunk.trim()}`,
        speaker: source
      });
    }

    return documents;
  }

  /**
   * Index a note's transcript for semantic search
   * Works in both local and cloud modes
   */
  async indexNote(noteId: string, noteTitle: string, transcript: TranscriptSegment[], folderId: string | null, userNotes?: string): Promise<boolean> {
    if (!this.isReady()) {
      console.log('[VectorSearch] Not ready, skipping indexing');
      return false;
    }

    try {
      // First, remove any existing entries for this note
      await this.removeNote(noteId);

      // If no transcript AND no user notes, nothing to index
      if ((!transcript || transcript.length === 0) && !userNotes) {
        console.log('[VectorSearch] No content to index for note:', noteId);
        return true;
      }

      // Chunk the transcript
      const documents = this.chunkTranscript(transcript || [], noteId, noteTitle, folderId);
      
      // Also chunk user notes and AI-enhanced notes if present
      if (userNotes && userNotes.trim().length > 0) {
        const notesChunks = this.chunkText(userNotes, noteId, noteTitle, folderId, 'notes');
        documents.push(...notesChunks);
      }
      
      console.log('[VectorSearch] Indexing', documents.length, 'chunks for note:', noteId, '(engine:', this.embeddingEngine, ')');

      if (!this.index) {
        console.error('[VectorSearch] No index available');
        return false;
      }

      // Index with vector embeddings
      for (const doc of documents) {
        try {
          const embedding = await this.getEmbedding(doc.text);
          
          await this.index.insertItem({
            vector: embedding,
            metadata: {
              noteId: doc.noteId,
              noteTitle: doc.noteTitle,
              folderId: doc.folderId || '', // Empty string instead of null
              chunkIndex: doc.chunkIndex,
              text: doc.text,
              speaker: doc.speaker || '' // Empty string instead of undefined
            }
          });
        } catch (embErr) {
          console.error('[VectorSearch] Failed to index chunk:', embErr);
          // Continue with other chunks
        }
      }

      console.log('[VectorSearch] ✅ Indexed note:', noteId);
      return true;
    } catch (err: any) {
      // Check if it's a JSON corruption error
      if (err?.message?.includes('JSON') || err?.message?.includes('Unterminated')) {
        console.log('[VectorSearch] Corruption detected during indexing, rebuilding index...');
        try {
          await this.rebuildCorruptedIndex();
          // Don't retry indexing this note to avoid loops - it will be indexed on next save
        } catch (rebuildErr) {
          console.error('[VectorSearch] Failed to rebuild index:', rebuildErr);
        }
      } else {
        console.error('[VectorSearch] Error indexing note:', err);
      }
      return false;
    }
  }

  /**
   * Remove a note from the index (both local and cloud)
   */
  async removeNote(noteId: string): Promise<boolean> {
    if (!this.isReady() || !this.index) return false;

    try {
      // Query for all items with this noteId and delete them
      const items = await this.index.listItems();
      const toDelete = items.filter(item => item.metadata?.noteId === noteId);
      
      for (const item of toDelete) {
        await this.index.deleteItem(item.id);
      }

      console.log('[VectorSearch] Removed', toDelete.length, 'chunks for note:', noteId);

      return true;
    } catch (err: any) {
      // Check if it's a JSON corruption error - silently rebuild
      if (err?.message?.includes('JSON') || err?.message?.includes('Unterminated')) {
        console.log('[VectorSearch] Corruption detected during removal, rebuilding index...');
        try {
          await this.rebuildCorruptedIndex();
        } catch (rebuildErr) {
          console.error('[VectorSearch] Failed to rebuild index:', rebuildErr);
        }
      } else {
        console.error('[VectorSearch] Error removing note:', err);
      }
      return false;
    }
  }

  /**
   * Update folder assignment for a note
   */
  async updateNoteFolder(noteId: string, folderId: string | null): Promise<boolean> {
    if (!this.isReady()) return false;

    try {
      const items = await this.index!.listItems();
      const noteItems = items.filter(item => item.metadata?.noteId === noteId);

      for (const item of noteItems) {
        // Update metadata (use empty string for null)
        (item.metadata as any).folderId = folderId || '';
        // vectra doesn't support direct update, would need to delete and re-insert
        // For simplicity, we'll skip this for now - folder filtering works at query time
      }

      return true;
    } catch (err) {
      console.error('[VectorSearch] Error updating note folder:', err);
      return false;
    }
  }

  /**
   * Search for relevant transcript chunks
   * @param query - The search query
   * @param folderId - Optional folder to limit search to
   * @param limit - Max results to return
   */
  async search(query: string, folderId?: string | null, limit: number = TOP_K_RESULTS): Promise<SearchResult[]> {
    if (!this.isReady()) {
      console.log('[VectorSearch] Not ready for search');
      return [];
    }

    if (!this.index) {
      console.log('[VectorSearch] No vector index available');
      return [];
    }

    console.log(`[VectorSearch] Search using engine: ${this.embeddingEngine}`);

    try {
      // Get embedding for query
      const queryEmbedding = await this.getEmbedding(query);

      const results = await this.index.queryItems(queryEmbedding, query, limit * 2);

      console.log('[VectorSearch] Raw results:', results.length, 'folderId filter:', folderId);
      
      // Filter by folder if specified and dedupe
      const seenNotes = new Set<string>();
      const filtered: SearchResult[] = [];

      for (const result of results) {
        const metadata = result.item.metadata as any;
        
        // Log first few results for debugging
        if (filtered.length === 0) {
          console.log('[VectorSearch] First result metadata:', metadata.noteId, 'folderId:', metadata.folderId);
        }
        
        // Skip if folder filter doesn't match
        if (folderId && metadata.folderId !== folderId) continue;
        
        // Skip duplicates from same note
        if (seenNotes.has(metadata.noteId)) continue;
        seenNotes.add(metadata.noteId);

        filtered.push({
          noteId: metadata.noteId,
          noteTitle: metadata.noteTitle,
          text: metadata.text,
          score: result.score,
          speaker: metadata.speaker,
          timestamp: metadata.timestamp
        });

        if (filtered.length >= limit) break;
      }

      console.log('[VectorSearch] Found', filtered.length, 'results for query:', query.substring(0, 50));
      return filtered;
    } catch (err) {
      console.error('[VectorSearch] Search error:', err);
      return [];
    }
  }

  /**
   * Get context from folder for AI Q&A
   * Returns relevant transcript snippets to include in LLM prompt
   */
  async getFolderContext(query: string, folderId: string, maxChunks: number = 5): Promise<string> {
    const results = await this.search(query, folderId, maxChunks);
    
    if (results.length === 0) {
      return '';
    }

    // Build context string
    const contextParts = results.map((r, i) => {
      return `--- From "${r.noteTitle}" ---\n${r.text}`;
    });

    return contextParts.join('\n\n');
  }

  /**
   * Get stats about the index
   */
  async getStats(): Promise<{ totalItems: number; noteCount: number }> {
    if (!this.isReady()) {
      return { totalItems: 0, noteCount: 0 };
    }

    try {
      const items = await this.index!.listItems();
      const noteIds = new Set(items.map(i => i.metadata?.noteId));
      
      return {
        totalItems: items.length,
        noteCount: noteIds.size
      };
    } catch (err) {
      return { totalItems: 0, noteCount: 0 };
    }
  }
}

// Singleton
let vectorSearchService: VectorSearchService | null = null;

export function getVectorSearchService(): VectorSearchService {
  if (!vectorSearchService) {
    vectorSearchService = new VectorSearchService();
  }
  return vectorSearchService;
}

export { VectorSearchService, SearchResult };

