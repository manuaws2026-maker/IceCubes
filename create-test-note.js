/**
 * Create a test note with a long transcript directly in the database
 * Run with: node create-test-note.js
 */

const fs = require('fs');
const path = require('path');

// Generate a comprehensive meeting transcript with all topics
function generateComprehensiveTranscript() {
  const transcript = `
Alice: Let me walk you through the architecture changes we're proposing for the authentication system. We've been seeing some performance issues with the current OAuth implementation, particularly around token refresh. The main bottleneck is in the session validation layer where we're making too many database calls.

Bob: I've been looking at the metrics and the P99 latency for auth requests has increased by 40% over the last quarter. We need to implement a caching layer, possibly using Redis, to store session tokens temporarily.

Carol: The security team has some concerns about caching auth tokens. We need to ensure proper TTL settings and implement cache invalidation when users log out or change passwords.

David: Good point. I suggest we use a sliding window expiration with a maximum absolute TTL of 24 hours. We should also implement immediate invalidation via pub/sub when security-critical events occur.

Alice: I'll set up a meeting with the security team to review the caching proposal. We should involve them early to avoid issues during the security review.

Bob: Moving on to the product roadmap, we need to finalize the features for Q1. The customer feedback survey shows that users are most interested in better collaboration tools and real-time notifications.

Carol: I've been working on the notification system redesign. We're planning to support push notifications, email digests, and in-app notifications with customizable preferences per notification type.

David: We should also consider adding Slack and Teams integrations. Many of our enterprise customers have been requesting this. It would significantly improve our competitive position.

Alice: The engineering estimate for Slack integration is about 3 weeks. Teams would take longer due to their more complex API. I suggest we prioritize Slack for Q1 and Teams for Q2.

Bob: One thing to note - we're still waiting on the legal review for the third-party data processing agreement. That might impact the timeline for the Slack integration.

Carol: I'll follow up with legal today. They've had the documents for two weeks now. We need that approval to proceed with the integration work.

David: Let's discuss the sprint priorities. We have the auth caching work, notification system, and several bug fixes that were escalated from support.

Alice: The critical bug in the export feature needs immediate attention. Customers are reporting data loss when exporting large datasets. This should be our top priority.

Bob: I can take that. I've already started investigating and I think the issue is with our streaming implementation. We're not properly handling backpressure from the file system.

Carol: Great. Let's also make sure we have proper error handling and recovery. Users should be able to resume failed exports without starting from scratch.

David: The design team has finished the mockups for the new dashboard. We're proposing a widget-based layout that users can customize. Each widget can display different metrics or data views.

Alice: I like the flexibility, but we need to ensure good performance with multiple widgets. Each widget shouldn't make separate API calls. We should batch requests where possible.

Bob: We're planning to use GraphQL for the dashboard API. That way, widgets can specify exactly what data they need, and we can optimize the backend to batch similar queries.

Carol: That's a good approach. We should also implement lazy loading for widgets that are below the fold. No point fetching data for widgets the user hasn't scrolled to yet.

David: On the infrastructure side, we're planning to migrate from AWS ECS to Kubernetes. This will give us better auto-scaling and easier deployment management.

Alice: What's the timeline for the migration? We need to ensure zero downtime during the transition. Our SLA guarantees 99.9% uptime.

Bob: We're planning a gradual migration over 6 weeks. We'll run both systems in parallel and use traffic splitting to gradually shift load to the new cluster.

Carol: Make sure we have comprehensive monitoring in place before we start. We need real-time visibility into error rates, latency, and resource utilization on both systems.

David: Let me summarize the action items from today. First, Bob will investigate and fix the export bug by end of week - this is the critical data loss issue with streaming backpressure.

Alice: Second, I'll create the technical design document for auth caching with Redis, including TTL strategy and pub/sub invalidation.

Bob: Third, Carol will coordinate with the design team on the dashboard widget specifications. We need the final component list by next Monday for the GraphQL schema design.

Carol: I'll also create user stories for the notification system features so we can start estimation in the next sprint planning.

David: Fourth, Alice needs to follow up with legal on the Slack data processing agreement - this is blocking the integration work.

Alice: Fifth, Bob will document the Kubernetes migration plan including the 6-week timeline, traffic splitting approach, and rollback procedures.

Bob: And we need monitoring dashboards set up before the migration starts - I'll work with the SRE team on that.

Carol: Before we wrap up, any blockers or concerns we haven't addressed? This is the time to raise anything that might impact our deliverables.

David: One thing - the export bug fix might require a database schema change. If so, we'll need to coordinate the migration carefully.

Alice: Let's flag that early. Bob, once you've finished the investigation, send out an email if a schema change is needed so we can plan accordingly.

Bob: Will do. I should have the investigation complete by tomorrow afternoon.

Carol: Thanks everyone. Good discussion today. Let's reconvene next Tuesday for the sprint review. Please update your Jira tickets with progress by end of day Friday.

David: Meeting adjourned. Remember - export bug is priority one, legal follow-up is priority two for unblocking Slack integration.
`.trim();

  return transcript;
}

const transcript = generateComprehensiveTranscript();
console.log('Generated transcript:');
console.log('- Length:', transcript.length, 'chars');
console.log('- Estimated tokens:', Math.ceil(transcript.length / 4));
console.log('');

// Save transcript to a temp file
fs.writeFileSync('/tmp/full-test-transcript.txt', transcript);
console.log('Saved to /tmp/full-test-transcript.txt');
console.log('');

// Create a note data structure that matches what the app expects
const noteData = {
  id: Date.now().toString(),
  title: 'Q1 Planning Meeting - Auth, Dashboard, Infrastructure',
  content: '<!-- This note has a long transcript for testing local LLM chunking -->',
  transcript: transcript.split('\n\n').map(line => ({
    text: line.trim(),
    timestamp: 0
  })).filter(t => t.text.length > 0),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// Save the note data structure
fs.writeFileSync('/tmp/test-note-data.json', JSON.stringify(noteData, null, 2));
console.log('Saved note data to /tmp/test-note-data.json');
console.log('');

console.log('=== KEY TOPICS THAT SHOULD APPEAR IN SUMMARY ===');
console.log('');
console.log('EARLY TOPICS (Part 1):');
console.log('- Auth performance issues, P99 latency +40%');
console.log('- Redis caching for session tokens');
console.log('- TTL and pub/sub invalidation');
console.log('');
console.log('MIDDLE TOPICS (Part 2-3):');
console.log('- Q1 roadmap, notifications');
console.log('- Slack/Teams integration (3 weeks estimate)');
console.log('- Export bug - DATA LOSS, streaming backpressure');
console.log('- Dashboard widgets, GraphQL, lazy loading');
console.log('');
console.log('LATE TOPICS (Part 4 - CRITICAL):');
console.log('- AWS ECS → Kubernetes migration');
console.log('- 6-week phased rollout');
console.log('- Zero downtime, 99.9% SLA');
console.log('- Monitoring requirements');
console.log('');
console.log('ACTION ITEMS (FINAL):');
console.log('1. Bob: Fix export bug (data loss) by end of week');
console.log('2. Alice: Auth caching design doc');
console.log('3. Carol: Dashboard widget specs by Monday');
console.log('4. Alice: Follow up with legal (blocking Slack)');
console.log('5. Bob: K8s migration plan with 6-week timeline');
console.log('6. Bob: Set up monitoring dashboards before migration');
console.log('7. Bob: Send email if schema change needed (tomorrow)');
console.log('');
console.log('To test: Copy transcript from /tmp/full-test-transcript.txt');
console.log('and use the app\'s recording flow, or modify the database directly.');

