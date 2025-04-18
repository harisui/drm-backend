import 'dotenv/config';
import axios from 'axios';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const DoctorReportController = {
  getRateMdDoctorReport: async (req, res) => {
    const { slug } = req.params;

    try {
      // Fetch all paginated reviews
      let currentPage = 1;
      let totalPages = 1;
      let maximumPageLimit = 5;
      const allReviews = [];

      while (currentPage <= maximumPageLimit) {
        const reviewsResponse = await axios.get(
          `https://www.ratemds.com/doctor-ratings/${slug}/?json=true&page=${currentPage}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
          }
        );

        const data = reviewsResponse.data;
        allReviews.push(...data.results);
        totalPages = data.total_pages || 1;
        currentPage++;
      }
  
      // Process reviews
      const formattedReviews = allReviews.map(review => ({
        comment: review.comment,
        date: new Date(review.created).toLocaleDateString('en-US', { 
          month: 'long', 
          year: 'numeric' 
        })
      }));

      // Find top comments
      const positiveComments = allReviews
        .filter(r => r.average >= 4)
        .sort((a, b) => b.average - a.average)
        .slice(0, 2)
        .map(r => ({
          comment: r.comment,
          date: new Date(r.created).toLocaleDateString('en-US', { 
            month: 'long', 
            year: 'numeric' 
          })
        }));

      const negativeComments = allReviews
        .filter(r => r.average < 3)
        .sort((a, b) => a.average - b.average)
        .slice(0, 1)
        .map(r => ({
          comment: r.comment,
          date: new Date(r.created).toLocaleDateString('en-US', { 
            month: 'long', 
            year: 'numeric' 
          })
        }));

      // Prepare prompt for OpenAI
      const prompt = `Based on these doctor reviews:\n\n${formattedReviews.map(r => 
        `[${r.date}] ${r.comment}`
      ).join('\n')}\n\n
      Please format your response EXACTLY like this:
      
      KEY INSIGHTS:
      1. [First insight]
      2. [Second insight]
      3. [Third insight]
      
      PROFESSIONAL SUMMARY:
      [Summary text here]`;
  
      // Check token count
      const estimatedTokens = formattedReviews.reduce((sum, r) => sum + r.comment.split(' ').length, 0);
      if (estimatedTokens > 4096) {
        return res.status(400).json({ error: 'Token limit exceeded. Consider processing reviews in smaller batches.' });
      }
  
      // Generate AI response
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
          role: "user",
          content: prompt
        }],
        temperature: 0.7,
      });

      // Parse the structured response
      const responseText = aiResponse.choices[0].message.content;
      const sections = responseText.split('\n\n');
      
      const result = {
        positiveComments: {
          first: positiveComments[0] || null,
          second: positiveComments[1] || null
        },
        negativeComment: negativeComments[0] || null,
        insights: [],
        summary: ''
      };

      sections.forEach(section => {
        const lines = section.split('\n');
        const header = lines[0].trim();
        
        if (header === 'KEY INSIGHTS:') {
          result.insights = lines.slice(1, 4);
        } else if (header === 'PROFESSIONAL SUMMARY:') {
          result.summary = lines.slice(1).join(' ');
        }
      });

      return res.json({
        success: true,
        ...result
      });

    } catch (error) {
      console.error('Error:', error.message);
      return res.status(500).json({ error: 'Failed to generate report' });
    }
  },

  getRealSelfDoctorReport: async (req, res) => {
    const { id } = req.params;
    const MAX_LIMIT = 10; // API's maximum per request
    const MAX_TOTAL_REVIEWS = 150; // Hard cap for AI processing
    const MAX_COMMENT_LENGTH = 300; // Character limit for comments
    const MIN_RATING = 4; // For positive comments
    const MAX_RATING = 2; // For negative comments
  
    try {
      let offset = 1;
      const allReviews = [];
      let totalReviews;
  
      // Initial request to get first batch and total count
      const initialResponse = await axios.get(
        `https://api.realself.com/v1/rs-provider-profile/${id}/reviews`,
        { params: { offset: 1, limit: MAX_LIMIT } }
      );
  
      if (!initialResponse.data?.summary?.review_count || !initialResponse.data?.reviews) {
        throw new Error('Invalid API response structure');
      }
  
      totalReviews = parseInt(initialResponse.data.summary.review_count);
      allReviews.push(...initialResponse.data.reviews);
      offset += initialResponse.data.reviews.length;
  
      // Fetch remaining reviews in batches
      while (allReviews.length < totalReviews) {
        const response = await axios.get(
          `https://api.realself.com/v1/rs-provider-profile/${id}/reviews`,
          { params: { offset, limit: MAX_LIMIT } }
        );
  
        if (!response.data?.reviews || response.data.reviews.length === 0) break;
  
        allReviews.push(...response.data.reviews);
        offset += response.data.reviews.length;
      }
  
      // Process reviews for AI processing – including author and formatted date
      const processedReviews = allReviews
        .sort((a, b) => new Date(b.reviewDate) - new Date(a.reviewDate)) // Newest first
        .slice(0, MAX_TOTAL_REVIEWS) // Apply hard cap
        .map(review => ({
          author: review.user?.name || 'Anonymous',
          comment:
            review.body.length > MAX_COMMENT_LENGTH
              ? review.body.substring(0, MAX_COMMENT_LENGTH) + '...'
              : review.body,
          date: new Date(review.reviewDate).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric'
          }),
          rating: parseInt(review.rating) || 0,
          rawDate: review.reviewDate
        }));
  
      // Find highlights from all reviews with the updated data (author + date)
      const positiveComments = allReviews
        .filter(r => parseInt(r.rating) >= MIN_RATING)
        .sort((a, b) => parseInt(b.rating) - parseInt(a.rating))
        .slice(0, 2)
        .map(review => ({
          author: review.user?.name || 'Anonymous',
          comment:
            review.body.length > MAX_COMMENT_LENGTH
              ? review.body.substring(0, MAX_COMMENT_LENGTH) + '...'
              : review.body,
          date: new Date(review.reviewDate).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric'
          }),
          // rating: parseInt(review.rating) || 0
        }));
  
      const negativeComments = allReviews
        .filter(r => parseInt(r.rating) <= MAX_RATING)
        .sort((a, b) => parseInt(a.rating) - parseInt(b.rating))
        .slice(0, 1)
        .map(review => ({
          author: review.user?.name || 'Anonymous',
          comment:
            review.body.length > MAX_COMMENT_LENGTH
              ? review.body.substring(0, MAX_COMMENT_LENGTH) + '...'
              : review.body,
          date: new Date(review.reviewDate).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric'
          }),
          // rating: parseInt(review.rating) || 0
        }));
  
      // Build prompt with author and date for each review
      const prompt = `Analyze these ${processedReviews.length} recent patient reviews:\n\n${
        processedReviews
          .map(
            r =>
              `${r.date} · ${r.author}: ${r.comment} (${r.rating}/5)`
          )
          .join('\n')
      }\n\nIdentify key trends and format response EXACTLY like:\n\nKEY INSIGHTS:\n1. [Insight]\n2. [Insight]\n3. [Insight]\n\nPROFESSIONAL SUMMARY:\n[Summary]`;
  
      // OpenAI call with token limits
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
  
      // Parse AI response
      const responseText = aiResponse.choices[0].message.content;
      const sections = responseText.split('\n\n');
  
      const result = {
        positiveComments: {
          first: positiveComments[0] || null,
          second: positiveComments[1] || null
        },
        negativeComment: negativeComments[0] || null,
        insights: [],
        summary: ''
      };
  
      sections.forEach(section => {
        const lines = section.split('\n');
        const header = lines[0].trim();
        if (header === 'KEY INSIGHTS:') {
          result.insights = lines
            .slice(1, 4)
            .map(l => l.replace(/^\d+\.\s*/, ''));
        } else if (header === 'PROFESSIONAL SUMMARY:') {
          result.summary = lines.slice(1).join(' ').substring(0, MAX_COMMENT_LENGTH);
        }
      });
  
      return res.json({
        success: true,
        ...result,
        meta: {
          totalReviews: allReviews.length,
          processedReviews: processedReviews.length
        }
      });
    } catch (error) {
      console.error('RealSelf Error:', error.message);
      return res.status(500).json({
        error: 'Report generation failed',
        details: error.message.includes("token")
          ? "Try requesting fewer reviews"
          : undefined
      });
    }
  },

  getIWGCReport: async (req, res) => {
    
    const { iwgc_slug } = req.params;

    try {
        // Fetch up to 3 pages of reviews
        let currentPage = 1;
        const allReviews = [];
        const maxPages = 3;
        let locations = [];

        while (currentPage <= maxPages) {
            const url = `https://www.iwantgreatcare.org/doctors/${iwgc_slug}${currentPage > 1 ? `?page=${currentPage}` : ''}`;
            
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);

            // Extract locations only on first page
            if (currentPage === 1) {
              $('.list-entity-locations li a').each((i, el) => {
                  const fullLocation = $(el).text().trim();
                  locations.push(fullLocation);
              });
            }

            const pageReviews = [];

            $('.entity-review').each((i, el) => {
                const $review = $(el);
                
                // Extract rating
                const rating = $review.find('.review-average-container img[src*="icon-star-yellow-full"]').length;

                // Extract text
                const comment = $review.find('.review-text').text().trim().replace(/^\<br\>/gi, '');

                // Extract and format date
                const rawDate = $review.find('.review-date').text().trim();
                const date = new Date(rawDate.replace(/(\d+)(st|nd|rd|th)/, '$1')).toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric'
                });

                if (comment) {
                    pageReviews.push({
                        comment,
                        date,
                        rating
                    });
                }
            });

            if (pageReviews.length === 0) break;
            
            allReviews.push(...pageReviews);
            currentPage++;
        }

        // Process reviews
        const formattedReviews = allReviews.map(review => ({
            comment: review.comment,
            date: review.date,
            rating: review.rating
        }));

        // Find top comments
        const positiveReviews = allReviews
            .filter(r => r.rating >= 4)
            .sort((a, b) => b.rating - a.rating || new Date(b.date) - new Date(a.date));

        const negativeReviews = allReviews
            .filter(r => r.rating < 3)
            .sort((a, b) => a.rating - b.rating || new Date(a.date) - new Date(b.date));

        // Prepare prompt for OpenAI
        const prompt = `Based on these doctor reviews:\n\n${formattedReviews.map(r => 
            `[${r.date}] (${r.rating} stars) ${r.comment}`
        ).join('\n')}\n\n
        Please format your response EXACTLY like this:
        
        KEY INSIGHTS:
        1. [First insight]
        2. [Second insight]
        3. [Third insight]
        
        PROFESSIONAL SUMMARY:
        [Summary text here]`;

        // Generate AI response
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "user",
                content: prompt
            }],
            temperature: 0.7,
        });

        // Parse the structured response
        const responseText = aiResponse.choices[0].message.content;
        const sections = responseText.split('\n\n');
        
        const result = {
            positiveComments: {
                first: positiveReviews[0] || null,
                second: positiveReviews[1] || null
            },
            negativeComment: negativeReviews[0] || null,
            insights: [],
            summary: '',
            locations
        };

        sections.forEach(section => {
            const lines = section.split('\n');
            const header = lines[0].trim();
            
            if (header === 'KEY INSIGHTS:') {
                result.insights = lines.slice(1, 4);
            } else if (header === 'PROFESSIONAL SUMMARY:') {
                result.summary = lines.slice(1).join(' ');
            }
        });

        return res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('Error:', error.message);
        return res.status(500).json({ error: 'Failed to generate report' });
    }
  }
  
};

export default DoctorReportController;