// EasyWork - 扫描件 PDF OCR（Tesseract.js 离线，chi_sim 中文）
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

const BASE = import.meta.env.BASE_URL || "/";
const TESS_PATH = `${BASE}tesseract`;
const SCALE = 2;

async function renderPageToCanvas(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

// 动态 import：OCR 资源（~10MB wasm + 2.4MB 语言包）不进首屏 bundle
export async function ocrPdf(doc: PDFDocumentProxy): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("chi_sim", 1, {
    workerPath: `${TESS_PATH}/worker.min.js`,
    corePath: `${TESS_PATH}/`,
    langPath: TESS_PATH,
    gzip: false, // tessdata_fast 的 chi_sim.traineddata 未压缩
  });
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const canvas = await renderPageToCanvas(page);
      const { data } = await worker.recognize(canvas);
      parts.push(data.text.trim());
    }
    return parts.filter(Boolean).join("\n");
  } finally {
    await worker.terminate();
  }
}
