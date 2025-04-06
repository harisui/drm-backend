import DoctorReportController from "./doctorsReportController.js";
import { APIS_BUNDLER } from "../../config/constants.js";
import redisClient from './redisClient.js';

// Master report generation function
export const masterReport = async (req, res) => {
    const { source, identifier } = req.query; // Extract from query params

    if (!source) {
        return res.status(400).json({ success: false, message: "Source query parameter is required" });
    }

    if (!identifier) {
        return res.status(400).json({ success: false, message: "Identifier query parameter is required" });
    }

    // Middleware to capture responses from internal controllers
    const handleInternalResponse = async (controller, req) => {
        return new Promise((resolve, reject) => {
            const resMock = {
                status: (code) => ({
                    json: (data) => resolve({ status: code, data }),
                }),
                json: (data) => resolve({ status: 200, data }), // Default to 200 if no status is used
            };

            controller(req, resMock).catch((err) => reject(err));
        });
    };

    try {
        const requestedSource = Object.values(APIS_BUNDLER).find((api) => api.identifier === source);
        if (!requestedSource) {
            return res.status(400).json({ success: false, message: "Invalid source specified" });
        }

        if (!requestedSource.active) {
            return res.status(400).json({ success: false, message: `${source} is currently inactive` });
        }

        // Step 1: Generate Redis Key
        const cacheKey = JSON.stringify({ source, identifier }); // Cache key based on source and identifier
        const cachedData = await redisClient.get(cacheKey);

        // Step 2: Serve from Redis cache if available
        if (cachedData) {
            console.log("Cache hit: Returning data from Redis");
            const  report  = JSON.parse(cachedData); // Parse cached data
            return res.status(200).json({ success: true, source, ...report });
        }

        // Step 3: No cache hit, proceed to retrieve from the source
        let reportResponse;

        // Handle report generation based on the source
        switch (source) {
            case "rms": // RateMDs
                reportResponse = await handleInternalResponse(
                    DoctorReportController.getRateMdDoctorReport,
                    { params: { slug: identifier } }
                );
                break;

            case "rs": // RealSelf
                reportResponse = await handleInternalResponse(
                    DoctorReportController.getRealSelfDoctorReport,
                    { params: { id: identifier } }
                );
                break;

            case "iwgc": // IWantGreatCare
                reportResponse = await handleInternalResponse(
                    DoctorReportController.getIWGCReport,
                    { params: { iwgc_slug: identifier } }
                );
                break;

            default:
                return res.status(400).json({ success: false, message: "Invalid source" });
        }

        // Step 4: Handle success or failure from the internal controllers
        if (reportResponse && reportResponse.status === 200 && reportResponse.data?.success) {
            const report = reportResponse.data;

            // Step 5: Cache the report in Redis for future queries
            const cachePayload = JSON.stringify({ ...report });
            await redisClient.set(cacheKey, cachePayload, { EX: 3600 }); // Cache for 1 hour

            console.log("Returning fetched report and caching the result");
            // Return response
            return res.status(200).json({
                success: true,
                source,
                ...report,
            });
        } else {
            // Handle failure
            return res.status(reportResponse.status || 500).json({
                success: false,
                message: reportResponse?.data?.error || "Failed to generate report",
            });
        }
    } catch (err) {
        console.error("Error in masterReport:", err.message);
        res.status(500).json({ success: false, message: "Server error. Please try again later." });
    }
};
