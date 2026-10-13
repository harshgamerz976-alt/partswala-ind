export function registerPublicSettingsRoute(app, getDb) {
  app.get("/api/settings/public", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const snapshot = await getDb().doc("settings/store").get();
      const settings = snapshot.exists ? snapshot.data() : {};
      return response.json({
        preLaunchEnabled: settings.preLaunchEnabled === true,
        comingSoonVideoUrl: typeof settings.comingSoonVideoUrl === "string" ? settings.comingSoonVideoUrl : "",
      });
    } catch (error) {
      console.error("Public site settings could not be loaded:", error?.code || "firestore_error");
      return response.status(500).json({ message: "Public site settings could not be loaded." });
    }
  });
}
