
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowed.length === 0 || allowed.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error("Origine non autorisée"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

const client = apiKey ? new Anthropic({ apiKey }) : null;

app.get("/", (_req, res) => {
  res.json({
    name: "CENTRAL-HEX JARVIS API",
    status: "online",
    configured: Boolean(client),
    provider: "Anthropic Claude",
    endpoints: ["/health", "/api/chat"]
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    configured: Boolean(client),
    provider: "Anthropic Claude",
    model
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error: "Clé Claude absente : ajoute ANTHROPIC_API_KEY dans Render."
      });
    }

    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim().slice(0, 4000)
        : "";

    if (!message) {
      return res.status(400).json({
        error: "Le champ message est obligatoire."
      });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-10)
      : [];

    const safe = history
      .filter(x =>
        x &&
        ["user", "assistant"].includes(x.role) &&
        typeof x.content === "string"
      )
      .map(x => ({
        role: x.role,
        content: x.content.slice(0, 4000)
      }));

    // Claude attend une alternance de messages user et assistant.
    const messages = [];
    for (const item of [...safe, { role: "user", content: message }]) {
      const previous = messages[messages.length - 1];

      if (previous && previous.role === item.role) {
        previous.content += "\n" + item.content;
      } else {
        messages.push({ ...item });
      }
    }

    const result = await client.messages.create({
      model,
      max_tokens: 700,
      system:
        "Tu es JARVIS, un assistant utile et prudent intégré à CENTRAL-HEX. " +
        "Réponds en français si l'utilisateur écrit en français. " +
        "Ne prétends pas avoir effectué une action sur l'appareil si ce n'est pas le cas.",
      messages
    });

    const reply = result.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: "Claude n'a pas renvoyé de texte."
      });
    }

    return res.json({ reply, model, provider: "Anthropic Claude" });

  } catch (e) {
    console.error(
      "Claude API error:",
      e?.status || "",
      e?.error?.error?.type || e?.message || "unknown"
    );

    if (e?.status === 401) {
      return res.status(502).json({
        error: "Clé Claude refusée. Vérifie ANTHROPIC_API_KEY sur Render."
      });
    }

    if (e?.status === 429) {
      return res.status(429).json({
        error: "Limite ou quota Claude atteint. Vérifie ton compte API Anthropic."
      });
    }

    return res.status(500).json({
      error: "Erreur Claude. Vérifie les journaux Render."
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CENTRAL-HEX API écoute sur ${port}`);
});
