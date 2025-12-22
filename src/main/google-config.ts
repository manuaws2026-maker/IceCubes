// Google OAuth Configuration
// These credentials are bundled into the app for Google Calendar integration
// Environment variables take precedence if set (for development/testing)
// 
// Before building DMG: Replace the empty strings below with your Google OAuth credentials
// Get credentials from: https://console.cloud.google.com/apis/credentials

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
