import express from "express";
import cors from "cors";
import morgan from 'morgan';
import dotenv from "dotenv";
import { createServer } from 'http';
import { doctorsRoutes } from "./routes/doctorsRoutes.js";
import ChatWebSocketServer from "./websocket/chatServer.js";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

app.use("/api/doctors", doctorsRoutes)

app.get("/", (req, res) => {
  res.json({ message: "Test Route!" });
});

const server = createServer(app);

new ChatWebSocketServer(server);

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`WebSocket server is running on ws://localhost:${PORT}`);
});