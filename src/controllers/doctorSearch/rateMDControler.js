import axios from 'axios';

const RateMDsController = {
    search: async (req, res) => {
        const { query, page = 1 } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        try {
            // Fetch data for the requested page
            const url = `https://www.ratemds.com/best-doctors/?json=true&text=${encodeURIComponent(query)}&page=${page}`;
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            const data = response.data;

            if (!data || !data.results || data.results.length === 0) {
                return res.status(404).json({ error: 'No doctors found' });
            }

            // Format the results
            const results = data.results.map(doctor => ({
                id: doctor.id,
                name: doctor.full_name,
                specialty: doctor.specialty_name,
                rating: doctor.rating?.average || 0,
                reviewCount: doctor.rating?.count || 0,
                city: doctor.location?.city?.name || 'Unknown',
                state: doctor.location?.city?.province_name || 'Unknown',
                imagePath: doctor.images?.['100x100'] || null,
                profileLink: doctor.url
            }));

            // Return pagination info along with results
            return res.json({
                success: true,
                currentPage: parseInt(page),
                totalPages: data.total_pages || 1,
                count: data.count || results.length,
                results
            });

        } catch (error) {
            console.error('Error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch data from RateMDs' });
        }
    }
};

export default RateMDsController;
