import { IncomingForm } from "formidable";
import fs from "fs";
import fetch from "node-fetch";
import sharp from "sharp";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: "50mb"
  }
};

const FAL_ENDPOINT = "https://fal.run/fal-ai/birefnet/v2";
const FAL_KEY = process.env.FAL_KEY;

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm();
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!FAL_KEY) {
    return res.status(500).json({ error: "FAL_KEY not set" });
  }

  try {
    let imageDataUrl = null;
    const ct = (req.headers["content-type"] || "").toLowerCase();

    if (ct.includes("multipart/form-data")) {
      const { files } = await parseForm(req);
      const file = files.image || files.file;
      if (!file) return res.status(400).json({ error: "Image missing" });

      const path = file.filepath;
      const buffer = fs.readFileSync(path);
      const mime = file.mimetype || "image/png";
      const base64 = buffer.toString("base64");
      imageDataUrl = `data:${mime};base64,${base64}`;
    } else {
      const data = await new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => resolve(body));
      });

      let json;
      try {
        json = JSON.parse(data);
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }

      if (!json.image_base64) return res.status(400).json({ error: "image_base64 missing" });
      imageDataUrl = json.image_base64;
    }

    const falResp = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image: imageDataUrl,
        model: "matting",
        mode: "HQ",
        output_type: "png"
      })
    });

    const falJson = await falResp.json();

    if (!falJson.image || !falJson.image.url) {
      return res.status(500).json({ error: "Invalid fal.ai response" });
    }

    const finalImg = await fetch(falJson.image.url);
    const arrayBuffer = await finalImg.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const outBuffer = await sharp(buffer).png().toBuffer();

    res.setHeader("Content-Type", "image/png");
    res.status(200).send(outBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
