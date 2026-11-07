import {
  getLaunchTargetMs,
  isLaunchWindowOpen,
  isValidServerTimestamp,
  PARTSWALA_LAUNCH_UTC,
} from "../shared/preLaunch.js";

export function registerPublicSettingsRoute(app, getDb, now = Date.now) {
  app.get("/api/settings/public", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const currentTime = now();
      if (!isValidServerTimestamp(currentTime)) {
        console.error("Trusted server time is unavailable for public launch status.");
        return response.status(503).json({ message: "Public site availability could not be verified." });
      }
      const millisecondsUntilLaunch = Math.max(0, getLaunchTargetMs() - currentTime);
      return response.json({
        preLaunchEnabled: !isLaunchWindowOpen(currentTime),
        launchTime: PARTSWALA_LAUNCH_UTC,
        serverTimeUtc: new Date(currentTime).toISOString(),
        millisecondsUntilLaunch,
      });
    } catch (error) {
      console.error("Public site settings could not be loaded:", error?.code || "firestore_error");
      return response.status(500).json({ message: "Public site settings could not be loaded." });
    }
  });

  app.get("/api/settings/assistant/public", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    const currentTime = now();
    if (!isValidServerTimestamp(currentTime)) {
      console.error("Trusted server time is unavailable for public assistant settings.");
      return response.status(503).json({ message: "Public site availability could not be verified." });
    }
    if (!isLaunchWindowOpen(currentTime)) {
      return response.status(403).json({ message: "The PartsWalaIND marketplace is not open yet." });
    }
    try {
      const snapshot = await getDb().doc("settings/assistant").get();
      const settings = snapshot.exists ? snapshot.data() : {};
      return response.json({ enabled: settings.enabled !== false });
    } catch (error) {
      console.error("Public assistant settings could not be loaded:", error?.code || "firestore_error");
      return response.status(503).json({ message: "Public assistant settings could not be loaded." });
    }
  });
}
