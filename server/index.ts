import fs from "node:fs";
import path from "node:path";
import http from "node:http";

// Load .env (simple KEY=value lines) before anything reads process.env
const envFile = path.resolve(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const express = (await import("express")).default;
const cookieParser = (await import("cookie-parser")).default;
const { UPLOAD_DIR } = await import("./db.ts");
const { attachUser } = await import("./auth.ts");
const { errorHandler } = await import("./helpers.ts");
const { initRealtime } = await import("./realtime.ts");
const { startDiscordScheduler } = await import("./discord.ts");
const { authRoutes } = await import("./routes/auth.ts");
const { campaignRoutes } = await import("./routes/campaigns.ts");
const { characterRoutes } = await import("./routes/characters.ts");
const { mapRoutes } = await import("./routes/maps.ts");
const { compendiumRoutes } = await import("./routes/compendium.ts");
const { aiRoutes } = await import("./routes/ai.ts");
const { adventureRoutes } = await import("./routes/adventures.ts");
const { srdRoutes } = await import("./routes/srd.ts");
const { recapRoutes } = await import("./routes/recaps.ts");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(attachUser);
const { rememberOrigin } = await import("./discord.ts");
app.use((req, _res, next) => { if (req.user) rememberOrigin(`${req.protocol}://${req.get("host")}`); next(); });

app.use("/api", authRoutes, campaignRoutes, characterRoutes, mapRoutes, compendiumRoutes, aiRoutes, adventureRoutes, srdRoutes, recapRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Uploaded maps and images. Only logged-in users can see them.
// Browsers must treat them as the picture/PDF they claim to be, never as a web page that could run scripts.
app.use(
  "/uploads",
  (req, res, next) => (req.user ? next() : res.status(401).end()),
  // Files uploaded before this fix kept their original extension, so only refuse types that could run code
  (req, res, next) => (/^\/[\w.-]+$/.test(req.path) && !/\.(html?|xhtml|svgz?|xml|js|mjs|css)$/i.test(req.path) ? next() : res.status(404).end()),
  express.static(UPLOAD_DIR, { maxAge: "7d", index: false, dotfiles: "deny", setHeaders: (res, file) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!file.toLowerCase().endsWith(".pdf")) res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  } }),
);

// The built website (npm run build) is served in production
const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use(errorHandler);

const server = http.createServer(app);
initRealtime(server);
startDiscordScheduler();
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`The Grumbling Gnoll is open on http://localhost:${port}`));
