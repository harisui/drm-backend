import { WebSocketServer } from "ws";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class ChatWebSocketServer {
  constructor(server) {
    this.wss = new WebSocketServer({ server });
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on("connection", (ws) => {
      console.log("New client connected");

      ws.on("message", async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error("Error parsing message:", error);
          this.sendError(ws, "Invalid message format");
        }
      });

      ws.on("close", () => {
        console.log("Client disconnected");
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
      });
    });
  }

  async handleMessage(ws, data) {
    const { type, payload } = data;

    switch (type) {
      case "CHAT_MESSAGE":
        await this.handleChatMessage(ws, payload);
        break;
      case "INIT_CHAT":
        await this.initializeChat(ws, payload);
        break;
      default:
        this.sendError(ws, "Unknown message type");
    }
  }

  async initializeChat(ws, { params, report }) {
    try {
      // Store doctor info for this connection
      ws.doctorInfo = { params, report };

      this.sendMessage(ws, {
        type: "CHAT_INITIALIZED",
        payload: {
          message: `Hello! I'm here to help you learn about Dr. ${params._nme}. You can ask me about their specialization, location, ratings, patient reviews, or any other information I have available. What would you like to know?`,
        },
      });
    } catch (error) {
      console.error("Error initializing chat:", error);
      this.sendError(ws, "Sorry, there was an issue initializing the chat. Please refresh the page and try again.");
    }
  }

  isDoctorRelatedQuery(message, doctorName) {
    const lowerMessage = message.toLowerCase();
    const lowerDoctorName = doctorName.toLowerCase();

    const doctorKeywords = [
      'doctor', 'dr', 'physician', 'medical', 'practice', 'clinic', 'hospital',
      'patient', 'review', 'rating', 'appointment', 'treatment', 'specialization',
      'specialty', 'location', 'address', 'phone', 'contact', 'experience',
      'qualification', 'education', 'board certified', 'insurance', 'available',
      'schedule', 'hours', 'consultation', 'visit', 'care', 'health', 'medicine',
      'expertise', 'background', 'credentials', 'years', 'trained', 'residency'
    ];

    const offTopicKeywords = [
      'weather', 'politics', 'sports', 'movies', 'music', 'food', 'travel',
      'technology', 'programming', 'coding', 'recipe', 'joke', 'story',
      'history', 'science', 'math', 'literature', 'art', 'philosophy',
      'religion', 'cryptocurrency', 'stock', 'investment', 'game', 'entertainment',
      'celebrity', 'news', 'current events', 'fashion', 'shopping', 'car',
      'real estate', 'business', 'marketing', 'social media'
    ];

    const containsDoctorName = lowerMessage.includes(lowerDoctorName) || 
                               lowerMessage.includes(lowerDoctorName.split(' ')[0]) ||
                               lowerMessage.includes('this doctor') ||
                               lowerMessage.includes('the doctor') ||
                               lowerMessage.includes('he') ||
                               lowerMessage.includes('she') ||
                               lowerMessage.includes('they') ||
                               lowerMessage.includes('them');

    const containsDoctorKeywords = doctorKeywords.some(keyword => 
      lowerMessage.includes(keyword)
    );

    const containsOffTopicKeywords = offTopicKeywords.some(keyword => 
      lowerMessage.includes(keyword)
    );

    const isGreeting = /^(hi|hello|hey|good morning|good afternoon|good evening|greetings)$/i.test(lowerMessage.trim());
    const isSimpleQuestion = /^(who is|what is|tell me about|can you|do you|how|where|when|why)/i.test(lowerMessage.trim());

    return isGreeting || 
           (containsDoctorName && containsDoctorKeywords) ||
           (containsDoctorKeywords && !containsOffTopicKeywords) ||
           (isSimpleQuestion && !containsOffTopicKeywords);
  }

  async handleChatMessage(ws, { message, conversationHistory = [] }) {
    try {
      if (!ws.doctorInfo) {
        this.sendError(ws, "Chat not initialized. Please refresh the page.");
        return;
      }

      const { params, report } = ws.doctorInfo;

      if (!this.isDoctorRelatedQuery(message, params._nme)) {
        this.sendMessage(ws, {
          type: "BOT_RESPONSE",
          payload: {
            message: `I can only provide information about Dr. ${params._nme}. Please ask me questions about their practice, specialization, location, ratings, or patient reviews. I'm not able to discuss other topics.`,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      this.sendMessage(ws, {
        type: "BOT_TYPING",
        payload: { isTyping: true },
      });

      const doctorContext = this.createDoctorContext(params, report);

      const systemPrompt = `You are a specialized assistant that ONLY provides information about Dr. ${params._nme}. 

STRICT RULES:
1. You can ONLY discuss information about Dr. ${params._nme} based on the provided data
2. If asked about anything not related to this specific doctor, politely redirect to doctor-related topics
3. Do NOT provide general medical advice or information about other doctors
4. Do NOT discuss topics unrelated to healthcare or this specific doctor
5. Do NOT make up or infer information not provided in the data
6. If you don't have specific information requested, say so clearly and offer related information you do have
7. When possible, quote directly from patient reviews or use exact numbers from the data to support your answers

Doctor Information:
${doctorContext}

Remember: You are here to help people learn about THIS SPECIFIC DOCTOR only. Stay strictly within this scope.`;

      const messages = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...conversationHistory.slice(-8),
        {
          role: "user",
          content: message,
        },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: messages,
        max_tokens: 400,
        temperature: 0.3,
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
      });

      let botResponse = completion.choices[0].message.content;

      if (!this.isResponseAppropriate(botResponse, params._nme)) {
        botResponse = `I can only provide information about Dr. ${params._nme}. Please ask me about their practice, specialization, location, ratings, or patient reviews.`;
      }

      this.sendMessage(ws, {
        type: "BOT_RESPONSE",
        payload: {
          message: botResponse,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Error handling chat message:", error);
      this.sendMessage(ws, {
        type: "BOT_RESPONSE",
        payload: {
          message: `I apologize, but I'm having trouble processing your request. Please ask me about Dr. ${ws.doctorInfo?.params?._nme || 'the doctor'}'s practice, specialization, location, or reviews.`,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  isResponseAppropriate(response, doctorName) {
    const lowerResponse = response.toLowerCase();
    const lowerDoctorName = doctorName.toLowerCase();

    const mentionsDoctorOrMedical = lowerResponse.includes(lowerDoctorName) ||
                                   lowerResponse.includes('doctor') ||
                                   lowerResponse.includes('dr.') ||
                                   lowerResponse.includes('practice') ||
                                   lowerResponse.includes('medical') ||
                                   lowerResponse.includes('patient') ||
                                   lowerResponse.includes('review') ||
                                   lowerResponse.includes('rating') ||
                                   lowerResponse.includes('specialization') ||
                                   lowerResponse.includes('location') ||
                                   lowerResponse.includes('clinic') ||
                                   lowerResponse.includes('hospital');

    const inappropriateContent = [
      'recipe', 'weather', 'politics', 'sports', 'entertainment',
      'programming', 'coding', 'joke', 'story', 'music', 'movie',
      'travel', 'fashion', 'cryptocurrency', 'stock market'
    ];

    const hasInappropriateContent = inappropriateContent.some(topic => 
      lowerResponse.includes(topic)
    );

    return mentionsDoctorOrMedical && !hasInappropriateContent;
  }

  createDoctorContext(params, report) {
    let context = `# Doctor Information

- **Name:** Dr. ${params._nme}
- **Specialization:** ${params._spt.replace(/-/g, " ")}
- **Location:** ${params._ct}, ${params._st}
- **Average Rating:** ${params._rt}/5
- **Total Reviews:** ${report.totalReviews || 'Not available'}
`;

    if (report.originalApiResponse && report.originalApiResponse.length > 0) {
      const apiResponse = report.originalApiResponse[0];
      if (apiResponse.results && Array.isArray(apiResponse.results)) {
        const reviews = apiResponse.results;
        const totalReviewsInSample = reviews.length;

        // Calculate average ratings from available reviews
        const sumStaff = reviews.reduce((sum, review) => sum + (review.staff || 0), 0);
        const sumPunctuality = reviews.reduce((sum, review) => sum + (review.punctuality || 0), 0);
        const sumHelpfulness = reviews.reduce((sum, review) => sum + (review.helpfulness || 0), 0);
        const sumKnowledge = reviews.reduce((sum, review) => sum + (review.knowledge || 0), 0);
        const sumAverage = reviews.reduce((sum, review) => sum + (review.average || 0), 0);

        const avgStaff = totalReviewsInSample > 0 ? (sumStaff / totalReviewsInSample).toFixed(1) : 'N/A';
        const avgPunctuality = totalReviewsInSample > 0 ? (sumPunctuality / totalReviewsInSample).toFixed(1) : 'N/A';
        const avgHelpfulness = totalReviewsInSample > 0 ? (sumHelpfulness / totalReviewsInSample).toFixed(1) : 'N/A';
        const avgKnowledge = totalReviewsInSample > 0 ? (sumKnowledge / totalReviewsInSample).toFixed(1) : 'N/A';
        const avgOverall = totalReviewsInSample > 0 ? (sumAverage / totalReviewsInSample).toFixed(1) : 'N/A';

        context += `
# Average Ratings (based on ${totalReviewsInSample} reviews)
- Staff: ${avgStaff}/5
- Punctuality: ${avgPunctuality}/5
- Helpfulness: ${avgHelpfulness}/5
- Knowledge: ${avgKnowledge}/5
- Overall: ${avgOverall}/5
`;

        // Include a few recent reviews
        context += `
# Recent Patient Reviews (sample)
`;
        reviews.slice(0, 3).forEach((review, index) => {
          context += `
## Review ${index + 1}
- Date: ${review.created}
- Average Rating: ${review.average}/5
- Staff: ${review.staff}/5
- Punctuality: ${review.punctuality}/5
- Helpfulness: ${review.helpfulness}/5
- Knowledge: ${review.knowledge}/5
- Comment: "${review.comment}"
`;
        });
      }
    }

    // Include other parts like insights, summary, yearlyData if available
    if (report.insights && report.insights.length > 0) {
      context += `
# Key Insights
${report.insights.map((insight, index) => `- ${insight}`).join('\n')}
`;
    }

    if (report.summary) {
      context += `
# Professional Summary
${report.summary}
`;
    }

    if (report.yearlyData && report.yearlyData.length > 0) {
      context += `
# Yearly Review Data
${report.yearlyData.map(year => `- ${year.year}: ${year.positive} positive, ${year.negative} negative (${year.total} total)`).join('\n')}
`;
    }

    return context;
  }

  sendMessage(ws, data) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  sendError(ws, message) {
    this.sendMessage(ws, {
      type: "ERROR",
      payload: { message },
    });
  }
}

export default ChatWebSocketServer;