// gmail-calendar-client.js
const axios = require("axios");

class GoogleAPIClient {
    constructor() {
        this.mainProjectUrl = process.env.MAIN_PROJECT_URL;
        
        if (!this.mainProjectUrl) {
            throw new Error("MAIN_PROJECT_URL is required in environment variables");
        }

        console.log("🔗 [GOOGLE-API-CLIENT] Initialized with main project URL:", this.mainProjectUrl);
    }

    /**
     * Get recent emails from Gmail
     */
    async getRecentEmails(userEmail, limit = 20, query = "") {
        console.log(`📧 [GOOGLE-API-CLIENT] Getting recent emails for ${userEmail}, limit: ${limit}, query: "${query}"`);

        try {
            const response = await axios.post(`${this.mainProjectUrl}/api/decrypt`, {
                email: userEmail,
                action: "gmail",
                subAction: "getRecentEmails",
                params: {
                    limit: limit,
                    query: query
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // 30 second timeout
            });

            if (response.data && response.data.success) {
                console.log(`✅ [GOOGLE-API-CLIENT] Retrieved ${response.data.emails?.length || 0} emails`);
                return response.data.emails || [];
            } else {
                console.error("❌ [GOOGLE-API-CLIENT] Gmail API call failed:", response.data);
                return [];
            }

        } catch (error) {
            console.error("❌ [GOOGLE-API-CLIENT] Error fetching emails:", {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Get inbox statistics
     */
    async getInboxStats(userEmail) {
        console.log(`📊 [GOOGLE-API-CLIENT] Getting inbox stats for ${userEmail}`);

        try {
            const response = await axios.post(`${this.mainProjectUrl}/api/decrypt`, {
                email: userEmail,
                action: "gmail",
                subAction: "getInboxStats",
                params: {}
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            if (response.data && response.data.success) {
                console.log(`✅ [GOOGLE-API-CLIENT] Retrieved inbox stats:`, response.data.stats);
                return response.data.stats || {};
            } else {
                console.error("❌ [GOOGLE-API-CLIENT] Inbox stats API call failed:", response.data);
                return {};
            }

        } catch (error) {
            console.error("❌ [GOOGLE-API-CLIENT] Error fetching inbox stats:", {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Get today's calendar events
     */
    async getTodaysEvents(userEmail) {
        console.log(`📅 [GOOGLE-API-CLIENT] Getting today's events for ${userEmail}`);

        try {
            const response = await axios.post(`${this.mainProjectUrl}/api/decrypt`, {
                email: userEmail,
                action: "calendar",
                subAction: "getTodaysEvents",
                params: {}
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            if (response.data && response.data.success) {
                console.log(`✅ [GOOGLE-API-CLIENT] Retrieved ${response.data.events?.length || 0} today's events`);
                return response.data.events || [];
            } else {
                console.error("❌ [GOOGLE-API-CLIENT] Today's events API call failed:", response.data);
                return [];
            }

        } catch (error) {
            console.error("❌ [GOOGLE-API-CLIENT] Error fetching today's events:", {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Get upcoming calendar events
     */
    async getUpcomingEvents(userEmail, limit = 10) {
        console.log(`📅 [GOOGLE-API-CLIENT] Getting upcoming events for ${userEmail}, limit: ${limit}`);

        try {
            const response = await axios.post(`${this.mainProjectUrl}/api/decrypt`, {
                email: userEmail,
                action: "calendar",
                subAction: "getUpcomingEvents",
                params: {
                    maxResults: limit
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            if (response.data && response.data.success) {
                console.log(`✅ [GOOGLE-API-CLIENT] Retrieved ${response.data.events?.length || 0} upcoming events`);
                return response.data.events || [];
            } else {
                console.error("❌ [GOOGLE-API-CLIENT] Upcoming events API call failed:", response.data);
                return [];
            }

        } catch (error) {
            console.error("❌ [GOOGLE-API-CLIENT] Error fetching upcoming events:", {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Get user's calendar availability
     */
    async getCalendarAvailability(userEmail, startDate, endDate) {
        console.log(`📅 [GOOGLE-API-CLIENT] Getting availability for ${userEmail} from ${startDate} to ${endDate}`);

        try {
            const response = await axios.post(`${this.mainProjectUrl}/api/decrypt`, {
                email: userEmail,
                action: "calendar",
                subAction: "getFreeBusy",
                params: {
                    timeMin: startDate,
                    timeMax: endDate
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            if (response.data && response.data.success) {
                console.log(`✅ [GOOGLE-API-CLIENT] Retrieved availability data`);
                return response.data.freeBusy || {};
            } else {
                console.error("❌ [GOOGLE-API-CLIENT] Availability API call failed:", response.data);
                return {};
            }

        } catch (error) {
            console.error("❌ [GOOGLE-API-CLIENT] Error fetching availability:", {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Test connection to main project API
     */
    async testConnection(testUserEmail) {
        console.log("🧪 [GOOGLE-API-CLIENT] Testing connection to main project API...");

        try {
            const response = await axios.post(`${this.mainProjectUrl}/api/health`, {
                test: true,
                from: "cron-scheduler"
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 10000, // 10 second timeout for health check
            });

            if (response.status === 200) {
                console.log("✅ [GOOGLE-API-CLIENT] Connection test successful:", response.data);
                return true;
            } else {
                console.error("❌ [GOOGLE-API-CLIENT] Connection test failed:", response.status, response.data);
                return false;
            }

        } catch (error) {
            console.error("❌ [GOOGLE-API-CLIENT] Connection test error:", {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            return false;
        }
    }

    /**
     * Validate user has Google account access
     */
    async validateUserAccess(userEmail) {
        console.log(`🔍 [GOOGLE-API-CLIENT] Validating access for ${userEmail}...`);

        try {
            // Try a simple Gmail call to validate access
            const response = await axios.post(`${this.mainProjectUrl}/api/decrypt`, {
                email: userEmail,
                action: "gmail",
                subAction: "getInboxStats",
                params: {}
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 15000, // 15 second timeout
            });

            if (response.data && response.data.success) {
                console.log(`✅ [GOOGLE-API-CLIENT] User ${userEmail} has valid access`);
                return true;
            } else {
                console.log(`❌ [GOOGLE-API-CLIENT] User ${userEmail} does not have valid access:`, response.data);
                return false;
            }

        } catch (error) {
            console.log(`❌ [GOOGLE-API-CLIENT] Access validation failed for ${userEmail}:`, error.message);
            return false;
        }
    }
}

module.exports = {
    GoogleAPIClient
};