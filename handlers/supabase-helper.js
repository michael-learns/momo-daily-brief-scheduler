// supabaseHelpers.js
const { createClient } = require("@supabase/supabase-js");
const moment = require("moment-timezone");

// Debug environment variables
console.log("🔍 [SUPABASE] Environment variables check:");
console.log(
    "NEXT_PUBLIC_SUPABASE_URL:",
    process.env.NEXT_PUBLIC_SUPABASE_URL ? "Set" : "Missing"
);
console.log(
    "SUPABASE_SERVICE_ROLE_KEY:",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? "Set" : "Missing"
);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
    throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL is required in environment variables"
    );
}

if (!supabaseKey) {
    throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is required in environment variables"
    );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test Supabase connection and table existence
async function testSupabaseConnection() {
    console.log("🧪 [SUPABASE] Testing connection and table structure...");

    try {
        // First, check if we can connect at all
        const { data: tables, error: tableError } = await supabase
            .from("user_preferences")
            .select("*")
            .limit(1);

        if (tableError) {
            console.error(
                "❌ [SUPABASE] Cannot access user_preferences table:",
                tableError
            );
            return false;
        }

        console.log(
            "✅ [SUPABASE] Successfully connected to user_preferences table"
        );
        console.log("📋 [SUPABASE] Sample data:", tables);
        return true;
    } catch (error) {
        console.error("❌ [SUPABASE] Connection test failed:", error);
        return false;
    }
}

// Get all active users with preferences
async function getActiveUsers() {
    console.log(
        "🔍 [SUPABASE] Fetching active users from user_preferences table..."
    );

    const { data, error } = await supabase
        .from("user_preferences")
        .select("user_id, timezone, user_email, delivery_time, slack_user_id");

    if (error) {
        console.error("❌ [SUPABASE] Error fetching users:", error);
        return [];
    }

    console.log(`📊 [SUPABASE] Raw data from database:`, data);
    console.log(`👥 [SUPABASE] Found ${data?.length || 0} users in database`);

    if (!data || data.length === 0) {
        console.warn("⚠️ [SUPABASE] No users found in user_preferences table!");
        return [];
    }

    // Filter out users without slack_user_id
    const validUsers = data.filter((user) => user.slack_user_id);
    if (validUsers.length < data.length) {
        console.warn(
            `⚠️ [SUPABASE] Filtered out ${
                data.length - validUsers.length
            } users without slack_user_id`
        );
    }

    return validUsers;
}

// Check if brief was already sent today
async function checkIfAlreadySent(userId) {
    console.log(
        "🔍 [SUPABASE] Checking if brief was already sent for user:",
        userId
    );
    const today = moment().utc().startOf("day").toISOString();

    const { data, error } = await supabase
        .from("brief_usage")
        .select("id")
        .eq("user_id", userId)
        .gte("last_used", today)
        .single();

    return !!data; // Returns true if found
}

// Check if a brief was sent recently within a time window (in seconds)
async function checkIfSentRecently(userId, windowSeconds = 3000) {
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const { data, error } = await supabase
        .from("brief_usage")
        .select("id")
        .eq("user_id", userId)
        .gte("last_used", since)
        .limit(1)
        .maybeSingle();

    if (error && error.code !== "PGRST116") {
        // ignore no rows error
        console.error("❌ [SUPABASE] Error checking recent brief:", error);
    }
    return !!data;
}

// Queue helpers
async function enqueueDueBriefJobs(users) {
    // Create jobs for the current minute in each user's local timezone
    const nowUtc = new Date();
    const upserts = [];
    for (const user of users) {
        try {
            const userNow = moment.tz(nowUtc, user.timezone);
            const hhmm = userNow.format("HH:mm");
            if (hhmm === user.delivery_time.slice(0, 5)) {
                // schedule at current minute boundary
                const scheduledAt = new Date(
                    Date.UTC(
                        userNow.year(),
                        userNow.month(),
                        userNow.date(),
                        userNow.hour(),
                        userNow.minute(),
                        0,
                        0
                    )
                ).toISOString();
                upserts.push({
                    user_id: user.user_id,
                    scheduled_at: scheduledAt,
                    status: "pending",
                });
            }
        } catch {}
    }
    if (upserts.length === 0) return { inserted: 0 };
    const { error } = await supabase
        .from("brief_queue")
        .upsert(upserts, { onConflict: "user_id,scheduled_at" });
    if (error) {
        console.error("❌ [SUPABASE] Failed to enqueue jobs:", error);
        return { inserted: 0, error };
    }
    return { inserted: upserts.length };
}

async function fetchNextBriefJobs(limit = 5) {
    const { data, error } = await supabase
        .from("brief_queue")
        .select("id,user_id,scheduled_at,status,attempts")
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(limit);
    if (error) {
        console.error("❌ [SUPABASE] Failed to fetch jobs:", error);
        return [];
    }
    return data || [];
}

async function markJobProcessing(id) {
    const { error } = await supabase
        .from("brief_queue")
        .update({
            status: "processing",
            attempts: supabase.rpc ? undefined : undefined,
        })
        .eq("id", id);
    if (error) console.error("❌ [SUPABASE] Failed to mark processing:", error);
}

async function completeJob(id) {
    const { error } = await supabase
        .from("brief_queue")
        .update({ status: "completed" })
        .eq("id", id);
    if (error) console.error("❌ [SUPABASE] Failed to complete job:", error);
}

async function failJob(id, lastError) {
    const { error } = await supabase
        .from("brief_queue")
        .update({
            status: "failed",
            last_error: lastError,
            attempts: supabase.rpc ? undefined : undefined,
        })
        .eq("id", id);
    if (error) console.error("❌ [SUPABASE] Failed to fail job:", error);
}

// Log that a brief was sent
async function logBriefSent(userId, status = "success", errorMessage = null) {
    // Only include error_message if it exists and we have an error
    const insertData = {
        user_id: userId,
        last_used: new Date().toISOString(),
        status: status,
    };

    // Only add error_message if we have one and the column exists
    if (errorMessage) {
        insertData.error_message = errorMessage;
    }

    const { error } = await supabase.from("brief_usage").insert(insertData);

    if (error) {
        console.error("Error logging brief:", error);
    } else {
        console.log(`✅ [SUPABASE] Logged brief ${status} for user ${userId}`);
    }
}

// Update user preferences (for Slack commands)
async function updateUserPreference(
    userId,
    timezone,
    deliveryTime,
    userEmail,
    slackUserId = null
) {
    const updateData = {
        user_id: userId,
        timezone: timezone,
        user_email: userEmail,
        delivery_time: deliveryTime,
        updated_at: new Date().toISOString(),
    };

    // Add slack_user_id if provided
    if (slackUserId) {
        updateData.slack_user_id = slackUserId;
    }

    const { data, error } = await supabase
        .from("user_preferences")
        .upsert(updateData, {
            onConflict: "user_id",
        });

    if (error) {
        console.error("Error updating preferences:", error);
        return false;
    }
    return true;
}

// Subscribe to preference changes (real-time)
function subscribeToPreferenceChanges(callback) {
    const subscription = supabase
        .channel("user_preference")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "user_preferences",
            },
            callback
        )
        .subscribe();

    return subscription;
}

// Get user preferences by user ID or email
async function getUserPreferences(userId = null, userEmail = null) {
    console.log(
        `🔍 [SUPABASE] Fetching user preferences for userId: ${userId}, userEmail: ${userEmail}`
    );

    if (!userId && !userEmail) {
        console.error(
            "❌ [SUPABASE] Either userId or userEmail must be provided"
        );
        return null;
    }

    let query = supabase
        .from("user_preferences")
        .select("user_id, timezone, user_email, delivery_time, slack_user_id");

    // Prefer userId lookup, fallback to email
    if (userId) {
        query = query.eq("user_id", userId);
    } else if (userEmail) {
        query = query.eq("user_email", userEmail);
    }

    const { data, error } = await query.single();

    if (error) {
        if (error.code === "PGRST116") {
            // No rows found
            console.log(`📭 [SUPABASE] No preferences found for user`);
            return null;
        }
        console.error("❌ [SUPABASE] Error fetching user preferences:", error);
        return null;
    }

    console.log(`✅ [SUPABASE] Found preferences for user:`, data);
    return data;
}

module.exports = {
    supabase,
    testSupabaseConnection,
    getActiveUsers,
    getUserPreferences,
    checkIfAlreadySent,
    checkIfSentRecently,
    logBriefSent,
    updateUserPreference,
    subscribeToPreferenceChanges,
    enqueueDueBriefJobs,
    fetchNextBriefJobs,
    markJobProcessing,
    completeJob,
    failJob,
};
