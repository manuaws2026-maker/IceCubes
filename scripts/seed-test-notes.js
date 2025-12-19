#!/usr/bin/env node
/**
 * Seed test notes with realistic transcripts for template detection testing
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Database path
const dbPath = path.join(os.homedir(), 'Library/Application Support/icecubes/icecubes.db');

console.log('Opening database at:', dbPath);
const db = new Database(dbPath);

// Generate unique IDs
const generateId = () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Test notes with realistic transcripts
const testNotes = [
  {
    title: 'Q4 Planning and Investor Update',
    transcript: [
      { text: "Alright everyone, let's get started with our quarterly board meeting.", speaker: 0, isYou: false },
      { text: "Thanks for joining. I'll walk you through our Q4 numbers first.", speaker: 1, isYou: true },
      { text: "We closed the quarter at 2.3 million ARR, up 40% from last quarter.", speaker: 1, isYou: true },
      { text: "That's solid growth. What's driving the acceleration?", speaker: 0, isYou: false },
      { text: "Mainly our enterprise push. We signed three Fortune 500 deals.", speaker: 1, isYou: true },
      { text: "The CAC payback improved to 14 months from 18 months last quarter.", speaker: 1, isYou: true },
      { text: "What about runway? Where do we stand on cash?", speaker: 2, isYou: false },
      { text: "We have 18 months of runway at current burn. We're spending about 400K per month.", speaker: 1, isYou: true },
      { text: "I think we should discuss the Series B timeline.", speaker: 0, isYou: false },
      { text: "Agreed. I'd recommend starting conversations in Q2 to close by end of year.", speaker: 2, isYou: false },
      { text: "We need to show another quarter of this growth trajectory first.", speaker: 0, isYou: false },
      { text: "On the product side, we're launching the AI features next month.", speaker: 1, isYou: true },
      { text: "How's the competitive landscape looking? Any concerns?", speaker: 2, isYou: false },
      { text: "We're seeing pressure from the bigger players but winning on product velocity.", speaker: 1, isYou: true },
      { text: "Let's make sure we have the board deck updated for the investor LP meeting.", speaker: 0, isYou: false },
      { text: "I'll send that over by Friday with all the updated metrics.", speaker: 1, isYou: true },
    ],
  },
  {
    title: 'Pitch Meeting with Sequoia',
    transcript: [
      { text: "Thanks for making time to meet. I've been following your company for a few months.", speaker: 0, isYou: false },
      { text: "Happy to be here. Should I jump into the deck?", speaker: 1, isYou: true },
      { text: "Actually, let's just talk. Tell me about the founding story.", speaker: 0, isYou: false },
      { text: "Sure. We started in 2022 after seeing how broken meeting productivity was.", speaker: 1, isYou: true },
      { text: "My cofounder and I were at Google and saw teams waste hours on note-taking.", speaker: 1, isYou: true },
      { text: "What makes you different from Otter or Fireflies?", speaker: 0, isYou: false },
      { text: "We're not just transcription. We use AI to actually generate actionable notes.", speaker: 1, isYou: true },
      { text: "The templates are customized per meeting type and learn from your style.", speaker: 1, isYou: true },
      { text: "What's your current traction?", speaker: 0, isYou: false },
      { text: "2.3 million ARR, 40% quarter over quarter growth, 500 paying customers.", speaker: 1, isYou: true },
      { text: "Net revenue retention is 130%. Very sticky product.", speaker: 1, isYou: true },
      { text: "That's impressive. What's the average deal size?", speaker: 0, isYou: false },
      { text: "Started at 5K but enterprise deals are now 50-100K annually.", speaker: 1, isYou: true },
      { text: "How much are you raising and what's the use of funds?", speaker: 0, isYou: false },
      { text: "We're raising 15 million Series A. Primarily for go-to-market expansion.", speaker: 1, isYou: true },
      { text: "I'd like to introduce you to my partner who leads our SaaS investments.", speaker: 0, isYou: false },
      { text: "That would be great. We're being pretty selective about partners.", speaker: 1, isYou: true },
    ],
  },
  {
    title: 'Enterprise Sales Discovery - Acme Corp',
    transcript: [
      { text: "Thanks for hopping on. I understand you're looking at productivity tools.", speaker: 0, isYou: true },
      { text: "Yes, we have about 2000 employees and meeting overload is a real problem.", speaker: 1, isYou: false },
      { text: "Our sales team alone spends 3 hours a day in meetings.", speaker: 1, isYou: false },
      { text: "That's significant. What's the main pain point?", speaker: 0, isYou: true },
      { text: "Action items get lost. People forget what was discussed.", speaker: 1, isYou: false },
      { text: "We tried Otter but the transcripts aren't actionable.", speaker: 1, isYou: false },
      { text: "Who else is involved in this decision?", speaker: 0, isYou: true },
      { text: "Our VP of Sales Sarah and IT security lead Mike need to sign off.", speaker: 1, isYou: false },
      { text: "What's your timeline for making a decision?", speaker: 0, isYou: true },
      { text: "We'd like to pilot something by end of Q1, decision by February.", speaker: 1, isYou: false },
      { text: "Do you have budget allocated for this?", speaker: 0, isYou: true },
      { text: "Yes, we have about 50K in our productivity tools budget.", speaker: 1, isYou: false },
      { text: "Are you looking at any other solutions?", speaker: 0, isYou: true },
      { text: "We had a demo with Fireflies but security had concerns.", speaker: 1, isYou: false },
      { text: "Our product runs entirely on-premise if needed. Would that help?", speaker: 0, isYou: true },
      { text: "That would definitely make the security review easier.", speaker: 1, isYou: false },
      { text: "Let me send over a proposal and set up a technical deep-dive with Mike.", speaker: 0, isYou: true },
    ],
  },
  {
    title: 'Weekly Sync with Sarah',
    transcript: [
      { text: "Hey Sarah, how's your week going?", speaker: 0, isYou: true },
      { text: "Pretty good. Busy but productive. How about you?", speaker: 1, isYou: false },
      { text: "Same. Let's dive in. What's top of mind for you?", speaker: 0, isYou: true },
      { text: "The product launch is stressing me out a bit.", speaker: 1, isYou: false },
      { text: "We're behind on the QA cycle and I'm worried about the deadline.", speaker: 1, isYou: false },
      { text: "What's causing the delay?", speaker: 0, isYou: true },
      { text: "We found some edge cases in the API that need fixing.", speaker: 1, isYou: false },
      { text: "Should we push the launch by a week?", speaker: 0, isYou: true },
      { text: "I think that's the safest option. Better to launch solid.", speaker: 1, isYou: false },
      { text: "Agreed. I'll communicate that to stakeholders.", speaker: 0, isYou: true },
      { text: "On the wins side, the new hire is ramping up faster than expected.", speaker: 1, isYou: false },
      { text: "That's great to hear. Any feedback for me?", speaker: 0, isYou: true },
      { text: "Actually yes. The team would love more context on company strategy.", speaker: 1, isYou: false },
      { text: "Maybe a monthly all-hands where you share the bigger picture?", speaker: 1, isYou: false },
      { text: "That's fair feedback. I'll set that up.", speaker: 0, isYou: true },
      { text: "What should we focus on for your growth this quarter?", speaker: 0, isYou: true },
      { text: "I'd like to get more experience with customer-facing work.", speaker: 1, isYou: false },
    ],
  },
  {
    title: 'Morning Standup',
    transcript: [
      { text: "Alright team, let's do a quick standup. Who wants to go first?", speaker: 0, isYou: true },
      { text: "I'll go. Yesterday I finished the authentication refactor.", speaker: 1, isYou: false },
      { text: "Today I'm starting on the API rate limiting feature.", speaker: 1, isYou: false },
      { text: "No blockers for me.", speaker: 1, isYou: false },
      { text: "Nice work on the auth stuff. Mike, you're up.", speaker: 0, isYou: true },
      { text: "I spent yesterday debugging that memory leak in production.", speaker: 2, isYou: false },
      { text: "Found the root cause, it was in the websocket connection pooling.", speaker: 2, isYou: false },
      { text: "Today I'm pushing the fix and monitoring.", speaker: 2, isYou: false },
      { text: "Actually I need help reviewing the PR. It's a sensitive change.", speaker: 2, isYou: false },
      { text: "I can review that this morning.", speaker: 1, isYou: false },
      { text: "Great. Lisa, how about you?", speaker: 0, isYou: true },
      { text: "I wrapped up the design for the new dashboard.", speaker: 3, isYou: false },
      { text: "Today I'm meeting with customers for feedback.", speaker: 3, isYou: false },
      { text: "The handoff to engineering should happen tomorrow.", speaker: 3, isYou: false },
      { text: "Perfect. One announcement - we're doing a team lunch Friday to celebrate the launch.", speaker: 0, isYou: true },
      { text: "Also reminder that next Monday is a holiday.", speaker: 0, isYou: true },
    ],
  },
  {
    title: 'Interview - Senior Engineer Candidate',
    transcript: [
      { text: "Thanks for coming in today. How are you doing?", speaker: 0, isYou: true },
      { text: "Great, thanks. Excited to learn more about the role.", speaker: 1, isYou: false },
      { text: "Tell me about your current role at Stripe.", speaker: 0, isYou: true },
      { text: "I'm a senior engineer on the payments team. Been there 3 years.", speaker: 1, isYou: false },
      { text: "I lead a team of 4 engineers building the subscription billing system.", speaker: 1, isYou: false },
      { text: "What's a project you're most proud of?", speaker: 0, isYou: true },
      { text: "We rebuilt the entire invoicing system last year.", speaker: 1, isYou: false },
      { text: "Reduced latency by 60% and cut infrastructure costs in half.", speaker: 1, isYou: false },
      { text: "That's impressive. How did you approach the architecture?", speaker: 0, isYou: true },
      { text: "We moved from a monolith to microservices, used Kafka for event streaming.", speaker: 1, isYou: false },
      { text: "What made you start looking for new opportunities?", speaker: 0, isYou: true },
      { text: "I want to be at an earlier stage company where I can have more impact.", speaker: 1, isYou: false },
      { text: "Also interested in the AI space, which is why this role caught my eye.", speaker: 1, isYou: false },
      { text: "What questions do you have for me?", speaker: 0, isYou: true },
      { text: "What does success look like in the first 6 months?", speaker: 1, isYou: false },
      { text: "Also curious about the team structure and how decisions get made.", speaker: 1, isYou: false },
    ],
  },
  {
    title: 'Product Demo - TechStart Inc',
    transcript: [
      { text: "Thanks for joining the demo. I'm excited to show you what we've built.", speaker: 0, isYou: true },
      { text: "We've heard great things. Our team is really interested.", speaker: 1, isYou: false },
      { text: "Let me share my screen and walk you through the product.", speaker: 0, isYou: true },
      { text: "So here's the main dashboard. You can see all your recent meetings.", speaker: 0, isYou: true },
      { text: "When I click on a meeting, you see the AI-generated notes here.", speaker: 0, isYou: true },
      { text: "Wow, that's really clean. How accurate is the transcription?", speaker: 1, isYou: false },
      { text: "About 95% accuracy, and it learns your team's terminology over time.", speaker: 0, isYou: true },
      { text: "Can it integrate with our existing tools like Salesforce?", speaker: 2, isYou: false },
      { text: "Yes, we have native integrations with Salesforce, HubSpot, and Slack.", speaker: 0, isYou: true },
      { text: "Let me show you the template feature. This is really powerful.", speaker: 0, isYou: true },
      { text: "You can create custom templates for different meeting types.", speaker: 0, isYou: true },
      { text: "That would be huge for our sales team. They have very specific needs.", speaker: 1, isYou: false },
      { text: "Exactly. And the AI learns which template to use automatically.", speaker: 0, isYou: true },
      { text: "What about security? We're in healthcare so compliance is critical.", speaker: 2, isYou: false },
      { text: "We're SOC 2 Type II certified and HIPAA compliant.", speaker: 0, isYou: true },
      { text: "This looks really promising. What are the next steps?", speaker: 1, isYou: false },
      { text: "I can set up a pilot for your team. Usually takes about a week.", speaker: 0, isYou: true },
    ],
  },
  {
    title: 'New Customer Kickoff - GlobalBank',
    transcript: [
      { text: "Welcome aboard! We're thrilled to have GlobalBank as a customer.", speaker: 0, isYou: true },
      { text: "Thanks. Our team is eager to get started.", speaker: 1, isYou: false },
      { text: "Let me introduce myself. I'm your dedicated customer success manager.", speaker: 0, isYou: true },
      { text: "I'll be your main point of contact throughout the onboarding.", speaker: 0, isYou: true },
      { text: "Perfect. We have about 200 users who'll be using this initially.", speaker: 1, isYou: false },
      { text: "Great. What are your primary goals with the platform?", speaker: 0, isYou: true },
      { text: "We want to reduce time spent on meeting admin by 50%.", speaker: 1, isYou: false },
      { text: "Also improve follow-through on action items.", speaker: 1, isYou: false },
      { text: "Those are achievable goals. Let me walk you through the timeline.", speaker: 0, isYou: true },
      { text: "Week one we'll do admin training and SSO setup.", speaker: 0, isYou: true },
      { text: "Week two is pilot group rollout with about 20 users.", speaker: 0, isYou: true },
      { text: "Do we need to involve IT for the SSO configuration?", speaker: 2, isYou: false },
      { text: "Yes, I'll need about an hour with your IT team.", speaker: 0, isYou: true },
      { text: "What about training for the end users?", speaker: 1, isYou: false },
      { text: "We provide self-service guides plus I'll do live training sessions.", speaker: 0, isYou: true },
      { text: "Usually 3 sessions of 30 minutes each for different user groups.", speaker: 0, isYou: true },
      { text: "That sounds comprehensive. When can we start?", speaker: 1, isYou: false },
    ],
  },
  {
    title: 'Brainstorm - New Feature Ideas',
    transcript: [
      { text: "Alright, let's brainstorm some new feature ideas for Q2.", speaker: 0, isYou: true },
      { text: "I've been thinking about real-time collaboration on notes.", speaker: 1, isYou: false },
      { text: "Like multiple people editing during the meeting?", speaker: 2, isYou: false },
      { text: "Exactly. Similar to how Google Docs works.", speaker: 1, isYou: false },
      { text: "That's interesting. What problem does it solve?", speaker: 0, isYou: true },
      { text: "Teams often have different perspectives on what was important.", speaker: 1, isYou: false },
      { text: "What about an AI summary that runs mid-meeting?", speaker: 3, isYou: false },
      { text: "So you can see a live summary as the meeting progresses.", speaker: 3, isYou: false },
      { text: "I love that idea. Could help people who join late catch up.", speaker: 0, isYou: true },
      { text: "Another thought - what about meeting analytics?", speaker: 2, isYou: false },
      { text: "Track things like who talks most, meeting efficiency scores.", speaker: 2, isYou: false },
      { text: "That could be powerful for managers to understand meeting culture.", speaker: 0, isYou: true },
      { text: "We should validate these with customers first.", speaker: 1, isYou: false },
      { text: "Agreed. Let's rank them by customer demand and effort.", speaker: 0, isYou: true },
      { text: "Real-time collab is probably high effort but high impact.", speaker: 3, isYou: false },
      { text: "Mid-meeting summary might be easier to ship quickly.", speaker: 1, isYou: false },
      { text: "Let's prototype both and see which resonates more.", speaker: 0, isYou: true },
    ],
  },
  {
    title: 'Troubleshooting Session - Customer Issue',
    transcript: [
      { text: "Thanks for getting on quickly. I know you're having issues.", speaker: 0, isYou: true },
      { text: "Yes, our transcriptions have been failing since yesterday.", speaker: 1, isYou: false },
      { text: "We have an important board meeting tomorrow and need this fixed.", speaker: 1, isYou: false },
      { text: "I understand. Let me pull up your account.", speaker: 0, isYou: true },
      { text: "I can see you're on the enterprise plan. Are all users affected?", speaker: 0, isYou: true },
      { text: "It seems to be only affecting our executives' accounts.", speaker: 1, isYou: false },
      { text: "Interesting. Let me check if there's a permissions issue.", speaker: 0, isYou: true },
      { text: "I see the problem. There was an SSO sync that reset some permissions.", speaker: 0, isYou: true },
      { text: "I'm fixing that now. Can you have one of them try again?", speaker: 0, isYou: true },
      { text: "Let me ping our CEO. One moment.", speaker: 1, isYou: false },
      { text: "He says it's working now!", speaker: 1, isYou: false },
      { text: "Great. I'll monitor this over the next 24 hours.", speaker: 0, isYou: true },
      { text: "Is there anything we can do to prevent this in the future?", speaker: 1, isYou: false },
      { text: "Yes, I recommend setting up a dedicated service account for SSO.", speaker: 0, isYou: true },
      { text: "That way user syncs won't affect core functionality.", speaker: 0, isYou: true },
      { text: "Can you send documentation on how to set that up?", speaker: 1, isYou: false },
      { text: "Absolutely. I'll email it right after this call.", speaker: 0, isYou: true },
    ],
  },
];

// Insert notes
const insertNote = db.prepare(`
  INSERT INTO notes (id, title, notes, transcript, date, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const now = new Date().toISOString();
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

console.log('\nInserting test notes...\n');

for (const note of testNotes) {
  const id = generateId();
  try {
    insertNote.run(
      id,
      note.title,
      '', // Empty raw notes
      JSON.stringify(note.transcript),
      today,
      now,
      now
    );
    console.log(`✅ Created: "${note.title}"`);
  } catch (err) {
    console.error(`❌ Failed: "${note.title}" - ${err.message}`);
  }
}

console.log('\n✨ Done! Restart the app to see the test notes.\n');

db.close();

