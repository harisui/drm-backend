import axios from 'axios';

const DoctorSpecialityController = {
    getRateMDSpeciality: async (req, res) => {
        const { specialty_name } = req.query;

        if (!specialty_name) {
            return res.status(400).json({ error: 'specialty_name query parameter is required' });
        }
        console.log("====specialty_name--====", specialty_name);
        try {
            const url = `https://www.ratemds.com/best-doctors/?json=true&specialty=${specialty_name}`;
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            // Assuming response.data is an array of doctor objects

            console.log("====response--====", response);
            
            const doctors = response.data.results;
            if (!doctors || !doctors.length) {
                return res.status(404).json({ error: 'No doctors found' });
            }

            // Format results
            const formattedResults = doctors.map(doctor => ({
                id: doctor.id,
                name: doctor.full_name,
                specialty: doctor.specialty_name,
                specialty_url: doctor.specialty,
                rating: doctor.rating?.average || 0,
                reviewCount: doctor.rating?.count || 0,
                city: doctor.location?.city?.name || 'Unknown',
                state: doctor.location?.city?.province_name || 'Unknown',
                country: doctor.location?.city?.country_name || 'Unknown',
                countrySlug: doctor.location?.city?.country_slug || 'Unknown',
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

export default DoctorSpecialityController;
