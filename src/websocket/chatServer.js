import { Server } from "socket.io";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class ChatWebSocketServer {
  constructor(server) {
    this.io = new Server(server, {
      path: process.env.SOCKET_IO_PATH || '/socket.io/',
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.io.on("connection", (socket) => {
      console.log("New client connected");

      socket.on("message", async (data) => {
        try {
          await this.handleMessage(socket, data);
        } catch (error) {
          console.error("Error handling message:", error);
          this.sendError(socket, "Invalid message format");
        }
      });

      socket.on("disconnect", () => {
        console.log("Client disconnected");
      });

      socket.on("error", (error) => {
        console.error("Socket.IO error:", error);
      });
    });
  }

  async handleMessage(socket, data) {
    const { type, payload } = data;

    switch (type) {
      case "CHAT_MESSAGE":
        await this.handleChatMessage(socket, payload);
        break;
      case "INIT_CHAT":
        await this.initializeChat(socket, payload);
        break;
      default:
        this.sendError(socket, "Unknown message type");
    }
  }

  async initializeChat(socket, { params, report }) {
    try {
      socket.doctorInfo = { params, report };

      this.sendMessage(socket, {
        type: "CHAT_INITIALIZED",
        payload: {
          message: `Hello! I'm here to answer any questions you have, about ${params._nme} or anything else. What's on your mind?`,
        },
      });
    } catch (error) {
      console.error("Error initializing chat:", error);
      this.sendError(socket, "Sorry, there was an issue initializing the chat. Please refresh the page and try again.");
    }
  }

  async handleChatMessage(socket, { message, conversationHistory = [] }) {
    try {
      if (!socket.doctorInfo) {
        this.sendError(socket, "Chat not initialized. Please refresh the page.");
        return;
      }

      const { params, report } = socket.doctorInfo;
      const followUpPrompt = 'Feel free to ask me anything else!';

      this.sendMessage(socket, {
        type: "BOT_TYPING",
        payload: { isTyping: true },
      });

      const doctorContext = this.createDoctorContext(params, report);
      const isSummaryRequested = message.toLowerCase().includes('summar') ||
          message.toLowerCase().includes('brief') ||
          message.toLowerCase().includes('overview');

      const systemPrompt = `You are a versatile assistant capable of answering any question on any topic. When the query relates to ${params._nme}, use the provided doctor information to give accurate details. For all other topics, use your general knowledge to provide helpful and accurate responses.

Doctor Information (use when relevant):
${doctorContext}

Provide concise answers (max 100 words) for summary requests, otherwise be detailed. Always aim to be helpful and engaging.`;

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

      if (!this.hasFollowUpPrompt(botResponse)) {
        botResponse += `\n\n${followUpPrompt}`;
      }

      this.sendMessage(socket, {
        type: "BOT_RESPONSE",
        payload: {
          message: botResponse,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Error handling chat message:", error);
      this.sendMessage(socket, {
        type: "BOT_RESPONSE",
        payload: {
          message: `I apologize, but I'm having trouble processing your request. Please try again or ask about something else.`,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  createDoctorContext(params, report) {
    let allReviews = [];
    if (report.originalApiResponse && Array.isArray(report.originalApiResponse)) {
      report.originalApiResponse.forEach(page => {
        if (page && page.results && Array.isArray(page.results)) {
          allReviews = [...allReviews, ...page.results];
        }
      });
    }

    const totalReviews = allReviews.length;
    const sumAverage = allReviews.reduce((sum, review) => sum + (review.average || 0), 0);
    const sumStaff = allReviews.reduce((sum, review) => sum + (review.staff || 0), 0);
    const sumHelpfulness = allReviews.reduce((sum, review) => sum + (review.helpfulness || 0), 0);
    const sumKnowledge = allReviews.reduce((sum, review) => sum + (review.knowledge || 0), 0);

    const avgOverall =
        totalReviews > 0
            ? parseFloat(((sumAverage / totalReviews) * 2).toFixed(1))
            : params._rt
                ? parseFloat((+params._rt * 2).toFixed(1))
                : 'N/A';

    const avgStaff = totalReviews > 0 ? (sumStaff / totalReviews).toFixed(1) : 'N/A';
    const avgHelpfulness = totalReviews > 0 ? (sumHelpfulness / totalReviews).toFixed(1) : 'N/A';
    const avgKnowledge = totalReviews > 0 ? (sumKnowledge / totalReviews).toFixed(1) : 'N/A';

    let context = `# Doctor Information

- **Name:** ${params._nme}
- **Specialization:** ${params._spt.replace(/-/g, ' ')}
- **Location:** ${params._ct}, ${params._st}
- **Average Rating:** ${avgOverall}/10
- **Total Reviews:** ${report.totalReviews || totalReviews}

# Average Ratings (based on ${totalReviews} reviews)
- Overall: ${avgOverall}/10
- Staff: ${avgStaff}/5
- Helpfulness: ${avgHelpfulness}/5
- Knowledge: ${avgKnowledge}/5
`;

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

    if (report.yearlyData && report.yearlyData.length > 0) {
      context += `
# Yearly Review Data
${report.yearlyData.map(year => `- ${year.year}: ${year.positive} positive, ${year.negative} negative (${year.total} total)`).join('\n')}
`;
    }

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

    return context;
  }

  sendMessage(socket, data) {
    socket.emit(data.type, data.payload);
  }

  sendError(socket, message) {
    socket.emit("ERROR", { message });
  }

  hasFollowUpPrompt(response) {
    const followUpPhrases = [
      'if you have any more questions',
      'if you have any questions',
      'if you need further information',
      'feel free to ask',
      'just type them here',
      'let me know if',
      'anything else you want to know',
      'can i help with',
      'can i assist',
      'still have questions',
      'want to know more',
      'need more info'
    ];
    const lowerResponse = response.toLowerCase();
    return followUpPhrases.some(phrase => lowerResponse.includes(phrase));
  }
}

export default ChatWebSocketServer;

// import { WebSocketServer } from "ws";
// import OpenAI from "openai";
// import dotenv from "dotenv";
//
// dotenv.config();
//
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });
//
// class ChatWebSocketServer {
//   constructor(server) {
//     this.wss = new WebSocketServer({ server });
//     this.setupWebSocket();
//   }
//
//   setupWebSocket() {
//     this.wss.on("connection", (ws) => {
//       console.log("New client connected");
//
//       ws.on("message", async (message) => {
//         try {
//           const data = JSON.parse(message);
//           await this.handleMessage(ws, data);
//         } catch (error) {
//           console.error("Error parsing message:", error);
//           this.sendError(ws, "Invalid message format");
//         }
//       });
//
//       ws.on("close", () => {
//         console.log("Client disconnected");
//       });
//
//       ws.on("error", (error) => {
//         console.error("WebSocket error:", error);
//       });
//     });
//   }
//
//   async handleMessage(ws, data) {
//     const { type, payload } = data;
//
//     switch (type) {
//       case "CHAT_MESSAGE":
//         await this.handleChatMessage(ws, payload);
//         break;
//       case "INIT_CHAT":
//         await this.initializeChat(ws, payload);
//         break;
//       default:
//         this.sendError(ws, "Unknown message type");
//     }
//   }
//
//   async initializeChat(ws, { params, report }) {
//     try {
//       // Store doctor info for this connection
//       ws.doctorInfo = { params, report };
//
//       this.sendMessage(ws, {
//         type: "CHAT_INITIALIZED",
//         payload: {
//           message: `Hello! I'm here to help you learn about ${params._nme}. You can ask about their specialization, ratings, patient reviews, or other available information. What would you like to know?`,
//         },
//       });
//     } catch (error) {
//       console.error("Error initializing chat:", error);
//       this.sendError(ws, "Sorry, there was an issue initializing the chat. Please refresh the page and try again.");
//     }
//   }
//
//   isDoctorRelatedQuery(message, doctorName) {
//     const lowerMessage = message.toLowerCase();
//     const lowerDoctorName = doctorName.toLowerCase();
//     const specialization = (doctorName.includes('Omidi') ? 'plastic surgery,cosmetic surgery,rhinoplasty,tummy tuck,eyelid surgery,facelift,liposuction,breast augmentation,breast lift,arm lift,mommy makeover' : 'surgery').split(',');
//
//     const doctorKeywords = [
//       'doctor', 'dr', lowerDoctorName, lowerDoctorName.split(' ')[0],
//       'physician', 'surgeon', 'review', 'rating', 'patient', 'procedure',
//       'specialization', 'experience', 'consultation', 'appointment', ...specialization,
//       'anything to note', 'what should i know', 'tell me about', 'important to know', 'summary', 'overview', 'anything else', 'key points', 'insights', 'notable', 'noteworthy'
//     ];
//
//     const offTopicKeywords = [
//       'weather', 'politics', 'sports', 'movies', 'music', 'food', 'travel',
//       'technology', 'programming', 'recipe', 'joke', 'history', 'science'
//     ];
//
//     return doctorKeywords.some(keyword => lowerMessage.includes(keyword)) &&
//            !offTopicKeywords.some(keyword => lowerMessage.includes(keyword));
//   }
//
//   async handleChatMessage(ws, { message, conversationHistory = [] }) {
//     try {
//       if (!ws.doctorInfo) {
//         this.sendError(ws, "Chat not initialized. Please refresh the page.");
//         return;
//       }
//
//       const { params, report } = ws.doctorInfo;
//       const followUpPrompt = 'If you still have any questions about the doctor, just type them here, and I will look for an answer for you!';
//
//       if (this.isGreeting(message)) {
//         this.sendMessage(ws, {
//           type: "BOT_RESPONSE",
//           payload: {
//             message: `Hello! I can provide information about ${params._nme}. Ask me about their practice, specialization, ratings, or patient reviews.`,
//             timestamp: new Date().toISOString(),
//           },
//         });
//         return;
//       }
//
//       // Check for engagement prompt
//       if (this.isEngagementPrompt(message)) {
//         this.sendMessage(ws, {
//           type: "BOT_RESPONSE",
//           payload: {
//             message: `I'm here to help! If you have any more questions about ${params._nme}, their practice, specialization, or patient reviews, just ask.`,
//             timestamp: new Date().toISOString(),
//           },
//         });
//         return;
//       }
//
//       // Check for "anything to note" query
//       if (this.isAnythingToNoteQuery(message)) {
//         await this.handleAnythingToNoteQuery(ws, params, report);
//         return;
//       }
//
//       if (!this.isDoctorRelatedQuery(message, params._nme)) {
//         this.sendMessage(ws, {
//           type: "BOT_RESPONSE",
//           payload: {
//             message: `I can only provide information about ${params._nme}. Please ask about their practice, specialization, ratings, or patient reviews.`,
//             timestamp: new Date().toISOString(),
//           },
//         });
//         return;
//       }
//
//       this.sendMessage(ws, {
//         type: "BOT_TYPING",
//         payload: { isTyping: true },
//       });
//
//       const doctorContext = this.createDoctorContext(params, report);
//       const isSummaryRequested = message.toLowerCase().includes('summar') ||
//                                message.toLowerCase().includes('brief') ||
//                                message.toLowerCase().includes('overview');
//
//       const systemPrompt = `You are a specialized assistant providing information ONLY about ${params._nme} based on the provided data.
//
// STRICT RULES:
// 1. ONLY discuss ${params._nme}'s information from the provided data
// 2. Redirect off-topic queries to doctor-related topics
// 3. Do NOT provide general medical advice or discuss other doctors
// 4. Use exact data (quotes, numbers) when available
// 5. For unavailable information, state clearly and offer related data
// 6. ${isSummaryRequested ? 'Provide a concise summary (max 100 words) unless specific details are requested' : 'Provide detailed information with specific examples and quotes'}
// 7. Include ratings and review counts accurately
// 8. List all available reviews when asked about patient feedback
//
// Doctor Information:
// ${doctorContext}
//
// Stay strictly within this scope.`;
//
//       const messages = [
//         {
//           role: "system",
//           content: systemPrompt,
//         },
//         ...conversationHistory.slice(-8),
//         {
//           role: "user",
//           content: message,
//         },
//       ];
//
//       const completion = await openai.chat.completions.create({
//         model: "gpt-3.5-turbo",
//         messages: messages,
//         max_tokens: isSummaryRequested ? 150 : 600,
//         temperature: 0.2,
//         presence_penalty: 0.1,
//         frequency_penalty: 0.1,
//       });
//
//       let botResponse = completion.choices[0].message.content;
//
//       if (!this.isResponseAppropriate(botResponse, params._nme)) {
//         botResponse = `I can only provide information about ${params._nme}. Please ask about their practice, specialization, ratings, or patient reviews.`;
//       } else {
//         // Append follow-up prompt for valid answers, only if not already present
//         if (!this.hasFollowUpPrompt(botResponse)) {
//           botResponse += `\n\n${followUpPrompt}`;
//         }
//       }
//
//       this.sendMessage(ws, {
//         type: "BOT_RESPONSE",
//         payload: {
//           message: botResponse,
//           timestamp: new Date().toISOString(),
//         },
//       });
//     } catch (error) {
//       console.error("Error handling chat message:", error);
//       this.sendMessage(ws, {
//         type: "BOT_RESPONSE",
//         payload: {
//           message: `I apologize, but I'm having trouble processing your request. Please ask about ${ws.doctorInfo?.params?._nme || 'the doctor'}'s practice, specialization, or reviews.`,
//           timestamp: new Date().toISOString(),
//         },
//       });
//     }
//   }
//
//   isResponseAppropriate(response, doctorName) {
//     const lowerResponse = response.toLowerCase();
//     const lowerDoctorName = doctorName.toLowerCase();
//     return (lowerResponse.includes(lowerDoctorName) ||
//             lowerResponse.includes('doctor') ||
//             lowerResponse.includes('surgeon') ||
//             lowerResponse.includes('surgery')) &&
//            !['weather', 'politics', 'sports', 'movies'].some(topic =>
//              lowerResponse.includes(topic));
//   }
//
//   createDoctorContext(params, report) {
//     // Calculate accurate ratings from all reviews
//     let allReviews = [];
//     if (report.originalApiResponse && Array.isArray(report.originalApiResponse)) {
//       report.originalApiResponse.forEach(page => {
//         if (page && page.results && Array.isArray(page.results)) {
//           allReviews = [...allReviews, ...page.results];
//         }
//       });
//     }
//
//     const totalReviews = allReviews.length;
//     const sumAverage = allReviews.reduce((sum, review) => sum + (review.average || 0), 0);
//     const sumStaff = allReviews.reduce((sum, review) => sum + (review.staff || 0), 0);
//     const sumHelpfulness = allReviews.reduce((sum, review) => sum + (review.helpfulness || 0), 0);
//     const sumKnowledge = allReviews.reduce((sum, review) => sum + (review.knowledge || 0), 0);
//
//     // Convert 5-star rating to 10-point scale (multiply by 2)
//     const avgOverall =
//       totalReviews > 0
//         ? parseFloat(((sumAverage / totalReviews) * 2).toFixed(1))
//         : params._rt
//         ? parseFloat((+params._rt * 2).toFixed(1))
//         : 'N/A';
//
//     const avgStaff = totalReviews > 0 ? (sumStaff / totalReviews).toFixed(1) : 'N/A';
//     const avgHelpfulness = totalReviews > 0 ? (sumHelpfulness / totalReviews).toFixed(1) : 'N/A';
//     const avgKnowledge = totalReviews > 0 ? (sumKnowledge / totalReviews).toFixed(1) : 'N/A';
//
//     let context = `# Doctor Information
//
// - **Name:** ${params._nme}
// - **Specialization:** ${params._spt.replace(/-/g, ' ')}
// - **Location:** ${params._ct}, ${params._st}
// - **Average Rating:** ${avgOverall}/10
// - **Total Reviews:** ${report.totalReviews || totalReviews}
//
// # Average Ratings (based on ${totalReviews} reviews)
// - Overall: ${avgOverall}/10
// - Staff: ${avgStaff}/5
// - Helpfulness: ${avgHelpfulness}/5
// - Knowledge: ${avgKnowledge}/5
// `;
//
//     // Include all reviews
//     context += `
// # Patient Reviews
// `;
//     allReviews.forEach((review, index) => {
//       context += `
// ## Review ${index + 1}
// - Date: ${new Date(review.created).toLocaleDateString()}
// - Average Rating: ${review.average}/5
// - Staff: ${review.staff}/5
// - Helpfulness: ${review.helpfulness}/5
// - Knowledge: ${review.knowledge}/5
// - Comment: "${review.comment.replace(/"/g, '\\"')}"
// `;
//     });
//
//     // Include yearly data
//     if (report.yearlyData && report.yearlyData.length > 0) {
//       context += `
// # Yearly Review Data
// ${report.yearlyData.map(year => `- ${year.year}: ${year.positive} positive, ${year.negative} negative (${year.total} total)`).join('\n')}
// `;
//     }
//
//     // Include insights
//     if (report.insights && report.insights.length > 0) {
//       context += `
// # Key Insights
// ${report.insights.map((insight, index) => `- ${insight}`).join('\n')}
// `;
//     }
//
//     // Include summary
//     if (report.summary) {
//       context += `
// # Professional Summary
// ${report.summary}
// `;
//     }
//
//     return context;
//   }
//
//   sendMessage(ws, data) {
//     if (ws.readyState === ws.OPEN) {
//       ws.send(JSON.stringify(data));
//     }
//   }
//
//   sendError(ws, message) {
//     this.sendMessage(ws, {
//       type: "ERROR",
//       payload: { message },
//     });
//   }
//
//   isEngagementPrompt(message) {
//     const engagementPhrases = [
//       'any questions',
//       'any other questions',
//       'if you have questions',
//       'let me know if',
//       'just type them here',
//       'anything else',
//       'need more info',
//       'want to know more',
//       'still have questions',
//       'feel free to ask',
//       'can i help with',
//       'can i assist',
//       'how can i help',
//       'how can i assist',
//     ];
//     const lowerMessage = message.toLowerCase();
//     return engagementPhrases.some(phrase => lowerMessage.includes(phrase));
//   }
//
//   isGreeting(message) {
//     const greetings = [
//       'hi', 'hello', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening',
//       'howdy', 'yo', 'hiya', 'sup', 'what\'s up', 'morning', 'evening', 'afternoon'
//     ];
//     const lowerMessage = message.trim().toLowerCase();
//
//     // Check if any greeting word is present as a whole word
//     return greetings.some(greet => new RegExp(`\\b${greet}\\b`).test(lowerMessage));
//   }
//
//   hasFollowUpPrompt(response) {
//     const followUpPhrases = [
//       'if you have any more questions',
//       'if you have any questions',
//       'if you need further information',
//       'feel free to ask',
//       'just type them here',
//       'let me know if',
//       'anything else you want to know',
//       'can i help with',
//       'can i assist',
//       'still have questions',
//       'want to know more',
//       'need more info'
//     ];
//     const lowerResponse = response.toLowerCase();
//     return followUpPhrases.some(phrase => lowerResponse.includes(phrase));
//   }
//
//   isAnythingToNoteQuery(message) {
//     const noteKeywords = [
//       'anything to note',
//       'anything to know',
//       'important to note',
//       'should i know',
//       'what should i know',
//       'anything notable',
//       'anything noteworthy',
//       'key points',
//       'important points',
//       'things to note',
//       'things to know',
//       'notable things',
//       'noteworthy things'
//     ];
//     const lowerMessage = message.toLowerCase();
//     return noteKeywords.some(keyword => lowerMessage.includes(keyword));
//   }
//
//   async handleAnythingToNoteQuery(ws, params, report) {
//     try {
//       this.sendMessage(ws, {
//         type: "BOT_TYPING",
//         payload: { isTyping: true },
//       });
//
//       // Calculate ratings and insights
//       let allReviews = [];
//       if (report.originalApiResponse && Array.isArray(report.originalApiResponse)) {
//         report.originalApiResponse.forEach(page => {
//           if (page && page.results && Array.isArray(page.results)) {
//             allReviews = [...allReviews, ...page.results];
//           }
//         });
//       }
//
//       const totalReviews = allReviews.length;
//       const sumAverage = allReviews.reduce((sum, review) => sum + (review.average || 0), 0);
//
//       // Convert 5-star rating to 10-point scale (multiply by 2)
//       const avgOverall = totalReviews > 0
//         ? parseFloat(((sumAverage / totalReviews) * 2).toFixed(1))
//         : params._rt
//         ? parseFloat((+params._rt * 2).toFixed(1))
//         : 'N/A';
//
//       // Analyze sentiment from reviews
//       const positiveReviews = allReviews.filter(review => review.average >= 4);
//       const negativeReviews = allReviews.filter(review => review.average <= 2);
//
//       let response = `Key Points About ${params._nme}\n\n`;
//
//       // Rating assessment
//       if (avgOverall !== 'N/A') {
//         if (avgOverall >= 9.0) {
//           response += `**Rating**: ${avgOverall}/10 - Excellent\n\n`;
//         } else if (avgOverall >= 8.0) {
//           response += `**Rating**: ${avgOverall}/10 - Good\n\n`;
//         } else if (avgOverall >= 6.0) {
//           response += `**Rating**: ${avgOverall}/10 - Average\n\n`;
//         } else {
//           response += `**Rating**: ${avgOverall}/10 - Below Average\n\n`;
//         }
//       }
//
//       // Key insights (behavior/personality)
//       if (report.insights && report.insights.length > 0) {
//         response += `**Key Points**:\n`;
//         // Take only the first 3 most important insights
//         const importantInsights = report.insights.slice(0, 3);
//         importantInsights.forEach(insight => {
//           response += `• ${insight}\n`;
//         });
//         response += `\n`;
//       }
//
//       // Overall assessment
//       response += `**Overall**: ${params._nme} is ${avgOverall >= 8.0 ? 'a well-regarded' : avgOverall >= 6.0 ? 'a moderately rated' : 'a lower-rated'} ${params._spt.replace(/-/g, ' ')} specialist. ${positiveReviews.length > negativeReviews.length ? 'Most patients report positive experiences.' : negativeReviews.length > positiveReviews.length ? 'Some patients have raised concerns.' : 'Patient experiences are mixed.'}`;
//
//       this.sendMessage(ws, {
//         type: "BOT_RESPONSE",
//         payload: {
//           message: response,
//           timestamp: new Date().toISOString(),
//         },
//       });
//     } catch (error) {
//       console.error("Error handling anything to note query:", error);
//       this.sendMessage(ws, {
//         type: "BOT_RESPONSE",
//         payload: {
//           message: `I apologize, but I'm having trouble analyzing the key points about ${params._nme}. Please try asking about their ratings or reviews instead.`,
//           timestamp: new Date().toISOString(),
//         },
//       });
//     }
//   }
// }
//
// export default ChatWebSocketServer;
