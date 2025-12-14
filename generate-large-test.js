/**
 * Generate a large test note with 3000 line transcript and 300 lines of raw notes
 */

const fs = require('fs');

// Meeting participants
const speakers = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank'];

// Topics that should appear in the final summary
const topics = {
  early: [
    // Auth & Security (lines 1-500)
    "discussing the authentication system redesign",
    "the OAuth implementation has been causing performance issues",
    "P99 latency increased by 40% over the last quarter",
    "we need Redis caching for session tokens",
    "TTL should be 24 hours with sliding window",
    "pub/sub for real-time cache invalidation",
    "security team needs to review the caching proposal",
    "JWT token rotation strategy",
    "multi-factor authentication rollout",
    "SSO integration with enterprise customers",
  ],
  middle: [
    // Product & Features (lines 500-1500)
    "Q1 roadmap finalization",
    "notification system redesign with push, email, and in-app",
    "Slack integration is estimated at 3 weeks",
    "Teams integration deferred to Q2",
    "legal review blocking third-party integrations",
    "customer feedback survey results",
    "collaboration tools are top requested feature",
    "mobile app performance improvements",
    "offline mode support",
    "data export functionality issues",
    
    // Critical Bug Discussion (lines 1000-1200)
    "CRITICAL: export feature has data loss bug",
    "customers reporting lost data on large exports",
    "the issue is streaming backpressure handling",
    "file system writes are not properly buffered",
    "need resume capability for failed exports",
    "Bob is investigating the export bug",
    "this is priority one for the sprint",
    
    // Dashboard & UI (lines 1200-1800)
    "dashboard redesign with customizable widgets",
    "each widget displays different metrics",
    "GraphQL API for efficient data fetching",
    "widgets should batch their API requests",
    "lazy loading for below-fold widgets",
    "dark mode support requested",
    "accessibility improvements needed",
    "responsive design for mobile",
  ],
  late: [
    // Infrastructure (lines 1800-2500)
    "AWS ECS to Kubernetes migration",
    "6-week phased rollout plan",
    "traffic splitting for gradual migration",
    "zero downtime requirement",
    "99.9% SLA must be maintained",
    "comprehensive monitoring before migration",
    "error rate and latency dashboards",
    "auto-scaling configuration",
    "container resource limits",
    "service mesh evaluation",
    "database migration considerations",
    "backup and disaster recovery",
    
    // Testing & QA (lines 2200-2600)
    "integration test coverage is at 60%",
    "need to reach 80% before launch",
    "load testing for 10x current traffic",
    "chaos engineering practices",
    "staging environment improvements",
  ],
  final: [
    // Action Items & Wrap-up (lines 2600-3000)
    "ACTION: Bob to fix export data loss bug by Friday",
    "ACTION: Alice to create auth caching design doc",
    "ACTION: Carol to coordinate dashboard widget specs by Monday",
    "ACTION: Alice to follow up with legal on Slack DPA",
    "ACTION: Bob to document K8s migration plan",
    "ACTION: Frank to set up monitoring dashboards",
    "ACTION: Eve to increase test coverage to 80%",
    "ACTION: David to review security proposal",
    "BLOCKER: legal approval needed for Slack",
    "BLOCKER: schema change might be needed for export fix",
    "DEADLINE: Sprint review next Tuesday",
    "DEADLINE: Jira updates by Friday EOD",
    "next meeting scheduled for Tuesday",
    "thanks everyone for the productive discussion",
  ]
};

// Generate realistic dialogue
function generateDialogue(topic, speaker) {
  const templates = [
    `${speaker}: ${topic}. This is something we've been tracking for a while now.`,
    `${speaker}: I want to highlight that ${topic}. We should prioritize this.`,
    `${speaker}: Looking at the data, ${topic}. The metrics support this approach.`,
    `${speaker}: From a technical perspective, ${topic}. Let me explain the details.`,
    `${speaker}: The team has been working on ${topic}. Good progress so far.`,
    `${speaker}: I have concerns about ${topic}. We need to address this carefully.`,
    `${speaker}: ${topic}. This aligns with our Q1 objectives.`,
    `${speaker}: Based on customer feedback, ${topic}. It's a common request.`,
    `${speaker}: ${topic}. I'll take the action item on this.`,
    `${speaker}: Let me add context - ${topic}. This impacts multiple teams.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

// Generate follow-up responses
function generateResponse(speaker) {
  const responses = [
    `${speaker}: That makes sense. Let's document that decision.`,
    `${speaker}: I agree with that approach. Adding to the backlog.`,
    `${speaker}: Can you elaborate? I want to understand the implications.`,
    `${speaker}: We tried something similar before. Let me share lessons learned.`,
    `${speaker}: Good point. I'll create a ticket for tracking.`,
    `${speaker}: We should involve stakeholders before finalizing.`,
    `${speaker}: Let me check the timeline and report back.`,
    `${speaker}: That's important. We need to consider edge cases.`,
    `${speaker}: Agreed. This should be high priority.`,
    `${speaker}: I can take that action item.`,
    `${speaker}: What's the estimated effort for this?`,
    `${speaker}: Do we have dependencies on other teams?`,
    `${speaker}: Let's sync offline on the details.`,
    `${speaker}: I'll schedule a follow-up meeting.`,
    `${speaker}: The design doc should cover this scenario.`,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

// Generate 3000 line transcript
function generateTranscript() {
  const lines = [];
  let lineNum = 0;
  
  // Helper to add lines with topic coverage
  function addSection(topicList, targetLines) {
    const startLine = lineNum;
    while (lineNum < startLine + targetLines) {
      const speaker = speakers[Math.floor(Math.random() * speakers.length)];
      const topic = topicList[Math.floor(Math.random() * topicList.length)];
      
      lines.push(generateDialogue(topic, speaker));
      lineNum++;
      
      // Add 1-3 responses
      const numResponses = Math.floor(Math.random() * 3) + 1;
      for (let r = 0; r < numResponses && lineNum < startLine + targetLines; r++) {
        const responder = speakers.filter(s => s !== speaker)[Math.floor(Math.random() * (speakers.length - 1))];
        lines.push(generateResponse(responder));
        lineNum++;
      }
      
      // Occasionally add empty line for readability
      if (Math.random() > 0.7) {
        lines.push('');
        lineNum++;
      }
    }
  }
  
  // Generate sections
  addSection(topics.early, 500);      // Lines 0-500: Auth & Security
  addSection(topics.middle, 1300);    // Lines 500-1800: Product, Bug, Dashboard
  addSection(topics.late, 800);       // Lines 1800-2600: Infrastructure, Testing
  addSection(topics.final, 400);      // Lines 2600-3000: Action Items & Wrap-up
  
  return lines.join('\n');
}

// Generate 300 lines of raw notes
function generateRawNotes() {
  const notes = [
    "// MY PERSONAL NOTES - DO NOT SHARE",
    "",
    "=== URGENT ITEMS ===",
    "- Export bug is CRITICAL - customers losing data!!",
    "- Need to escalate to management if not fixed by Friday",
    "- Bob said he found the root cause - backpressure issue",
    "",
    "=== AUTH DISCUSSION ===", 
    "- Redis caching sounds good but security concerns",
    "- TTL: 24 hours sliding window - need to verify with security team",
    "- Pub/sub for invalidation - check if we have Redis cluster ready",
    "- Remember: JWT rotation might break mobile app",
    "",
    "=== LEGAL BLOCKER ===",
    "- Slack DPA has been with legal for 2 WEEKS",
    "- Alice will follow up TODAY",
    "- This is blocking 3 weeks of integration work",
    "- Consider escalating to VP if no response by Wednesday",
    "",
    "=== KUBERNETES MIGRATION ===",
    "- 6 week timeline seems aggressive",
    "- Zero downtime is non-negotiable (99.9% SLA)",
    "- Need monitoring BEFORE we start migration",
    "- Traffic splitting approach is smart - gradual rollout",
    "- Check: do we have enough cluster capacity?",
    "",
    "=== DASHBOARD NOTES ===",
    "- Widget-based layout = good UX",
    "- GraphQL will help with performance",
    "- MUST implement lazy loading - users complained about slow load",
    "- Dark mode is highly requested",
    "",
    "=== ACTION ITEMS I NEED TO TRACK ===",
    "[ ] Bob: Export bug fix - Friday deadline",
    "[ ] Alice: Auth caching design doc",
    "[ ] Carol: Dashboard specs - Monday",
    "[ ] Alice: Legal follow-up on Slack DPA",
    "[ ] Bob: K8s migration plan document",
    "[ ] Frank: Monitoring dashboards",
    "[ ] Eve: Test coverage to 80%",
    "[ ] David: Security review",
    "",
    "=== MY FOLLOW-UPS ===",
    "- Schedule 1:1 with Bob about export bug details",
    "- Review GraphQL schema proposal",
    "- Check Redis cluster status with DevOps",
    "- Update Jira tickets by Friday EOD",
    "",
    "=== MEETING NOTES ===",
    "- Good energy in the meeting",
    "- Everyone aligned on priorities",
    "- Export bug consensus: priority #1",
    "- K8s migration: need more planning",
    "",
    "=== QUESTIONS TO ASK LATER ===",
    "- What's the rollback plan for K8s?",
    "- Who owns the monitoring dashboards?",
    "- Is the export bug a regression?",
    "- Timeline for mobile app SSO?",
    "",
  ];
  
  // Expand to 300 lines with variations
  const expandedNotes = [...notes];
  const reminders = [
    "TODO: Follow up on this",
    "IMPORTANT: Don't forget",
    "NOTE: Discussed in meeting",
    "CHECK: Verify before next meeting",
    "ASK: Need clarification",
    "IDEA: Consider for future",
    "RISK: Potential blocker",
    "DECISION: Team agreed on this",
  ];
  
  const detailNotes = [
    "- Performance metrics need attention",
    "- Customer escalation from last week related to this",
    "- Similar issue in Q3 - check old tickets",
    "- Documentation needs updating",
    "- Training needed for new team members",
    "- Budget implications to consider",
    "- Cross-team dependency identified",
    "- Technical debt to address",
    "- Security review required",
    "- Compliance check needed",
    "- User research supports this",
    "- A/B test results pending",
    "- Feature flag configuration",
    "- Rollout plan needs review",
    "- Monitoring alerts to set up",
  ];
  
  while (expandedNotes.length < 300) {
    if (Math.random() > 0.7) {
      expandedNotes.push('');
    } else if (Math.random() > 0.5) {
      expandedNotes.push(reminders[Math.floor(Math.random() * reminders.length)]);
    } else {
      expandedNotes.push(detailNotes[Math.floor(Math.random() * detailNotes.length)]);
    }
  }
  
  return expandedNotes.slice(0, 300).join('\n');
}

// Generate the test data
console.log('Generating large test note...\n');

const transcript = generateTranscript();
const rawNotes = generateRawNotes();

const transcriptLines = transcript.split('\n').length;
const notesLines = rawNotes.split('\n').length;

console.log(`Transcript: ${transcriptLines} lines, ${transcript.length} chars (~${Math.ceil(transcript.length/4)} tokens)`);
console.log(`Raw Notes: ${notesLines} lines, ${rawNotes.length} chars (~${Math.ceil(rawNotes.length/4)} tokens)`);
console.log('');

// Save files
fs.writeFileSync('/tmp/large-transcript.txt', transcript);
fs.writeFileSync('/tmp/large-raw-notes.txt', rawNotes);

console.log('Saved to:');
console.log('  /tmp/large-transcript.txt');
console.log('  /tmp/large-raw-notes.txt');
console.log('');

// Create combined file for easy testing
const combined = `=== TRANSCRIPT (${transcriptLines} lines) ===

${transcript}

=== RAW NOTES (${notesLines} lines) ===

${rawNotes}`;

fs.writeFileSync('/tmp/large-test-combined.txt', combined);
console.log('  /tmp/large-test-combined.txt (both combined)');
console.log('');

console.log('=== KEY TOPICS THAT MUST APPEAR IN SUMMARY ===');
console.log('');
console.log('EARLY (Auth & Security):');
console.log('  - OAuth performance, P99 +40%');
console.log('  - Redis caching, TTL 24h sliding window');
console.log('  - Pub/sub invalidation');
console.log('');
console.log('MIDDLE (Product & Bugs):');
console.log('  - Q1 roadmap, notifications');
console.log('  - Slack integration (3 weeks), Teams Q2');
console.log('  - CRITICAL: Export data loss bug');
console.log('  - Streaming backpressure issue');
console.log('  - Dashboard widgets, GraphQL, lazy loading');
console.log('');
console.log('LATE (Infrastructure):');
console.log('  - AWS ECS → Kubernetes');
console.log('  - 6-week phased rollout');
console.log('  - Zero downtime, 99.9% SLA');
console.log('  - Monitoring requirements');
console.log('');
console.log('ACTION ITEMS:');
console.log('  1. Bob: Export bug fix by Friday');
console.log('  2. Alice: Auth caching design doc');
console.log('  3. Carol: Dashboard specs by Monday');
console.log('  4. Alice: Legal follow-up (Slack DPA)');
console.log('  5. Bob: K8s migration plan');
console.log('  6. Frank: Monitoring dashboards');
console.log('  7. Eve: Test coverage 80%');
console.log('  8. David: Security review');
console.log('');
console.log('RAW NOTES TO MERGE:');
console.log('  - Export bug CRITICAL urgency');
console.log('  - Legal blocker for Slack (2 weeks waiting)');
console.log('  - K8s timeline concerns');
console.log('  - Personal follow-ups and TODOs');

