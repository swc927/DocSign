
// DocSign SWC
// All logic runs on the device. Uses OpenCV.js for detection and jsPDF for export.

const video = document.getElementById('video');
const captureCanvas = document.getElementById('captureCanvas');
const workCanvas = document.getElementById('workCanvas');
const sigCanvas = document.getElementById('signatureCanvas');
const hint = document.getElementById('hint');

const btnStartCamera = document.getElementById('btnStartCamera');
const btnCapture = document.getElementById('btnCapture');
const btnRetake = document.getElementById('btnRetake');
const btnAutoFix = document.getElementById('btnAutoFix');
const btnBW = document.getElementById('btnBW');
const btnColor = document.getElementById('btnColor');
const btnDownload = document.getElementById('btnDownload');
const btnShare = document.getElementById('btnShare');
const fileInput = document.getElementById('fileInput');
const penBlack = document.getElementById('penBlack');
const penBlue = document.getElementById('penBlue');
const btnClearSig = document.getElementById('btnClearSig');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const zoomReset = document.getElementById('zoomReset');

let stream = null;
let transformState = { scale: 1, x: 0, y: 0 };
let penColour = 'black';
let drawing = false;
let lastPt = null;
let imageIsBW = false;
let haveImage = false;

function setCanvasSizesFromStage(){
  const rect = workCanvas.getBoundingClientRect();
  [captureCanvas, workCanvas, sigCanvas].forEach(cv=>{
    cv.width = Math.floor(rect.width * devicePixelRatio);
    cv.height = Math.floor(rect.height * devicePixelRatio);
    cv.style.width = '100%';
    cv.style.height = '100%';
  });
}

function drawCurrentFrameToCapture(){
  const ctx = captureCanvas.getContext('2d');
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.drawImage(video, 0, 0, captureCanvas.width/devicePixelRatio, captureCanvas.height/devicePixelRatio);
  ctx.restore();
}

async function startCamera(){
  if(stream){ return }
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    video.srcObject = stream;
    video.play();
    hint.style.display = 'block';
  }catch(err){
    alert('Camera could not start. You can upload an image instead.');
  }
}

function stopCamera(){
  if(stream){
    stream.getTracks().forEach(t=>t.stop());
  }
  stream = null;
}

function toMatFromCanvas(canvas){
  const src = cv.imread(canvas);
  return src;
}

function resizeToDocAspect(mat){
  // ensure a standard A4 portrait aspect for better warp
  const aspect = 1.4142; // sqrt(2) A series
  let h = mat.rows;
  let w = Math.round(h / aspect);
  if(w > mat.cols){
    w = mat.cols;
    h = Math.round(w * aspect);
  }
  const rect = new cv.Rect(Math.floor((mat.cols - w)/2), Math.floor((mat.rows - h)/2), w, h);
  return mat.roi(rect);
}

function autoDetectQuad(mat){
  // returns four points ordered TL TR BR BL, fallback to image corners
  let gray = new cv.Mat();
  let blur = new cv.Mat();
  let edges = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
  cv.Canny(blur, edges, 60, 160);
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let biggestArea = 0;
  let bestQuad = null;

  for(let i=0; i<contours.size(); i++){
    let cnt = contours.get(i);
    let peri = cv.arcLength(cnt, true);
    let approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
    if(approx.rows === 4 && cv.contourArea(approx) > biggestArea){
      biggestArea = cv.contourArea(approx);
      bestQuad = approx.clone();
    }
    approx.delete();
    cnt.delete();
  }

  let pts;
  if(bestQuad){
    pts = [];
    for(let i=0; i<4; i++){
      pts.push({x: bestQuad.intPtr(i,0)[0], y: bestQuad.intPtr(i,0)[1]});
    }
    bestQuad.delete();
    // order TL TR BR BL
    pts.sort((a,b)=>a.y-b.y);
    const top = pts.slice(0,2).sort((a,b)=>a.x-b.x);
    const bottom = pts.slice(2).sort((a,b)=>a.x-b.x);
    pts = [top[0], top[1], bottom[1], bottom[0]];
  }else{
    pts = [
      {x:0, y:0},
      {x:mat.cols-1, y:0},
      {x:mat.cols-1, y:mat.rows-1},
      {x:0, y:mat.rows-1}
    ];
  }

  gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  return pts;
}

function warpToRect(mat, quad){
  const width = mat.cols;
  const height = mat.rows;
  const srcTri = cv.matFromArray(4,1,cv.CV_32FC2, [
    quad[0].x, quad[0].y,
    quad[1].x, quad[1].y,
    quad[2].x, quad[2].y,
    quad[3].x, quad[3].y
  ]);
  const dstTri = cv.matFromArray(4,1,cv.CV_32FC2, [
    0,0,
    width-1,0,
    width-1,height-1,
    0,height-1
  ]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  let dst = new cv.Mat();
  cv.warpPerspective(mat, dst, M, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  srcTri.delete(); dstTri.delete(); M.delete();
  return dst;
}

function drawMatOnCanvas(mat, canvas){
  cv.imshow(canvas, mat);
}

function runAutoFix(){
  const src = toMatFromCanvas(captureCanvas);
  const cropped = resizeToDocAspect(src);
  const quad = autoDetectQuad(cropped);
  const warped = warpToRect(cropped, quad);
  drawMatOnCanvas(warped, workCanvas);
  haveImage = true;
  imageIsBW = false;
  src.delete(); cropped.delete(); warped.delete();
}

function applyBW(){
  const src = toMatFromCanvas(workCanvas);
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  let result = new cv.Mat();
  cv.adaptiveThreshold(gray, result, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 35, 10);
  cv.cvtColor(result, src, cv.COLOR_GRAY2RGBA);
  drawMatOnCanvas(src, workCanvas);
  src.delete(); gray.delete(); result.delete();
  imageIsBW = true;
}

function restoreColour(){
  // simply redraw from capture then refix to keep geometry identical
  runAutoFix();
  imageIsBW = false;
}

function onResize(){
  setCanvasSizesFromStage();
  if(haveImage){
    // redraw existing work canvas by scaling its bitmap to new size
    // save old to temp
    const tmp = document.createElement('canvas');
    tmp.width = workCanvas.width; tmp.height = workCanvas.height;
    tmp.getContext('2d').drawImage(workCanvas,0,0);
    const ctx = workCanvas.getContext('2d');
    ctx.clearRect(0,0,workCanvas.width,workCanvas.height);
    ctx.drawImage(tmp,0,0,workCanvas.width,workCanvas.height);
  }
}

function handleCapture(){
  if(!stream){ return }
  drawCurrentFrameToCapture();
  runAutoFix();
  hint.style.display = 'none';
}

function handleRetake(){
  haveImage = false;
  imageIsBW = false;
  const c1 = workCanvas.getContext('2d');
  const c2 = captureCanvas.getContext('2d');
  [c1,c2].forEach(c=>c.clearRect(0,0,workCanvas.width,workCanvas.height));
  clearSignature();
  hint.style.display = 'block';
}

function clearSignature(){
  const sctx = sigCanvas.getContext('2d');
  sctx.clearRect(0,0,sigCanvas.width,sigCanvas.height);
}

function penColourFromButton(){
  penBlack.classList.toggle('active', penColour==='black');
  penBlue.classList.toggle('active', penColour==='blue');
}

function pressureFromSpeed(prev, curr){
  // vary line width based on speed
  if(!prev) return 1.6;
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const p = Math.max(0.8, Math.min(2.2, 2.2 - dist*0.04));
  return p;
}

function drawSigPoint(pt){
  const ctx = sigCanvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = penColour === 'blue' ? 'rgba(20,80,200,1)' : 'rgba(20,20,20,1)';
  ctx.strokeStyle = stroke;
  ctx.shadowColor = stroke;
  ctx.shadowBlur = 1.5;
  const w = 2.2 * pressureFromSpeed(lastPt, pt);
  ctx.lineWidth = w * devicePixelRatio;
  ctx.beginPath();
  if(lastPt){
    ctx.moveTo(lastPt.x * devicePixelRatio, lastPt.y * devicePixelRatio);
    ctx.lineTo(pt.x * devicePixelRatio, pt.y * devicePixelRatio);
    ctx.stroke();
  }else{
    ctx.moveTo(pt.x * devicePixelRatio, pt.y * devicePixelRatio);
    ctx.lineTo(pt.x * devicePixelRatio + 0.2, pt.y * devicePixelRatio + 0.2);
    ctx.stroke();
  }
  lastPt = pt;
}

function pointerPos(e){
  const rect = sigCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  return {x, y};
}

function setupSignature(){
  sigCanvas.addEventListener('pointerdown', e=>{
    if(!haveImage) return;
    drawing = true; lastPt = null; sigCanvas.setPointerCapture(e.pointerId);
    drawSigPoint(pointerPos(e));
  });
  sigCanvas.addEventListener('pointermove', e=>{
    if(!drawing) return;
    drawSigPoint(pointerPos(e));
  });
  window.addEventListener('pointerup', e=>{
    if(drawing){ drawing = false; lastPt = null; }
  });
}

function setupZoomPan(){
  let isDragging = false;
  let last = null;
  workCanvas.style.transformOrigin = '0 0';
  sigCanvas.style.transformOrigin = '0 0';

  function apply(){
    const t = `translate(${transformState.x}px, ${transformState.y}px) scale(${transformState.scale})`;
    workCanvas.style.transform = t;
    sigCanvas.style.transform = t;
  }

  sigCanvas.addEventListener('pointerdown', e=>{
    if(e.pointerType === 'touch' || e.pointerType === 'pen'){
      isDragging = true; last = {x: e.clientX, y: e.clientY};
      sigCanvas.setPointerCapture(e.pointerId);
    }
  });
  sigCanvas.addEventListener('pointermove', e=>{
    if(isDragging){
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      transformState.x += dx;
      transformState.y += dy;
      last = {x: e.clientX, y: e.clientY};
      apply();
    }
  });
  window.addEventListener('pointerup', e=>{ isDragging=false });

  zoomIn.addEventListener('click', ()=>{ transformState.scale = Math.min(4, transformState.scale*1.15); apply(); });
  zoomOut.addEventListener('click', ()=>{ transformState.scale = Math.max(0.5, transformState.scale/1.15); apply(); });
  zoomReset.addEventListener('click', ()=>{ transformState.scale=1; transformState.x=0; transformState.y=0; apply(); });
}

async function downloadPDF(){
  if(!haveImage){ alert('Capture or upload first'); return }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
  // merge work and signature to a temporary canvas at natural size
  const tmp = document.createElement('canvas');
  tmp.width = workCanvas.width; tmp.height = workCanvas.height;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(workCanvas,0,0);
  // reverse transforms for signature because we only transform CSS
  // draw signature at native scale by reading its bitmap
  tctx.drawImage(sigCanvas,0,0);

  // fit into A4 while keeping aspect
  const imgData = tmp.toDataURL('image/jpeg', 0.92);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // compute fit
  const img = new Image(); await new Promise(r=>{ img.onload=r; img.src=imgData; });
  let w = pageW - 40; // margins
  let h = img.height * (w / img.width);
  if(h > pageH - 40){
    h = pageH - 40;
    w = img.width * (h / img.height);
  }
  const x = (pageW - w)/2;
  const y = (pageH - h)/2;
  pdf.addImage(imgData, 'JPEG', x, y, w, h);
  pdf.save('DocSign-SWC.pdf');
}

async function shareWhatsApp(){
  if(!haveImage){ alert('Capture or upload first'); return }
  // Build a PDF blob first
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
  const tmp = document.createElement('canvas');
  tmp.width = workCanvas.width; tmp.height = workCanvas.height;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(workCanvas,0,0);
  tctx.drawImage(sigCanvas,0,0);
  const imgData = tmp.toDataURL('image/jpeg', 0.9);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const img = new Image(); await new Promise(r=>{ img.onload=r; img.src=imgData; });
  let w = pageW - 40;
  let h = img.height * (w / img.width);
  if(h > pageH - 40){
    h = pageH - 40; w = img.width * (h / img.height);
  }
  const x = (pageW - w)/2, y=(pageH - h)/2;
  pdf.addImage(imgData, 'JPEG', x, y, w, h);
  const pdfBlob = pdf.output('blob');
  const file = new File([pdfBlob], 'DocSign-SWC.pdf', { type: 'application/pdf' });

  if(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })){
    try{
      await navigator.share({
        title: 'DocSign SWC',
        text: 'Signed document',
        files: [file]
      });
    }catch(e){
      // user cancelled
    }
  }else{
    // Fallback to wa.me link
    const url = URL.createObjectURL(pdfBlob);
    const msg = encodeURIComponent('Signed document created with DocSign SWC. Download link below then share manually in WhatsApp: ' + url);
    window.open('https://wa.me/?text=' + msg, '_blank');
  }
}

function handleUpload(file){
  const img = new Image();
  img.onload = ()=>{
    const ctx = captureCanvas.getContext('2d');
    // draw to fit canvas
    ctx.clearRect(0,0,captureCanvas.width,captureCanvas.height);
    const ratio = Math.min(captureCanvas.width/img.width, captureCanvas.height/img.height);
    const w = img.width * ratio, h = img.height * ratio;
    const x = (captureCanvas.width - w)/2, y=(captureCanvas.height - h)/2;
    ctx.drawImage(img, x, y, w, h);
    runAutoFix();
    hint.style.display = 'none';
  };
  img.src = URL.createObjectURL(file);
}

function waitForOpenCV(){
  return new Promise(resolve=>{
    if(window.cv && cv.getBuildInformation){ resolve(); return }
    const check = setInterval(()=>{
      if(window.cv && cv.getBuildInformation){ clearInterval(check); resolve() }
    }, 80);
  });
}

window.addEventListener('load', async()=>{
  setCanvasSizesFromStage();
  await waitForOpenCV();
  setupSignature();
  setupZoomPan();

  btnStartCamera.addEventListener('click', startCamera);
  btnCapture.addEventListener('click', handleCapture);
  btnRetake.addEventListener('click', handleRetake);
  btnAutoFix.addEventListener('click', runAutoFix);
  btnBW.addEventListener('click', applyBW);
  btnColor.addEventListener('click', restoreColour);
  btnDownload.addEventListener('click', downloadPDF);
  btnShare.addEventListener('click', shareWhatsApp);
  penBlack.addEventListener('click', ()=>{ penColour='black'; penColourFromButton() });
  penBlue.addEventListener('click', ()=>{ penColour='blue'; penColourFromButton() });
  btnClearSig.addEventListener('click', clearSignature);
  fileInput.addEventListener('change', e=>{
    const f = e.target.files[0];
    if(f){ handleUpload(f) }
  });
  penColourFromButton();
});

window.addEventListener('resize', onResize);
