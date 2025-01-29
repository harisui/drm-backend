import axios from 'axios';

const DoctorController = {
    
    search: async (req, res) => {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        try {
            const response = await axios.get(`https://search.realself.com/site_search?query=${encodeURIComponent(query)}`);
            const results = response.data.contents;

            const formattedResults = results.map(doctor => ({
                id: doctor.id,
                name: doctor.title,
                specialty: doctor.specialty,
                rating: doctor.rating,
                reviewCount: doctor.review_count,
                city: doctor.city,
                state: doctor.state,
                imagePath: doctor.image_path ? `https://example.com/${doctor.image_path}` : null,
                profileLink: `https://realself.com${doctor.uri}`
            }));

            return res.json({ results: formattedResults });
        } catch (error) {
            console.error('Error fetching data from API:', error);
            return res.status(500).json({ error: 'Failed to fetch data from the API' });
        }
    }
};

export default DoctorController;