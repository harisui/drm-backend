import express from "express";
import cors from "cors";
import morgan from 'morgan';
import dotenv from "dotenv";
import { doctorsRoutes } from "./routes/doctorsRoutes.js";
dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

app.use("/api/doctors", doctorsRoutes)

app.get("/", (req, res) => {
  res.json({ message: "Test Route!" });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
