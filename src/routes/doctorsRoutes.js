import { Router } from "express";
import DoctorController from "../controllers/doctorSearch/doctorSearchController.js";
import RateMDsController from "../controllers/doctorSearch/rateMDControler.js";


export const doctorsRoutes = Router();

// RealSelf route
doctorsRoutes.get("/realself-search", DoctorController.search);
// RateMDs route
doctorsRoutes.get("/ratemds-search", RateMDsController.search);