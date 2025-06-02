import axios from 'axios';

const RealSelfController = {
    search: async (req, res) => {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        try {
            const pageSize = 20; //  maximum page size API limit
            let from = 0;
            let totalResults = 0;
            const allContents = [];

            do {
                const response = await axios.get(`https://search.realself.com/site_search`, {
                    params: {
                        query: encodeURIComponent(query),
                        type: 'provider',
                        size: pageSize,
                        from: from,
                        latlng: '31.5161,74.3075'
                    }
                });

                const data = response.data;

                if (!data?.contents || data.contents.length === 0) {
                    break;
                }

                // Filter only doctors
                const doctorContents = data.contents.filter(item => item.type === 'doctor');
                allContents.push(...doctorContents);

                // Update total from first response
                if (totalResults === 0) {
                    totalResults = data.total;
                }

                from += pageSize;

                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));

            } while (false);
            // while (from < totalResults);  replace with above when need to loop through the total results
            if (allContents.length === 0) {
                return res.status(404).json({ error: 'No results found' });
            }

            const formattedResults = allContents.map(item => ({
                id: item.id,
                type: item.type,
                name: item.title || '',
                specialty: item.specialty || null,
                rating: item.rating || 0,
                reviewCount: item.review_count || 0,
                city: item.city || '',
                state: item.state || '',
                imagePath: item.image_path ? `https://www.realself.com/${item.image_path}` : null,
                profileLink: `https://www.realself.com${item.uri}`
            }));

            return res.json({
                success: true,
                totalResults: formattedResults.length,
                results: formattedResults
            });

        } catch (error) {
            console.error('Error fetching data from RealSelf API:', error);
            return res.status(500).json({ 
                error: 'Failed to fetch data from RealSelf API',
                details: error.response?.data || error.message
            });
        }
    }
};

export default RealSelfController;
