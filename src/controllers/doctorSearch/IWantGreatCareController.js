import axios from 'axios';
import * as cheerio from 'cheerio';

const IWantGreatCareController = {
    search: async (req, res) => {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        try {
            const baseUrl = 'https://www.iwantgreatcare.org/search';
            const params = new URLSearchParams({
                search: query,
                jsno: 'true'
            });

            const initialResponse = await axios.get(`${baseUrl}?${params}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ =cheerio.load(initialResponse.data);
            let doctors = extractDoctors($);

            const showAllLinks = [];
            $('a.show-all-btn-large').each((i, el) => {
                const href = $(el).attr('href');
                if (href) showAllLinks.push(href);
            });

            for (const path of showAllLinks) {
                const showAllUrl = new URL(path, baseUrl).href;
                const showAllResponse = await axios.get(showAllUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                const $showAll = cheerio.load(showAllResponse.data);
                doctors = doctors.concat(extractDoctors($showAll));
            }

            if (doctors.length === 0) {
                return res.status(404).json({ error: 'No doctors found' });
            }

            return res.json({
                success: true,
                totalResults: doctors.length,
                results: doctors
            });

        } catch (error) {
            console.error('Error:', error.message);
            return res.status(500).json({ error: 'Failed to fetch data from IWantGreatCare' });
        }
    }
};

function extractDoctors($) {
    const doctors = [];
    
    $('.row.entity.pale-green.clearfix').each((i, el) => {
        const $element = $(el);
        
        // Extract basic information
        const name = $element.find('.doc-text h5 a').text().trim();
        const profilePath = $element.find('.doc-text h5 a').attr('href');
        const specialties = $element.find('.specialties .green').text().trim();
        const hospital = $element.find('.locations a.green').text().trim();
        
        const rating = $element.find('.rating img[src*="icon-star-yellow-full"]').length;
        
        const reviewText = $element.find('.rating').contents()
            .filter((i, el) => el.type === 'text')
            .text()
            .trim();
        const reviewCount = parseInt(reviewText.match(/\d+/)?.[0] || 0, 10);

        const imagePath = $element.find('.doc-image img').attr('src');

        if (name.trim() !== '' && specialties.trim() !== '' && profilePath && reviewCount >= 2) {
            doctors.push({
                name,
                specialties: specialties.split(', '),
                hospital,
                rating,
                reviewCount,
                profileLink: `https://www.iwantgreatcare.org${profilePath}`,
                imagePath
            });
        }
    });

    return doctors;
}

export default IWantGreatCareController;