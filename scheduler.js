// scheduler.js
const cron = require("node-cron");
const moment = require("moment-timezone");
const {
    testSupabaseConnection,
    getActiveUsers,
    checkIfAlreadySent,
    logBriefSent,
    subscribeToPreferenceChanges,
    checkIfSentRecently,
} = require("./handlers/supabase-helper");
const { sendBriefViaWebhook } = require("./services/webhook-client");

// Store active cron tasks
const activeTasks = new Map();

// Mutex to prevent concurrent syncs
let syncInProgress = false;

function convertToCronTime(timePreference, timezone) {
    const [hours, minutes] = timePreference.split(":");

    // Get today's date in the USER'S timezone, not UTC
    const todayInUserTz = moment.tz(timezone).format("YYYY-MM-DD");

    // Create the time in the user's timezone
    const userTime = moment.tz(
        `${todayInUserTz} ${hours}:${minutes}`,
        "YYYY-MM-DD HH:mm",
        timezone
    );

    const utcTime = userTime.utc();

    console.log(
        `🕐 [TIMEZONE-DEBUG] Converting ${timePreference} ${timezone}:`
    );
    console.log(`   Today in ${timezone}: ${todayInUserTz}`);
    console.log(`   User time: ${userTime.format("YYYY-MM-DD HH:mm:ss z")}`);
    console.log(`   UTC time: ${utcTime.format("YYYY-MM-DD HH:mm:ss z")}`);
    console.log(
        `   Expected cron: ${utcTime.minutes()} ${utcTime.hours()} * * *`
    );

    return `${utcTime.minutes()} ${utcTime.hours()} * * *`;
}

// Per-user cron job adapted for webhook communication
function createUserCronJob(user) {
    const cronExpression = convertToCronTime(user.delivery_time, user.timezone);

    console.log(
        `📅 [SCHEDULER] Scheduling brief for ${user.user_id} at ${cronExpression} (UTC) / ${user.delivery_time} (${user.timezone})`
    );

    const task = cron.schedule(
        cronExpression,
        async () => {
            try {
                // Double-check if already sent (important for reliability)
                const alreadySent = await checkIfAlreadySent(user.user_id);

                const sentRecently = await checkIfSentRecently(
                    user.user_id,
                    3000
                );
                if (!alreadySent && !sentRecently) {
                    console.log(
                        `📤 [SCHEDULER] Sending brief to user ${user.user_id} (email: ${user.user_email})`
                    );

                    // Only proceed if we have a slack_user_id
                    if (!user.slack_user_id) {
                        console.warn(
                            `⚠️ [SCHEDULER] Skipping user ${user.user_id} - no slack_user_id configured`
                        );
                        await logBriefSent(
                            user.user_id,
                            "skipped",
                            "No slack_user_id configured"
                        );
                        return;
                    }

                    console.log(
                        `🔍 [SCHEDULER] Using Slack user ID: ${user.slack_user_id}`
                    );

                    // Send via webhook instead of direct Slack call
                    const success = await sendBriefViaWebhook(
                        user.slack_user_id,
                        user.user_email
                    );

                    // Log the result
                    await logBriefSent(
                        user.user_id,
                        success ? "success" : "failed",
                        success ? null : "Failed to send via webhook"
                    );

                    if (success) {
                        console.log(
                            `✅ [SCHEDULER] Successfully sent brief to ${user.user_id}`
                        );
                    } else {
                        console.error(
                            `❌ [SCHEDULER] Failed to send brief to ${user.user_id}`
                        );
                    }
                } else {
                    console.log(
                        `⏭️ [SCHEDULER] Brief already sent (today or within cooldown) for ${user.user_id}`
                    );
                }
            } catch (error) {
                console.error(
                    `❌ [SCHEDULER] Error sending brief to ${user.user_id}:`,
                    error
                );
                await logBriefSent(user.user_id, "failed", error.message);
            }
        },
        {
            scheduled: false, // Don't start immediately
            timezone: "UTC", // Always use UTC for cron jobs
        }
    );

    return task;
}

// Sync all schedules with Supabase
async function syncAllSchedules() {
    console.log("🔄 [SCHEDULER] Syncing schedules with Supabase...");

    try {
        // Stop all existing tasks
        activeTasks.forEach((task, userId) => {
            console.log(`⏹️ [SCHEDULER] Stopping existing task for ${userId}`);
            task.stop();
        });
        activeTasks.clear();

        // Get all active users
        const users = await getActiveUsers();
        console.log(`👥 [SCHEDULER] Found ${users.length} active users`);

        // Create cron job for each user
        for (const user of users) {
            try {
                // Validate required fields
                if (!user.user_id || !user.delivery_time || !user.timezone) {
                    console.warn(
                        `⚠️ [SCHEDULER] Skipping user ${user.user_id} - missing required fields:`,
                        {
                            user_id: !!user.user_id,
                            delivery_time: !!user.delivery_time,
                            timezone: !!user.timezone,
                            user_email: !!user.user_email,
                        }
                    );
                    continue;
                }

                const task = createUserCronJob(user);
                task.start(); // Start the cron job
                activeTasks.set(user.user_id, task);

                console.log(
                    `✅ [SCHEDULER] Scheduled brief for ${user.user_id} at ${user.delivery_time} (${user.timezone})`
                );
            } catch (error) {
                console.error(
                    `❌ [SCHEDULER] Failed to schedule task for ${user.user_id}:`,
                    error
                );
            }
        }

        console.log(
            `📊 [SCHEDULER] Successfully scheduled ${activeTasks.size} briefs`
        );
    } catch (error) {
        console.error("❌ [SCHEDULER] Error syncing schedules:", error);
    }
}

// Get scheduler status
function getSchedulerStatus() {
    const status = {
        activeTasks: activeTasks.size,
        tasks: [],
    };

    activeTasks.forEach((task, userId) => {
        status.tasks.push({
            userId: userId,
            running: task.running,
        });
    });

    return status;
}

// Stop all scheduled tasks
function stopAllTasks() {
    console.log("🛑 [SCHEDULER] Stopping all scheduled tasks...");

    activeTasks.forEach((task, userId) => {
        console.log(`⏹️ [SCHEDULER] Stopping task for ${userId}`);
        task.stop();
    });

    activeTasks.clear();
    console.log("✅ [SCHEDULER] All tasks stopped");
}

// Initialize the scheduler
async function initScheduler() {
    console.log("🚀 [SCHEDULER] Initializing cron scheduler...");

    try {
        // Test Supabase connection first
        console.log("🔧 [SCHEDULER] Testing Supabase connection...");
        const connectionOk = await testSupabaseConnection();

        if (!connectionOk) {
            throw new Error("Supabase connection test failed");
        }

        // Initial sync
        await syncAllSchedules();

        // Resync every hour (in case preferences changed)
        console.log("⏰ [SCHEDULER] Setting up hourly sync...");
        const syncTask = cron.schedule(
            "0 * * * *",
            async () => {
                console.log("🔄 [SCHEDULER] Hourly sync triggered");
                await syncAllSchedules();
            },
            {
                timezone: "UTC",
            }
        );

        // Subscribe to real-time changes (optional but nice)
        try {
            const subscription = subscribeToPreferenceChanges(
                async (payload) => {
                    console.log("🔔 [SCHEDULER] Preference changed:", payload);
                    // Resync when preferences change
                    await syncAllSchedules();
                }
            );

            console.log(
                "👂 [SCHEDULER] Subscribed to real-time preference changes"
            );
        } catch (error) {
            console.warn(
                "⚠️ [SCHEDULER] Could not subscribe to real-time changes:",
                error.message
            );
        }

        console.log("✅ [SCHEDULER] Cron scheduler initialized successfully");

        // Log current status
        const status = getSchedulerStatus();
        console.log(
            `📊 [SCHEDULER] Status: ${status.activeTasks} active tasks`
        );
    } catch (error) {
        console.error("❌ [SCHEDULER] Failed to initialize scheduler:", error);
        throw error;
    }
}

// Manually trigger a brief for testing
async function triggerTestBrief(userId) {
    console.log(`🧪 [SCHEDULER] Triggering test brief for ${userId}`);

    try {
        const users = await getActiveUsers();
        const user = users.find((u) => u.user_id === userId);

        if (!user) {
            throw new Error(`User ${userId} not found in active users`);
        }

        // Only proceed if we have a slack_user_id
        if (!user.slack_user_id) {
            throw new Error(`User ${userId} has no slack_user_id configured`);
        }

        const success = await sendBriefViaWebhook(
            user.slack_user_id,
            user.user_email
        );

        if (success) {
            console.log(
                `✅ [SCHEDULER] Test brief sent successfully to ${userId}`
            );
        } else {
            console.error(`❌ [SCHEDULER] Test brief failed for ${userId}`);
        }

        return success;
    } catch (error) {
        console.error(
            `❌ [SCHEDULER] Error triggering test brief for ${userId}:`,
            error
        );
        return false;
    }
}

module.exports = {
    initScheduler,
    syncAllSchedules,
    getSchedulerStatus,
    stopAllTasks,
    triggerTestBrief,
};
