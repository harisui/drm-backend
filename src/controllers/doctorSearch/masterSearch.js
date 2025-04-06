import RateMDsController from "./rateMDControler.js";
import RealSelfController from "./doctorSearchController.js";
import IWantGreatCareController from "./IWantGreatCareController.js";
import { APIS_BUNDLER } from "../../config/constants.js";
import redisClient from './redisClient.js';

// Master search function
export const masterSearch = async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ success: false, message: "Query parameter is required" });
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
        // Step 1: Check Redis for cached data for the given query
        const cachedData = await redisClient.get(query);
        if (cachedData) {
            console.log("Cache hit: Returning data from Redis");
            const { source, results } = JSON.parse(cachedData); // Parse cached data to retrieve source and results
            return res.status(200).json({ success: true, source, results });
        }

        // Step 2: No cached data found; proceed with API queue to fetch data
        let finalResults = [];
        let source = "";

        if (APIS_BUNDLER.RateMds.active) {
            try {
                const rateMDsResult = await handleInternalResponse(
                    RateMDsController.search,
                    { query: { query } }
                );

                if (rateMDsResult.data?.success && rateMDsResult.data.results?.length > 0) {
                    finalResults = rateMDsResult.data.results;
                    source = APIS_BUNDLER.RateMds.identifier; // Set source to RateMDs
                    console.log("Fetched from RateMDs");
                }
            } catch (err) {
                console.error("Error fetching from RateMDs:", err.message);
            }
        }

        if (finalResults.length === 0 && APIS_BUNDLER.RealSelf.active) {
            try {
                const realSelfResult = await handleInternalResponse(
                    RealSelfController.search,
                    { query: { query } }
                );

                if (realSelfResult.data?.success && realSelfResult.data.results?.length > 0) {
                    finalResults = realSelfResult.data.results;
                    source = APIS_BUNDLER.RealSelf.identifier; // Set source to RealSelf
                    console.log("Fetched from RealSelf");
                }
            } catch (err) {
                console.error("Error fetching from RealSelf:", err.message);
            }
        }

        if (finalResults.length === 0 && APIS_BUNDLER.IWGC.active) {
            try {
                const iwgcResult = await handleInternalResponse(
                    IWantGreatCareController.search,
                    { query: { query } }
                );

                if (iwgcResult.data?.success && iwgcResult.data.results?.length > 0) {
                    finalResults = iwgcResult.data.results;
                    source = APIS_BUNDLER.IWGC.identifier; // Set source to IWGC
                    console.log("Fetched from IWGC");
                }
            } catch (err) {
                console.error("Error fetching from IWGC:", err.message);
            }
        }

        // Step 3: If no results found, return 404
        if (finalResults.length === 0 || !source) {
            return res.status(404).json({ success: false, message: "No doctors found" });
        }

        // Step 4: Cache the results and the source in Redis with TTL (e.g., 1 hour = 3600 seconds)
        const cachePayload = JSON.stringify({ source, results: finalResults });
        await redisClient.set(query, cachePayload, { EX: 3600 });

        // Step 5: Return the results
        console.log("Returning fetched data and caching the result");
        return res.status(200).json({ success: true, source, results: finalResults });
    } catch (err) {
        console.error("Error in masterSearch:", err.message);
        return res.status(500).json({ success: false, message: "Server error. Please try again later." });
    }
};
