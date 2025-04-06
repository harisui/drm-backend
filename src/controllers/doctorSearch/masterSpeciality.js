import DoctorSpecialityController from "./doctorSpeciality.js";
import IWantGreatCareController from "./IWantGreatCareController.js";
import RealSelfController from "./doctorSearchController.js";
import { APIS_BUNDLER } from "../../config/constants.js";
import redisClient from './redisClient.js';

export const masterSpeciality = async (req, res) => {
    const { source, speciality } = req.query; // Extract source and specialty from query parameters

    if (!source) {
        return res.status(400).json({ success: false, message: "Source query parameter is required" });
    }

    if (!speciality) {
        return res.status(400).json({ success: false, message: "Specialty query parameter is required" });
    }

    // Middleware to handle internal calls to controllers
    const handleInternalResponse = async (controller, req) => {
        return new Promise((resolve, reject) => {
            const resMock = {
                status: (code) => ({
                    json: (data) => resolve({ status: code, data })
                }),
                json: (data) => resolve({ status: 200, data }) // Default status is 200 if not set
            };

            controller(req, resMock).catch((err) => reject(err));
        });
    };

    try {
        const requestedSource = Object.values(APIS_BUNDLER).find(api => api.identifier === source);

        if (!requestedSource) {
            return res.status(400).json({ success: false, message: "Invalid source specified in query" });
        }

        if (!requestedSource.active) {
            return res.status(400).json({ success: false, message: `${source} is currently inactive` });
        }

        // Step 1: Generate Redis Key
        const cacheKey = JSON.stringify({ source, speciality }); // Use source and speciality as key
        const cachedData = await redisClient.get(cacheKey);

        // Step 2: Serve from Redis cache if available
        if (cachedData) {
            console.log("Cache hit: Returning data from Redis");
            const { results } = JSON.parse(cachedData); // Parse cached data
            return res.status(200).json({ success: true, source, results });
        }

        // Step 3: No cache hit, proceed to retrieve from the source
        let specialityResponse;

        // Check the source and call the respective controller
        switch (source) {
            case "rms": // RateMDs
                specialityResponse = await handleInternalResponse(
                    DoctorSpecialityController.getRateMDSpeciality,
                    { query: { specialty_name: speciality } }
                );
                break;

            case "rs": // RealSelf
                specialityResponse = await handleInternalResponse(
                    RealSelfController.search,
                    { query: { query: speciality } }
                );
                break;

            case "iwgc": // IWantGreatCare
                specialityResponse = await handleInternalResponse(
                    IWantGreatCareController.search,
                    { query: { query: speciality } }
                );
                break;

            default:
                return res.status(400).json({ success: false, message: "Invalid source specified" });
        }

        // Step 4: Handle success or failure from the internal controllers
        if (specialityResponse && specialityResponse.status === 200 && specialityResponse.data?.success) {
            const results = specialityResponse.data.results || [];

            // Step 5: Cache the results in Redis for future queries
            const cachePayload = JSON.stringify({ results });
            await redisClient.set(cacheKey, cachePayload, { EX: 3600 }); // Cache for 1 hour

            console.log("Returning fetched data and caching the result");
            // Return response
            return res.status(200).json({
                success: true,
                source,
                results,
            });
        } else {
            // Handle failure
            return res.status(404).json({
                success: false,
                message: specialityResponse?.data?.error || "Failed to fetch specialty",
            });
        }
    } catch (err) {
        console.error("Error in masterSpeciality:", err.message);
        return res.status(500).json({ success: false, message: "Server error. Please try again later." });
    }
};
