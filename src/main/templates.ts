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

// Template categories for organization
export type TemplateCategory = 
  | 'General'
  | 'Commercial'
  | 'Leadership'
  | 'Team'
  | 'Recruiting'
  | 'Product'
  | 'VC';

// Full template definition
export interface NoteTemplate {
  id: string;
  name: string;
  icon: string; // Emoji icon
  description: string; // Meeting context/overview
  sections: TemplateSection[];
  category?: TemplateCategory; // Optional category for grouping
  isDefault: boolean;
  isBuiltIn: boolean; // Pre-built vs user-created
  createdAt: string;
  updatedAt: string;
}

const USER_DATA = app.getPath('userData');
const TEMPLATES_PATH = path.join(USER_DATA, 'templates.json');

// Default built-in templates - comprehensive collection
const DEFAULT_TEMPLATES: NoteTemplate[] = [
  // ============================================================================
  // GENERAL
  // ============================================================================
  {
    id: 'general',
    name: 'General Meeting',
    icon: '📝',
    category: 'General',
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

  // ============================================================================
  // LEADERSHIP
  // ============================================================================
  {
    id: '1-on-1',
    name: '1 on 1',
    icon: '👥',
    category: 'Leadership',
    description: 'I am having a 1:1 meeting with someone in my team, please capture these meeting notes in a concise and actionable format. Focus on immediate priorities, progress, challenges, and personal feedback, ensuring the notes are structured for clarity, efficiency and easy follow-up.',
    sections: [
      { id: 's1', title: 'Top of mind', instructions: "What's the most pressing issue or priority? Capture the top concerns or focus areas that need immediate attention." },
      { id: 's2', title: 'Updates and wins', instructions: "Highlight recent achievements and progress. What's going well? Document key updates that show momentum." },
      { id: 's3', title: 'Challenges and blockers', instructions: 'What obstacles are in the way? Note any blockers that are slowing progress.' },
      { id: 's4', title: 'Mutual feedback', instructions: 'Did they give me any feedback on what I could do differently? Is there anything I should change about our team to make us more successful? Did I share any feedback for them? List it all here.' },
      { id: 's5', title: 'Next Milestone', instructions: "Define clear action items and next steps. Who's doing what by when? Ensure accountability and follow-up." },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'advisory',
    name: 'Advisory',
    icon: '❓',
    category: 'Leadership',
    description: 'I met with an advisor or mentor to get guidance on strategic decisions, challenges, or opportunities.',
    sections: [
      { id: 's1', title: 'Context shared', instructions: 'What background or situation did I share with the advisor?' },
      { id: 's2', title: 'Key advice', instructions: 'What were the main recommendations or insights they provided?' },
      { id: 's3', title: 'Questions raised', instructions: 'What questions did they ask that made me think differently?' },
      { id: 's4', title: 'Resources or connections', instructions: 'Did they offer any introductions, resources, or references?' },
      { id: 's5', title: 'Action items', instructions: 'What specific actions should I take based on this advice?' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'board-meeting',
    name: 'Board Meeting',
    icon: '❗',
    category: 'Leadership',
    description: 'I attended or presented at a board meeting to provide updates and receive strategic guidance.',
    sections: [
      { id: 's1', title: 'Company updates', instructions: 'Key updates shared about company performance, metrics, and milestones.' },
      { id: 's2', title: 'Strategic discussions', instructions: 'What strategic topics were discussed? Include any debates or different viewpoints.' },
      { id: 's3', title: 'Board feedback', instructions: 'What feedback or concerns did board members raise?' },
      { id: 's4', title: 'Decisions made', instructions: 'Document any formal decisions or approvals.' },
      { id: 's5', title: 'Action items', instructions: 'List follow-up items with owners and deadlines.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'investor-current',
    name: 'Investor: Current',
    icon: '📊',
    category: 'Leadership',
    description: 'I met with a current investor to provide updates on company progress and discuss any support needed.',
    sections: [
      { id: 's1', title: 'Updates shared', instructions: 'What key updates did I share about the company, product, or metrics?' },
      { id: 's2', title: 'Investor questions', instructions: 'What questions or concerns did the investor raise?' },
      { id: 's3', title: 'Support requested', instructions: 'What help did I ask for? Introductions, advice, resources?' },
      { id: 's4', title: 'Investor offers', instructions: 'What support or connections did they offer to provide?' },
      { id: 's5', title: 'Next steps', instructions: 'Agreed follow-ups and timeline for next check-in.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'investor-prospective',
    name: 'Investor: Prospective',
    icon: '🌱',
    category: 'Leadership',
    description: 'I met with a prospective investor to pitch our company and explore potential investment.',
    sections: [
      { id: 's1', title: 'Investor background', instructions: 'Who did I meet? What is their investment focus and typical check size?' },
      { id: 's2', title: 'Questions asked', instructions: 'What questions did they ask about the business, team, or market?' },
      { id: 's3', title: 'Interest level', instructions: 'How interested did they seem? Any specific concerns or hesitations?' },
      { id: 's4', title: 'Information requested', instructions: 'What additional information or materials did they ask for?' },
      { id: 's5', title: 'Next steps', instructions: 'What are the agreed next steps? Timeline for follow-up?' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'networking',
    name: 'Networking',
    icon: '💬',
    category: 'Leadership',
    description: 'I had a networking meeting to build relationships and exchange ideas.',
    sections: [
      { id: 's1', title: 'Their background', instructions: 'Brief overview of who I met and their current role/company.' },
      { id: 's2', title: 'Key topics discussed', instructions: 'What were the main topics of conversation?' },
      { id: 's3', title: 'Insights shared', instructions: 'What interesting insights or perspectives did they share?' },
      { id: 's4', title: 'Mutual interests', instructions: 'Where do our interests or goals align?' },
      { id: 's5', title: 'Follow-up', instructions: 'Any promised introductions, resources to share, or reasons to reconnect?' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // ============================================================================
  // COMMERCIAL
  // ============================================================================
  {
    id: 'customer-discovery',
    name: 'Customer: Discovery',
    icon: '🔍',
    category: 'Commercial',
    description: "I had a call with a potential customer. This call helps me to understand their needs, concerns, and goals, and ensure that I gather all the necessary information to follow up effectively. I'm interested in the details that might help me close a deal. Please pull out specific figures and helpful quotes. Focus only on what they say, not me.",
    sections: [
      { id: 's1', title: 'Their background', instructions: "I care about key details about the client's business, industry, and role. This context helps me understand where they are coming from and what might be driving their needs for my product." },
      { id: 's2', title: 'Pain points and needs', instructions: 'Please highlight the specific challenges and needs they express. This section is crucial for understanding what problems they are trying to solve and what they are looking for in a solution.' },
      { id: 's3', title: 'Questions or concerns', instructions: 'Capture any questions or concerns they raise during the meeting. This section ensures that I address their worries and provide relevant follow-up information.' },
      { id: 's4', title: 'Budget and timeline', instructions: 'How much do they have to spend? Are there any key dates I should be aware of?' },
      { id: 's5', title: 'Next Steps', instructions: 'Outline the next steps based on our conversation. This could include scheduling another meeting, sending additional information, or any other follow-up actions needed to keep the momentum going.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'customer-existing',
    name: 'Customer: Existing',
    icon: '❤️',
    category: 'Commercial',
    description: 'I met with an existing customer to understand the real-world impact of our product on their business. I aimed to capture specific, actionable feedback that could inform our product development, customer success strategies, and account growth plans.',
    sections: [
      { id: 's1', title: 'Current satisfaction', instructions: "Capture the customer's feedback on their overall satisfaction with your product or service. Note any positive experiences or pain points they mention." },
      { id: 's2', title: 'Recent use and outcomes', instructions: "Summarize how the customer has been using the product or service recently and any outcomes or results they've experienced." },
      { id: 's3', title: 'Challenges and support needs', instructions: 'Document any challenges the customer is facing and what support they may need. Include any requests for additional features or improvements.' },
      { id: 's4', title: 'Opportunities and next steps', instructions: 'Note any opportunities for upselling, cross-selling, or deepening the relationship. Capture any agreed next steps, such as follow-up actions or setting up another check-in.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'account-management',
    name: 'Account Management',
    icon: '🧳',
    category: 'Commercial',
    description: 'I met with a key account to dive deep into their evolving needs and usage patterns. My goal was to uncover opportunities for expanding their adoption of our product and to identify any risks to their long-term satisfaction and retention.',
    sections: [
      { id: 's1', title: 'Current Product Use and Satisfaction', instructions: "Capture their feedback on how they are currently using the product. How many people in the team? Which use cases do they describe? Include details and quotes relating to their satisfaction levels." },
      { id: 's2', title: 'Additional Needs and Pain Points', instructions: 'Document any additional needs or pain points the client expressed, including areas where the product could better support their goals or where they are facing difficulties.' },
      { id: 's3', title: 'Future Roadmap', instructions: "Summarize the client's future plans, including any upcoming projects, expansions, or hiring plans that could impact their usage of our product or require additional support." },
      { id: 's4', title: 'Agreed Next Steps', instructions: 'Note the agreed-upon next steps, including any actions to be taken by either party, timelines, and follow-up plans.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pipeline-review',
    name: 'Pipeline Review',
    icon: '✏️',
    category: 'Commercial',
    description: 'I met with the sales team to review our sales pipeline. Our focus was on understanding our deal flow, identifying potential roadblocks, and determining the most impactful actions to move key opportunities forward.',
    sections: [
      { id: 's1', title: 'Current Pipeline Status', instructions: 'Capture the overall status of the sales pipeline, including the number of active opportunities, their stages, and any significant changes since the last review.' },
      { id: 's2', title: 'Key Deals and Progress', instructions: 'Document the progress of key deals, including updates on important opportunities, expected close dates, and any notable advancements.' },
      { id: 's3', title: 'Blockers and Risks', instructions: 'Summarize any blockers or risks identified that could impact the progression of deals. Note the discussions on potential strategies to address these issues.' },
      { id: 's4', title: 'Next Steps and Actions', instructions: 'Record the agreed-upon next steps and actions for advancing deals, including who is responsible for each action and any deadlines or follow-up plans.' },
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
    category: 'Commercial',
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

  // ============================================================================
  // TEAM
  // ============================================================================
  {
    id: 'standup',
    name: 'Stand-Up',
    icon: '🧍',
    category: 'Team',
    description: "I attended a daily standup meeting. The goal is to document each participant's updates regarding their recent accomplishments, current focus, and any blockers they are facing. Keep these notes short and to-the-point.",
    sections: [
      { id: 's1', title: 'Announcements', instructions: 'Include any note-worthy points from the small-talk or announcements at the beginning of the call.' },
      { id: 's2', title: 'Updates', instructions: 'Break these down into what was achieved yesterday, or accomplishments, what each person is working on today and highlight any blockers that could impact progress.' },
      { id: 's3', title: 'Sidebar', instructions: 'Summarize any further discussions or issues that were explored after the main updates. Note any collaborative efforts, decisions made, or additional points raised.' },
      { id: 's4', title: 'Action Items', instructions: 'Document and assign next steps from the meeting, summarize immediate tasks, provide reminders, and ensure accountability and clarity on responsibilities.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'weekly-team-meeting',
    name: 'Weekly Team Meeting',
    icon: '📅',
    category: 'Team',
    description: "I met with my team to assess our project's health and align our efforts. My aim was to gain a clear understanding of our progress, address any emerging challenges, and ensure each team member is clear on their role in advancing our goals.",
    sections: [
      { id: 's1', title: 'Announcements', instructions: 'Note here any significant announcements made, whether they relate to professional and company-wide updates, or important events in the personal lives of my colleagues.' },
      { id: 's2', title: 'Review of Progress', instructions: "Capture the discussion on the team's progress towards the overall strategic goals." },
      { id: 's3', title: 'Key Achievements', instructions: 'Summarize the notable achievements and results shared by team members, highlighting significant successes or completed tasks from the past week.' },
      { id: 's4', title: 'Challenges and Adjustments Needed', instructions: 'Document any challenges the team is facing, including obstacles that have arisen. Note any adjustments or changes in strategy that were discussed to overcome these challenges.' },
      { id: 's5', title: 'Action Items and Accountability for the Week Ahead', instructions: 'Record the action items assigned for the upcoming week, including who is responsible for each task and any deadlines or accountability measures that were agreed upon.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'all-hands',
    name: 'All Hands Meeting',
    icon: '👐',
    category: 'Team',
    description: "I attended our company's all-hands meeting to stay informed about our overall direction. I wanted to understand how recent developments might affect my role, catch any important announcements, and get a sense of our priorities moving forward.",
    sections: [
      { id: 's1', title: 'Business Overview', instructions: 'Capture updates on company performance, major achievements, and current market position.' },
      { id: 's2', title: 'Strategic Direction', instructions: 'Note discussions about future plans, goals, and any significant changes in company strategy or focus.' },
      { id: 's3', title: 'Team Updates', instructions: 'Record important announcements about departments, new initiatives, or significant projects across the organization.' },
      { id: 's4', title: 'Impact on my role', instructions: 'Summarize information relevant to my specific role and team, including any changes, expectations, or opportunities mentioned.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    icon: '💡',
    category: 'Team',
    description: "We're trying to solve a problem together. This discussion lets us share ideas and feedback on those ideas.",
    sections: [
      { id: 's1', title: 'The problem', instructions: "This section describes the problem we are trying to solve. What's the context and current state? What's been tried before?" },
      { id: 's2', title: 'Themes discussion', instructions: 'This section describes the major themes explored in the brainstorm.' },
      { id: 's3', title: 'Specific ideas', instructions: 'This section lists the most important specific ideas or discussion points from the brainstorm.' },
      { id: 's4', title: 'Future directions', instructions: 'This section is about what we should keep in mind as we move forward. Are there specific directions we decided to explore?' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'project-kickoff',
    name: 'Project Kick-Off',
    icon: '🚀',
    category: 'Team',
    description: "I attended our project kick-off to gain clarity on our new initiative. My aim was to understand the project's scope, our collective goals, and how my role fits into the bigger picture, while also getting aligned on our immediate action plan.",
    sections: [
      { id: 's1', title: 'Context', instructions: 'Capture the background and context of the project, including the overall objectives and reasons for initiating the project.' },
      { id: 's2', title: 'Deliverables', instructions: 'Document the specific deliverables that are expected from the project, including any key outputs, products, or services to be completed.' },
      { id: 's3', title: 'Timelines', instructions: 'Summarize the project timelines, including major milestones, deadlines, and any important dates that were discussed.' },
      { id: 's4', title: 'Ownership and Accountability', instructions: 'Record who is responsible for each part of the project, including roles, responsibilities, and accountability for the deliverables.' },
      { id: 's5', title: 'Next Steps', instructions: 'Note the immediate next steps agreed upon during the meeting, including any actions to be taken, who will take them, and any upcoming meetings or checkpoints.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'project-sync',
    name: 'Project Sync',
    icon: '🔄',
    category: 'Team',
    description: "I participated in our project sync to get a clear picture of where we stand and what's coming up. My focus was on understanding our progress, identifying any hurdles, and ensuring we're all aligned on our next moves to keep things on track.",
    sections: [
      { id: 's1', title: 'Project Status', instructions: 'Capture the current status of the project, including any significant progress made since the last sync and any updates on completed tasks or milestones.' },
      { id: 's2', title: 'Current Roadblocks', instructions: 'Document any challenges or roadblocks the team is facing, including obstacles that are impeding progress and any discussions around how to overcome them.' },
      { id: 's3', title: 'Upcoming Tasks and Milestones', instructions: 'Summarize the upcoming tasks and milestones that need to be addressed, including deadlines and priorities for the next phase of the project.' },
      { id: 's4', title: 'Team Collaboration and Action Items', instructions: 'Record any discussions on team collaboration, including roles, responsibilities, and any new action items assigned during the meeting. Note who is responsible for each task and any agreed-upon timelines.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sprint-planning',
    name: 'Sprint Planning',
    icon: '🏃',
    category: 'Team',
    description: 'I caught up with my team to map out our upcoming sprint. My goal was to prioritize our backlog, estimate task complexity, and commit to a realistic set of deliverables that align with our project milestones.',
    sections: [
      { id: 's1', title: 'Review of Previous Sprint', instructions: 'Summarize the outcomes of the previous sprint, including completed tasks, unfinished work, and any retrospective insights or lessons learned.' },
      { id: 's2', title: 'Prioritization of Backlog Items', instructions: "Capture the discussion on the team's progress towards the overall strategic goals." },
      { id: 's3', title: 'Key Achievements', instructions: 'Document the discussion on backlog items, including how tasks were prioritized for the upcoming sprint and any decisions made about what to include or defer.' },
      { id: 's4', title: 'Sprint Goals and Objectives', instructions: 'Capture the specific goals and objectives set for the sprint, highlighting what the team aims to achieve by the end of the sprint.' },
      { id: 's5', title: 'Task Assignment and Capacity Planning', instructions: "Record the task assignments, including who is responsible for each task and the team's capacity planning to ensure workload balance and feasibility." },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // ============================================================================
  // RECRUITING
  // ============================================================================
  {
    id: 'hiring',
    name: 'Hiring',
    icon: '💼',
    category: 'Recruiting',
    description: 'I met with a job candidate to assess their suitability for a position within our company.',
    sections: [
      { id: 's1', title: 'Their background', instructions: "Detail the candidate's professional journey, education, and overall career progression. Include information about their current role and responsibilities, as well as any significant achievements or projects they've worked on." },
      { id: 's2', title: 'Skills and experience', instructions: 'Highlight the specific skills and experiences that are most relevant to the position. Focus on technical abilities, soft skills, and any particular areas of expertise that align with the job requirements.' },
      { id: 's3', title: 'Motivation and fit', instructions: "Include the candidate's career aspirations and why they're interested in this particular role and company." },
      { id: 's4', title: 'Availability and salary expectations', instructions: "Note down the candidate's current notice period or earliest start date. Include their salary expectations and any other compensation-related questions." },
      { id: 's5', title: 'My thoughts', instructions: 'I may have written my thoughts in the raw notes, list them here. Otherwise, put N/A.' },
      { id: 's6', title: 'Next steps', instructions: 'Write here any subsequent stages in the hiring process that I mention. Include any considerations regarding the candidate\'s availability or timelines that they mention.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'hiring-advanced',
    name: 'Hiring (Advanced)',
    icon: '⭐',
    category: 'Recruiting',
    description: 'A comprehensive interview for senior or specialized roles with deeper evaluation.',
    sections: [
      { id: 's1', title: 'Background and experience', instructions: 'Deep dive into their career history, key accomplishments, and leadership experience.' },
      { id: 's2', title: 'Technical assessment', instructions: 'Detailed evaluation of technical skills, problem-solving ability, and domain expertise.' },
      { id: 's3', title: 'Leadership and management style', instructions: 'How do they lead teams? What is their management philosophy?' },
      { id: 's4', title: 'Culture and values alignment', instructions: 'How well do they align with company culture and values?' },
      { id: 's5', title: 'References and verification', instructions: 'Any reference information provided or verification needed.' },
      { id: 's6', title: 'Compensation discussion', instructions: 'Salary expectations, equity expectations, and total compensation discussion.' },
      { id: 's7', title: 'Decision and next steps', instructions: 'Initial recommendation and proposed next steps in the process.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'user-interview',
    name: 'User Interview',
    icon: '👍',
    category: 'Product',
    description: "I interviewed a user to gather insights about our product. The goal is to capture the customer's feedback, experiences, and suggestions in a detailed and organized manner. The notes should be comprehensive but focused, allowing for the detailed documentation of both qualitative insights and actionable items. Pull out direct quotes and figures whenever relevant.",
    sections: [
      { id: 's1', title: 'User background', instructions: 'Capture relevant details about the user, including their role, experience, and how they interact with your product or service. Note down here any existing solutions or workarounds they use.' },
      { id: 's2', title: 'Current product usage', instructions: 'Document how the user is currently using the product, including frequency of use, key features used, and any specific use cases.' },
      { id: 's3', title: 'Positive feedback and pain points', instructions: 'Summarize the positive feedback the user provided, as well as any pain points or challenges they are experiencing with the product.' },
      { id: 's4', title: 'Impact of the product', instructions: "Record the impact the product has had on the user's work or life, including any improvements or changes it has enabled." },
      { id: 's5', title: 'Next steps and follow up', instructions: 'Record the agreed-upon next steps, including any additional actions that need to be taken, follow-up tasks, and who is responsible for them.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // ============================================================================
  // PRODUCT
  // ============================================================================
  {
    id: 'customer-onboarding',
    name: 'Customer Onboarding',
    icon: '📦',
    category: 'Product',
    description: "I conducted an onboarding session with a new customer. These notes aim to capture their specific circumstances, initial reactions, and any expressed concerns, providing me with a comprehensive understanding to customize my company's approach effectively. I don't need to capture any details of my own product.",
    sections: [
      { id: 's1', title: 'Key Information About Them', instructions: 'Capture essential details about the customer and their company, including their industry, business goals, and how they intend to use your product or service.' },
      { id: 's2', title: 'Questions and Concerns', instructions: 'Document any questions or concerns the customer raised during the onboarding, including any clarifications they needed or potential challenges they foresee.' },
      { id: 's3', title: 'Timeline and Next Steps', instructions: 'Record the agreed-upon timeline for the onboarding process, including key milestones. Note the next steps and actions required, along with who is responsible for each and any deadlines.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'product-demo',
    name: 'Product Demo',
    icon: '🎯',
    category: 'Product',
    description: 'I presented our solution to potential customers to demonstrate its value proposition. My goal was to gauge their level of interest in moving forward with us.',
    sections: [
      { id: 's1', title: 'Their reactions', instructions: 'Capture their initial reactions during the demo, including any positive feedback or visible enthusiasm.' },
      { id: 's2', title: 'Questions and Concerns', instructions: 'Document any questions or concerns raised by the participants, including clarifications needed or any issues they identified during the demo.' },
      { id: 's3', title: 'Feedback and Suggestions', instructions: 'Record any feedback provided, including suggestions for improvements, feature requests, or areas they think could be enhanced.' },
      { id: 's4', title: 'Next Steps', instructions: 'Note the agreed-upon next steps, including any actions to follow up on, further discussions, or changes to be made to the product. Include who is responsible for each action and any timelines.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'requirements-gathering',
    name: 'Requirements Gathering',
    icon: '📋',
    category: 'Product',
    description: 'I am speaking to a stakeholder to understand a problem that needs to be solved. I care about understanding the discussion that leads to the action items.',
    sections: [
      { id: 's1', title: 'Context', instructions: "Note down the overview of what it is we're trying to accomplish and any additional context required." },
      { id: 's2', title: 'Brainstorming', instructions: 'Capture the key topics discussed and our conclusions on each of them.' },
      { id: 's3', title: 'Decision', instructions: 'What was decided upon? Crystallize the output into action items.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'troubleshooting',
    name: 'Troubleshooting',
    icon: '⁉️',
    category: 'Product',
    description: 'I met a customer who was having problems with using my product or service. I care about recording the specifics of their problem and steps I took to help them.',
    sections: [
      { id: 's1', title: 'Their challenge or problem', instructions: 'Capture a clear description of the challenge or problem they are experiencing, including any specific details they provided.' },
      { id: 's2', title: 'My suggested solutions and their outcomes', instructions: 'Document the solutions I suggested, including any immediate outcomes or results from the troubleshooting steps taken during the session.' },
      { id: 's3', title: 'Next steps', instructions: 'Record the agreed-upon next steps, including any additional actions that need to be taken, follow-up tasks, and who is responsible for them.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // ============================================================================
  // VC (Venture Capital)
  // ============================================================================
  {
    id: 'catchup-investor',
    name: 'Catch-up: Investor',
    icon: '🤝',
    category: 'VC',
    description: 'This is a meeting with another investor. The point of this meeting is to exchange information about companies or people we should be speaking with.',
    sections: [
      { id: 's1', title: 'Personal update', instructions: 'A short summary of any personal information shared during the call. If not discussed, write "NA".' },
      { id: 's2', title: 'Companies they talked about', instructions: 'List all the companies they talked about and summarize what was said.' },
      { id: 's3', title: 'Companies I talked about', instructions: 'List all the companies I talked about and summarize what I said.' },
      { id: 's4', title: 'Other Topics', instructions: 'What other topics were discussed?' },
      { id: 's5', title: 'Promised introductions', instructions: 'List all the introductions that were promised.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'catchup-portfolio',
    name: 'Catch-up: Portfolio Company',
    icon: '📈',
    category: 'VC',
    description: 'This is a meeting with one of my portfolio companies. The point of this meeting is to hear how things are going and how I can be helpful.',
    sections: [
      { id: 's1', title: 'Growth', instructions: 'Any information regarding the company\'s traction or growth. Include specific numbers or metrics that were mentioned. If not discussed, put "NA".' },
      { id: 's2', title: 'Challenges', instructions: 'Any challenges or roadblocks the startup is currently facing.' },
      { id: 's3', title: 'Burn rate', instructions: 'Any details discussed about the company\'s burn rate and remaining runway. If not discussed, put "NA".' },
      { id: 's4', title: 'Action items', instructions: 'Record the agreed-upon next steps, including any additional actions that need to be taken, follow-up tasks, and who is responsible for them.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'lp-prospective',
    name: 'LP: Prospective',
    icon: '🔴',
    category: 'VC',
    description: 'This meeting was with a prospective LP. The point of the meeting is to see if they would be a good investor in our fund.',
    sections: [
      { id: 's1', title: 'Investment Strategy and Check Size', instructions: 'What sized checks do they write? What\'s their overall investment strategy? Where else are they invested? If not discussed, write "NA"' },
      { id: 's2', title: 'What they look for', instructions: 'What do they look for in their investments? Particular segment, geo, size, etc. If not discussed, write "NA"' },
      { id: 's3', title: 'Timeline', instructions: 'What\'s their timeline for doing an investment? What\'s the process for approving an investment? If not discussed, write "NA"' },
      { id: 's4', title: 'Other funds they are in', instructions: 'Did they mention any other funds they are invested in? If not discussed, write "NA"' },
      { id: 's5', title: 'Personal information', instructions: 'Any personal information they shared (family, vacations, etc). If not discussed, write "NA"' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'vc-board-meeting',
    name: 'VC: Board Meeting',
    icon: '🧳',
    category: 'VC',
    description: 'I met with a start-up as a member of their board to hear updates from the company and to provide feedback on strategy.',
    sections: [
      { id: 's1', title: 'Progress', instructions: 'Summarize all progress made by the company since the last board meeting. Pull out all relevant KPIs and numbers.' },
      { id: 's2', title: 'Plans', instructions: 'Detail the plan moving forward and any major events, goals or KPIs coming up in the next few months.' },
      { id: 's3', title: 'Challenges', instructions: 'List any potential blockers or challenges they mention anticipating.' },
      { id: 's4', title: 'Requests for support', instructions: 'Write out a list of any requests for support they mention, and in sub-bullets, how members of the board offer their help.' },
      { id: 's5', title: 'Next steps', instructions: 'This section covers what was decided in the meeting as to next steps moving forward.' },
    ],
    isDefault: false,
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'vc-pitch',
    name: 'VC: Pitch',
    icon: '🚀',
    category: 'VC',
    description: 'I am an investor meeting a startup to see if I should potentially invest.',
    sections: [
      { id: 's1', title: 'Team', instructions: 'Detail the background of the team members and their previous experience.' },
      { id: 's2', title: 'Problem', instructions: 'This section is about what problem the startup is trying to solve. Who has this problem? How many people or businesses have this problem? Why is it a problem?' },
      { id: 's3', title: 'Product', instructions: "What product is the startup building? How does the product work? How does it solve the user's problem? Any specific details about the product goes here." },
      { id: 's4', title: 'Go-to-market', instructions: 'How will they sell the product? Have they started selling it yet? How are they reaching customers? How much will it cost? How will they get lots of customers?' },
      { id: 's5', title: 'Traction', instructions: 'What has the startup achieved so far? How many users do they have? How much money are they making? What other progress or traction do they have?' },
      { id: 's6', title: 'Funding', instructions: 'Is the startup currently fundraising? If so, how much are they looking to raise and under what terms? Has the startup raised money in the past? If so, how much did they raise, from whom, and on what terms.' },
      { id: 's7', title: 'Agreed next steps', instructions: 'Write here any important dates or deadlines mentioned relating to my timeline for getting back to them.' },
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
        
        // Update existing built-in templates with new data (descriptions, sections, categories)
        const updatedSaved = saved.map((t: NoteTemplate) => {
          if (t.isBuiltIn) {
            const defaultTemplate = DEFAULT_TEMPLATES.find(dt => dt.id === t.id);
            if (defaultTemplate) {
              // Preserve user's isDefault choice, but update everything else
              return {
                ...defaultTemplate,
                isDefault: t.isDefault,
                createdAt: t.createdAt,
              };
            }
          }
          return t;
        });
        
        this.templates = [...updatedSaved, ...newBuiltIns];
        // Save to persist any updates
        this.saveTemplates();
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

  getTemplatesByCategory(): Record<TemplateCategory | 'Custom', NoteTemplate[]> {
    const grouped: Record<string, NoteTemplate[]> = {
      'General': [],
      'Commercial': [],
      'Leadership': [],
      'Team': [],
      'Recruiting': [],
      'Product': [],
      'VC': [],
      'Custom': [],
    };

    for (const template of this.templates) {
      if (!template.isBuiltIn) {
        grouped['Custom'].push(template);
      } else if (template.category) {
        grouped[template.category].push(template);
      } else {
        grouped['General'].push(template);
      }
    }

    return grouped as Record<TemplateCategory | 'Custom', NoteTemplate[]>;
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
