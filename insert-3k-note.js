const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'Library/Application Support/icecubes/icecubes.db');

const speakers = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank'];
const transcript = [];
let wordCount = 0;

const topics = [
  "The authentication system redesign requires immediate attention due to the forty percent increase in P99 latency over the past quarter affecting enterprise customers severely",
  "We need to implement Redis caching for session tokens with a sliding window TTL of twenty-four hours and pub/sub invalidation for security events like password changes",
  "The security team raised valid concerns about caching authentication tokens so we need proper invalidation when users change passwords or get their accounts locked out",
  "Multi-factor authentication rollout is promised to enterprise customers by end of Q1 and needs to integrate cleanly with our new caching strategy and token rotation",
  "Customer feedback survey shows collaboration tools and real-time notifications are the most requested features across all customer segments including enterprise and SMB",
  "The notification system redesign supports push notifications via Firebase, email through SendGrid, SMS via Twilio, and in-app notifications with customizable preferences",
  "Slack integration is estimated at three weeks including OAuth flow implementation, webhook setup for bidirectional communication, and Slack app submission process",
  "Microsoft Teams integration would take longer probably five to six weeks due to their complex API and additional security requirements so we defer it to Q2",
  "Critical production bug in the export feature is causing data loss for enterprise customers when exporting more than fifty thousand records which is unacceptable",
  "Root cause analysis shows the streaming implementation is not handling backpressure from the file system causing buffer overflow and data corruption issues",
  "The fix requires proper flow control with backpressure handling, chunked writing with progress tracking, and the ability to resume failed exports from where they stopped",
  "Dashboard redesign features a widget-based customizable layout with GraphQL API for efficient data fetching, lazy loading, and proper accessibility support for screen readers",
  "AWS ECS to Kubernetes migration is planned over six weeks with traffic splitting starting at ten percent and gradual increase while monitoring closely for any issues",
  "Zero downtime is absolutely critical with our SLA guaranteeing ninety-nine point nine percent uptime during the entire migration process so we need comprehensive monitoring",
  "Action item for Bob to investigate and fix the export bug by Friday, Alice to create auth caching design doc, Carol to finalize dashboard widget specifications by Monday",
  "Legal follow-up on Slack DPA is blocking three weeks of engineering work and needs escalation to VP of Legal if we dont receive response by Wednesday afternoon",
  "Test coverage needs to increase from sixty percent to eighty percent before Kubernetes migration can safely proceed to ensure we catch any regressions during deployment",
  "Database schema change might be required for supporting resumable exports which could impact the release schedule coordination if we need to run migrations in production",
  "The GraphQL API design for the dashboard needs to prevent N plus one query problems by batching similar queries together and implementing data loader pattern properly",
  "User permissions system also needs review as part of the authentication redesign to ensure role-based access control works correctly with the new Redis caching layer",
  "Mobile app compatibility is a concern with the new JWT rotation strategy since mobile apps often have longer session requirements than web applications typically do",
  "Integration testing environment needs to be set up before Kubernetes migration begins so we can validate the deployment pipeline works correctly in a production-like setting",
  "Documentation for the new notification system needs to be written including API docs, integration guides, and troubleshooting information for the support team to use",
  "Performance benchmarks should be established before and after the Redis caching implementation so we can quantify the improvement and validate our assumptions were correct",
];

const responses = [
  "I agree, let me add that to my notes and follow up with the relevant stakeholders after the meeting to ensure we are aligned on the approach.",
  "That is a great point. We should definitely document that decision in Confluence and link it to the relevant Jira tickets for tracking purposes.",
  "Can you elaborate on the technical details? I want to make sure we are all on the same page before moving forward with the implementation work.",
  "We should involve the stakeholders before making any final decisions on this matter since it affects multiple teams across the entire organization.",
  "Good observation. We need to consider the edge cases carefully before we commit to this approach in the production environment this quarter.",
  "I will schedule a follow-up meeting with the relevant team leads to discuss this in more detail and come back with concrete recommendations.",
];

let segIdx = 0;
while (wordCount < 3200) {
  const speaker = speakers[segIdx % speakers.length];
  const topic = topics[segIdx % topics.length];
  const text = speaker + ": " + topic + ". This is critical for our Q1 goals and delivery timeline.";
  transcript.push({ text, timestamp: segIdx * 15 });
  wordCount += text.split(/\s+/).length;
  segIdx++;
  
  if (segIdx % 2 === 0 && wordCount < 3200) {
    const responder = speakers[(segIdx + 2) % speakers.length];
    const response = responses[segIdx % responses.length];
    const respText = responder + ": " + response;
    transcript.push({ text: respText, timestamp: segIdx * 15 + 7 });
    wordCount += respText.split(/\s+/).length;
  }
}

const rawNotes = "=== MY PERSONAL NOTES - Q1 PLANNING MEETING ===\n\nCRITICAL PRIORITIES (TOP OF MIND):\n- Export bug causing DATA LOSS for enterprise customers - Bob fixing by Friday - HIGHEST PRIORITY!\n- Legal has been blocking Slack integration for TWO WEEKS - must escalate to VP Legal by Wednesday\n- Auth caching needs security team sign-off before we can proceed with implementation work\n- Schema change for resumable exports might impact release schedule - need contingency plan\n\nAUTHENTICATION SYSTEM REDESIGN DETAILS:\n- P99 latency increased 40% over last quarter - enterprise SLA violations imminent\n- Redis caching approved in principle for session tokens\n- TTL strategy: 24 hour maximum with sliding window expiration\n- Pub/sub invalidation required for: password changes, account lockouts, permission updates, explicit logouts\n- JWT rotation: switch to short-lived access tokens (15 min) with longer refresh tokens (7 days)\n- MFA implementation for Q1: TOTP authenticator apps, SMS fallback, hardware security keys\n- Mobile app compatibility is a concern - token rotation might break existing sessions\n- Need to schedule dedicated security team review meeting this week\n\nPRODUCT ROADMAP AND FEATURES:\n- Top 3 customer requests: real-time collaboration, notifications, third-party integrations\n- Notification system architecture: push (Firebase), email (SendGrid), SMS (Twilio), in-app\n- Granular user preferences per notification type and per project\n- Slack integration: 3 weeks estimate (OAuth, webhooks, app submission)\n- Teams integration: 5-6 weeks, officially deferred to Q2\n- Real-time collaboration like Google Docs - marked for future consideration Q3 or later\n\nEXPORT BUG DEEP DIVE:\n- Symptoms: silent failure at 100%, corrupted output files, progress bar stuck\n- Root cause identified: streaming implementation not handling file system backpressure\n- Buffer overflow causing data drops and process crashes\n- Required fix components: chunked writing, proper flow control, accurate progress tracking\n- Additional needs: meaningful error messages, automatic retry, resume from checkpoint\n- Enterprise customers heavily impacted - check support ticket volume\n\nDASHBOARD REDESIGN TECHNICAL NOTES:\n- Widget-based fully customizable layout (drag, drop, resize)\n- GraphQL API with DataLoader pattern to prevent N+1 queries\n- Lazy loading for below-fold widgets to improve initial load time\n- Accessibility requirements: full keyboard navigation, ARIA labels, screen reader support\n- Template system for users to save and share dashboard configurations\n- Consider caching widget data client-side for faster subsequent loads\n\nKUBERNETES MIGRATION PLANNING:\n- 6 week phased approach (seems aggressive but doable)\n- Week 1-2: Cluster setup, networking, IAM, security groups\n- Week 3-4: Parallel deployment, traffic splitting starting at 10%\n- Week 5-6: Gradual increase, monitoring, optimization, full cutover\n- Zero downtime mandatory (99.9% SLA commitment)\n- Monitoring dashboards MUST be ready before migration begins\n- Rollback procedures must be documented and tested\n\nMY ACTION ITEMS:\n[ ] Create auth caching technical design document\n[ ] Schedule security team review meeting\n[ ] Follow up with legal on Slack DPA (escalate Wednesday if no response)\n[ ] Update all my Jira tickets with status by Friday EOD\n\nTRACKING OTHER TEAM MEMBERS:\n[ ] Bob: Export data loss bug fix by Thursday test, Friday deploy\n[ ] Carol: Dashboard widget specifications by Monday morning\n[ ] Frank: Complete K8s migration plan document with rollback procedures\n[ ] Eve: Increase test coverage from 60% to 80% before migration\n\nOPEN CONCERNS TO RAISE:\n- K8s migration + all Q1 features might be too much - risk of burnout\n- Schema change for exports is high risk near release date\n- Mobile app JWT compatibility needs dedicated testing\n- Are we underestimating the dashboard redesign complexity?\n\nNEXT STEPS:\n- Tuesday: Sprint review meeting\n- Wednesday: Legal escalation deadline\n- Friday: Jira updates due, export bug fix target\n\n=== END PERSONAL NOTES ===";

const noteId = Date.now().toString();
const now = new Date().toISOString();

const db = new Database(dbPath);
db.prepare("INSERT INTO notes (id, title, provider, date, transcript, notes, enhanced_notes, audio_path, calendar_event_id, start_time, folder_id, template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  noteId, 
  "Q1 Planning Meeting - 3000 Word Transcript Test", 
  "manual", 
  now, 
  JSON.stringify(transcript), 
  rawNotes, 
  null, null, null, now, null, null, now, now
);
db.close();

const rawNotesWords = rawNotes.split(/\s+/).length;
console.log("\n✅ Note inserted successfully!");
console.log("   Transcript: " + wordCount + " words (" + transcript.length + " segments)");
console.log("   Raw Notes: " + rawNotesWords + " words");
console.log("   Note ID: " + noteId);
console.log("\n⚠️  Restart the app to see the new note.");
