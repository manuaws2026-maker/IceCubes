/**
 * Insert a LARGE test note with 3000+ word transcript and 400+ word raw notes
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const userDataPath = path.join(os.homedir(), 'Library/Application Support/icecubes');
const dbPath = path.join(userDataPath, 'icecubes.db');

// Generate 3000+ word transcript
function generateLargeTranscript() {
  const speakers = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank'];
  const transcript = [];
  
  // Each block is ~150-200 words
  const contentBlocks = [
    // Auth Section (600 words)
    "Let's begin our quarterly planning meeting. The first major topic on our agenda is the authentication system redesign that we've been discussing for several weeks now. Our current OAuth implementation has been causing significant performance degradation across the platform.",
    "Looking at the metrics from our monitoring dashboard, the P99 latency for authentication requests has increased by approximately forty percent over the last quarter. This is a serious concern because it directly impacts our enterprise customers who have strict SLA requirements.",
    "The root cause analysis points to excessive database queries in the session validation layer. Every time a user makes an authenticated request, we're hitting the database multiple times to validate their session token and check permissions.",
    "My proposal is to implement a Redis caching layer for session tokens. This would dramatically reduce database load and bring our latency back to acceptable levels. We could cache the entire session object including user roles and permissions.",
    "The security team has raised valid concerns about caching authentication tokens. We need to carefully design the TTL strategy to balance performance with security. I suggest a sliding window expiration with a maximum absolute TTL of twenty-four hours.",
    "Additionally, we need to implement immediate cache invalidation via Redis pub/sub when security-critical events occur. This includes password changes, account lockouts, permission changes, and explicit logout events from any device.",
    "The JWT token rotation strategy also needs to be finalized. We've been using long-lived tokens which poses security risks. I recommend implementing short-lived access tokens with longer-lived refresh tokens and proper rotation on each refresh.",
    "Don't forget about the multi-factor authentication rollout we promised to enterprise customers. The MFA implementation needs to integrate cleanly with our new caching strategy. We should support TOTP, SMS, and hardware security keys.",
    
    // Product Roadmap (600 words)
    "Moving on to the product roadmap discussion. Based on the customer feedback survey we conducted last month, there are three major feature requests that keep coming up consistently across different customer segments.",
    "The most requested feature is improved collaboration tools. Customers want real-time co-editing capabilities similar to Google Docs. They also want better commenting and annotation features for documents and dashboards.",
    "Second on the list is a comprehensive notification system. The current email-only notifications are insufficient. Customers want push notifications on mobile, in-app notifications with a notification center, and customizable digest emails.",
    "Third is better integration with existing enterprise tools. Specifically, Slack and Microsoft Teams integrations are highly requested. Many customers use these platforms as their primary communication channels and want our alerts there.",
    "For the notification system, I've been working on a complete redesign. The architecture supports multiple notification channels including push notifications via Firebase, email through SendGrid, SMS via Twilio, and in-app notifications stored in our database.",
    "Users will be able to customize their notification preferences at a very granular level. They can choose which events trigger which notification types, set quiet hours, and configure different settings for different projects or teams.",
    "Regarding the Slack integration, the engineering estimate is approximately three weeks of development time. This includes OAuth flow implementation, webhook setup for bidirectional communication, and a Slack app submission process.",
    "Microsoft Teams integration would take longer, probably five to six weeks, due to their more complex API structure and the additional security requirements for enterprise applications. I suggest we prioritize Slack for Q1 and defer Teams to Q2.",
    
    // Critical Bug Discussion (500 words)
    "Now we need to discuss a critical production issue that was escalated from customer support this morning. Several enterprise customers have reported data loss when using the export feature with large datasets.",
    "The symptoms are concerning. When users try to export more than fifty thousand records, the export either fails silently or produces a corrupted file. In some cases, the progress bar reaches one hundred percent but the download never starts.",
    "I've started investigating this issue and I believe I've identified the root cause. The problem is in our streaming implementation. When writing large files, we're not properly handling backpressure from the file system.",
    "Essentially, we're pushing data to the file writer faster than it can write to disk. This causes the internal buffer to overflow and either drops data or crashes the export process entirely. It's a classic producer-consumer problem.",
    "The fix involves implementing proper flow control with backpressure handling. We also need to add chunked writing with progress tracking so users can see accurate progress and potentially resume failed exports.",
    "We should also add better error handling and user feedback. Currently, when an export fails, users just see a spinning loader forever. We need to detect failures and show appropriate error messages with retry options.",
    
    // Dashboard Redesign (500 words)  
    "The design team has completed the mockups for the new dashboard experience. This is a major overhaul of our analytics and reporting interface based on extensive user research and competitive analysis.",
    "The new design features a widget-based layout that users can fully customize. Each widget is a self-contained component that can display charts, metrics, tables, or custom visualizations based on user preferences.",
    "Users can drag and drop widgets to rearrange their dashboard, resize them, and configure data sources and visualization options for each one. We're also adding a template system so users can save and share dashboard configurations.",
    "From a technical perspective, we're implementing this with a GraphQL API. Each widget declares exactly what data it needs, and the backend optimizes queries by batching similar requests together. This prevents the N+1 query problem.",
    "We're also implementing lazy loading for widgets below the fold. The initial page load will only fetch data for visible widgets. As users scroll down, additional widgets will load their data on demand.",
    "Accessibility is a key requirement. The new dashboard must be fully keyboard navigable with proper focus management. All charts need screen reader support with text alternatives for visual data.",
    
    // Infrastructure Migration (500 words)
    "On the infrastructure side, we're planning a major migration from AWS ECS to Kubernetes. This move will give us better auto-scaling capabilities, easier multi-region deployment, and improved developer experience.",
    "The migration timeline is six weeks with a phased approach. Week one and two focus on setting up the Kubernetes cluster with proper networking, security groups, and IAM roles for service accounts.",
    "Weeks three and four involve deploying services to Kubernetes while keeping ECS running in parallel. We'll use traffic splitting to gradually shift load from ECS to Kubernetes, starting at ten percent.",
    "Weeks five and six are for monitoring, optimization, and full cutover. We'll increase traffic to Kubernetes in increments while monitoring error rates, latency, and resource utilization closely.",
    "Zero downtime is absolutely critical. Our SLA guarantees ninety-nine point nine percent uptime, which translates to less than nine hours of downtime per year. The migration must not violate this commitment.",
    "We need comprehensive monitoring and alerting before we start. I'm working with the SRE team to set up dashboards that show real-time metrics from both ECS and Kubernetes so we can quickly detect and respond to any issues.",
    
    // Action Items (300 words)
    "Let me summarize the action items from today's discussion. These are the concrete next steps that need to happen before our next meeting on Tuesday.",
    "First priority: Bob will investigate and fix the export data loss bug. The target is to have a fix ready for testing by end of day Thursday with deployment to production on Friday if testing passes.",
    "Second: Alice will create the technical design document for the Redis caching implementation. This should include the data model, TTL strategy, invalidation mechanisms, and capacity planning estimates.",
    "Third: Carol will coordinate with the design team to finalize the dashboard widget specifications. We need the complete component inventory and data requirements by Monday for the GraphQL schema design.",
    "Fourth: Alice will follow up with legal on the Slack data processing agreement. If we don't have a response by Wednesday, escalate to the VP of Legal. This is blocking three weeks of engineering work.",
    "Fifth: Frank will document the complete Kubernetes migration plan including timeline, traffic splitting percentages, rollback procedures, and success criteria for each phase.",
    "Sixth: Eve will work on increasing integration test coverage from sixty percent to eighty percent before the Kubernetes migration begins. We need confidence in our test suite before making infrastructure changes.",
    "Before we wrap up, are there any blockers or concerns that haven't been addressed? This is your opportunity to raise anything that might impact our Q1 deliverables.",
    "One concern is that the export bug fix might require a database schema change to support resumable exports. If that's the case, we need to coordinate carefully with the release schedule.",
    "Thanks everyone for a productive meeting. Let's reconvene on Tuesday for the sprint review. Please update your Jira tickets with current status by end of day Friday.",
  ];
  
  let segmentIndex = 0;
  for (const content of contentBlocks) {
    const speaker = speakers[segmentIndex % speakers.length];
    transcript.push({
      text: `${speaker}: ${content}`,
      timestamp: segmentIndex * 20
    });
    segmentIndex++;
    
    // Add some follow-up comments to reach 3000+ words
    const followUps = [
      "That's a great point. We should definitely document that decision.",
      "I agree with that approach. Let me add it to the backlog.",
      "Can you elaborate on the technical details? I want to make sure we're aligned.",
      "We should involve the stakeholders before making any final decisions.",
      "Let me check the dependencies and get back to the group.",
      "Good observation. We need to consider the edge cases carefully.",
    ];
    
    if (segmentIndex % 2 === 0) {
      const responder = speakers[(segmentIndex + 1) % speakers.length];
      transcript.push({
        text: `${responder}: ${followUps[segmentIndex % followUps.length]}`,
        timestamp: segmentIndex * 20 + 10
      });
      segmentIndex++;
    }
  }
  
  return transcript;
}

// Generate 400+ word raw notes
function generateRawNotes() {
  return `=== PERSONAL MEETING NOTES - CONFIDENTIAL ===

CRITICAL ITEMS - DO NOT FORGET:
- Export bug is causing DATA LOSS for enterprise customers - TOP PRIORITY!
- Bob says root cause is streaming backpressure - needs fix by Friday
- Legal has been sitting on Slack DPA for TWO WEEKS - escalate Wednesday!
- Schema change might be needed for export fix - coordinate with release

AUTH SYSTEM REDESIGN:
- Redis caching for session tokens - approved in principle
- TTL: 24 hours sliding window (security team to verify)
- Pub/sub for immediate invalidation on security events
- JWT rotation: short-lived access tokens, longer refresh tokens
- MFA rollout still on track for Q1 - TOTP, SMS, hardware keys
- Need meeting with security team before finalizing design
- Watch out: token rotation might break mobile app

PRODUCT ROADMAP NOTES:
- Top 3 requests: collaboration tools, notifications, integrations
- Notification system: push, email, SMS, in-app with preferences
- Slack integration: 3 weeks estimate, OAuth + webhooks
- Teams integration: 5-6 weeks, defer to Q2
- Real-time co-editing like Google Docs - big project, maybe Q3?

EXPORT BUG DETAILS:
- Symptoms: silent failure, corrupted files, stuck progress bar
- Root cause: not handling backpressure from file system
- Buffer overflow dropping data or crashing process
- Fix needed: chunked writing, flow control, progress tracking
- Also need: better error messages, retry capability, resume support
- Enterprise customers affected - check support tickets

DASHBOARD REDESIGN:
- Widget-based customizable layout
- GraphQL API to optimize queries and prevent N+1
- Lazy loading for below-fold widgets
- Must be keyboard accessible and screen reader friendly
- Template system for saving/sharing configurations
- Drag and drop, resize widgets

KUBERNETES MIGRATION:
- 6 week phased timeline (seems aggressive to me)
- Zero downtime requirement - 99.9% SLA
- Traffic splitting: start 10%, increment gradually
- Need monitoring dashboards BEFORE migration starts
- Rollback plan must be documented and tested
- Working with SRE on alerting setup

ACTION ITEMS I'M RESPONSIBLE FOR:
[ ] Follow up with legal on Slack DPA (escalate Wed if no response)
[ ] Auth caching design doc (include TTL, invalidation, capacity)
[ ] Schedule security team review meeting
[ ] Update my Jira tickets by Friday EOD

OTHER ACTION ITEMS TO TRACK:
[ ] Bob: Export bug fix by Thursday/Friday
[ ] Carol: Dashboard specs by Monday
[ ] Frank: K8s migration plan document
[ ] Eve: Test coverage 60% → 80%

CONCERNS TO RAISE LATER:
- K8s migration during Q1 features might be too much
- Schema change could delay release
- Are we underestimating the dashboard work?
- Mobile app compatibility with new auth system?

NEXT MEETING: Tuesday sprint review
DON'T FORGET: Jira updates Friday EOD`;
}

// Main
try {
  const db = new Database(dbPath);
  
  const transcript = generateLargeTranscript();
  const rawNotes = generateRawNotes();
  
  const transcriptText = transcript.map(t => t.text).join(' ');
  const transcriptWords = transcriptText.split(/\s+/).length;
  const notesWords = rawNotes.split(/\s+/).length;
  
  console.log(`\nGenerated content:`);
  console.log(`  Transcript: ${transcriptWords} words (${transcript.length} segments, ${transcriptText.length} chars)`);
  console.log(`  Raw Notes: ${notesWords} words (${rawNotes.length} chars)`);
  
  const noteId = Date.now().toString();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO notes (id, title, provider, date, transcript, notes, enhanced_notes, audio_path, calendar_event_id, start_time, folder_id, template_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    noteId,
    'Q1 Planning: Auth Redesign, Export Bug, K8s Migration, Dashboard',
    'manual',
    now,
    JSON.stringify(transcript),
    rawNotes,
    null,
    null,
    null,
    now,
    null,
    null,
    now,
    now
  );
  
  console.log(`\n✅ Large note inserted successfully!`);
  console.log(`   ID: ${noteId}`);
  console.log(`\n⚠️  Restart the app to see the new note.`);
  
  db.close();
  
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

