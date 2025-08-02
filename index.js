// ✅ index.js (backend principal ordenado)

// ===== IMPORTS =====
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import proxyRouter from "./proxy.js";
import * as cheerio from "cheerio";

// ===== FIREBASE ADMIN (para FCM) =====
import admin from "firebase-admin";
import { initializeApp as initializeAdminApp, applicationDefault } from "firebase-admin/app";

// Inicializar Firebase Admin SOLO una vez
if (!admin.apps.length) {
  initializeAdminApp({
    credential: applicationDefault(), // si usas GOOGLE_APPLICATION_CREDENTIALS en render/vercel
  });
  console.log("✅ Firebase Admin inicializado correctamente");
}

// Messaging para FCM
const fcm = admin.messaging();
const db = admin.firestore(); // Firestore Admin para obtener tokens

// ===== EXPRESS APP =====
const app = express();
const PORT = process.env.PORT || 5000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // sirve archivos HTML, JS, etc.
app.use("/", proxyRouter); // monta el proxy para las llamadas POST

// ===== FRASES DE CONFIRMACIÓN =====
const frasesConfirmacion = [
  "pedido confirmado",
   "te esperamos mañana"
  "pedido confirmado",
  "compra confirmada",
  "te esperamos",
  "queda registrado",
  "perfecto, anotado",
  "te lo guardamos",
  "te lo reservo",
  "te esperamos pronto",
  "ya está listo tu pedido",
  "queda agendado",
  "gracias por tu compra",
];

function contieneFraseDeConfirmacion(texto) {
  return frasesConfirmacion.some(frase =>
    texto.toLowerCase().includes(frase)
  );
}



// ===============================================
// ✅ ENDPOINT OPENAI CHAT
// ===============================================
app.post("/api/chat", async (req, res) => {
  const { mensaje, uid } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY no configurada");
    return res.status(500).json({ respuesta: "Error: Falta la API key" });
  }

  console.log("🤖 [CHAT] Enviando mensaje a OpenAI:", mensaje);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "Sos una asistente virtual para un emprendimiento. Respondé consultas de productos, envíos, pagos, talles. Sé clara, amable y breve.",
          },
          { role: "user", content: mensaje },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("❌ Error OpenAI:", errorData);
      return res
        .status(500)
        .json({ respuesta: "Error OpenAI: " + errorData.error?.message });
    }

    const data = await response.json();
    const respuesta = data.choices?.[0]?.message?.content || "Sin respuesta";

    console.log("✅ [CHAT] Respuesta lista:", respuesta);

    // 🚨 Detectar si la IA confirmó una compra
    if (contieneFraseDeConfirmacion(respuesta) && uid) {
      await enviarNotificacionDeCompraConfirmada(uid);
    }

    res.json({ respuesta });
  } catch (err) {
    console.error("❌ Error al contactar OpenAI:", err);
    res.status(500).json({ respuesta: "Error con el servidor de IA" });
  }
});

async function enviarNotificacionDeCompraConfirmada(uid) {
  try {
    const ref = db.collection("usuarios").doc(uid);
    const snap = await ref.get();
    const data = snap.data();

    if (!data || !data.pushToken || (data.plan !== "pro" && data.plan !== "experto")) {
      console.log("⚠️ Usuario sin token o sin plan válido");
      return;
    }

    const token = data.pushToken;

    const payload = {
      notification: {
        title: "🛍️ Nueva compra confirmada",
        body: "Un cliente confirmó una compra. Revisalo en tu panel.",
      },
    };

    await fcm.sendToDevice(token, payload);
    console.log("✅ Notificación de compra enviada correctamente");
  } catch (error) {
    console.error("❌ Error al enviar notificación:", error);
  }
}


// ===============================================
// ✅ ENDPOINT PUSH NOTIFICATIONS (FCM)
// ===============================================
app.post("/api/enviar-push", async (req, res) => {
  const { token, titulo, mensaje } = req.body;

  if (!token) return res.status(400).json({ error: "Falta el token del usuario" });

  const payload = {
    notification: {
      title: titulo,
      body: mensaje,
    },
  };

  try {
    const response = await fcm.sendToDevice(token, payload);
    console.log("✅ [FCM] Notificación enviada:", response);
    res.json({ success: true, response });
  } catch (error) {
    console.error("❌ [FCM] Error al enviar push:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// ✅ ENDPOINT PUSH ALMACENADO POR UID (OneSignal)
// ===============================================
app.post("/api/notificar", async (req, res) => {
  const { title, body, uid } = req.body;

  try {
    const ref = db.collection("usuarios").doc(uid);
    const snap = await ref.get();
    const data = snap.data();
    const token = data?.pushToken;

    if (!token) {
      console.warn("⚠️ Usuario sin pushToken");
      return res.status(400).json({ error: "Este usuario no tiene pushToken" });
    }

    const resp = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID,
        include_player_ids: [token],
        headings: { en: title },
        contents: { en: body },
      }),
    });

    const json = await resp.json();
    console.log("✅ [OneSignal] Push enviada:", json.id || json.errors);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ [OneSignal] Error enviando push:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===============================================
// ✅ START SERVER
// ===============================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor corriendo en http://0.0.0.0:${PORT}`);
  console.log(`🔑 API Key OpenAI configurada: ${process.env.OPENAI_API_KEY ? "SÍ" : "NO"}`);
  console.log(`🔑 OneSignal configurado: ${process.env.ONESIGNAL_API_KEY ? "SÍ" : "NO"}`);
});
