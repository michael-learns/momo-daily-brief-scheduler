// daily-brief-generator.js
const Anthropic = require("@anthropic-ai/sdk");
const { DateTime } = require("luxon");
const { getUserPreferences } = require("../handlers/supabase-helper");
const { GoogleAPIClient } = require("../handlers/gmail-calendar-client");

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

class DailyBriefGenerator {
    constructor() {
        this.googleClient = new GoogleAPIClient();
        
        // Simple cache to prevent duplicate requests within a short window
        this.briefCache = new Map();
        this.CACHE_DURATION = 30000; // 30 seconds
        this.inFlight = new Map(); // coalesce concurrent generations

        console.log("📋 [BRIEF-GENERATOR] Initialized with cache duration:", this.CACHE_DURATION / 1000, "seconds");
    }

    /**
     * Generate a comprehensive daily brief for a user
     */
    async generateDailyBrief(userEmail, userId = null) {
        console.log(`📋 [BRIEF-GENERATOR] Generating daily brief for user: ${userEmail}`);

        // Check cache to prevent duplicate processing
        const cacheKey = `${userEmail}:${userId || "unknown"}`;
        const now = Date.now();

        if (this.briefCache.has(cacheKey)) {
            const cachedData = this.briefCache.get(cacheKey);
            if (now - cachedData.timestamp < this.CACHE_DURATION) {
                console.log(`📄 [BRIEF-GENERATOR] Returning cached brief for ${userEmail}`);
                return cachedData.brief;
            } else {
                // Clean up expired cache entry
                this.briefCache.delete(cacheKey);
            }
        }

        // If a generation is already running for this user, await it
        if (this.inFlight.has(cacheKey)) {
            console.log(`⏳ [BRIEF-GENERATOR] Awaiting in-flight brief generation for ${userEmail}`);
            try {
                return await this.inFlight.get(cacheKey);
            } catch (e) {
                console.warn(`⚠️ [BRIEF-GENERATOR] In-flight generation failed, regenerating...`);
            }
        }

        try {
            // Get user preferences from Supabase for timezone settings
            let userPreferences = null;
            let userTimezone = "America/New_York"; // fallback

            try {
                userPreferences = await getUserPreferences(userId, userEmail);
                if (userPreferences) {
                    userTimezone = userPreferences.timezone || "America/New_York";
                    console.log(`📋 [BRIEF-GENERATOR] Using preferences - timezone: ${userTimezone}, delivery_time: ${userPreferences.delivery_time}`);
                } else {
                    console.log("📋 [BRIEF-GENERATOR] No preferences found, using fallback timezone");
                }
            } catch (error) {
                console.log("📋 [BRIEF-GENERATOR] Could not get user preferences:", error.message);
            }

            // Current date in user's timezone
            const now = DateTime.now().setZone(userTimezone);
            const todayFormatted = now.toFormat("EEEE, MMMM d, yyyy");

            console.log(`📋 [BRIEF-GENERATOR] Gathering data for ${todayFormatted} in timezone ${userTimezone}`);

            // Generate the brief with retry logic
            const generationPromise = this.generateBriefContent(
                userEmail,
                userTimezone,
                todayFormatted,
                now
            );
            this.inFlight.set(cacheKey, generationPromise);
            const dailyBrief = await generationPromise;

            // Cache the result for short-term consistency
            this.briefCache.set(cacheKey, {
                brief: dailyBrief,
                timestamp: now,
            });

            console.log(`💾 [BRIEF-GENERATOR] Cached brief for ${userEmail} (expires in ${this.CACHE_DURATION / 1000}s)`);

            // Clean up old cache entries periodically
            this.cleanupCache();

            return dailyBrief;

        } catch (error) {
            console.error(`❌ [BRIEF-GENERATOR] Error generating daily brief:`, error);
            return `❌ Sorry, I couldn't generate your daily brief. ${error.message}`;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    /**
     * Generate brief content using Gmail and Calendar data
     */
    async generateBriefContent(userEmail, userTimezone, todayFormatted, currentTime) {
        console.log("📊 [BRIEF-GENERATOR] Gathering data from Gmail and Calendar...");

        try {
            // Gather data sequentially to avoid overwhelming APIs
            console.log("📧 [BRIEF-GENERATOR] Starting Gmail data gathering...");
            const emailSummary = await this.gatherGmailData(userEmail, userTimezone, currentTime);
            
            // Add delay between major API operations
            await this.delay(1000);

            console.log("📅 [BRIEF-GENERATOR] Starting Calendar data gathering...");
            const calendarSummary = await this.gatherCalendarData(userEmail);

            // Generate AI-powered brief
            return await this.generateAIDailyBrief(
                emailSummary,
                calendarSummary,
                todayFormatted,
                userTimezone
            );

        } catch (error) {
            console.error("❌ [BRIEF-GENERATOR] Error gathering data:", error);
            
            // Fallback to basic brief
            return this.generateBasicBrief(todayFormatted, userTimezone, error.message);
        }
    }

    /**
     * Gather Gmail data for the brief
     */
    async gatherGmailData(userEmail, userTimezone, currentTime) {
        console.log("📧 [BRIEF-GENERATOR] Gathering Gmail data...");

        try {
            const now = currentTime || DateTime.now().setZone(userTimezone);
            const businessStart = now.minus({ days: 1 }).set({ hour: 18, minute: 0, second: 0 }); // Yesterday 6pm
            const businessEnd = now; // Current time

            console.log(`📧 [BRIEF-GENERATOR] Business period: ${businessStart.toFormat("MMM dd, h:mm a")} - ${businessEnd.toFormat("MMM dd, h:mm a")} ${userTimezone}`);

            // Get email data with time filtering
            const startDate = businessStart.toFormat("yyyy/MM/dd");
            const endDate = businessEnd.plus({ days: 1 }).toFormat("yyyy/MM/dd");
            const timeQuery = `after:${startDate} before:${endDate}`;

            // Get different categories of emails
            console.log("📧 [BRIEF-GENERATOR] Getting unread emails...");
            const unreadEmails = await this.retryOperation(() =>
                this.googleClient.getRecentEmails(userEmail, 30, `is:unread ${timeQuery}`)
            );

            await this.delay(500);

            console.log("📧 [BRIEF-GENERATOR] Getting important emails...");
            const importantEmails = await this.retryOperation(() =>
                this.googleClient.getRecentEmails(userEmail, 15, `(is:important OR is:starred) ${timeQuery}`)
            );

            await this.delay(500);

            console.log("📧 [BRIEF-GENERATOR] Getting VIP emails...");
            const vipEmails = await this.retryOperation(() =>
                this.googleClient.getRecentEmails(userEmail, 10, `label:"VIP" ${timeQuery}`)
            );

            // Filter by business hours and get counts
            const filteredUnread = this.filterEmailsByBusinessHours(unreadEmails, businessStart, businessEnd, userTimezone);
            const filteredImportant = this.filterEmailsByBusinessHours(importantEmails, businessStart, businessEnd, userTimezone);
            const filteredVip = this.filterEmailsByBusinessHours(vipEmails, businessStart, businessEnd, userTimezone);

            console.log(`📧 [BRIEF-GENERATOR] Email summary: ${filteredUnread.length} unread, ${filteredImportant.length} important, ${filteredVip.length} VIP`);

            return {
                unreadEmails: filteredUnread.slice(0, 20),
                importantEmails: filteredImportant.slice(0, 10),
                vipEmails: filteredVip.slice(0, 5),
                unreadCount: filteredUnread.length,
                importantCount: filteredImportant.length,
                vipCount: filteredVip.length,
                businessPeriod: {
                    start: businessStart.toFormat("MMM dd, h:mm a"),
                    end: businessEnd.toFormat("MMM dd, h:mm a"),
                    timezone: userTimezone,
                },
            };

        } catch (error) {
            console.error("❌ [BRIEF-GENERATOR] Gmail data gathering failed:", error);
            return null;
        }
    }

    /**
     * Gather Calendar data for the brief
     */
    async gatherCalendarData(userEmail) {
        console.log("📅 [BRIEF-GENERATOR] Gathering Calendar data...");

        try {
            console.log("📅 [BRIEF-GENERATOR] Getting today's events...");
            const todaysEvents = await this.retryOperation(() =>
                this.googleClient.getTodaysEvents(userEmail)
            );

            await this.delay(500);

            console.log("📅 [BRIEF-GENERATOR] Getting upcoming events...");
            const upcomingEvents = await this.retryOperation(() =>
                this.googleClient.getUpcomingEvents(userEmail, 10)
            );

            // Filter upcoming events to exclude today's events
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);

            const futureEvents = upcomingEvents.filter((event) => {
                const eventStart = new Date(event.start?.dateTime || event.start?.date);
                return eventStart >= tomorrow;
            });

            console.log(`📅 [BRIEF-GENERATOR] Calendar summary: ${todaysEvents.length} today's events, ${futureEvents.length} upcoming`);

            return {
                todaysEvents: todaysEvents,
                upcomingEvents: futureEvents.slice(0, 5),
                todaysEventCount: todaysEvents.length,
                upcomingEventCount: futureEvents.length,
            };

        } catch (error) {
            console.error("❌ [BRIEF-GENERATOR] Calendar data gathering failed:", error);
            return null;
        }
    }

    /**
     * Filter emails by business hours
     */
    filterEmailsByBusinessHours(emails, businessStart, businessEnd, userTimezone) {
        if (!emails || emails.length === 0) return [];

        return emails.filter((email) => {
            try {
                const emailDate = new Date(email.date);
                if (isNaN(emailDate.getTime())) return false;

                const emailDateTime = DateTime.fromJSDate(emailDate).setZone(userTimezone);
                return emailDateTime >= businessStart && emailDateTime <= businessEnd;
            } catch (error) {
                console.error("❌ [BRIEF-GENERATOR] Error filtering email:", error);
                return false;
            }
        });
    }

    /**
     * Generate AI-powered daily brief
     */
    async generateAIDailyBrief(emailSummary, calendarSummary, todayFormatted, userTimezone) {
        console.log("🤖 [BRIEF-GENERATOR] Generating AI-powered daily brief...");

        const briefingData = this.prepareBriefingData(emailSummary, calendarSummary, todayFormatted, userTimezone);

        const systemPrompt = `You are an expert executive assistant. Generate a daily brief divided into EXACTLY TWO sections:

1) 📧 Email Brief
   - Summarize inbox at a glance (unread count, important/starred count, VIP count)
   - List up to 5 important email highlights with format: "subject | from | [View Thread](threadLink)". Keep each on a single line.
   - Be concise and action-oriented.

2) 📅 Calendar Brief
   - Use a numbered list for today's meetings in chronological order. Format each as:
     1. Event Title | Time Range
        1.1 context from related emails (if available)
   - If no email context exists for an event, include a single sub-point: "No specific email context available".
   - Always include time ranges in format "8:00 - 9:00" or "9:00 - 9:30".

General Rules:
- Do not add any extra sections beyond the two specified.
- Keep the tone professional and concise.
- Always include thread links for emails in markdown format.`;

        const userPrompt = `Please create a daily brief for ${todayFormatted} with EXACTLY two sections (Email Brief, Calendar Brief). Here's the data:

${briefingData}

Generate a comprehensive yet concise daily brief that helps the user prioritize their day effectively.`;

        try {
            const response = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 800,
                system: systemPrompt,
                messages: [
                    {
                        role: "user",
                        content: userPrompt,
                    },
                ],
            });

            const dailyBrief = response.content[0].text;
            const briefHeader = `🍑 *Daily Brief - ${todayFormatted}*\n\n`;
            
            return `${briefHeader}${dailyBrief}`;

        } catch (error) {
            console.error("❌ [BRIEF-GENERATOR] AI generation failed:", error);
            return this.generateBasicBrief(todayFormatted, userTimezone, error.message);
        }
    }

    /**
     * Prepare data for AI analysis
     */
    prepareBriefingData(emailSummary, calendarSummary, todayFormatted, userTimezone) {
        let briefingData = `DATE: ${todayFormatted}\nTIMEZONE: ${userTimezone}\n\n`;

        // Email data
        if (emailSummary) {
            briefingData += `EMAIL DATA:\n`;
            briefingData += `- Unread emails: ${emailSummary.unreadCount}\n`;
            briefingData += `- Important emails: ${emailSummary.importantCount}\n`;
            briefingData += `- VIP emails: ${emailSummary.vipCount}\n`;

            if (emailSummary.importantEmails && emailSummary.importantEmails.length > 0) {
                briefingData += `\nIMPORTANT EMAIL SUBJECTS:\n`;
                emailSummary.importantEmails.slice(0, 5).forEach((email, index) => {
                    briefingData += `${index + 1}. ${email.subject} (from: ${email.from}) - Thread: ${email.threadLink || "N/A"}\n`;
                });
            }

            if (emailSummary.vipEmails && emailSummary.vipEmails.length > 0) {
                briefingData += `\nVIP EMAIL SUBJECTS:\n`;
                emailSummary.vipEmails.slice(0, 5).forEach((email, index) => {
                    briefingData += `${index + 1}. ${email.subject} (from: ${email.from}) - Thread: ${email.threadLink || "N/A"}\n`;
                });
            }
        } else {
            briefingData += `EMAIL DATA: Not available (connection issue)\n`;
        }

        briefingData += `\n`;

        // Calendar data
        if (calendarSummary) {
            briefingData += `CALENDAR DATA:\n`;
            briefingData += `- Today's events: ${calendarSummary.todaysEventCount}\n`;
            briefingData += `- Upcoming events: ${calendarSummary.upcomingEventCount}\n`;

            if (calendarSummary.todaysEvents && calendarSummary.todaysEvents.length > 0) {
                briefingData += `\nTODAY'S EVENTS:\n`;
                calendarSummary.todaysEvents.forEach((event, index) => {
                    const startTime = event.start?.dateTime
                        ? new Date(event.start.dateTime).toLocaleTimeString()
                        : "All day";
                    briefingData += `${index + 1}. ${event.summary} at ${startTime}\n`;
                });
            }
        } else {
            briefingData += `CALENDAR DATA: Not available (connection issue)\n`;
        }

        return briefingData;
    }

    /**
     * Generate basic daily brief (fallback)
     */
    generateBasicBrief(todayFormatted, userTimezone, errorMessage = null) {
        console.log("📄 [BRIEF-GENERATOR] Generating basic fallback brief...");

        let brief = `🍑 *Daily Brief - ${todayFormatted}*\n\n`;
        
        if (errorMessage) {
            brief += `⚠️ *Notice: Limited functionality due to: ${errorMessage}*\n\n`;
        }

        brief += `📧 *Email Brief:*\n`;
        brief += `• Unable to access Gmail data at this time\n`;
        brief += `• Please check your email manually\n\n`;

        brief += `📅 *Calendar Brief:*\n`;
        brief += `• Unable to access Calendar data at this time\n`;
        brief += `• Please check your calendar manually\n\n`;

        brief += `💡 *Generated at ${DateTime.now().setZone(userTimezone).toFormat("h:mm a")} ${userTimezone}*`;
        
        return brief;
    }

    /**
     * Add delay between operations
     */
    async delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Retry operation with exponential backoff
     */
    async retryOperation(operation, throwOnFailure = true, maxRetries = 3, baseDelay = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation();
                if (attempt > 1) {
                    console.log(`✅ [BRIEF-GENERATOR] Operation succeeded on attempt ${attempt}`);
                }
                return result;
            } catch (error) {
                console.log(`❌ [BRIEF-GENERATOR] Attempt ${attempt}/${maxRetries} failed:`, error.message);

                if (attempt === maxRetries) {
                    if (throwOnFailure) {
                        throw error;
                    } else {
                        console.log(`⚠️ [BRIEF-GENERATOR] All ${maxRetries} attempts failed, returning empty array`);
                        return [];
                    }
                }

                // Exponential backoff
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.log(`⏳ [BRIEF-GENERATOR] Waiting ${delay}ms before retry...`);
                await this.delay(delay);
            }
        }
    }

    /**
     * Clean up expired cache entries
     */
    cleanupCache() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, data] of this.briefCache.entries()) {
            if (now - data.timestamp > this.CACHE_DURATION) {
                this.briefCache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 [BRIEF-GENERATOR] Cleaned up ${cleaned} expired cache entries`);
        }
    }
}

module.exports = {
    DailyBriefGenerator
};