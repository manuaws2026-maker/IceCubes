/**
 * Folder Service - Manages folders for organizing notes
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';

// Types
export interface Folder {
  id: string;
  name: string;
  description: string; // Description for AI matching
  icon: string; // Emoji icon
  color: string; // Hex color for folder accent
  createdAt: string;
  updatedAt: string;
  isPrivate: boolean;
  isDefault: boolean; // If true, new notes go here by default
  noteCount: number; // Cached count for display
}

export interface FolderWithNotes extends Folder {
  noteIds: string[];
}

// Paths
const USER_DATA = app.getPath('userData');
const FOLDERS_FILE = path.join(USER_DATA, 'folders.json');
const FOLDER_NOTES_FILE = path.join(USER_DATA, 'folder-notes.json'); // Maps folderId -> noteIds

// No default folders - user creates their own
const DEFAULT_FOLDERS: Folder[] = [];

class FolderService {
  private folders: Folder[] = [];
  private folderNotes: Record<string, string[]> = {}; // folderId -> noteIds

  constructor() {
    this.loadFolders();
    this.loadFolderNotes();
  }

  private loadFolders(): void {
    try {
      if (fs.existsSync(FOLDERS_FILE)) {
        const data = fs.readFileSync(FOLDERS_FILE, 'utf-8');
        this.folders = JSON.parse(data);
        console.log('[Folders] Loaded', this.folders.length, 'folders');
      } else {
        // Initialize with default folders
        this.folders = [...DEFAULT_FOLDERS];
        this.saveFolders();
        console.log('[Folders] Initialized with default folders');
      }
    } catch (err) {
      console.error('[Folders] Error loading folders:', err);
      this.folders = [...DEFAULT_FOLDERS];
    }
  }

  private saveFolders(): void {
    try {
      fs.writeFileSync(FOLDERS_FILE, JSON.stringify(this.folders, null, 2));
      console.log('[Folders] Saved', this.folders.length, 'folders');
    } catch (err) {
      console.error('[Folders] Error saving folders:', err);
    }
  }

  private loadFolderNotes(): void {
    try {
      if (fs.existsSync(FOLDER_NOTES_FILE)) {
        const data = fs.readFileSync(FOLDER_NOTES_FILE, 'utf-8');
        this.folderNotes = JSON.parse(data);
        console.log('[Folders] Loaded folder-note mappings');
      } else {
        this.folderNotes = {};
        this.saveFolderNotes();
      }
    } catch (err) {
      console.error('[Folders] Error loading folder notes:', err);
      this.folderNotes = {};
    }
  }

  private saveFolderNotes(): void {
    try {
      fs.writeFileSync(FOLDER_NOTES_FILE, JSON.stringify(this.folderNotes, null, 2));
    } catch (err) {
      console.error('[Folders] Error saving folder notes:', err);
    }
  }

  private updateNoteCounts(): void {
    this.folders.forEach(folder => {
      folder.noteCount = this.folderNotes[folder.id]?.length || 0;
    });
    this.saveFolders();
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get all folders
   */
  getFolders(): Folder[] {
    this.updateNoteCounts();
    return [...this.folders];
  }

  /**
   * Get a specific folder by ID
   */
  getFolder(folderId: string): Folder | null {
    return this.folders.find(f => f.id === folderId) || null;
  }

  /**
   * Create a new folder
   */
  createFolder(name: string, icon: string = '📁', color: string = '#6366f1', isPrivate: boolean = false, description: string = '', isDefault: boolean = false): Folder {
    // If this folder is being set as default, clear default from others
    if (isDefault) {
      this.folders.forEach(f => f.isDefault = false);
    }
    
    const folder: Folder = {
      id: uuidv4(),
      name: name.trim(),
      description: description.trim(),
      icon,
      color,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPrivate,
      isDefault,
      noteCount: 0
    };

    this.folders.push(folder);
    this.folderNotes[folder.id] = [];
    this.saveFolders();
    this.saveFolderNotes();

    console.log('[Folders] Created folder:', folder.name, isDefault ? '(default)' : '');
    return folder;
  }
  
  /**
   * Get the default folder (if any)
   */
  getDefaultFolder(): Folder | null {
    return this.folders.find(f => f.isDefault) || null;
  }
  
  /**
   * Set a folder as default
   */
  setDefaultFolder(folderId: string): boolean {
    // Clear default from all folders
    this.folders.forEach(f => f.isDefault = false);
    
    // Set new default
    const folder = this.folders.find(f => f.id === folderId);
    if (folder) {
      folder.isDefault = true;
      folder.updatedAt = new Date().toISOString();
      this.saveFolders();
      console.log('[Folders] Set default folder:', folder.name);
      return true;
    }
    return false;
  }

  /**
   * Update a folder
   */
  updateFolder(folderId: string, updates: Partial<Pick<Folder, 'name' | 'icon' | 'color' | 'isPrivate' | 'description' | 'isDefault'>>): Folder | null {
    const folder = this.folders.find(f => f.id === folderId);
    if (!folder) return null;

    if (updates.name !== undefined) folder.name = updates.name.trim();
    if (updates.icon !== undefined) folder.icon = updates.icon;
    if (updates.color !== undefined) folder.color = updates.color;
    if (updates.isPrivate !== undefined) folder.isPrivate = updates.isPrivate;
    if (updates.description !== undefined) folder.description = updates.description.trim();
    if (updates.isDefault !== undefined) {
      // If setting as default, clear default from others first
      if (updates.isDefault) {
        this.folders.forEach(f => f.isDefault = false);
      }
      folder.isDefault = updates.isDefault;
    }
    folder.updatedAt = new Date().toISOString();

    this.saveFolders();
    console.log('[Folders] Updated folder:', folder.name);
    return folder;
  }

  /**
   * Delete a folder (notes are NOT deleted, just unassigned)
   */
  deleteFolder(folderId: string): boolean {
    const index = this.folders.findIndex(f => f.id === folderId);
    if (index === -1) return false;

    const folder = this.folders[index];
    this.folders.splice(index, 1);
    delete this.folderNotes[folderId];

    this.saveFolders();
    this.saveFolderNotes();

    console.log('[Folders] Deleted folder:', folder.name);
    return true;
  }

  /**
   * Add a note to a folder
   */
  addNoteToFolder(folderId: string, noteId: string): boolean {
    if (!this.folderNotes[folderId]) {
      this.folderNotes[folderId] = [];
    }

    // Remove note from any other folder first
    Object.keys(this.folderNotes).forEach(fId => {
      this.folderNotes[fId] = this.folderNotes[fId].filter(id => id !== noteId);
    });

    // Add to new folder
    if (!this.folderNotes[folderId].includes(noteId)) {
      this.folderNotes[folderId].push(noteId);
    }

    this.saveFolderNotes();
    this.updateNoteCounts();

    console.log('[Folders] Added note', noteId, 'to folder', folderId);
    return true;
  }

  /**
   * Remove a note from a folder
   */
  removeNoteFromFolder(folderId: string, noteId: string): boolean {
    if (!this.folderNotes[folderId]) return false;

    this.folderNotes[folderId] = this.folderNotes[folderId].filter(id => id !== noteId);
    this.saveFolderNotes();
    this.updateNoteCounts();

    console.log('[Folders] Removed note', noteId, 'from folder', folderId);
    return true;
  }

  /**
   * Get all note IDs in a folder
   */
  getNotesInFolder(folderId: string): string[] {
    return this.folderNotes[folderId] || [];
  }

  /**
   * Get folder ID for a note (returns null if not in any folder)
   */
  getFolderForNote(noteId: string): string | null {
    for (const [folderId, noteIds] of Object.entries(this.folderNotes)) {
      if (noteIds.includes(noteId)) {
        return folderId;
      }
    }
    return null;
  }

  /**
   * Get all folder-note mappings
   */
  getAllFolderNotes(): Record<string, string[]> {
    return { ...this.folderNotes };
  }
}

// Singleton instance
let folderService: FolderService | null = null;

export function getFolderService(): FolderService {
  if (!folderService) {
    folderService = new FolderService();
  }
  return folderService;
}

export { FolderService };

