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
          message: `Hello! I'm here to help you learn about Dr. ${params._nme}. I can only provide information about their practice, specialization, location, ratings, and patient reviews. Please ask me questions specifically about this doctor.`,
        },
      });
    } catch (error) {
      console.error("Error initializing chat:", error);
      this.sendError(ws, "Failed to initialize chat");
    }
  }

  // Validate if the user's message is doctor-related
  isDoctorRelatedQuery(message, doctorName) {
    const lowerMessage = message.toLowerCase();
    const lowerDoctorName = doctorName.toLowerCase();
    
    // Doctor-related keywords
    const doctorKeywords = [
      'doctor', 'dr', 'physician', 'medical', 'practice', 'clinic', 'hospital',
      'patient', 'review', 'rating', 'appointment', 'treatment', 'specialization',
      'specialty', 'location', 'address', 'phone', 'contact', 'experience',
      'qualification', 'education', 'board certified', 'insurance', 'available',
      'schedule', 'hours', 'consultation', 'visit', 'care', 'health', 'medicine',
      'expertise', 'background', 'credentials', 'years', 'trained', 'residency'
    ];

    // Off-topic keywords that should be rejected
    const offTopicKeywords = [
      'weather', 'politics', 'sports', 'movies', 'music', 'food', 'travel',
      'technology', 'programming', 'coding', 'recipe', 'joke', 'story',
      'history', 'science', 'math', 'literature', 'art', 'philosophy',
      'religion', 'cryptocurrency', 'stock', 'investment', 'game', 'entertainment',
      'celebrity', 'news', 'current events', 'fashion', 'shopping', 'car',
      'real estate', 'business', 'marketing', 'social media'
    ];

    // Check if message contains doctor's name
    const containsDoctorName = lowerMessage.includes(lowerDoctorName) || 
                               lowerMessage.includes(lowerDoctorName.split(' ')[0]) ||
                               lowerMessage.includes('this doctor') ||
                               lowerMessage.includes('the doctor') ||
                               lowerMessage.includes('he') ||
                               lowerMessage.includes('she') ||
                               lowerMessage.includes('they') ||
                               lowerMessage.includes('them');

    // Check for doctor-related keywords
    const containsDoctorKeywords = doctorKeywords.some(keyword => 
      lowerMessage.includes(keyword)
    );

    // Check for off-topic keywords
    const containsOffTopicKeywords = offTopicKeywords.some(keyword => 
      lowerMessage.includes(keyword)
    );

    // Additional checks for common greetings and doctor context
    const isGreeting = /^(hi|hello|hey|good morning|good afternoon|good evening|greetings)$/i.test(lowerMessage.trim());
    const isSimpleQuestion = /^(who is|what is|tell me about|can you|do you|how|where|when|why)/i.test(lowerMessage.trim());

    // Return true if:
    // 1. It's a greeting (always allow)
    // 2. Contains doctor name or pronouns AND doctor keywords
    // 3. Contains doctor keywords but no off-topic keywords
    // 4. Is a simple question that could be about the doctor
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

      // Validate if the query is doctor-related
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

      // Create context for GPT
      const doctorContext = this.createDoctorContext(params, report);

      // Enhanced system prompt with strict instructions
      const systemPrompt = `You are a specialized assistant that ONLY provides information about Dr. ${params._nme}. 

STRICT RULES:
1. You can ONLY discuss information about Dr. ${params._nme} based on the provided data
2. If asked about anything not related to this specific doctor, politely redirect to doctor-related topics
3. Do NOT provide general medical advice or information about other doctors
4. Do NOT discuss topics unrelated to healthcare or this specific doctor
5. Do NOT make up or infer information not provided in the data
6. If you don't have specific information requested, say so clearly and offer related information you do have

Doctor Information:
${doctorContext}

Remember: You are here to help people learn about THIS SPECIFIC DOCTOR only. Stay strictly within this scope.`;

      // Prepare messages for GPT
      const messages = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...conversationHistory.slice(-8), // Keep last 8 messages for context
        {
          role: "user",
          content: message,
        },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: messages,
        max_tokens: 400,
        temperature: 0.3, // Lower temperature for more focused responses
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
      });

      let botResponse = completion.choices[0].message.content;

      // Additional validation of GPT response
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

  // Validate GPT response to ensure it's appropriate
  isResponseAppropriate(response, doctorName) {
    const lowerResponse = response.toLowerCase();
    const lowerDoctorName = doctorName.toLowerCase();

    // Check if response mentions the doctor or medical topics
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

    // Check for inappropriate content
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
    const context = `
Doctor Name: ${params._nme}
Specialization: ${params._spt.replace(/-/g, " ")}
Location: ${params._ct}, ${params._st}
Average Rating: ${params._rt}/5
Total Reviews: ${report.totalReviews || 'Not available'}

Recent Positive Comments:
${
  report.positiveComments?.first
    ? `- "${report.positiveComments.first.comment}" (${report.positiveComments.first.date})`
    : "No recent positive comments available"
}
${
  report.positiveComments?.second
    ? `- "${report.positiveComments.second.comment}" (${report.positiveComments.second.date})`
    : ""
}

${
  report.negativeComment
    ? `Recent Negative Comment: "${report.negativeComment.comment}" (${report.negativeComment.date})`
    : "No recent negative comments available"
}

Key Insights:
${
  report.insights && report.insights.length > 0
    ? report.insights.map((insight, index) => `${index + 1}. ${insight}`).join("\n")
    : "No specific insights available"
}

Professional Summary:
${report.summary || 'No summary available'}

Yearly Review Data:
${
  report.yearlyData && report.yearlyData.length > 0
    ? report.yearlyData.map(
        (year) =>
          `${year.year}: ${year.positive} positive, ${year.negative} negative (${year.total} total)`
      ).join("\n")
    : "No yearly review data available"
}
    `.trim();

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