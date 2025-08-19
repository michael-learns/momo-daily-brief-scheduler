// index.js - Mimi Daily Brief Cron Scheduler
require("dotenv").config();
const express = require("express");
const { initScheduler, getSchedulerStatus, stopAllTasks, triggerTestBrief } = require("./scheduler");
const { testSupabaseConnection, getActiveUsers } = require("./handlers/supabase-helper");
const { GoogleAPIClient } = require("./handlers/gmail-calendar-client");
const { testWebhook, sendHealthStatus } = require("./services/webhook-client");

const app = express();
const port = process.env.PORT || 3002;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global variables for tracking application state
let applicationStartTime = new Date();
let isHealthy = true;
let lastError = null;
let schedulerInitialized = false;

// Initialize Google API client for testing
const googleClient = new GoogleAPIClient();

// Health check endpoint
app.get("/health", async (req, res) => {
    console.log("🏥 [HEALTH-CHECK] Health check requested");

    try {
        const uptime = process.uptime();
        const schedulerStatus = getSchedulerStatus();
        
        // Test Supabase connection
        const supabaseHealthy = await testSupabaseConnection();
        
        // Get basic stats
        const activeUsers = supabaseHealthy ? await getActiveUsers() : [];
        
        const healthStatus = {
            status: isHealthy && supabaseHealthy && schedulerInitialized ? "healthy" : "unhealthy",
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
            startTime: applicationStartTime.toISOString(),
            scheduler: {
                initialized: schedulerInitialized,
                activeTasks: schedulerStatus.activeTasks,
                tasks: schedulerStatus.tasks
            },
            database: {
                connected: supabaseHealthy,
                activeUsers: activeUsers.length
            },
            lastError: lastError,
            environment: {
                nodeEnv: process.env.NODE_ENV || "development",
                hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
                hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
                hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
                hasWebhookUrl: !!process.env.MAIN_BOT_WEBHOOK_URL,
                hasMainProjectUrl: !!process.env.MAIN_PROJECT_URL
            }
        };

        console.log(`🏥 [HEALTH-CHECK] Status: ${healthStatus.status}, Active tasks: ${healthStatus.scheduler.activeTasks}`);
        
        res.json(healthStatus);
    } catch (error) {
        console.error("❌ [HEALTH-CHECK] Health check failed:", error);
        res.status(500).json({
            status: "error",
            message: error.message,
            uptime: `${Math.floor(process.uptime())}s`
        });
    }
});

// Status endpoint with detailed information
app.get("/status", async (req, res) => {
    console.log("📊 [STATUS] Status requested");

    try {
        const schedulerStatus = getSchedulerStatus();
        const activeUsers = await getActiveUsers();

        const statusInfo = {
            application: {
                name: "Mimi Cron Scheduler",
                version: "1.0.0",
                startTime: applicationStartTime.toISOString(),
                uptime: process.uptime(),
                healthy: isHealthy,
                lastError: lastError
            },
            scheduler: {
                initialized: schedulerInitialized,
                ...schedulerStatus
            },
            users: {
                total: activeUsers.length,
                withSlackId: activeUsers.filter(u => u.slack_user_id).length,
                users: activeUsers.map(u => ({
                    userId: u.user_id,
                    email: u.user_email,
                    timezone: u.timezone,
                    deliveryTime: u.delivery_time,
                    hasSlackId: !!u.slack_user_id
                }))
            }
        };

        res.json(statusInfo);
    } catch (error) {
        console.error("❌ [STATUS] Status check failed:", error);
        res.status(500).json({
            error: "Failed to get status",
            message: error.message
        });
    }
});

// Manual sync endpoint (for debugging)
app.post("/sync", async (req, res) => {
    console.log("🔄 [MANUAL-SYNC] Manual sync requested");

    try {
        const { syncAllSchedules } = require("./scheduler");
        await syncAllSchedules();
        
        const status = getSchedulerStatus();
        console.log(`✅ [MANUAL-SYNC] Sync completed, ${status.activeTasks} tasks scheduled`);
        
        res.json({
            success: true,
            message: `Sync completed successfully`,
            activeTasks: status.activeTasks
        });
    } catch (error) {
        console.error("❌ [MANUAL-SYNC] Manual sync failed:", error);
        res.status(500).json({
            success: false,
            error: "Sync failed",
            message: error.message
        });
    }
});

// Test webhook endpoint
app.post("/test-webhook", async (req, res) => {
    console.log("🧪 [TEST-WEBHOOK] Webhook test requested");
    
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required in request body"
        });
    }

    try {
        const success = await testWebhook(userId);
        
        if (success) {
            console.log("✅ [TEST-WEBHOOK] Webhook test successful");
            res.json({
                success: true,
                message: "Webhook test message sent successfully"
            });
        } else {
            console.error("❌ [TEST-WEBHOOK] Webhook test failed");
            res.status(500).json({
                success: false,
                error: "Failed to send test webhook"
            });
        }
    } catch (error) {
        console.error("❌ [TEST-WEBHOOK] Webhook test error:", error);
        res.status(500).json({
            success: false,
            error: "Webhook test failed",
            message: error.message
        });
    }
});

// Test brief endpoint (for debugging specific users)
app.post("/test-brief", async (req, res) => {
    console.log("🧪 [TEST-BRIEF] Test brief requested");
    
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: "userId is required in request body"
        });
    }

    try {
        const success = await triggerTestBrief(userId);
        
        if (success) {
            console.log(`✅ [TEST-BRIEF] Test brief sent successfully for ${userId}`);
            res.json({
                success: true,
                message: `Test brief sent successfully for user ${userId}`
            });
        } else {
            console.error(`❌ [TEST-BRIEF] Test brief failed for ${userId}`);
            res.status(500).json({
                success: false,
                error: `Failed to send test brief for user ${userId}`
            });
        }
    } catch (error) {
        console.error(`❌ [TEST-BRIEF] Test brief error for ${userId}:`, error);
        res.status(500).json({
            success: false,
            error: "Test brief failed",
            message: error.message
        });
    }
});

// Graceful shutdown handling
process.on("SIGINT", async () => {
    console.log("\n🛑 [SHUTDOWN] Received SIGINT, starting graceful shutdown...");
    await gracefulShutdown("SIGINT");
});

process.on("SIGTERM", async () => {
    console.log("\n🛑 [SHUTDOWN] Received SIGTERM, starting graceful shutdown...");
    await gracefulShutdown("SIGTERM");
});

async function gracefulShutdown(signal) {
    console.log(`🛑 [SHUTDOWN] Graceful shutdown initiated by ${signal}`);
    isHealthy = false;

    try {
        // Stop all cron tasks
        console.log("⏹️ [SHUTDOWN] Stopping all scheduled tasks...");
        stopAllTasks();
        
        // Close Express server
        console.log("🌐 [SHUTDOWN] Closing Express server...");
        server.close(() => {
            console.log("✅ [SHUTDOWN] Express server closed");
        });
        
        // Give a moment for cleanup
        setTimeout(() => {
            console.log("✅ [SHUTDOWN] Graceful shutdown completed");
            process.exit(0);
        }, 2000);
        
    } catch (error) {
        console.error("❌ [SHUTDOWN] Error during graceful shutdown:", error);
        process.exit(1);
    }
}

// Error handling
process.on("uncaughtException", (error) => {
    console.error("💥 [UNCAUGHT-EXCEPTION] Uncaught exception:", error);
    lastError = {
        type: "uncaughtException",
        message: error.message,
        timestamp: new Date().toISOString()
    };
    isHealthy = false;
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("💥 [UNHANDLED-REJECTION] Unhandled promise rejection:", reason);
    lastError = {
        type: "unhandledRejection",
        message: reason?.message || String(reason),
        timestamp: new Date().toISOString()
    };
    isHealthy = false;
});

// Application startup
async function startApplication() {
    console.log("🚀 [STARTUP] Starting Mimi Daily Brief Cron Scheduler...");
    console.log(`🚀 [STARTUP] Node.js version: ${process.version}`);
    console.log(`🚀 [STARTUP] Environment: ${process.env.NODE_ENV || "development"}`);
    
    try {
        // Test environment variables
        console.log("🔧 [STARTUP] Checking environment variables...");
        const requiredVars = [
            "ANTHROPIC_API_KEY",
            "NEXT_PUBLIC_SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "MAIN_BOT_WEBHOOK_URL",
            "MAIN_PROJECT_URL"
        ];

        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
        }

        console.log("✅ [STARTUP] Environment variables validated");

        // Test Supabase connection
        console.log("🔧 [STARTUP] Testing Supabase connection...");
        const supabaseHealthy = await testSupabaseConnection();
        if (!supabaseHealthy) {
            throw new Error("Failed to connect to Supabase");
        }
        console.log("✅ [STARTUP] Supabase connection successful");

        // Test Google API connection
        console.log("🔧 [STARTUP] Testing Google API connection...");
        const googleHealthy = await googleClient.testConnection();
        if (!googleHealthy) {
            console.warn("⚠️ [STARTUP] Google API connection test failed, but continuing...");
        } else {
            console.log("✅ [STARTUP] Google API connection successful");
        }

        // Initialize scheduler
        console.log("📅 [STARTUP] Initializing scheduler...");
        await initScheduler();
        schedulerInitialized = true;
        console.log("✅ [STARTUP] Scheduler initialized successfully");

        // Start Express server
        const server = app.listen(port, () => {
            console.log(`⚡️ [STARTUP] Cron scheduler is running on port ${port}!`);
            console.log(`🌐 [STARTUP] Health check: http://localhost:${port}/health`);
            console.log(`📊 [STARTUP] Status endpoint: http://localhost:${port}/status`);
            console.log("✅ [STARTUP] Application startup completed successfully");
            
            // Log initial status
            const status = getSchedulerStatus();
            console.log(`📊 [STARTUP] Initial status: ${status.activeTasks} active tasks`);
        });

        // Store server reference for graceful shutdown
        global.server = server;

        return server;

    } catch (error) {
        console.error("❌ [STARTUP] Failed to start application:", error);
        lastError = {
            type: "startupError",
            message: error.message,
            timestamp: new Date().toISOString()
        };
        isHealthy = false;
        process.exit(1);
    }
}

// Start the application
const server = startApplication().then(server => {
    global.server = server;
}).catch(error => {
    console.error("💥 [STARTUP] Application startup failed:", error);
    process.exit(1);
});