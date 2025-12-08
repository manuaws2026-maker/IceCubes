/**
 * AI Note Templates Service
 * Allows users to create custom templates for AI-generated meeting notes
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Template section (like "Introduction", "Action Items", etc.)
export interface TemplateSection {
  id: string;
  title: string;
  instructions: string; // Instructions for AI on what to include
}

// Full template definition
export interface NoteTemplate {
  id: string;
  name: string;
  icon: string; // Emoji icon
  description: string; // Meeting context/overview
  sections: TemplateSection[];
  isDefault: boolean;
  isBuiltIn: boolean; // Pre-built vs user-created
  createdAt: string;
  updatedAt: string;
}

const USER_DATA = app.getPath('userData');
const TEMPLATES_PATH = path.join(USER_DATA, 'templates.json');

// Default built-in templates
const DEFAULT_TEMPLATES: NoteTemplate[] = [
  {
    id: 'general',
    name: 'General Meeting',
    icon: '📝',
    description: 'Standard meeting notes with summary, key points, and action items.',
    sections: [
      { id: 's1', title: 'Summary', instructions: 'Provide a brief 2-3 sentence summary of the meeting' },
      { id: 's2', title: 'Key Points', instructions: 'List the main discussion points and important information shared' },
      { id: 's3', title: 'Action Items', instructions: 'List any tasks, assignments, or follow-ups with owners if mentioned' },
      { id: 's4', title: 'Decisions', instructions: 'Document any decisions that were made during the meeting' },
    ],
    isDefault: true,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '1-on-1',
    name: '1 on 1',
    icon: '👥',
    description: 'One-on-one meeting notes focusing on personal updates, feedback, and goals.',
    sections: [
      { id: 's1', title: 'Personal Updates', instructions: 'Note any personal updates or check-in items discussed' },
      { id: 's2', title: 'Progress & Wins', instructions: 'Highlight accomplishments and progress since last meeting' },
      { id: 's3', title: 'Challenges', instructions: 'Document any blockers, challenges, or concerns raised' },
      { id: 's4', title: 'Feedback', instructions: 'Note any feedback given or received' },
      { id: 's5', title: 'Goals & Next Steps', instructions: 'List goals and action items for the next period' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'standup',
    name: 'Stand-Up',
    icon: '🧍',
    description: 'Daily standup meeting with yesterday, today, and blockers format.',
    sections: [
      { id: 's1', title: 'Yesterday', instructions: 'What was accomplished yesterday' },
      { id: 's2', title: 'Today', instructions: 'What is planned for today' },
      { id: 's3', title: 'Blockers', instructions: 'Any blockers or issues preventing progress' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'customer-discovery',
    name: 'Customer Discovery',
    icon: '🔍',
    description: 'Customer interview notes for product discovery and research.',
    sections: [
      { id: 's1', title: 'Customer Background', instructions: 'Brief overview of the customer and their role' },
      { id: 's2', title: 'Pain Points', instructions: 'Problems and challenges the customer experiences' },
      { id: 's3', title: 'Current Solutions', instructions: 'How they currently solve these problems' },
      { id: 's4', title: 'Desired Outcomes', instructions: 'What success looks like for them' },
      { id: 's5', title: 'Product Feedback', instructions: 'Specific feedback on our product if discussed' },
      { id: 's6', title: 'Quotes', instructions: 'Notable quotes that capture their perspective' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'hiring',
    name: 'Interview',
    icon: '💼',
    description: 'Candidate interview notes for hiring decisions.',
    sections: [
      { id: 's1', title: 'Candidate Overview', instructions: 'Brief summary of candidate background' },
      { id: 's2', title: 'Technical Skills', instructions: 'Assessment of relevant technical abilities' },
      { id: 's3', title: 'Experience Highlights', instructions: 'Notable experience and accomplishments discussed' },
      { id: 's4', title: 'Culture Fit', instructions: 'Observations on team and culture fit' },
      { id: 's5', title: 'Questions Asked', instructions: 'Questions the candidate asked' },
      { id: 's6', title: 'Recommendation', instructions: 'Overall impression and hiring recommendation' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sales-call',
    name: 'Sales Call',
    icon: '💰',
    description: 'Sales meeting notes with qualification and next steps.',
    sections: [
      { id: 's1', title: 'Attendees & Roles', instructions: 'Who attended and their roles in the buying process' },
      { id: 's2', title: 'Pain Points', instructions: 'Business problems they are trying to solve' },
      { id: 's3', title: 'Requirements', instructions: 'Specific requirements and must-haves' },
      { id: 's4', title: 'Budget & Timeline', instructions: 'Any budget or timeline information shared' },
      { id: 's5', title: 'Competition', instructions: 'Other solutions being considered' },
      { id: 's6', title: 'Next Steps', instructions: 'Agreed upon next steps and follow-ups' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

class TemplateService {
  private templates: NoteTemplate[] = [];

  constructor() {
    this.loadTemplates();
  }

  private loadTemplates(): void {
    try {
      if (fs.existsSync(TEMPLATES_PATH)) {
        const data = fs.readFileSync(TEMPLATES_PATH, 'utf-8');
        const saved = JSON.parse(data);
        // Merge saved with defaults (in case new built-ins were added)
        const savedIds = new Set(saved.map((t: NoteTemplate) => t.id));
        const newBuiltIns = DEFAULT_TEMPLATES.filter(t => !savedIds.has(t.id));
        this.templates = [...saved, ...newBuiltIns];
      } else {
        this.templates = [...DEFAULT_TEMPLATES];
        this.saveTemplates();
      }
    } catch (e) {
      console.error('[Templates] Error loading:', e);
      this.templates = [...DEFAULT_TEMPLATES];
    }
  }

  private saveTemplates(): void {
    try {
      fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(this.templates, null, 2));
    } catch (e) {
      console.error('[Templates] Error saving:', e);
    }
  }

  getTemplates(): NoteTemplate[] {
    return this.templates;
  }

  getTemplate(id: string): NoteTemplate | undefined {
    return this.templates.find(t => t.id === id);
  }

  getDefaultTemplate(): NoteTemplate | undefined {
    return this.templates.find(t => t.isDefault) || this.templates[0];
  }

  createTemplate(template: Omit<NoteTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn'>): NoteTemplate {
    const newTemplate: NoteTemplate = {
      ...template,
      id: `custom-${Date.now()}`,
      isBuiltIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.templates.push(newTemplate);
    this.saveTemplates();
    return newTemplate;
  }

  updateTemplate(id: string, updates: Partial<NoteTemplate>): NoteTemplate | null {
    const index = this.templates.findIndex(t => t.id === id);
    if (index === -1) return null;

    // Don't allow modifying built-in templates (except isDefault)
    if (this.templates[index].isBuiltIn && Object.keys(updates).some(k => k !== 'isDefault')) {
      console.log('[Templates] Cannot modify built-in template');
      return null;
    }

    this.templates[index] = {
      ...this.templates[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.saveTemplates();
    return this.templates[index];
  }

  deleteTemplate(id: string): boolean {
    const template = this.templates.find(t => t.id === id);
    if (!template || template.isBuiltIn) {
      console.log('[Templates] Cannot delete built-in template');
      return false;
    }

    this.templates = this.templates.filter(t => t.id !== id);
    this.saveTemplates();
    return true;
  }

  setDefaultTemplate(id: string): boolean {
    const template = this.templates.find(t => t.id === id);
    if (!template) return false;

    // Clear existing default
    this.templates.forEach(t => t.isDefault = false);
    template.isDefault = true;
    this.saveTemplates();
    return true;
  }

  // Generate prompt sections from template for AI
  generatePromptFromTemplate(template: NoteTemplate): string {
    let prompt = '';
    
    if (template.description) {
      prompt += `Meeting Context: ${template.description}\n\n`;
    }
    
    prompt += 'Generate notes with these sections:\n';
    template.sections.forEach((section, i) => {
      prompt += `\n${i + 1}. **${section.title}**\n`;
      prompt += `   Instructions: ${section.instructions}\n`;
    });
    
    return prompt;
  }
}

// Singleton instance
let templateService: TemplateService | null = null;

export function getTemplateService(): TemplateService {
  if (!templateService) {
    templateService = new TemplateService();
  }
  return templateService;
}


