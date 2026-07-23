/**
 * File ingestion for the Capture inbox.
 *
 * Turns dropped/attached files into things Claude can read:
 *   - images (screenshots)  → resized JPEG, sent to Claude as vision blocks
 *   - PDFs                  → sent to Claude natively as document blocks
 *   - Word (.docx)          → text extracted in the browser (jszip)
 *   - Excel (.xlsx/.xls)    → sheets converted to CSV text (SheetJS)
 *   - Outlook (.msg)        → headers + body extracted (@kenjiuno/msgreader)
 *   - .eml / .csv / .txt / .md → read as plain text
 *
 * Parsers are dynamically imported so they only download when first used.
 */

export const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.xls,.csv,.msg,.eml,.txt,.md";
export const MAX_FILES = 8;

function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

const decodeEntities = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

async function imageBlock(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't read this image"));
      i.src = url;
    });
    // Claude's sweet spot is ≤1568px on the long edge; resizing also keeps
    // request sizes sensible for phone photos.
    const MAX = 1568;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const dataUrl = c.toDataURL("image/jpeg", 0.82);
    return { kind: "image", name: file.name || "screenshot", media_type: "image/jpeg", data: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function docxText(file) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("Couldn't read this Word file");
  const xml = await entry.async("string");
  return decodeEntities(
    xml.replace(/<w:p[^>]*>/g, "\n").replace(/<w:tab[^>]*\/>/g, "\t").replace(/<[^>]+>/g, "")
  ).replace(/\n{3,}/g, "\n\n").trim().slice(0, 60000);
}

async function sheetText(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const parts = [];
  wb.SheetNames.slice(0, 6).forEach((n) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]).trim();
    if (csv) parts.push("## Sheet: " + n + "\n" + csv.slice(0, 15000));
  });
  if (!parts.length) throw new Error("No readable sheets in this file");
  return parts.join("\n\n").slice(0, 45000);
}

async function msgText(file) {
  const mod = await import("@kenjiuno/msgreader");
  const MsgReader = mod.default?.default || mod.default || mod.MsgReader;
  const reader = new MsgReader(await file.arrayBuffer());
  const d = reader.getFileData() || {};
  const recips = (d.recipients || []).map((r) => r.name || r.email).filter(Boolean).join(", ");
  const atts = (d.attachments || []).map((a) => a.fileName).filter(Boolean).join(", ");
  const body = d.body || (d.bodyHtml ? d.bodyHtml.replace(/<[^>]+>/g, " ") : "");
  return [
    d.senderName || d.senderEmail ? "From: " + (d.senderName || "") + (d.senderEmail ? " <" + d.senderEmail + ">" : "") : "",
    recips ? "To: " + recips : "",
    d.subject ? "Subject: " + d.subject : "",
    d.messageDeliveryTime ? "Date: " + d.messageDeliveryTime : "",
    atts ? "Attachments: " + atts : "",
    "",
    (body || "(no body text found)").trim(),
  ].filter((x, i) => x !== "" || i === 5).join("\n").slice(0, 60000);
}

/** Convert a File into a capture attachment descriptor. Throws with a
 *  friendly message for unsupported/broken files. */
export async function fileToCapture(file) {
  const ext = (file.name || "").toLowerCase().split(".").pop();
  const isImage = file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);

  if (isImage) return imageBlock(file);
  if (ext === "pdf") {
    if (file.size > 4.5 * 1024 * 1024) throw new Error(file.name + ": PDF too large (max ~4.5MB) — try exporting fewer pages");
    return { kind: "pdf", name: file.name, data: b64FromBuffer(await file.arrayBuffer()) };
  }
  if (ext === "docx") return { kind: "text", name: file.name, text: await docxText(file) };
  if (ext === "xlsx" || ext === "xls") return { kind: "text", name: file.name, text: await sheetText(file) };
  if (ext === "msg") return { kind: "text", name: file.name, text: await msgText(file) };
  if (["csv", "eml", "txt", "md"].includes(ext)) {
    return { kind: "text", name: file.name, text: (await file.text()).slice(0, 60000) };
  }
  throw new Error(file.name + ": unsupported type — supported: screenshots/images, PDF, Word (.docx), Excel (.xlsx/.xls/.csv), Outlook (.msg/.eml), text");
}
