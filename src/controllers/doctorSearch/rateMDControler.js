import axios from 'axios';

const RateMDsController = {
    search: async (req, res) => {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        try {
            let currentPage = 1;
            let totalPages = 1;
            let maxPages = 2;
            const allResults = [];

            do {
                const url = `https://www.ratemds.com/best-doctors/?json=true&text=${encodeURIComponent(query)}&page=${currentPage}`;
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                });

                const data = response.data;

                // Break loop if no results
                if (!data?.results?.length) break;

                // Add results to array
                allResults.push(...data.results);

                // Update total pages from first response
                if (currentPage === 1) {
                    totalPages = Math.min(data.total_pages || 1, maxPages );
                }

            } while (currentPage++ < totalPages);

            if (allResults.length === 0) {
                return res.status(404).json({ error: 'No doctors found' });
            }

            // Format results
            const formattedResults = allResults.map(doctor => ({
                id: doctor.id,
                name: doctor.full_name,
                specialty: doctor.specialty_name,
                specialty_url: doctor.specialty,
                rating: doctor.rating?.average || 0,
                reviewCount: doctor.rating?.count || 0,
                city: doctor.location?.city?.name || 'Unknown',
                state: doctor.location?.city?.province_name || 'Unknown',
                imagePath: doctor.images?.['100x100'] || null,
                profileLink: doctor.url,
                slug: doctor.slug
            }));

            return res.json({
                success: true,
                totalResults: formattedResults.length,
                results: formattedResults
            });

        } catch (error) {
            console.error('Error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch data from RateMDs' });
        }
    }
};

export default RateMDsController;