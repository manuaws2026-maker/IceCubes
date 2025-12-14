/**
 * Test script for local LLM chunking implementation
 * Run with: node test-chunking.js
 * 
 * This creates a ~16000 char transcript (~4000 tokens) to test chunking
 */

// Generate a realistic meeting transcript
function generateLongTranscript() {
  const speakers = ['Alice', 'Bob', 'Carol', 'David'];
  const topics = [
    // Technical discussion
    `Let me walk you through the architecture changes we're proposing for the authentication system. We've been seeing some performance issues with the current OAuth implementation, particularly around token refresh. The main bottleneck is in the session validation layer where we're making too many database calls.`,
    
    `I've been looking at the metrics and the P99 latency for auth requests has increased by 40% over the last quarter. We need to implement a caching layer, possibly using Redis, to store session tokens temporarily.`,
    
    `The security team has some concerns about caching auth tokens. We need to ensure proper TTL settings and implement cache invalidation when users log out or change passwords.`,
    
    `Good point. I suggest we use a sliding window expiration with a maximum absolute TTL of 24 hours. We should also implement immediate invalidation via pub/sub when security-critical events occur.`,
    
    // Product discussion
    `Moving on to the product roadmap, we need to finalize the features for Q1. The customer feedback survey shows that users are most interested in better collaboration tools and real-time notifications.`,
    
    `I've been working on the notification system redesign. We're planning to support push notifications, email digests, and in-app notifications with customizable preferences per notification type.`,
    
    `We should also consider adding Slack and Teams integrations. Many of our enterprise customers have been requesting this. It would significantly improve our competitive position.`,
    
    `The engineering estimate for Slack integration is about 3 weeks. Teams would take longer due to their more complex API. I suggest we prioritize Slack for Q1 and Teams for Q2.`,
    
    // Sprint planning
    `Let's discuss the sprint priorities. We have the auth caching work, notification system, and several bug fixes that were escalated from support.`,
    
    `The critical bug in the export feature needs immediate attention. Customers are reporting data loss when exporting large datasets. This should be our top priority.`,
    
    `I can take that. I've already started investigating and I think the issue is with our streaming implementation. We're not properly handling backpressure from the file system.`,
    
    `Great. Let's also make sure we have proper error handling and recovery. Users should be able to resume failed exports without starting from scratch.`,
    
    // Design review
    `The design team has finished the mockups for the new dashboard. We're proposing a widget-based layout that users can customize. Each widget can display different metrics or data views.`,
    
    `I like the flexibility, but we need to ensure good performance with multiple widgets. Each widget shouldn't make separate API calls. We should batch requests where possible.`,
    
    `We're planning to use GraphQL for the dashboard API. That way, widgets can specify exactly what data they need, and we can optimize the backend to batch similar queries.`,
    
    `That's a good approach. We should also implement lazy loading for widgets that are below the fold. No point fetching data for widgets the user hasn't scrolled to yet.`,
    
    // Infrastructure
    `On the infrastructure side, we're planning to migrate from AWS ECS to Kubernetes. This will give us better auto-scaling and easier deployment management.`,
    
    `What's the timeline for the migration? We need to ensure zero downtime during the transition. Our SLA guarantees 99.9% uptime.`,
    
    `We're planning a gradual migration over 6 weeks. We'll run both systems in parallel and use traffic splitting to gradually shift load to the new cluster.`,
    
    `Make sure we have comprehensive monitoring in place before we start. We need real-time visibility into error rates, latency, and resource utilization on both systems.`,
    
    // Action items discussion
    `Let me summarize the action items from today. First, Bob will investigate and fix the export bug by end of week. Second, Alice will create the technical design document for auth caching.`,
    
    `I'll also set up a meeting with the security team to review the caching proposal. We should involve them early to avoid issues during the security review.`,
    
    `Carol, can you coordinate with the design team on the dashboard widget specifications? We need the final component list by next Monday.`,
    
    `Will do. I'll also create user stories for the notification system features so we can start estimation in the next sprint planning.`,
    
    // Wrap up
    `Before we wrap up, any blockers or concerns we haven't addressed? This is the time to raise anything that might impact our deliverables.`,
    
    `One thing - we're still waiting on the legal review for the third-party data processing agreement. That might impact the timeline for the Slack integration.`,
    
    `I'll follow up with legal today. They've had the documents for two weeks now. We need that approval to proceed with the integration work.`,
    
    `Thanks everyone. Good discussion today. Let's reconvene next Tuesday for the sprint review. Please update your Jira tickets with progress by end of day Friday.`
  ];
  
  let transcript = '';
  let topicIndex = 0;
  
  // Generate ~16000 characters of transcript
  while (transcript.length < 16000) {
    const speaker = speakers[Math.floor(Math.random() * speakers.length)];
    const topic = topics[topicIndex % topics.length];
    topicIndex++;
    
    transcript += `${speaker}: ${topic}\n\n`;
    
    // Add some follow-up comments to make it more realistic
    if (Math.random() > 0.5) {
      const responder = speakers.filter(s => s !== speaker)[Math.floor(Math.random() * 3)];
      const responses = [
        `That makes sense. We should document that decision.`,
        `I agree. Let's add that to the backlog.`,
        `Can you elaborate on that point? I want to make sure I understand correctly.`,
        `We tried something similar last year. Let me share what we learned.`,
        `Good idea. I'll create a ticket to track that.`,
        `We should involve the stakeholders before making that decision.`,
        `Let me check the timeline and get back to you.`,
        `That's a good point. We need to consider the edge cases.`
      ];
      transcript += `${responder}: ${responses[Math.floor(Math.random() * responses.length)]}\n\n`;
    }
  }
  
  return transcript;
}

const transcript = generateLongTranscript();
console.log('Generated transcript length:', transcript.length, 'chars');
console.log('Estimated tokens:', Math.ceil(transcript.length / 4));
console.log('\n--- First 500 chars ---\n');
console.log(transcript.substring(0, 500));
console.log('\n--- Last 500 chars ---\n');
console.log(transcript.substring(transcript.length - 500));
console.log('\n\nTo test: Copy this transcript into a new note and click "Generate Notes" with Local LLM enabled.\n');

// Write to a file for easy copy-paste
const fs = require('fs');
fs.writeFileSync('/tmp/test-transcript.txt', transcript);
console.log('Full transcript saved to: /tmp/test-transcript.txt');

