import { Router } from "express";
import DoctorController from "../controllers/doctorSearch/doctorSearchController.js";

export const doctorsRoutes = Router();

doctorsRoutes.get("/search", DoctorController.search);


