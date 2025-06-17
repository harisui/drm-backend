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
          message: `Hello! I'm here to help you learn about ${params._nme}. You can ask about their specialization, ratings, patient reviews, or other available information. What would you like to know?`,
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
    const specialization = (doctorName.includes('Omidi') ? 'plastic surgery,cosmetic surgery,rhinoplasty,tummy tuck,eyelid surgery,facelift,liposuction,breast augmentation,breast lift,arm lift,mommy makeover' : 'surgery').split(',');

    const doctorKeywords = [
      'doctor', 'dr', lowerDoctorName, lowerDoctorName.split(' ')[0],
      'physician', 'surgeon', 'review', 'rating', 'patient', 'procedure',
      'specialization', 'experience', 'consultation', 'appointment', ...specialization
    ];

    const offTopicKeywords = [
      'weather', 'politics', 'sports', 'movies', 'music', 'food', 'travel',
      'technology', 'programming', 'recipe', 'joke', 'history', 'science'
    ];

    return doctorKeywords.some(keyword => lowerMessage.includes(keyword)) &&
           !offTopicKeywords.some(keyword => lowerMessage.includes(keyword));
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
            message: `I can only provide information about ${params._nme}. Please ask about their practice, specialization, ratings, or patient reviews.`,
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
      const isSummaryRequested = message.toLowerCase().includes('summar') || 
                               message.toLowerCase().includes('brief') ||
                               message.toLowerCase().includes('overview');

      const systemPrompt = `You are a specialized assistant providing information ONLY about ${params._nme} based on the provided data.

STRICT RULES:
1. ONLY discuss ${params._nme}'s information from the provided data
2. Redirect off-topic queries to doctor-related topics
3. Do NOT provide general medical advice or discuss other doctors
4. Use exact data (quotes, numbers) when available
5. For unavailable information, state clearly and offer related data
6. ${isSummaryRequested ? 'Provide a concise summary (max 100 words) unless specific details are requested' : 'Provide detailed information with specific examples and quotes'}
7. Include ratings and review counts accurately
8. List all available reviews when asked about patient feedback

Doctor Information:
${doctorContext}

Stay strictly within this scope.`;

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
        max_tokens: isSummaryRequested ? 150 : 600,
        temperature: 0.2,
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
      });

      let botResponse = completion.choices[0].message.content;

      if (!this.isResponseAppropriate(botResponse, params._nme)) {
        botResponse = `I can only provide information about ${params._nme}. Please ask about their practice, specialization, ratings, or patient reviews.`;
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
          message: `I apologize, but I'm having trouble processing your request. Please ask about ${ws.doctorInfo?.params?._nme || 'the doctor'}'s practice, specialization, or reviews.`,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  isResponseAppropriate(response, doctorName) {
    const lowerResponse = response.toLowerCase();
    const lowerDoctorName = doctorName.toLowerCase();
    return (lowerResponse.includes(lowerDoctorName) || 
            lowerResponse.includes('doctor') ||
            lowerResponse.includes('surgeon') ||
            lowerResponse.includes('surgery')) &&
           !['weather', 'politics', 'sports', 'movies'].some(topic => 
             lowerResponse.includes(topic));
  }

  createDoctorContext(params, report) {
    // Calculate accurate ratings from all reviews
    let allReviews = [];
    report.originalApiResponse.forEach(page => {
      if (page.results) {
        allReviews = [...allReviews, ...page.results];
      }
    });

    const totalReviews = allReviews.length;
    const sumAverage = allReviews.reduce((sum, review) => sum + (review.average || 0), 0);
    const sumStaff = allReviews.reduce((sum, review) => sum + (review.staff || 0), 0);
    const sumHelpfulness = allReviews.reduce((sum, review) => sum + (review.helpfulness || 0), 0);
    const sumKnowledge = allReviews.reduce((sum, review) => sum + (review.knowledge || 0), 0);

    const avgOverall = totalReviews > 0 ? (sumAverage / totalReviews).toFixed(1) : params._rt || 'N/A';
    const avgStaff = totalReviews > 0 ? (sumStaff / totalReviews).toFixed(1) : 'N/A';
    const avgHelpfulness = totalReviews > 0 ? (sumHelpfulness / totalReviews).toFixed(1) : 'N/A';
    const avgKnowledge = totalReviews > 0 ? (sumKnowledge / totalReviews).toFixed(1) : 'N/A';

    let context = `# Doctor Information

- **Name:** ${params._nme}
- **Specialization:** ${params._spt.replace(/-/g, ' ')}
- **Location:** ${params._ct}, ${params._st}
- **Average Rating:** ${avgOverall}/5
- **Total Reviews:** ${report.totalReviews || totalReviews}

# Average Ratings (based on ${totalReviews} reviews)
- Overall: ${avgOverall}/5
- Staff: ${avgStaff}/5
- Helpfulness: ${avgHelpfulness}/5
- Knowledge: ${avgKnowledge}/5
`;

    // Include all reviews
    context += `
# Patient Reviews
`;
    allReviews.forEach((review, index) => {
      context += `
## Review ${index + 1}
- Date: ${new Date(review.created).toLocaleDateString()}
- Average Rating: ${review.average}/5
- Staff: ${review.staff}/5
- Helpfulness: ${review.helpfulness}/5
- Knowledge: ${review.knowledge}/5
- Comment: "${review.comment.replace(/"/g, '\\"')}"
`;
    });

    // Include yearly data
    if (report.yearlyData && report.yearlyData.length > 0) {
      context += `
# Yearly Review Data
${report.yearlyData.map(year => `- ${year.year}: ${year.positive} positive, ${year.negative} negative (${year.total} total)`).join('\n')}
`;
    }

    // Include insights
    if (report.insights && report.insights.length > 0) {
      context += `
# Key Insights
${report.insights.map((insight, index) => `- ${insight}`).join('\n')}
`;
    }

    // Include summary
    if (report.summary) {
      context += `
# Professional Summary
${report.summary}
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