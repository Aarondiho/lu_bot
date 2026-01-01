// --- CONFIGURATION (Based on Python Logic) ---
const CONFIG = {
    expectedWidth: 1000,
    expectedHeight: 1000,

    colors: {
        blueArrow: { hMin: 95, hMax: 125, sMin: 150, vMin: 100 }, // HSV
        whiteDots: { rMin: 200, gMin: 200, bMin: 200 }, // RGB
        skin: { rMin: 140, rMax: 255, gMin: 80, gMax: 200, bMin: 40, bMax: 160 } // Skin Tone
    },
    rois: {
        power: { x: 40, y: 600, w: 100, h: 600 },      // Left side, Full Height
        direction: { x: 580, y: 700, w: 200, h: 200 },  // Right Side
        pins: { x: 355, y: 400, w: 80, h: 70 }, // Pin Scan Area

        positionLeftArrow: { x: 130, y: 720 }, // Left Move Button
        positionRightArrow: { x: 870, y: 720 }, // Right Move Button
        playerWait: { x: 250, y: 1090, w: 150, h: 150 }, // Area to scan for Red T-Shirt
        gameFinished: { x: 200, y: 400, w: 600, h: 400 } // Center canvas scan (Blue Modal)
    }
};

// --- BACKGROUND KEEP-ALIVE (Anti-Throttling) ---
function keepAlive() {
    // 1. Create a dummy audio context
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    // Ultra-low frequency (silent to human ear usually, but gain 0 makes it truly silent)
    osc.frequency.value = 100;
    gain.gain.value = 0.001; // Effectively silent but active

    osc.start();

    // Periodically resume context if suspended (Chrome auto-suspends audio without user interaction)
    setInterval(() => {
        if (ctx.state === 'suspended') ctx.resume();
    }, 5000);

    console.log("ðŸ”Š Keep-Alive Audio Started");
}

// Call immediately (Autoplay policy might block it until interaction, 
// but since we simulate clicks, it will activate shortly)
try { keepAlive(); } catch (e) { }

// --- VOLUME LIMITER (Main World Injection) ---
function injectSilencer() {
    const script = document.createElement('script');
    script.textContent = `
        (function() {
            // 1. Force all HTML5 Audio/Video elements to 2% volume
            function tameMedia() {
                const media = document.querySelectorAll('audio, video');
                media.forEach(el => {
                    if (el.volume > 0.02) el.volume = 0.02;
                });
            }
            setInterval(tameMedia, 1000);

            // 2. Monkey-patch play() to catch new sounds immediately
            const originalPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function() {
                this.volume = 0.02;
                return originalPlay.apply(this, arguments);
            };
            
            console.log("ðŸ”Š Audio Silencer Active (2%)");
        })();
    `;
    (document.head || document.documentElement).appendChild(script);
}
injectSilencer();

// --- VISIBILITY SPOOFER REMOVED (Handled by Node App) ---




async function waitForRedShirt() {
    log("Waiting for Player (Red Zone) OR Game Finish...");

    const timeout = Date.now() + 60000; // 60s

    while (Date.now() < timeout) {
        // 1. PRIORITY: Check for Player
        const roi = CONFIG.rois.playerWait;
        const imageData = getPixelData(roi.x, roi.y, roi.w, roi.h);

        if (imageData) {
            let redPixels = 0;
            const totalPixels = imageData.data.length / 4;
            let sumR = 0, sumG = 0, sumB = 0;

            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                sumR += r; sumG += g; sumB += b;

                if (r > 90 && g < 50 && b < 50 && r > g * 2.0 && r > b * 2.0) {
                    redPixels++;
                }
            }

            const redRatio = redPixels / totalPixels;

            if (redRatio > 0.35) {
                // log(`Player Detected (Red Ratio: ${(redRatio * 100).toFixed(1)}%)`);
                return "PLAYER_FOUND"; // Custom return to distinguish
            }
        }

        // 2. SECONDARY: Check for Game Finished Modal
        // We check this every loop so we don't miss it
        if (await checkForGameFinished()) {
            log("GAME FINISHED DETECTED during wait!");
            // Wait for the full minute as requested or just return?
            // User said "scan till one munite but when player is present... start".
            // If Finished is found, the game is over. No need to wait further.
            return "GAME_FINISHED";
        }

        await sleep(200);
    }

    log("Player detection timed out.");
    return false;
}



// --- PINS LOGIC (ADVANCED PEAK DETECTION) ---
function scanPins(imageData) {
    const roi = CONFIG.rois.pins;
    // Layer 1: Scan ONLY Pin Tips (Top 40px of the ROI)
    // ROI is 1000px tall, but we only care about the top where heads are separated.
    const scanHeight = 40;

    let rawHistogram = new Array(roi.w).fill(0);

    // 1. Build Histogram (White Pixels in Top Band)
    // Padding 10px to avoid edge noise
    for (let x = 10; x < roi.w - 10; x++) {
        for (let y = 0; y < scanHeight; y += 2) {
            const idx = (y * roi.w + x) * 4;
            if (idx >= imageData.data.length - 4) continue;

            const r = imageData.data[idx];
            const g = imageData.data[idx + 1];
            const b = imageData.data[idx + 2];

            // Strict White for Tips
            if (r > 160 && g > 160 && b > 160) {
                rawHistogram[x]++;
            }
        }
    }

    // 2. Smooth Histogram (Window average to remove noise)
    let smoothed = new Array(roi.w).fill(0);
    const windowSize = 4;
    for (let x = windowSize; x < roi.w - windowSize; x++) {
        let sum = 0;
        for (let i = -windowSize; i <= windowSize; i++) {
            sum += rawHistogram[x + i];
        }
        smoothed[x] = sum / (windowSize * 2 + 1);
    }

    // 3. Detect Peaks (Local Maxima)
    // Each peak is roughly one pin head.
    let peaks = [];
    // Min height to be considered a pin tip (avoid dust)
    const peakThreshold = 2;

    for (let x = 10; x < roi.w - 10; x++) {
        if (smoothed[x] > peakThreshold &&
            smoothed[x] > smoothed[x - 1] &&
            smoothed[x] >= smoothed[x + 1]) { // >= allows flat tops

            // Filter close peaks (debounce)
            if (peaks.length === 0 || (x - peaks[peaks.length - 1]) > 10) {
                peaks.push(x);
            }
        }
    }

    return { peaks, smoothed };
}

function getPinTarget(pinResult) {
    const pins = pinResult.peaks; // Array of X coordinates
    if (!pins || pins.length === 0) return CONFIG.rois.pins.w / 2; // Fallback: Center
    const centerX = CONFIG.rois.pins.w / 2;

    const count = pins.length;
    // Sort peaks left-to-right
    pins.sort((a, b) => a - b);

    // CASE A: Single Pin (Direct Shot)
    if (count === 1) {
        return pins[0];
    }

    // CASE B: Full Rack (or mostly full) - Geometry Rule
    // User requested count >= 9.
    // Logic: Head pin is closest to center. Pin 3 is the next one to the right.
    if (count >= 10) {
        let headPin = pins[0];
        let minDist = Infinity;
        let headIndex = 0;

        for (let i = 0; i < count; i++) {
            const dist = Math.abs(pins[i] - centerX);
            if (dist < minDist) {
                minDist = dist;
                headPin = pins[i];
                headIndex = i;
            }
        }

        // Aim for the "Pocket" (Between Head and right neighbor)
        if (headIndex + 1 < count) {
            const pin3 = pins[headIndex + 1];
            return (headPin + pin3) / 2;
        } else {
            // No right neighbor (rare in full rack), just hit head right side
            return headPin + 15;
        }
    }

    // Calculate Spread for Grouping logic
    const minX = pins[0];
    const maxX = pins[pins.length - 1];
    const spread = maxX - minX;

    // CASE C: Compact Cluster (Tight Group)
    // All pins are close together. Aim at center of mass.
    if (spread < 50) {
        let sum = 0;
        pins.forEach(p => sum += p);
        return sum / count;
    }

    // CASE D: Split / Scattered (Logic: Find Clusters)
    // Group pins separated by gaps > 30px
    let clusters = [];
    let currentCluster = [pins[0]];

    for (let i = 1; i < pins.length; i++) {
        const gap = pins[i] - pins[i - 1];
        if (gap > 30) {
            clusters.push(currentCluster);
            currentCluster = [];
        }
        currentCluster.push(pins[i]);
    }
    clusters.push(currentCluster);

    // Decision Strategy:
    // 1. Pick Largest Cluster (Most pins)
    // 2. Tie-breaker: Pick Cluster closest to center lane
    clusters.sort((a, b) => {
        // Size descending
        if (b.length !== a.length) return b.length - a.length;

        // Distance ascending
        const centerA = a.reduce((s, v) => s + v, 0) / a.length;
        const centerB = b.reduce((s, v) => s + v, 0) / b.length;
        return Math.abs(centerA - centerX) - Math.abs(centerB - centerX);
    });

    const bestCluster = clusters[0];
    // Return average X of the best cluster
    let sum = 0;
    bestCluster.forEach(p => sum += p);
    return sum / bestCluster.length;
}




// --- VISUAL LOOP REMOVED ---


// --- GLOBAL STATE ---
let isRunning = false;
let botLoopId = null;
let currentPhase = "IDLE";
let round = 1;
let credentials = {};

// --- UTILITIES ---

function log() { }

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function sleepJitter(ms) {
    const variance = Math.floor(ms * 0.2);
    const time = ms + random(-variance, variance);
    return new Promise(resolve => setTimeout(resolve, Math.max(50, time)));
}

async function sleep(ms) {
    return sleepJitter(ms);
}

function rgbToHsv(r, g, b) {
    r /= 255, g /= 255, b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    let d = max - min;
    s = max == 0 ? 0 : d / max;
    if (max == min) { h = 0; }
    else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 179, s * 255, v * 255];
}

function getGameCanvas() {
    return document.querySelector('canvas');
}

function getPixelData(x, y, w, h) {
    const canvas = getGameCanvas();
    if (!canvas) return null;
    try {
        const ctx = canvas.getContext('2d') || canvas.getContext('webgl', { preserveDrawingBuffer: true });
        if (!ctx) return null;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

        return tempCtx.getImageData(0, 0, w, h);
    } catch (e) {
        return null;
    }
}

// --- HUMAN MOVEMENT HELPER ---
// --- HUMAN MOVEMENT HELPER ---
async function humanMoveTo(targetX, targetY) {
    // visual cursor removed, just sleep to simulate time
    const duration = random(400, 700);
    await sleep(duration);
}

async function simulateClick(x, y) {
    const canvas = getGameCanvas();

    // Jitter
    const jX = x + random(-3, 3);
    const jY = y + random(-3, 3);

    let clientX, clientY;

    if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / CONFIG.expectedWidth;
        const scaleY = rect.height / CONFIG.expectedHeight;

        clientX = rect.left + (jX * scaleX);
        clientY = rect.top + (jY * scaleY);
    } else {
        // Web Mode: Coordinates are Document Pixels
        // Scroll into view if needed
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const vH = window.innerHeight;
        const vW = window.innerWidth;

        // Check if out of viewport
        if (jY < scrollY || jY > scrollY + vH || jX < scrollX || jX > scrollX + vW) {
            log(`Scrolling to ${jX},${jY}...`);
            window.scrollTo({
                top: Math.max(0, jY - vH / 2),
                left: Math.max(0, jX - vW / 2),
                behavior: 'instant'
            });
        }

        // Recalculate Client (Viewport) Coordinates after potential scroll
        clientX = jX - window.scrollX;
        clientY = jY - window.scrollY;
    }

    const targetElement = document.elementFromPoint(clientX, clientY) || (canvas || document.body);

    // Visuals
    // CONDITIONAL: Disable human movement on Game Page (Prohibited per user)
    if (!window.location.href.toLowerCase().includes("playgame")) {
        await humanMoveTo(clientX, clientY);
    }

    const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: clientX,
        clientY: clientY,
        pointerId: 1,
        isPrimary: true
    };

    targetElement.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
    targetElement.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    targetElement.dispatchEvent(new PointerEvent('pointerup', eventOptions));
    targetElement.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    targetElement.dispatchEvent(new MouseEvent('click', eventOptions));
}

// --- CORE LOGIC ---

// --- WATCHDOG REMOVED ---
function resetWatchdog() { }


// --- SMART INTERACTION ---
// --- SMART INTERACTION ---
async function smartClickText(textToFind) {
    log(`Looking for link containing: "${textToFind}"...`);

    // Find all potential elements: links, buttons, spans
    // EXCUDED generic 'div' to prevent matching the whole container
    const elements = Array.from(document.querySelectorAll('a, button, li, span'));

    // Filter and Collect all candidates
    const candidates = elements.filter(el => {
        // Skip hidden elements
        if (el.offsetParent === null) return false;

        // Strict Text Match: Avoid matching massive containers with lots of text
        // Check if the element ITSELF contains the text, not just its children
        // (A simple way is to check if innerText length is reasonable, < 50 chars)
        if (el.innerText.length > 50) return false;

        const textMatch = el.innerText && el.innerText.toLowerCase().includes(textToFind.toLowerCase());
        const hrefMatch = el.href && el.href.toLowerCase().includes(textToFind.toLowerCase());

        return textMatch || hrefMatch;
    });

    if (candidates.length > 0) {
        // SORT by Vertical Position (Y) to find the TOP-Most one (Main Menu)
        candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.top - rectB.top;
        });

        // Pick the top-most one
        const target = candidates[0];

        log(`Found ${candidates.length} candidates for "${textToFind}". Picking top-most.`);
        const rect = target.getBoundingClientRect();

        // Calculate center of element relative to DOCUMENT (including scroll)
        // USER REQUEST: Offset X by 
        const x = rect.left + (rect.width / 2) + window.scrollX;
        const y = rect.top + (rect.height / 2) + window.scrollY;

        log(`Clicking at ${x.toFixed(0)}, ${y.toFixed(0)}`);
        await simulateClick(x, y);
        return true;
    } else {
        log(`Could NOT find element: "${textToFind}"`);
        return false;
    }
}

// --- PIXEL SCANNING ---
async function scanAndClick(name, x, y, colorCheckFn, timeout = 15000) {
    log(`Scanning for ${name} at ${x},${y}...`);
    const start = Date.now();
    const size = 20;


    while (Date.now() - start < timeout) {
        // Scan a 20x20 area around the target center
        const img = getPixelData(x - size / 2, y - size / 2, size, size);

        if (img) {
            let matches = 0;
            const total = img.data.length / 4;

            for (let i = 0; i < img.data.length; i += 4) {
                const r = img.data[i];
                const g = img.data[i + 1];
                const b = img.data[i + 2];

                if (colorCheckFn(r, g, b)) {
                    matches++;
                }
            }

            // If > 30% of pixels match, assume it's the button
            if (matches > total * 0.3) {
                // log(`${name} Detected! Clicking...`);
                // Briefly flash green
                simulateClick(x, y);
                return true;
            }
        }
        await sleep(200); // Scan interval
    }

    log(`${name} NOT found (Timeout). Skipping...`);
    return false;
}

// --- GAME FINISHED DETECTION ---
async function checkForGameFinished() {
    // log("Checking for Game Finished Modal...");
    const roi = { x: 200, y: 400, w: 600, h: 400 }; // Updated coordinates

    const imageData = getPixelData(roi.x, roi.y, roi.w, roi.h);

    if (imageData) {
        let bluePixels = 0;
        let whitePixels = 0;
        const total = imageData.data.length / 4;

        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];

            // Check for Modal Blue Background (Deep Blue/Gradient)
            if (b > r + 30 && b > g + 30 && b > 80) {
                bluePixels++;
            }
            // Check for White Text (High brightness)
            if (r > 210 && g > 210 && b > 210) {
                whitePixels++;
            }
        }

        const bRatio = bluePixels / total;
        const wRatio = whitePixels / total;

        // Log ratios so user can adjust if needed
        // Log ratios so user can adjust if needed
        if (bRatio > 0.1 || wRatio > 0.05) {
            // updateStatus removed
        }

        // Trigger if reasonable amount of blue (modal background) is found
        if (bRatio > 0.3) {
            // log(`GAME FINISHED DETECTED (Blue: ${(bRatio * 100).toFixed(1)}%)`);
            return true;
        }
    }
    return false;
}

async function runBotLoop() {
    resetWatchdog();
    if (currentPhase === "SETUP") {
        log("Running Setup...");

        // Mark as Playing for persistence
        localStorage.setItem('bot_status', 'PLAYING');

        // Wait for visual loop to start for feedback
        // Wait for visual loop to start for feedback
        // startVisualLoop();

        const probe = getPixelData(500, 500, 10, 10);
        if (!probe) {
            log("CRITICAL: Cannot read Game Canvas!");
            await sleep(2000);
            setTimeout(runBotLoop, 100);
            return;
        }

        // Give canvas a moment to render
        await sleep(2000);

        /* SMART DISMISSAL LOGIC */

        // 1. Tangura (White)
        // Check for bright white pixels
        await scanAndClick('Tangura (White)', 400, 500, (r, g, b) => r > 200 && g > 200 && b > 200);
        await sleep(1000);

        // 2. Play Button (Blue)
        // Check for dominant blue
        simulateClick(500, 700); //Dismiss blue play button I
        await sleep(1000);


        // 3. Hint Modal (Blue) 
        // Same blue check
        simulateClick(500, 750);
        await sleep(1000);


        currentPhase = "PLAY_ROUND";
        // Use setTimeout instead of requestAnimationFrame for background execution
        setTimeout(runBotLoop, 50);
    }

    else if (currentPhase === "PLAY_ROUND") {
        log(`--- Round ${round} Starting ---`);

        // 1. INTELLIGENT POSITIONING (DEAD RECKONING)
        log("Checking alignment (Dead Reckoning)...");
        await sleep(500);

        // Fixed Start Position: Absolute 470 -> Relative 270 (470 - 355)
        let currentPlayerX = 35;
        const alignTimeout = Date.now() + 20000; // 20s Limit (Increased for slow clicks)

        while (Date.now() < alignTimeout) {
            const fullRoi = CONFIG.rois.pins;
            const fullImage = getPixelData(fullRoi.x, fullRoi.y, fullRoi.w, fullRoi.h);

            if (fullImage) {
                const pinResult = scanPins(fullImage);
                // NO scanPlayer used here. We assume 'currentPlayerX'.

                // Update Visuals
                if (pinResult) {
                    const bestTarget = getPinTarget(pinResult)

                    // Logic Update: Compare RELATIVE coordinates
                    // currentPlayerX is relative (e.g. 115)
                    // bestTarget is relative (e.g. 40)
                    const diff1 = bestTarget - currentPlayerX;

                    const diff = diff1 > 0 ? diff1 + 17.5 : diff1 - 15.5;


                    // STRICT Alignment Check (Tolerance 3px - slightly less than 1 step of ~4.4px)
                    if (Math.abs(diff) > 2.5) {
                        // log(`Aligning: Target=${bestTarget.toFixed(0)} Player=${currentPlayerX.toFixed(0)} Diff=${diff.toFixed(0)}`);


                        // Dynamic Step Size: Width / 18 clicks
                        const stepSize = (CONFIG.rois.pins.w / 18);

                        if (diff > 0) {
                            simulateClick(CONFIG.rois.positionRightArrow.x, CONFIG.rois.positionRightArrow.y);
                            currentPlayerX += stepSize; // Dead Reckoning Update
                        } else {
                            simulateClick(CONFIG.rois.positionLeftArrow.x, CONFIG.rois.positionLeftArrow.y);
                            currentPlayerX -= stepSize; // Dead Reckoning Update
                        }
                        await sleep(1000); // 1s Move delay per user request
                    } else {
                        // log(`Aligned! (Diff ${diff.toFixed(0)})`);
                        break;
                    }
                } else {
                    await sleep(50);
                }
            } else {
                await sleep(50);
            }
        }

        log("Positioning Done. Waiting 10s...");

        // 2. Power Scan
        simulateClick(500, 500);

        let powerFull = false;
        let pTimeout = Date.now() + 5000;

        while (Date.now() < pTimeout && !powerFull) {
            const imageData = getPixelData(CONFIG.rois.power.x, CONFIG.rois.power.y, CONFIG.rois.power.w, CONFIG.rois.power.h);
            if (imageData) {
                let whitePixels = 0;
                for (let i = 0; i < imageData.data.length; i += 4) {
                    if (imageData.data[i] > 200 && imageData.data[i + 1] > 200 && imageData.data[i + 2] > 200) {
                        whitePixels++;
                    }
                }

                if (whitePixels > 1380) {
                    powerFull = true;
                    // log(`Power Full! (Pixels: ${whitePixels})`);
                    simulateClick(500, 500);
                }
            }
            await new Promise(r => setTimeout(r, 60));

        }

        if (!powerFull) {
            log("Power Timeout. Firing fallback.");
            simulateClick(500, 420);
        }

        // 3. Direction Scan
        let arrowDetected = false;
        let dTimeout = Date.now() + 10000;

        while (Date.now() < dTimeout && !arrowDetected) {
            const imageData = getPixelData(CONFIG.rois.direction.x, CONFIG.rois.direction.y, CONFIG.rois.direction.w, CONFIG.rois.direction.h);
            if (!imageData) break;

            const roiW = CONFIG.rois.direction.w;
            const targetX = 100;
            let bluePixels = 0;
            let sumX = 0;

            for (let y = 0; y < CONFIG.rois.direction.h; y += 4) {
                for (let x = 0; x < roiW; x += 4) {
                    const idx = (y * roiW + x) * 4;
                    const [H, S, V] = rgbToHsv(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
                    if (H >= 95 && H <= 125 && S >= 150 && V >= 100) {
                        bluePixels++;
                        sumX += x;
                    }
                }
            }

            let avgX = 0;
            if (bluePixels > 10) {
                avgX = sumX / bluePixels;
                if (Math.abs(avgX - targetX) < 1.5) { // Strict Tolerance
                    arrowDetected = true;
                    // log(`FIRE! X=${avgX.toFixed(1)}`);
                    simulateClick(500, 420);
                    await sleep(1000);
                }
            }


            await new Promise(r => setTimeout(r, 30));

        }

        if (!arrowDetected) {
            log("Direction Timeout. Firing blind.");
            simulateClick(500, 420);
        }

        log("Round Complete. Waiting for animation...");
        await sleep(8000); // Wait for ball roll / player to disappear

        log("Checking for Next Round...");

        log("Checking for Next Round...");

        const scanResult = await waitForRedShirt();

        if (scanResult === "PLAYER_FOUND" || scanResult === true) { // Backward compat boolean just in case
            round++;
        } else if (scanResult === "GAME_FINISHED") {
            log("GAME FINISHED DETECTED!");
            log("Standing by for Redirect to Homepage...");
            // Do nothing, just exit loop. The game will redirect us.
            return;
        } else {
            // Timeout - no player, no finish modal.
            // We could re-check finished one last time or just loop.
            log("Warning: Player not found after timeout. Retrying loop...");
        }

        runBotLoop();

    }
}

// --- MESSAGING ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 3. Content Script Request to Maximize
    // MAXIMIZE_WINDOW request removed

    if (request.action === "start") {
        if (!isRunning) {
            isRunning = true;
            if (request.credentials) credentials = request.credentials;
            log("Received MANUAL START.");
            currentPhase = "SETUP";
            runBotLoop();
            sendResponse({ success: true });
        }
    } else if (request.action === "stop") {
        isRunning = false;
        log("Received STOP.");
    }
});

// --- LOGIN LOGIC (Same as before) ---
async function waitForPageLoad() {
    log("Waiting for Page Load...");
    if (document.readyState !== 'complete') {
        await new Promise(resolve => window.addEventListener('load', resolve));
    }
    await sleep(2000);
    log("Page Fully Loaded.");
}



async function performLogin() {
    log("Status: On Login Page.");

    if (localStorage.getItem('bot_status') === 'START_NEW_SESSION') {
        log("Status: START_NEW_SESSION. Proceeding to Login...");
        localStorage.setItem('bot_status', 'LOGGING_IN'); // Advance state so we don't loop
    }



    // Attempt fullscreen early
    // Attempt fullscreen early - REMOVED


    await waitForPageLoad();
    log("Waiting 1s before logic...");
    await sleep(1000);

    let attempts = 0;
    let phoneIn, passIn, btn;

    while (attempts < 10) {
        // Updated Selectors based on specific DOM IDs found
        phoneIn = document.getElementById('msisdn') || document.querySelector('input[name="phone"]');
        passIn = document.getElementById('password') || document.querySelector('input[name="password"]');
        btn = document.getElementById('login') ||
            document.querySelector('button[type="submit"]') ||
            Array.from(document.querySelectorAll('button')).find(b => b.innerText.toUpperCase().includes('LOGIN'));

        if (phoneIn && passIn && btn) break;
        await sleep(500);
        attempts++;
    }

    if (phoneIn && passIn && btn) {
        log(`Filling credentials (Human-like)...`);

        // Human-like Typing Function
        async function typeHuman(element, text) {
            element.focus();
            element.value = "";
            for (let i = 0; i < text.length; i++) {
                element.value += text[i];
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keydown', { key: text[i], bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keyup', { key: text[i], bubbles: true }));
                await sleep(random(50, 150)); // Random typing speed
            }
            await sleep(500);
        }

        // Human-like Mouse Move (Uses global Bezier helper)
        async function moveMouseHuman(targetElem) {
            const rect = targetElem.getBoundingClientRect();
            const targetX = rect.left + (rect.width / 2);
            const targetY = rect.top + (rect.height / 2);

            // Use the global function which has the new Bezier logic
            await humanMoveTo(targetX, targetY);

            // Dispatch mousemove to fool basic trackers (humanMoveTo does visual only usually, but let's ensure events)
            // Actually humanMoveTo does NOT dispatch events, only moves cursor div. 
            // We need to dispatch events here if needed, but simulateClick deals with clicks.
            // For hover emulation:
            document.dispatchEvent(new MouseEvent('mousemove', {
                view: window, bubbles: true, cancelable: true,
                clientX: targetX, clientY: targetY
            }));
        }

        // Execute Sequence
        await moveMouseHuman(phoneIn);
        await typeHuman(phoneIn, credentials.phone);

        await moveMouseHuman(passIn);
        await typeHuman(passIn, credentials.password);

        await moveMouseHuman(btn);
        await sleep(500);
        btn.click();

        log("Login Clicked. Waiting for redirect...");

        await sleep(30000);
        let redirectTimeout = Date.now() + 20000;
        while (Date.now() < redirectTimeout) {
            const currentUrl = window.location.href.toLowerCase();

            if (currentUrl.includes("playgame")) {
                log("Redirect Detected!");
                isRunning = true;
                currentPhase = "SETUP";
                runBotLoop();
                return;
            }

            if (currentUrl.includes("home/index") || currentUrl.includes("/home") || currentUrl === "https://bowling.lumitel.bi/") {
                log("Homepage Detected. Redirecting...");

                await sleep(5000);

                // CHECK REMAINING PLAYS HERE
                if (await checkRemainingPlays()) {
                    log("Smart Clicking Rank Menu...");
                    await smartClickText("Ranking");
                }
                return;
            }

            // CHECK: If we are stuck on Profile Page for some reason
            if (currentUrl.includes("profile")) {
                log("On Profile Page. Moving to Ranking...");
                await smartClickText("Ranking");
                await sleep(5000); // Wait for nav
            }

            await sleep(500);
        }
        log("Warning: Redirection timeout.");
    } else {
        log("Error: Login fields not found!");
    }
}

// --- PROFILE CHECK ---
async function checkRemainingPlays() {
    log("Checking Remaining Plays...");

    // FIX: Don't click Profile if we are ALREADY there!
    if (!window.location.href.toLowerCase().includes("profile")) {
        // Try to click Profile
        const profileClicked = await smartClickText("PROFILE");
        if (!profileClicked) {
            // Try "Profile" or "My Profile"
            const altClicked = await smartClickText("Profile");
            if (!altClicked) {
                log("Could not find 'PROFILE' menu. Skipping Play Count check...");
                return true; // Default to allow
            }
        }
    } else {
        log("Already on Profile Page. Scanning content...");
    }

    log("Waiting 3s for Profile content...");
    await sleep(3000);

    // ROBUST SEARCH Strategy
    const bodyText = document.body.innerText || "";
    // Regex to find "TOTAL REMAINING PLAY" followed by a colon and number
    const playMatch = bodyText.match(/TOTAL\s+REMAINING\s+PLAY\s*[:]\s*(\d+)/i);

    if (playMatch) {
        const num = parseInt(playMatch[1]);
        log(`SCANNED PLAY COUNT: ${num}`);
        log(`SCANNED PLAY COUNT: ${num}`);

        if (num > 0) {
            log("Plays available (>0). VERIFIED.");
            // FIX: Navigate AWAY from Profile immediately to avoid getting stuck
            log("Navigating to Ranking...");
            await smartClickText("Ranking");
            await sleep(2000);

            if (window.location.href.toLowerCase().includes("profile")) {
                window.location.href = "https://bowling.lumitel.bi/Game/Ranking";
            }
            return true;
        } else {
            // STRICT STOP
            log("STOPPING: 0 Remaining Plays detected.");
            log("STOPPING: 0 Remaining Plays detected.");
            alert("STOP: You have 0 Remaining Plays.");
            isRunning = false;
            return false;
        }
    } else {
        log("ERROR: Could not find 'TOTAL REMAINING PLAY' text on page.");
        log("Verification Failed. Stopping bot to be safe.");
        log("Verification Failed. Stopping bot to be safe.");
        isRunning = false;
        return false;
    }
}

// --- RANKING LOGIC ---
async function checkRanking() {
    log("Checking Ranking...");
    await waitForPageLoad();
    log("Waiting 5s before logic...");
    await sleep(5000);
    log("Waiting 5s before logic...");
    await sleep(5000);

    // Give the page a moment to render the list
    await sleep(2000);

    // Selector based on user provided HTML
    // <div class="hoc"><ul><li><span>1</span> 25765***641</li>...</ul></div>
    const listItems = document.querySelectorAll('div.hoc ul li');
    if (listItems.length > 0) {
        const firstItem = listItems[0];
        const span = firstItem.querySelector('span');

        // Ensure this is indeed Rank #1
        if (span && span.innerText.trim() === '1') {
            const rawText = firstItem.innerText; // "1 25765***641"
            // Remove the rank number "1" to get the phone part
            const phoneText = rawText.replace('1', '').trim(); // "25765***641"

            log(`Top Player: ${phoneText}`);

            if (credentials.phone) {
                // Construct Expected Mask
                // Format: 257 + XX + *** + XXX
                // User Phone: 61552799 (8 digits) or 25761552799
                // Let's normalize user phone to 8 digits
                let p = credentials.phone.toString().replace(/\D/g, ''); // "61552799"
                if (p.startsWith('257') && p.length > 8) {
                    p = p.substring(3);
                }

                // e.g. "61552799" -> "61" + "***" + "799" -> "25761***799"
                const first2 = p.substring(0, 2);
                const last3 = p.substring(p.length - 3);
                const expectedMask = `257${first2}***${last3}`;

                log(`My Pattern: ${expectedMask}`);

                if (phoneText === expectedMask) {
                    log("ðŸ† YOU ARE RANK #1! STOPPING BOT.");
                    // Stop everything
                    isRunning = false;
                    alert("CONGRATULATIONS! You are Rank #1. Bot Stopped.");
                    return;
                } else {
                    log("You are not #1. Proceeding to Game...");
                }
            } else {
                log("No credentials found to verify rank. Proceeding...");
            }
        }
    } else {
        log("Could not find ranking list.");
    }

    // Proceed if not #1 or list not found
    await sleep(5000);
    log("Navigating to Game (Smart Click)...");
    await smartClickText("Play Game"); // Match Visible Text "PLAY GAME"
    // simulateClick(400, 30); // Click Playgame Menu Item
    // window.location.href = "https://bowling.lumitel.bi/Bowling/Playgame";
}

// --- VISUAL UI REMOVED ---





// --- AUTO-START ---
(async function () {
    // createVisuals() removed
    log("Checking State...");

    const params = new URLSearchParams(window.location.search);
    const onLoginPage = window.location.href.includes("Login");
    const onGamePage = window.location.href.includes("Playgame");
    const onRankingPage = window.location.href.includes("Game/Ranking");
    const onHomePage = window.location.href.includes("Home/Index") || window.location.pathname === "/";
    const onProfilePage = window.location.href.includes("Profile");

    if (params.has('auto_user') && params.has('auto_pass')) {
        log("Auto-Login Params Detected.");
        credentials.phone = params.get('auto_user');
        credentials.password = params.get('auto_pass');
        credentials.password = params.get('auto_pass');
        // PERSIST: Save to Local Storage so we remember who we are after redirects
        localStorage.setItem('bot_phone', credentials.phone);
        localStorage.setItem('bot_pass', credentials.password);
    } else {
        // RECOVER: Check if we have saved creds
        const savedPhone = localStorage.getItem('bot_phone');
        const savedPass = localStorage.getItem('bot_pass');
        if (savedPhone && savedPass) {
            log("Recovered Credentials from LocalStorage.");
            credentials.phone = savedPhone;
            credentials.password = savedPass;
        }
    }

    if (credentials.phone && credentials.password) {
        if (onLoginPage) {
            log("Credentials Present. initiating Auto-Login...");
            performLogin();
        } else if (onGamePage) {
            isRunning = true;
            currentPhase = "SETUP";
            runBotLoop();
        } else if (onRankingPage) {
            // FIXED: Do NOT overwrite credentials with null params here
            checkRanking();
        } else if (onHomePage) {
            log("Homepage detected ");
            await sleep(1000);

            if (await checkRemainingPlays()) {
                log("On Homepage with params. Smart Clicking Rank Menu...");
                await smartClickText("Ranking");
            }
        } else if (onProfilePage) {
            log("State: PROFILE PAGE. Checking plays...");
            await sleep(2000);
            if (await checkRemainingPlays()) {
                // Verified. checkRemainingPlays handles nav.
            }
        }
        return;
    }

    if (onGamePage) {
        // log("Requesting Fullscreen...");


        await waitForPageLoad();
        log("Game Page Detected! Waiting 5s before Play...");
        await sleep(5000);
        log("Starting Bot...");
        isRunning = true;
        currentPhase = "SETUP";
        runBotLoop();
        return;
    }

    if (onRankingPage) {
        // Wait for creds via message usually
        log("Ranking Page Detected. Waiting for credentials...");
        // We rely on the message below

        await sleep(200);
        log("Navigating to Game (Smart Click)...");
        await smartClickText("Play Game");
    }

    if (onHomePage) {

        log("Homepage detected");
        await sleep(1000);

        if (await checkRemainingPlays()) {
            log("Homepage with params. Smart Clicking Rank Menu...");
            await smartClickText("Ranking");
        }
    }

    try {
        chrome.runtime.sendMessage({ action: "GET_MY_CREDS" }, (response) => {
            if (response && response.success && response.credentials) {
                log("Received Drag/Drop Credentials.");
                credentials = response.credentials;
                isRunning = true;
                if (onLoginPage) performLogin();
                else if (onGamePage) runBotLoop();
                else if (onRankingPage) checkRanking();
            }
        });
    } catch (e) { }
})();