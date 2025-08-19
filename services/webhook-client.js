// webhook-client.js
const axios = require("axios");
const { DailyBriefGenerator } = require("./daily-brief-generator");

class WebhookClient {
    constructor() {
        this.webhookUrl = process.env.MAIN_BOT_WEBHOOK_URL;
        this.briefGenerator = new DailyBriefGenerator();
        
        if (!this.webhookUrl) {
            throw new Error("MAIN_BOT_WEBHOOK_URL is required in environment variables");
        }
        
        console.log("🌐 [WEBHOOK-CLIENT] Initialized with URL:", this.webhookUrl);
    }

    /**
     * Generate daily brief and send it to user via main bot webhook
     */
    async sendBriefViaWebhook(slackUserId, userEmail) {
        console.log(`📤 [WEBHOOK-CLIENT] Generating and sending brief for ${userEmail} (Slack ID: ${slackUserId})`);

        try {
            // Step 1: Generate the daily brief content
            console.log("🔄 [WEBHOOK-CLIENT] Generating daily brief content...");
            const briefContent = await this.briefGenerator.generateDailyBrief(userEmail);

            if (!briefContent) {
                console.error("❌ [WEBHOOK-CLIENT] Failed to generate brief content");
                return false;
            }

            // Step 2: Send via webhook to main bot
            console.log("📡 [WEBHOOK-CLIENT] Sending brief via webhook...");
            const success = await this.sendMessageViaWebhook(slackUserId, briefContent);

            if (success) {
                console.log(`✅ [WEBHOOK-CLIENT] Successfully sent brief to ${userEmail}`);
            } else {
                console.error(`❌ [WEBHOOK-CLIENT] Failed to send brief to ${userEmail}`);
            }

            return success;

        } catch (error) {
            console.error(`❌ [WEBHOOK-CLIENT] Error sending brief:`, error);
            return false;
        }
    }

    /**
     * Send message to main bot via webhook
     */
    async sendMessageViaWebhook(userId, message, channel = null, blocks = null, attachments = null) {
        try {
            const payload = {
                userId: userId,
                message: message
            };

            // Add optional parameters if provided
            if (channel) payload.channel = channel;
            if (blocks) payload.blocks = blocks;
            if (attachments) payload.attachments = attachments;

            console.log(`📡 [WEBHOOK-CLIENT] Sending webhook request to ${this.webhookUrl}`);
            console.log(`📋 [WEBHOOK-CLIENT] Payload preview:`, {
                ...payload,
                message: payload.message ? `${payload.message.substring(0, 100)}...` : null
            });

            const response = await axios.post(this.webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // 30 second timeout
            });

            if (response.status === 200 && response.data.success) {
                console.log(`✅ [WEBHOOK-CLIENT] Webhook call successful:`, response.data);
                return true;
            } else {
                console.error(`❌ [WEBHOOK-CLIENT] Webhook call failed:`, response.status, response.data);
                return false;
            }

        } catch (error) {
            console.error(`❌ [WEBHOOK-CLIENT] Webhook request failed:`, {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
                url: this.webhookUrl
            });
            return false;
        }
    }

    /**
     * Test webhook connection with a simple ping message
     */
    async testWebhookConnection(testUserId) {
        console.log("🧪 [WEBHOOK-CLIENT] Testing webhook connection...");
        
        const testMessage = "🧪 Test message from cron scheduler - webhook connection working!";
        const success = await this.sendMessageViaWebhook(testUserId, testMessage);
        
        if (success) {
            console.log("✅ [WEBHOOK-CLIENT] Webhook connection test successful");
        } else {
            console.error("❌ [WEBHOOK-CLIENT] Webhook connection test failed");
        }
        
        return success;
    }

    /**
     * Send system health status to main bot
     */
    async sendHealthStatus(adminUserId, status) {
        const healthMessage = `🤖 **Cron Scheduler Health Status**

📊 **Status**: ${status.healthy ? '✅ Healthy' : '❌ Unhealthy'}
🕐 **Uptime**: ${status.uptime}
📅 **Active Tasks**: ${status.activeTasks}
🗄️ **Database**: ${status.databaseConnected ? '✅ Connected' : '❌ Disconnected'}
⏰ **Last Sync**: ${status.lastSync}

${status.errors && status.errors.length > 0 ? `**Errors**: ${status.errors.join(', ')}` : '**No Errors**'}`;

        return await this.sendMessageViaWebhook(adminUserId, healthMessage);
    }
}

// Create singleton instance
const webhookClient = new WebhookClient();

/**
 * Main export function for sending brief via webhook
 */
async function sendBriefViaWebhook(slackUserId, userEmail) {
    return await webhookClient.sendBriefViaWebhook(slackUserId, userEmail);
}

/**
 * Send test message via webhook
 */
async function testWebhook(testUserId) {
    return await webhookClient.testWebhookConnection(testUserId);
}

/**
 * Send health status via webhook
 */
async function sendHealthStatus(adminUserId, status) {
    return await webhookClient.sendHealthStatus(adminUserId, status);
}

/**
 * Send custom message via webhook
 */
async function sendMessage(userId, message, channel = null, blocks = null, attachments = null) {
    return await webhookClient.sendMessageViaWebhook(userId, message, channel, blocks, attachments);
}

module.exports = {
    WebhookClient,
    sendBriefViaWebhook,
    testWebhook,
    sendHealthStatus,
    sendMessage
};