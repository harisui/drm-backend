import 'dotenv/config';
import axios from 'axios';
import OpenAI from 'openai';

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
      const allReviews = [];

      do {
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
        
      } while (currentPage++ < totalPages);

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
  }
};

export default DoctorReportController;