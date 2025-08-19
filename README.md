# Mimi Daily Brief Cron Scheduler

A standalone cron scheduler service for the Mimi Slack bot that handles automated daily brief delivery. This service runs independently from the main Slack bot and communicates via webhooks to ensure reliable, distributed daily brief scheduling.

## Architecture Overview

This scheduler application separates cron job management from the main Slack bot to solve duplicate message issues that occur when multiple bot instances are running. Instead of each bot instance managing its own cron jobs, this dedicated service handles all scheduling and sends briefs via webhook to the main bot.

### Key Components

- **Scheduler Core**: Uses `node-cron` for timezone-aware task scheduling
- **Daily Brief Generator**: Generates personalized briefs using Gmail and Calendar data
- **Webhook Client**: Sends generated briefs to main bot via HTTP webhooks
- **Supabase Integration**: Manages user preferences and deduplication
- **Health Monitoring**: Express endpoints for health checks and status monitoring

## Features

- ✅ **Distributed Cron Management**: Single source of truth for scheduled tasks
- ✅ **Timezone Support**: Accurate delivery in user's preferred timezone
- ✅ **Deduplication**: Prevents duplicate briefs via database tracking
- ✅ **Health Monitoring**: Comprehensive health checks and status reporting
- ✅ **Graceful Shutdown**: Proper cleanup of cron tasks on termination
- ✅ **Error Handling**: Robust error handling with retry logic
- ✅ **Real-time Sync**: Automatic schedule updates when user preferences change

## Prerequisites

- Node.js 18+ 
- Access to Supabase database (shared with main bot)
- Anthropic API key for Claude AI
- Main Momo project URL for Google API access
- Main bot webhook URL for message delivery

## Installation

```bash
# Clone/copy the cron scheduler directory
cd mimi-cron-scheduler

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Configure environment variables (see below)
nano .env
```

## Environment Configuration

Copy `.env.example` to `.env` and configure:

### Required Variables

```bash
# Supabase Configuration (shared with main bot)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Anthropic API Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key

# Main Project URL (for Gmail/Calendar integration)
MAIN_PROJECT_URL=https://www.usemomo.com

# Main Bot Communication
MAIN_BOT_WEBHOOK_URL=https://mimi-for-momo-production.up.railway.app/webhook
```

### Optional Variables

```bash
# Server Configuration
PORT=3002
NODE_ENV=production

# Testing (for webhook tests)
TEST_SLACK_USER_ID=U1234567890
```

## Development

### Running the Scheduler

```bash
# Start the scheduler
npm start

# Run in development mode (same as start)
npm run dev

# Run comprehensive tests
npm test
```

### Testing Commands

```bash
# Test all components
node test-scheduler.js

# Set TEST_SLACK_USER_ID to test webhook delivery
TEST_SLACK_USER_ID=U1234567890 node test-scheduler.js
```

## API Endpoints

The scheduler exposes several HTTP endpoints for monitoring and testing:

### Health & Status

```bash
# Health check
GET /health

# Detailed status
GET /status
```

### Manual Operations

```bash
# Manually sync schedules
POST /sync

# Test webhook delivery
POST /test-webhook
Content-Type: application/json
{
  "userId": "U1234567890"
}

# Test brief generation for specific user
POST /test-brief
Content-Type: application/json
{
  "userId": "your_supabase_user_id"
}
```

## Railway Deployment

This application is designed for Railway deployment alongside the main bot.

### Deploy to Railway

1. **Create New Railway Service**:
   ```bash
   railway login
   railway init
   railway up
   ```

2. **Configure Environment Variables**:
   - Use Railway dashboard to set all required environment variables
   - Copy values from main bot service where applicable

3. **Set Custom Start Command** (if needed):
   ```bash
   railway run npm start
   ```

### Deployment Configuration

The `railway.json` file is pre-configured with:
- Nixpacks builder for automatic Node.js detection
- Restart policy for reliability
- Proper start command

### Environment Variable Sources

- **Supabase**: Same as main bot (shared database)
- **Anthropic**: Same as main bot (shared Claude API)
- **Main Project URL**: Same as main bot
- **Webhook URL**: Points to main bot's Railway URL + `/webhook`

## Monitoring & Operations

### Health Monitoring

```bash
# Check if scheduler is healthy
curl https://your-cron-scheduler.railway.app/health

# Get detailed status including active tasks
curl https://your-cron-scheduler.railway.app/status
```

### Log Monitoring

The application provides detailed logging with emoji prefixes for easy visual scanning:

- 🚀 **Startup**: Application initialization
- 📅 **Scheduler**: Cron job management  
- 📧 **Brief Generator**: Daily brief creation
- 📡 **Webhook**: Communication with main bot
- 🏥 **Health**: Health checks and monitoring
- ❌ **Errors**: Error conditions
- ✅ **Success**: Successful operations

### Manual Operations

```bash
# Manually trigger schedule sync
curl -X POST https://your-cron-scheduler.railway.app/sync

# Test webhook with specific Slack user
curl -X POST https://your-cron-scheduler.railway.app/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"userId":"U1234567890"}'
```

## Troubleshooting

### Common Issues

**1. No briefs being sent**
- Check `/health` endpoint for scheduler status
- Verify Supabase connection and user preferences
- Check webhook URL is reachable
- Review logs for cron job execution

**2. Duplicate briefs**
- Ensure only one instance of cron scheduler is running
- Check deduplication logic in database
- Verify main bot webhook endpoint is working

**3. Brief generation fails**
- Check user has valid Google account access
- Verify main project URL is accessible
- Review Gmail/Calendar API rate limits

**4. Webhook delivery fails**
- Test main bot webhook endpoint directly
- Check network connectivity between services
- Verify webhook URL format and authentication

### Debug Commands

```bash
# Check active users and their schedules
curl https://your-cron-scheduler.railway.app/status

# Force schedule resync
curl -X POST https://your-cron-scheduler.railway.app/sync

# Test specific user's brief generation
curl -X POST https://your-cron-scheduler.railway.app/test-brief \
  -H "Content-Type: application/json" \
  -d '{"userId":"user_id_from_supabase"}'
```

## Integration with Main Bot

The cron scheduler communicates with the main Slack bot via webhook calls:

1. **Cron triggers** → Scheduler generates brief content
2. **Brief ready** → Scheduler calls main bot's `/webhook` endpoint
3. **Main bot receives** → Delivers message to user via Slack API

### Webhook Payload Format

```json
{
  "userId": "U1234567890",
  "message": "🍑 *Daily Brief - Monday, January 15, 2024*\n\n..."
}
```

## Security Considerations

- Environment variables contain sensitive API keys
- Webhook endpoint should validate requests (if implementing authentication)
- Supabase service role key has elevated permissions
- Consider rate limiting for manual endpoints in production

## Monitoring Production

### Key Metrics to Monitor

- **Active Tasks**: Number of scheduled cron jobs
- **Success Rate**: Percentage of successful brief deliveries
- **Error Rate**: Failed webhook calls or brief generations
- **Uptime**: Service availability
- **Database Connection**: Supabase connectivity

### Alerting

Consider setting up alerts for:
- Service downtime
- High error rates
- Database connection failures
- Webhook delivery failures
- Memory/CPU usage spikes

## Contributing

When making changes:

1. Test locally with comprehensive test suite
2. Ensure environment variables are documented
3. Update health checks if adding new dependencies
4. Test webhook integration with main bot
5. Verify graceful shutdown behavior

## Architecture Benefits

This standalone scheduler provides:

- **Reliability**: Single point of failure elimination
- **Scalability**: Independent scaling from main bot
- **Maintainability**: Separated concerns and easier debugging
- **Monitoring**: Dedicated health checks and status endpoints
- **Flexibility**: Easy to modify scheduling logic without affecting main bot