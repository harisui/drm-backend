import { Router } from "express";
import DoctorController from "../controllers/doctorSearch/doctorSearchController.js";
import RateMDsController from "../controllers/doctorSearch/rateMDControler.js";
import DoctorReportController from "../controllers/doctorSearch/doctorsReportController.js";
import DoctorSpecialityController from "../controllers/doctorSearch/doctorSpeciality.js";
import IWantGreatCareController from "../controllers/doctorSearch/IWantGreatCareController.js";


export const doctorsRoutes = Router();

// RealSelf route
doctorsRoutes.get("/realself-search", DoctorController.search);
// RateMDs route
doctorsRoutes.get("/ratemds-search", RateMDsController.search);
// I want great care search route
doctorsRoutes.get('/iwgc-search', IWantGreatCareController.search);

doctorsRoutes.get('/ratemds/report/:slug', DoctorReportController.getRateMdDoctorReport);
doctorsRoutes.get('/realself/report/:id', DoctorReportController.getRealSelfDoctorReport);
doctorsRoutes.get('/iwgc/report/:iwgc_slug', DoctorReportController.getIWGCReport);

// other doctors in report API
doctorsRoutes.get('/get-ratemd-doctor-specialty', DoctorSpecialityController.getRateMDSpeciality);