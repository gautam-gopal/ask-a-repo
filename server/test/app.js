import { createApp } from "../src/app.js";

// The real app wiring (helmet, limits, logging, routers); only the DB connection is absent.
export const makeApp = (opts) => createApp(opts);
