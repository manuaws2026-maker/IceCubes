/**
 * Insert a test note with 3000 word transcript and 400 word raw notes directly into the database
 * Run with: node insert-test-note.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Get the database path (same as the app uses)
const userDataPath = process.platform === 'darwin' 
  ? path.join(os.homedir(), 'Library/Application Support/icecubes')
  : path.join(os.homedir(), '.icecubes');

const dbPath = path.join(userDataPath, 'icecubes.db');

console.log('Database path:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('Database not found! Make sure the app has been run at least once.');
  process.exit(1);
}

// Generate ~3000 word transcript (about 18000 chars)
function generateTranscript() {
  const speakers = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank'];
  
  const discussions = [
    // Auth & Security (~600 words)
    { speaker: 'Alice', text: "Let's start with the authentication system redesign. We've been seeing significant performance issues with the current OAuth implementation, particularly around token refresh. The P99 latency has increased by forty percent over the last quarter, which is unacceptable for our enterprise customers." },
    { speaker: 'Bob', text: "I've been analyzing the metrics and the main bottleneck is in the session validation layer. We're making too many database calls for each authentication request. My proposal is to implement a Redis caching layer for session tokens." },
    { speaker: 'Carol', text: "The security team has some concerns about caching authentication tokens. We need to ensure proper TTL settings and implement cache invalidation when users log out or change their passwords. We can't compromise on security." },
    { speaker: 'David', text: "Good point Carol. I suggest we use a sliding window expiration with a maximum absolute TTL of twenty-four hours. We should also implement immediate invalidation via pub/sub when security-critical events occur like password changes or account lockouts." },
    { speaker: 'Alice', text: "I'll schedule a meeting with the security team to review this caching proposal. We should involve them early in the design process to avoid issues during the security review phase." },
    { speaker: 'Eve', text: "Don't forget about the multi-factor authentication rollout. We promised enterprise customers MFA support by end of Q1. The JWT token rotation strategy needs to be finalized as well." },
    
    // Product Roadmap (~600 words)
    { speaker: 'Bob', text: "Moving on to the product roadmap. We need to finalize the features for Q1. The customer feedback survey shows that users are most interested in better collaboration tools and real-time notifications." },
    { speaker: 'Carol', text: "I've been working on the notification system redesign. We're planning to support push notifications, email digests, and in-app notifications with customizable preferences per notification type. Users will be able to set quiet hours and choose which events trigger notifications." },
    { speaker: 'David', text: "We should also consider adding Slack and Microsoft Teams integrations. Many of our enterprise customers have been requesting this feature. It would significantly improve our competitive position in the market." },
    { speaker: 'Alice', text: "The engineering estimate for Slack integration is about three weeks. Teams would take longer due to their more complex API and authentication requirements. I suggest we prioritize Slack for Q1 and defer Teams to Q2." },
    { speaker: 'Frank', text: "One thing to note - we're still waiting on the legal review for the third-party data processing agreement. That might impact the timeline for the Slack integration. Legal has had the documents for two weeks now." },
    { speaker: 'Carol', text: "I'll follow up with legal today. We need that approval to proceed with the integration work. This is becoming a blocker for multiple features." },
    
    // Critical Bug (~500 words)
    { speaker: 'David', text: "Let's discuss the sprint priorities. We have the auth caching work, notification system, and several bug fixes that were escalated from customer support." },
    { speaker: 'Alice', text: "The critical bug in the export feature needs immediate attention. Customers are reporting data loss when exporting large datasets. This should be our top priority for this sprint." },
    { speaker: 'Bob', text: "I can take that investigation. I've already started looking into it and I think the issue is with our streaming implementation. We're not properly handling backpressure from the file system when writing large exports." },
    { speaker: 'Carol', text: "Great. Let's make sure we have proper error handling and recovery mechanisms. Users should be able to resume failed exports without starting from scratch. This is a critical customer-facing issue." },
    { speaker: 'Eve', text: "We should also add better progress indicators and the ability to cancel long-running exports. The current UX leaves users in the dark about what's happening." },
    
    // Dashboard (~500 words)
    { speaker: 'Frank', text: "The design team has finished the mockups for the new dashboard. We're proposing a widget-based layout that users can customize. Each widget can display different metrics or data views based on user preferences." },
    { speaker: 'Alice', text: "I like the flexibility, but we need to ensure good performance with multiple widgets loading simultaneously. Each widget shouldn't make separate API calls. We should batch requests where possible." },
    { speaker: 'Bob', text: "We're planning to use GraphQL for the dashboard API. That way, widgets can specify exactly what data they need, and we can optimize the backend to batch similar queries together." },
    { speaker: 'Carol', text: "That's a good approach. We should also implement lazy loading for widgets that are below the fold. No point fetching data for widgets the user hasn't scrolled to yet." },
    { speaker: 'David', text: "Don't forget about accessibility. The new dashboard needs to be fully keyboard navigable and work well with screen readers. We've had complaints about the current dashboard's accessibility." },
    
    // Infrastructure (~500 words)
    { speaker: 'Eve', text: "On the infrastructure side, we're planning to migrate from AWS ECS to Kubernetes. This will give us better auto-scaling capabilities and easier deployment management across multiple regions." },
    { speaker: 'Frank', text: "What's the timeline for the migration? We need to ensure zero downtime during the transition. Our SLA guarantees ninety-nine point nine percent uptime." },
    { speaker: 'Alice', text: "We're planning a gradual migration over six weeks. We'll run both systems in parallel and use traffic splitting to gradually shift load to the new Kubernetes cluster. This minimizes risk." },
    { speaker: 'Bob', text: "Make sure we have comprehensive monitoring in place before we start. We need real-time visibility into error rates, latency percentiles, and resource utilization on both systems during the migration." },
    { speaker: 'Carol', text: "I'll work with the SRE team to set up the monitoring dashboards. We should have alerting configured for any anomalies that might indicate migration issues." },
    
    // Action Items (~300 words)
    { speaker: 'David', text: "Let me summarize the action items from today's meeting. First, Bob will investigate and fix the export data loss bug by end of this week. This is our top priority." },
    { speaker: 'Alice', text: "Second, I'll create the technical design document for the authentication caching implementation with Redis, including the TTL strategy and pub/sub invalidation approach." },
    { speaker: 'Bob', text: "Third, Carol will coordinate with the design team on the dashboard widget specifications. We need the final component list by next Monday for the GraphQL schema design." },
    { speaker: 'Carol', text: "I'll also create user stories for the notification system features so we can start estimation in the next sprint planning session." },
    { speaker: 'Eve', text: "Fourth, Alice needs to follow up with legal on the Slack data processing agreement. This is blocking the integration work and needs to be escalated if we don't hear back by Wednesday." },
    { speaker: 'Frank', text: "Fifth, I'll document the Kubernetes migration plan including the six-week timeline, traffic splitting approach, monitoring requirements, and rollback procedures in case of issues." },
    { speaker: 'David', text: "Before we wrap up, any blockers or concerns we haven't addressed? This is the time to raise anything that might impact our deliverables for Q1." },
    { speaker: 'Bob', text: "One thing - the export bug fix might require a database schema change to support resumable exports. If so, we'll need to coordinate the migration carefully with the release schedule." },
    { speaker: 'Alice', text: "Let's flag that early. Bob, once you've finished the investigation, send out an email if a schema change is needed so we can plan the migration accordingly." },
    { speaker: 'Carol', text: "Thanks everyone. Good discussion today. Let's reconvene next Tuesday for the sprint review. Please update your Jira tickets with progress by end of day Friday." },
    { speaker: 'David', text: "Meeting adjourned. Remember - export bug is priority one, and legal follow-up is priority two for unblocking the Slack integration. Have a productive week everyone." },
  ];
  
  // Convert to transcript array format
  return discussions.map((d, i) => ({
    text: `${d.speaker}: ${d.text}`,
    timestamp: i * 15 // 15 seconds apart
  }));
}

// Generate ~400 word raw notes
function generateRawNotes() {
  return `=== MY PERSONAL NOTES ===

URGENT PRIORITIES:
- Export bug is CRITICAL - customers are losing data! Bob investigating, deadline Friday
- Legal blocker for Slack integration - 2 weeks waiting, need to escalate to VP
- Auth caching needs security team review ASAP

AUTH DISCUSSION NOTES:
- Redis caching for session tokens - good idea but security concerns
- TTL: 24 hours sliding window - verify with security team first
- Pub/sub for immediate invalidation on password changes
- JWT rotation might break mobile app - need to test thoroughly
- MFA rollout promised to enterprise by Q1 end

PRODUCT ROADMAP:
- Notification system: push, email, in-app with preferences
- Slack integration: 3 weeks estimate, Teams deferred to Q2
- Customer feedback: collaboration tools most requested
- Dark mode highly requested - add to backlog

CRITICAL BUG - EXPORT DATA LOSS:
- Streaming backpressure issue identified by Bob
- File system writes not properly buffered
- Need resume capability for failed exports
- Better progress indicators needed
- This is affecting enterprise customers!

DASHBOARD REDESIGN:
- Widget-based customizable layout
- GraphQL API for efficient data fetching
- Lazy loading for below-fold widgets
- Must be keyboard accessible
- Mobile responsive design needed

KUBERNETES MIGRATION:
- 6 week phased rollout - seems aggressive
- Zero downtime requirement (99.9% SLA)
- Traffic splitting for gradual migration
- Monitoring dashboards needed BEFORE migration starts
- Rollback plan must be documented

ACTION ITEMS TO TRACK:
[ ] Bob: Export bug fix - Friday deadline (P1)
[ ] Alice: Auth caching design doc
[ ] Carol: Dashboard widget specs - Monday
[ ] Alice: Legal follow-up on Slack DPA - escalate Wednesday
[ ] Frank: K8s migration plan document
[ ] Set up monitoring before migration

MY FOLLOW-UPS:
- 1:1 with Bob about export bug technical details
- Review GraphQL schema proposal when ready
- Check Redis cluster capacity with DevOps
- Update my Jira tickets by Friday EOD

CONCERNS:
- Schema change for export might delay release
- Legal approval timeline is risky
- K8s migration during Q1 features seems tight

Next meeting: Tuesday sprint review`;
}

// Main execution
try {
  const db = new Database(dbPath);
  
  const transcript = generateTranscript();
  const rawNotes = generateRawNotes();
  
  // Calculate stats
  const transcriptText = transcript.map(t => t.text).join(' ');
  const transcriptWords = transcriptText.split(/\s+/).length;
  const notesWords = rawNotes.split(/\s+/).length;
  
  console.log(`\nGenerated content:`);
  console.log(`  Transcript: ${transcriptWords} words, ${transcript.length} segments`);
  console.log(`  Raw Notes: ${notesWords} words`);
  
  const noteId = Date.now().toString();
  const now = new Date().toISOString();
  
  // Insert the note
  const stmt = db.prepare(`
    INSERT INTO notes (id, title, provider, date, transcript, notes, enhanced_notes, audio_path, calendar_event_id, start_time, folder_id, template_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    noteId,                                    // id
    'Q1 Planning Meeting - Auth, Export Bug, K8s Migration',  // title
    'manual',                                   // provider
    now,                                        // date
    JSON.stringify(transcript),                 // transcript
    rawNotes,                                   // notes (raw notes)
    null,                                       // enhanced_notes (will be generated)
    null,                                       // audio_path
    null,                                       // calendar_event_id
    now,                                        // start_time
    null,                                       // folder_id
    null,                                       // template_id
    now,                                        // created_at
    now                                         // updated_at
  );
  
  console.log(`\n✅ Note inserted successfully!`);
  console.log(`   ID: ${noteId}`);
  console.log(`   Title: Q1 Planning Meeting - Auth, Export Bug, K8s Migration`);
  console.log(`\n⚠️  Restart the app or refresh the notes list to see the new note.`);
  
  db.close();
  
  console.log(`\n=== EXPECTED TOPICS IN AI SUMMARY ===`);
  console.log(`\nEARLY (Auth):
  - P99 latency +40%
  - Redis caching proposal
  - TTL 24h sliding window
  - Pub/sub invalidation
  - MFA rollout Q1`);
  console.log(`\nMIDDLE (Product & Bug):
  - Notification system redesign
  - Slack integration (3 weeks)
  - Teams deferred to Q2
  - CRITICAL: Export data loss bug
  - Streaming backpressure issue`);
  console.log(`\nLATE (Infrastructure):
  - Dashboard widgets + GraphQL
  - AWS ECS → Kubernetes
  - 6-week migration plan
  - Zero downtime / 99.9% SLA`);
  console.log(`\nACTION ITEMS:
  1. Bob: Export bug fix (Friday)
  2. Alice: Auth caching design doc
  3. Carol: Dashboard specs (Monday)
  4. Alice: Legal follow-up (Slack DPA)
  5. Frank: K8s migration plan`);
  console.log(`\nRAW NOTES TO MERGE (📝):
  - Export bug CRITICAL urgency
  - Legal blocker 2 weeks
  - Schema change concern
  - Personal follow-ups`);
  
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

