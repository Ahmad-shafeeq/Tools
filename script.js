
// ------------------- State -------------------
const state = {
  pdf2imgFile: null,
  img2pdfFiles: [],
  jpg2pngFile: null,
  png2jpgFile: null,
  enhanceFile: null,
  lastDownload: { blob: null, name: "", multi: false, pages: [] }
};

// ------------------- Helpers -------------------
function $(id){ return document.getElementById(id); }

function cleanName(name = "converted"){
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g,"_");
}

function fileSizeString(bytes){
  if (!bytes && bytes !== 0) return "";
  const units = ["B","KB","MB","GB"];
  let u = 0, n = bytes;
  while(n >= 1024 && u < units.length-1){ n/=1024; u++; }
  return n.toFixed( (u===0)?0: (u===1?1:2) ) + " " + units[u];
}

function showToast(message, type = 'success') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 4000);
}

function showProgress(section, show) {
  const progress = $(`prog-${section}`);
  if (progress) progress.style.display = show ? 'block' : 'none';
}

function updateProgress(section, percent) {
  const bar = $(`bar-${section}`);
  if (bar) bar.style.width = percent + '%';
}

function showResult(section, show) {
  const result = $(`res-${section}`);
  if (result) result.style.display = show ? 'block' : 'none';
}

function showDownloadButtons(section, show) {
  const downloadBtn = $(`btn-download-${section}`);
  const openBtn = $(`btn-open-${section}`);
  if (downloadBtn) downloadBtn.style.display = show ? 'inline-block' : 'none';
  if (openBtn) openBtn.style.display = show ? 'inline-block' : 'none';
}

// Load image utility
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Canvas to blob utility
function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise(resolve => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

// Enhanced download functionality
function downloadBlob(blob, filename) {
  try {
    if (!blob || blob.size === 0) {
      showToast('Download failed: empty file', 'error');
      return;
    }
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanName(filename);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    showToast(`Downloaded ${filename} (${fileSizeString(blob.size)})`);
  } catch (error) {
    showToast(`Download failed: ${error.message}`, 'error');
  }
}

async function downloadMultipleImages(images, baseName) {
  try {
    if (images.length === 1) {
      downloadBlob(images[0].blob, images[0].name);
    } else {
      showToast('Creating ZIP file...');
      const zip = new JSZip();
      for (const img of images) {
        zip.file(img.name, img.blob);
      }
      const zipBlob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      downloadBlob(zipBlob, `${baseName}_images.zip`);
    }
  } catch (error) {
    showToast(`ZIP creation failed: ${error.message}`, 'error');
  }
}

// PDF to Images conversion
async function convertPdfToImages(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    const images = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      updateProgress('pdf2img', (i / pdf.numPages) * 90);
      
      const page = await pdf.getPage(i);
      const scale = 2; // High quality
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      
      // White background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;
      
      const blob = await canvasToBlob(canvas, 'image/png');
      images.push({
        blob,
        name: `page_${i}.png`
      });
    }
    
    updateProgress('pdf2img', 100);
    return images;
  } catch (error) {
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

// Images to PDF conversion - FIXED VERSION
// FIXED: Images to PDF conversion (no white space, no watermark)
async function convertImagesToPdf(files) {
  try {
    // Support both jsPDF global and window.jspdf.jsPDF
    const jsPDF = window.jsPDF || (window.jspdf && window.jspdf.jsPDF);
    if (!jsPDF) throw new Error('PDF library not loaded');
    let pdf;
    for (let i = 0; i < files.length; i++) {
      const img = await loadImage(files[i]);
      const orientation = img.width > img.height ? 'landscape' : 'portrait';
      if (i === 0) {
        pdf = new jsPDF({
          orientation,
          unit: 'pt',
          format: [img.width, img.height]
        });
      } else {
        pdf.addPage([img.width, img.height], orientation);
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, img.width, img.height);
      const imgDataUrl = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgDataUrl, 'JPEG', 0, 0, img.width, img.height);
    }
    updateProgress('img2pdf', 100);
    return pdf.output('blob');
  } catch (err) {
    console.error('PDF creation failed:', err);
    throw err;
  }
}

// Image format conversion
async function convertImageFormat(file, outputType) {
  try {
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    
    // For JPG output, fill with white background
    if (outputType === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    ctx.drawImage(img, 0, 0);
    
    const quality = outputType === 'image/jpeg' ? 0.95 : undefined;
    return await canvasToBlob(canvas, outputType, quality);
  } catch (error) {
    throw new Error(`Image conversion failed: ${error.message}`);
  }
}

// Image enhancement
async function enhanceImage(file) {
  try {
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    
    // Apply enhancement filters
    ctx.filter = 'brightness(1.1) contrast(1.1) saturate(1.1)';
    ctx.drawImage(img, 0, 0);
    
    return await canvasToBlob(canvas, 'image/png');
  } catch (error) {
    throw new Error(`Image enhancement failed: ${error.message}`);
  }
}

// File validation functions
function isValidPdf(file) {
  return file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
}

function isValidImage(file) {
  return file && (file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(file.name));
}

function isValidJpeg(file) {
  return file && (file.type === 'image/jpeg' || /\.(jpg|jpeg)$/i.test(file.name));
}

function isValidPng(file) {
  return file && (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png'));
}

// Enhanced file input handling with duplicate prevention
function setupFileInput(inputId, callback) {
  const input = $(inputId);
  if (!input) return;
  input.onchange = null;
  input.addEventListener('click', function() {
    this.value = '';
  });
  input.addEventListener('change', function(e) {
    if (this.files && this.files.length > 0) {
      callback(this.files);
    }
  });
}

// Drag and drop setup (corrected)
function setupDropZone(dropId, inputId, callback) {
  const dropZone = document.querySelector(dropId);
  const input = document.querySelector(inputId);

  if (!dropZone || !input) return;

  dropZone.addEventListener('click', () => input.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      input.files = e.dataTransfer.files;  // ✅ Corrected: Assign files to input
      callback(Array.from(files));
    }
  });



  // Drag-and-drop image files only (no input, no click)
function setupImageDragOnly(dropId, callback) {
  const dropZone = document.querySelector(dropId);
  if (!dropZone) return;

  // Clean out any file input fields inside the drop zone
  const fileInputs = dropZone.querySelectorAll('input[type="file"]');
  fileInputs.forEach(input => input.remove());

  // Make it clear this area is not clickable
  dropZone.style.cursor = 'default';

  // Highlight drop zone when dragging
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  // Remove highlight when dragging leaves
  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });

  // Handle dropped files
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Filter: only allow image files
      const imageFiles = Array.from(files).filter(file =>
        file.type.startsWith('image/')
      );

      if (imageFiles.length > 0) {
        callback(imageFiles);  // Send images to your handler
      } else {
        alert("Only image files are allowed!");
      }
    }
  });

  // Disable any click behavior
  dropZone.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}


  // Add input change listener to handle manual file selection
  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      callback(Array.from(e.target.files));
    }
  });
}

// Conversion handlers
async function handlePdfToImages() {
  if (!state.pdf2imgFile) {
    showToast('Please select a PDF file first', 'error');
    return;
  }
  
  try {
    showProgress('pdf2img', true);
    updateProgress('pdf2img', 10);
    
    const images = await convertPdfToImages(state.pdf2imgFile);
    
    state.lastDownload = {
      multi: true,
      pages: images,
      name: cleanName(state.pdf2imgFile.name.replace('.pdf', '')),
      blob: null
    };
    
    showProgress('pdf2img', false);
    showResult('pdf2img', true);
    showDownloadButtons('pdf2img', true);
    
    $('msg-pdf2img').textContent = `Converted ${images.length} pages successfully.`;
    showToast(`Converted ${images.length} pages successfully`);
  } catch (error) {
    showProgress('pdf2img', false);
    showToast(error.message, 'error');
  }
}

async function handleImagesToPdf() {
  if (state.img2pdfFiles.length === 0) {
    showToast('Please select image files first', 'error');
    return;
  }
  try {
    showProgress('img2pdf', true);
    updateProgress('img2pdf', 10);
    showToast(`Converting ${state.img2pdfFiles.length} image(s) to PDF...`);
    const pdfBlob = await convertImagesToPdf(state.img2pdfFiles);
    if (!pdfBlob || pdfBlob.size === 0) {
      throw new Error('Failed to generate PDF - empty file');
    }
    const baseName = state.img2pdfFiles.length === 1 
      ? cleanName(state.img2pdfFiles[0].name.split('.')[0])
      : 'images';
    state.lastDownload = {
      blob: pdfBlob,
      name: `${baseName}.pdf`,
      multi: false,
      pages: []
    };
    showProgress('img2pdf', false);
    showResult('img2pdf', true);
    showDownloadButtons('img2pdf', true);
    $('msg-img2pdf').textContent = `PDF created successfully (${fileSizeString(pdfBlob.size)}).`;
    showToast(`PDF created successfully (${fileSizeString(pdfBlob.size)})`);
  } catch (error) {
    showProgress('img2pdf', false);
    showToast(error.message, 'error');
  }
}

async function handleJpgToPng() {
  if (!state.jpg2pngFile) {
    showToast('Please select a JPG file first', 'error');
    return;
  }
  
  try {
    const pngBlob = await convertImageFormat(state.jpg2pngFile, 'image/png');
    const baseName = cleanName(state.jpg2pngFile.name.split('.')[0]);
    
    state.lastDownload = {
      blob: pngBlob,
      name: `${baseName}.png`,
      multi: false,
      pages: []
    };
    
    showResult('jpg2png', true);
    showDownloadButtons('jpg2png', true);
    
    $('msg-jpg2png').textContent = 'PNG conversion complete.';
    showToast('PNG conversion complete');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handlePngToJpg() {
  if (!state.png2jpgFile) {
    showToast('Please select a PNG file first', 'error');
    return;
  }
  
  try {
    const jpgBlob = await convertImageFormat(state.png2jpgFile, 'image/jpeg');
    const baseName = cleanName(state.png2jpgFile.name.split('.')[0]);
    
    state.lastDownload = {
      blob: jpgBlob,
      name: `${baseName}.jpg`,
      multi: false,
      pages: []
    };
    
    showResult('png2jpg', true);
    showDownloadButtons('png2jpg', true);
    
    $('msg-png2jpg').textContent = 'JPG conversion complete.';
    showToast('JPG conversion complete');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleEnhanceImage() {
  if (!state.enhanceFile) {
    showToast('Please select an image file first', 'error');
    return;
  }
  
  try {
    const enhancedBlob = await enhanceImage(state.enhanceFile);
    const baseName = cleanName(state.enhanceFile.name.split('.')[0]);
    
    state.lastDownload = {
      blob: enhancedBlob,
      name: `${baseName}_enhanced.png`,
      multi: false,
      pages: []
    };
    
    showResult('enhance', true);
    showDownloadButtons('enhance', true);
    
    $('msg-enhance').textContent = 'Image enhancement complete.';
    showToast('Image enhancement complete');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Download handlers
async function handleDownload(section) {
  try {
    if (section === 'pdf2img' && state.lastDownload.multi && state.lastDownload.pages && state.lastDownload.pages.length > 0) {
      await downloadMultipleImages(state.lastDownload.pages, state.lastDownload.name);
    } else if (state.lastDownload.blob) {
      downloadBlob(state.lastDownload.blob, state.lastDownload.name);
    } else {
      showToast('No file available for download. Please convert a file first.', 'error');
    }
  } catch (error) {
    showToast(`Download failed: ${error.message}`, 'error');
  }
}

function handleOpen(section) {
  let blob = null;
  
  if (section === 'pdf2img' && state.lastDownload.pages && state.lastDownload.pages[0]) {
    blob = state.lastDownload.pages[0].blob;
  } else if (state.lastDownload.blob) {
    blob = state.lastDownload.blob;
  }
  
  if (blob) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Tab switching
function switchTab(target) {
  // Hide all sections
  document.querySelectorAll('.section').forEach(section => {
    section.classList.remove('active');
  });
  
  // Remove active class from all tab buttons
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show target section
  const targetSection = $(`section-${target}`);
  if (targetSection) {
    targetSection.classList.add('active');
  }
  
  // Add active class to clicked tab
  const targetTab = document.querySelector(`[data-target="${target}"]`);
  if (targetTab) {
    targetTab.classList.add('active');
  }
}

// Initialize app
function initApp() {
  // Tab switching
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-target'));
    });
  });

  // PDF to Images
  const pdfInput = setupFileInput('input-pdf2img', (files) => {
    const file = files[0];
    if (isValidPdf(file)) {
      state.pdf2imgFile = file;
      $('info-pdf2img').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid PDF file', 'error');
    }
  });
  setupDropZone('drop-pdf2img', 'input-pdf2img', (files) => {
    const file = files[0];
    if (isValidPdf(file)) {
      state.pdf2imgFile = file;
      $('info-pdf2img').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid PDF file', 'error');
    }
  });
  $('btn-convert-pdf2img').addEventListener('click', handlePdfToImages);
  $('btn-download-pdf2img').addEventListener('click', () => handleDownload('pdf2img'));
  $('btn-open-pdf2img').addEventListener('click', () => handleOpen('pdf2img'));

  // Images to PDF
  const imgInput = setupFileInput('input-img2pdf', (files) => {
    const imageFiles = Array.from(files).filter(isValidImage);
    if (imageFiles.length > 0) {
      state.img2pdfFiles = imageFiles;
      $('info-img2pdf').textContent = `${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''} selected`;
    } else {
      showToast('Please select valid image files', 'error');
    }
  });
  setupDropZone('drop-img2pdf', 'input-img2pdf', (files) => {
    const imageFiles = Array.from(files).filter(isValidImage);
    if (imageFiles.length > 0) {
      state.img2pdfFiles = imageFiles;
      $('info-img2pdf').textContent = `${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''} selected`;
    } else {
      showToast('Please select valid image files', 'error');
    }
  });
  $('btn-convert-img2pdf').addEventListener('click', handleImagesToPdf);
  $('btn-download-img2pdf').addEventListener('click', () => handleDownload('img2pdf'));
  $('btn-open-img2pdf').addEventListener('click', () => handleOpen('img2pdf'));

  // JPG to PNG
  const jpgInput = setupFileInput('input-jpg2png', (files) => {
    const file = files[0];
    if (isValidJpeg(file)) {
      state.jpg2pngFile = file;
      $('info-jpg2png').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid JPG file', 'error');
    }
  });
  setupDropZone('drop-jpg2png', 'input-jpg2png', (files) => {
    const file = files[0];
    if (isValidJpeg(file)) {
      state.jpg2pngFile = file;
      $('info-jpg2png').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid JPG file', 'error');
    }
  });
  $('btn-convert-jpg2png').addEventListener('click', handleJpgToPng);
  $('btn-download-jpg2png').addEventListener('click', () => handleDownload('jpg2png'));
  $('btn-open-jpg2png').addEventListener('click', () => handleOpen('jpg2png'));

  // PNG to JPG
  const pngInput = setupFileInput('input-png2jpg', (files) => {
    const file = files[0];
    if (isValidPng(file)) {
      state.png2jpgFile = file;
      $('info-png2jpg').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid PNG file', 'error');
    }
  });
  setupDropZone('drop-png2jpg', 'input-png2jpg', (files) => {
    const file = files[0];
    if (isValidPng(file)) {
      state.png2jpgFile = file;
      $('info-png2jpg').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid PNG file', 'error');
    }
  });
  $('btn-convert-png2jpg').addEventListener('click', handlePngToJpg);
  $('btn-download-png2jpg').addEventListener('click', () => handleDownload('png2jpg'));
  $('btn-open-png2jpg').addEventListener('click', () => handleOpen('png2jpg'));

  // Enhance Image
  const enhanceInput = setupFileInput('input-enhance', (files) => {
    const file = files[0];
    if (isValidImage(file)) {
      state.enhanceFile = file;
      $('info-enhance').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid image file', 'error');
    }
  });
  setupDropZone('drop-enhance', 'input-enhance', (files) => {
    const file = files[0];
    if (isValidImage(file)) {
      state.enhanceFile = file;
      $('info-enhance').textContent = `${file.name} (${fileSizeString(file.size)})`;
    } else {
      showToast('Please select a valid image file', 'error');
    }
  });
  $('btn-convert-enhance').addEventListener('click', handleEnhanceImage);
  $('btn-download-enhance').addEventListener('click', () => handleDownload('enhance'));
  $('btn-open-enhance').addEventListener('click', () => handleOpen('enhance'));

  // Check if libraries are loaded
  setTimeout(() => {
    const jsPDF = window.jsPDF || (window.jspdf && window.jspdf.jsPDF);
    if (!jsPDF) {
      showToast('Warning: PDF library not loaded. Some features may not work.', 'error');
    }
    if (!window.JSZip) {
      showToast('Warning: ZIP library not loaded. Multi-file downloads may not work.', 'error');
    }
  }, 1000);
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}