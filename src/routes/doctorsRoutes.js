import { Router } from "express";
import DoctorController from "../controllers/doctorSearch/doctorSearchController.js";
import RateMDsController from "../controllers/doctorSearch/rateMDControler.js";
import DoctorReportController from "../controllers/doctorSearch/doctorsReportController.js";
import DoctorSpecialityController from "../controllers/doctorSearch/doctorSpeciality.js";


export const doctorsRoutes = Router();

// RealSelf route
doctorsRoutes.get("/realself-search", DoctorController.search);
// RateMDs route
doctorsRoutes.get("/ratemds-search", RateMDsController.search);

doctorsRoutes.get('/ratemds/report/:slug', DoctorReportController.getRateMdDoctorReport);
doctorsRoutes.get('/realself/report/:id', DoctorReportController.getRealSelfDoctorReport);

doctorsRoutes.get('/get-ratemd-doctor-specialty', DoctorSpecialityController.getRateMDSpeciality);