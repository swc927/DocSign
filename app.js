// DocSign by SWC
// All logic is client side to protect user privacy

const fileInput = document.getElementById("fileInput");
const docCanvas = document.getElementById("docCanvas");
const sigCanvas = document.getElementById("sigCanvas");
const ph = document.getElementById("placeholder");

const modeRadios = document.querySelectorAll('input[name="mode"]');
const thresholdSlider = document.getElementById("thresholdSlider");
const bright = document.getElementById("brightness");
const contr = document.getElementById("contrast");
const penSize = document.getElementById("penSize");
const inkBtns = document.querySelectorAll(".ink");
const clearBtn = document.getElementById("clearSig");
const downloadBtn = document.getElementById("downloadBtn");
const shareBtn = document.getElementById("shareBtn");

const dctx = docCanvas.getContext("2d");
const sctx = sigCanvas.getContext("2d");

let img = new Image();
let originalImageBitmap = null;
let currentInk = "black";

function fitCanvasToWrap() {
  const wrap = document.querySelector(".canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  const ratio = 3 / 4;
  let w = rect.width;
  let h = (w * 4) / 3;
  if (h > rect.height) {
    h = rect.height;
    w = (h * 3) / 4;
  }
  docCanvas.width = w;
  docCanvas.height = h;
  sigCanvas.width = w;
  sigCanvas.height = h;
}
window.addEventListener("resize", () => {
  fitCanvasToWrap();
  if (originalImageBitmap) render();
});

fitCanvasToWrap();

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file, { resizeQuality: "high" });
  originalImageBitmap = bitmap;
  ph.style.display = "none";
  render();
});

// Render pipeline with contrast and brightness then mode
function render() {
  if (!originalImageBitmap) return;
  // draw base image scaled to canvas
  const cw = docCanvas.width,
    ch = docCanvas.height;
  dctx.clearRect(0, 0, cw, ch);
  // cover fit
  const br = originalImageBitmap.width / originalImageBitmap.height;
  const cr = cw / ch;
  let dw = cw,
    dh = ch,
    dx = 0,
    dy = 0;
  if (br > cr) {
    // image wider than canvas
    dh = ch;
    dw = dh * br;
    dx = (cw - dw) / 2;
  } else {
    dw = cw;
    dh = dw / br;
    dy = (ch - dh) / 2;
  }
  dctx.drawImage(originalImageBitmap, dx, dy, dw, dh);

  // get pixels
  const imgData = dctx.getImageData(0, 0, cw, ch);
  const data = imgData.data;
  // apply brightness and contrast
  const b = parseInt(bright.value, 10);
  const c = parseInt(contr.value, 10);
  // contrast formula using factor
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i],
      g = data[i + 1],
      bl = data[i + 2];
    r = cf * (r - 128) + 128 + b;
    g = cf * (g - 128) + 128 + b;
    bl = cf * (bl - 128) + 128 + b;
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, bl));
  }
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode === "greyscale" || mode === "threshold") {
    // convert to greyscale
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = y;
    }
    if (mode === "threshold") {
      const t = parseInt(thresholdSlider.value, 10);
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i] < t ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    }
  }
  dctx.putImageData(imgData, 0, 0);
}

// controls
modeRadios.forEach((r) => r.addEventListener("change", render));
[thresholdSlider, bright, contr].forEach((el) =>
  el.addEventListener("input", render)
);

inkBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    inkBtns.forEach((b) => b.classList.remove("sel"));
    btn.classList.add("sel");
    currentInk = btn.dataset.ink;
  });
});

clearBtn.addEventListener("click", () => {
  sctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
});

// signature drawing with simple velocity smoothing and subtle texture
let drawing = false;
let last = null;

function getInkStyle() {
  // realistic pen ink with slight alpha and glow
  const color =
    currentInk === "blue" ? "rgba(20,80,200,1)" : "rgba(20,20,20,1)";
  return color;
}

function lineWidthFromVelocity(v) {
  const base = parseInt(penSize.value, 10);
  const min = Math.max(1, base * 0.6);
  const max = base * 1.8;
  const speed = Math.min(1.5, v);
  const w = max - speed * (max - min);
  return w;
}

function pointerPos(e) {
  const rect = sigCanvas.getBoundingClientRect();
  const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
  const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
  return { x, y };
}

function startDraw(e) {
  e.preventDefault();
  if (!originalImageBitmap) {
    return;
  }
  drawing = true;
  last = { ...pointerPos(e), t: performance.now() };
}

function draw(e) {
  if (!drawing) return;
  const p = pointerPos(e);
  const t = performance.now();
  const dt = Math.max(1, t - last.t);
  const dx = p.x - last.x,
    dy = p.y - last.y;
  const dist = Math.hypot(dx, dy);
  const v = (dist / dt) * 10;

  const w = lineWidthFromVelocity(v);

  sctx.lineCap = "round";
  sctx.lineJoin = "round";
  sctx.strokeStyle = getInkStyle();
  sctx.lineWidth = w;

  sctx.beginPath();
  sctx.moveTo(last.x, last.y);
  sctx.lineTo(p.x, p.y);
  sctx.stroke();

  // subtle feather to mimic ink bleed
  sctx.globalAlpha = 0.08;
  sctx.lineWidth = w * 1.6;
  sctx.stroke();
  sctx.globalAlpha = 1;

  last = { x: p.x, y: p.y, t: t };
}

function endDraw() {
  drawing = false;
  last = null;
}

["pointerdown", "touchstart"].forEach((ev) =>
  sigCanvas.addEventListener(ev, startDraw, { passive: false })
);
["pointermove", "touchmove"].forEach((ev) =>
  sigCanvas.addEventListener(ev, draw, { passive: false })
);
["pointerup", "pointerleave", "touchend", "touchcancel"].forEach((ev) =>
  sigCanvas.addEventListener(ev, endDraw)
);

// export helpers
async function compositeToBlob() {
  const off = document.createElement("canvas");
  off.width = docCanvas.width;
  off.height = docCanvas.height;
  const octx = off.getContext("2d");
  octx.drawImage(docCanvas, 0, 0);
  octx.drawImage(sigCanvas, 0, 0);
  return await new Promise((res) => off.toBlob(res, "image/png", 0.95));
}

downloadBtn.addEventListener("click", async () => {
  if (!originalImageBitmap) {
    alert("Please upload a document first");
    return;
  }
  const blob = await compositeToBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "DocSign_by_SWC.png";
  a.click();
  URL.revokeObjectURL(url);
});

shareBtn.addEventListener("click", async () => {
  if (!originalImageBitmap) {
    alert("Please upload a document first");
    return;
  }
  try {
    const blob = await compositeToBlob();
    const file = new File([blob], "DocSign_by_SWC.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Signed document",
        text: "Signed with DocSign by SWC",
      });
    } else {
      // fallback to WhatsApp text share with link to image data
      const url = URL.createObjectURL(blob);
      const text = encodeURIComponent("Signed with DocSign by SWC");
      // WhatsApp cannot accept blob URLs as media directly from browser reliably
      // So we open a share text only and instruct the user to attach image from downloads if needed
      window.open("https://api.whatsapp.com/send?text=" + text, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      alert(
        "Your browser cannot share the image directly. The image is downloaded. Attach it in WhatsApp."
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "DocSign_by_SWC.png";
      a.click();
    }
  } catch (err) {
    alert("Share failed. " + err.message);
  }
});

// initial state
sctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
