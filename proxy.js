import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

router.post("/api/replicate", async (req, res) => {
  const { image, prompt } = req.body;

  const version = "e3d8c079a7424ad2bfa31bb6d56a5eb2"; // Modelo IA válido

  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version,
        input: {
          image,
          prompt,
        },
      }),
    });

    const json = await response.json();
    res.json({ prediction: json });
  } catch (err) {
    console.error("Error desde proxy:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
