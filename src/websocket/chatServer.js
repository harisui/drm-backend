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
          message: `Hello! I'm here to help you learn about ${params._nme}. Feel free to ask me anything about their practice, specialization, location, or patient reviews.`,
        },
      });
    } catch (error) {
      console.error("Error initializing chat:", error);
      this.sendError(ws, "Failed to initialize chat");
    }
  }

  async handleChatMessage(ws, { message, conversationHistory = [] }) {
    try {
      if (!ws.doctorInfo) {
        this.sendError(ws, "Chat not initialized. Please refresh the page.");
        return;
      }

      const { params, report } = ws.doctorInfo;

      this.sendMessage(ws, {
        type: "BOT_TYPING",
        payload: { isTyping: true },
      });

      // Create context for GPT
      const doctorContext = this.createDoctorContext(params, report);

      // Prepare messages for GPT
      const messages = [
        {
          role: "system",
          content: `You are a helpful assistant providing information about Dr. ${params._nme}. Here's the doctor's information:

${doctorContext}

Please provide accurate, helpful responses based on this information. Keep responses conversational and informative. If asked about something not in the provided data, politely mention that you don't have that specific information but offer related details you do have.`,
        },
        ...conversationHistory.slice(-10), // Keep last 10 messages for context
        {
          role: "user",
          content: message,
        },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: messages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const botResponse = completion.choices[0].message.content;

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
          message:
            "I apologize, but I'm having trouble processing your request right now. Please try again.",
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  createDoctorContext(params, report) {
    const context = `
Doctor Name: ${params._nme}
Specialization: ${params._spt.replace(/-/g, " ")}
Location: ${params._ct}, ${params._st}
Average Rating: ${params._rt}/5
Total Reviews: ${report.totalReviews}

Recent Positive Comments:
${
  report.positiveComments?.first
    ? `- "${report.positiveComments.first.comment}" (${report.positiveComments.first.date})`
    : "No recent comments available"
}
${
  report.positiveComments?.second
    ? `- "${report.positiveComments.second.comment}" (${report.positiveComments.second.date})`
    : ""
}

${
  report.negativeComment
    ? `Recent Negative Comment: "${report.negativeComment.comment}" (${report.negativeComment.date})`
    : "No recent negative comments"
}

Key Insights:
${
  report.insights
    ?.map((insight, index) => `${index + 1}. ${insight}`)
    .join("\n") || "No insights available"
}

Professional Summary:
${report.summary}

Yearly Review Data:
${
  report.yearlyData
    ?.map(
      (year) =>
        `${year.year}: ${year.positive} positive, ${year.negative} negative (${year.total} total)`
    )
    .join("\n") || "No yearly data available"
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
