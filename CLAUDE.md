# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a standalone Node.js cron scheduler service for the Mimi Slack bot that handles automated daily brief delivery. It runs independently from the main Slack bot and communicates via webhooks to ensure reliable, distributed daily brief scheduling.

## Development Commands

```bash
# Start the application (production or development)
npm start
npm run dev

# Run comprehensive tests
npm test
node test-scheduler.js

# Test with specific Slack user ID
TEST_SLACK_USER_ID=U1234567890 node test-scheduler.js
```

## Architecture Overview

### Core Components

- **index.js**: Express server with health/status endpoints and graceful shutdown
- **scheduler.js**: Cron job management using `node-cron` with timezone support
- **services/daily-brief-generator.js**: Generates personalized briefs using Gmail/Calendar data via Anthropic API
- **services/webhook-client.js**: Sends generated briefs to main bot via HTTP webhooks
- **handlers/supabase-helper.js**: Database operations for user preferences and deduplication
- **handlers/gmail-calendar-client.js**: Google APIs integration for calendar/email data

### Key Architecture Patterns

1. **Distributed Cron Management**: Single source of truth for scheduled tasks to prevent duplicate messages from multiple bot instances
2. **Webhook Communication**: Instead of direct Slack API calls, sends briefs via webhook to main bot at `/webhook` endpoint
3. **Timezone-Aware Scheduling**: Converts user local times to UTC cron expressions using moment-timezone
4. **Deduplication**: Database tracking prevents duplicate briefs via `checkIfAlreadySent()` and cooldown periods
5. **Real-time Sync**: Subscribes to Supabase changes for immediate schedule updates + hourly resync
6. **Graceful Shutdown**: Proper cleanup of all cron tasks on SIGINT/SIGTERM

### Data Flow

1. **Schedule Sync**: `syncAllSchedules()` queries Supabase for active users and creates/updates cron jobs
2. **Cron Execution**: Per-user cron jobs trigger at specified local times (converted to UTC)
3. **Brief Generation**: Uses Google APIs + Anthropic to create personalized daily briefs
4. **Webhook Delivery**: Sends brief content to main bot's webhook endpoint for Slack delivery
5. **Logging**: Records success/failure in database for deduplication and monitoring

## Environment Variables

Required variables (copy from `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`: Shared with main bot
- `SUPABASE_SERVICE_ROLE_KEY`: Database access
- `ANTHROPIC_API_KEY`: Claude AI for brief generation
- `MAIN_PROJECT_URL`: For Google API access (e.g., https://www.usemomo.com)
- `MAIN_BOT_WEBHOOK_URL`: Main bot webhook endpoint

Optional:
- `PORT`: Server port (default 3002)
- `NODE_ENV`: Environment mode
- `TEST_SLACK_USER_ID`: For testing webhook delivery

## API Endpoints

Health monitoring:
- `GET /health`: Basic health status with uptime and active tasks
- `GET /status`: Detailed status including user schedules and system info

Manual operations:
- `POST /sync`: Force schedule resync with database
- `POST /test-webhook`: Test webhook delivery (requires `userId` in body)
- `POST /test-brief`: Test brief generation for specific user (requires `userId` in body)

## Database Schema

Key Supabase tables:
- `user_preferences`: User settings with delivery_time, timezone, slack_user_id
- `daily_brief_logs`: Tracking sent briefs for deduplication

## Testing and Debugging

Use the comprehensive test file `test-scheduler.js` which tests:
- Supabase connection and user data
- Google API connectivity
- Brief generation pipeline
- Webhook delivery (if `TEST_SLACK_USER_ID` is set)
- All major system components

For debugging specific users, use the `/test-brief` endpoint with their Supabase user_id.