/**
 * Hand Tracking AR - Tetris
 */

import { GestureRecognizer, FilesetResolver } from 
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { Tetris } from "./tetris.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    accent: '#000000',
    accentDim: 'rgba(0, 0, 0, 0.6)',
    accentVeryDim: 'rgba(0, 0, 0, 0.1)',
    white: 'rgba(0, 0, 0, 0.9)',
    whiteDim: 'rgba(0, 0, 0, 0.4)',
    warning: '#000000',
    bg: '#ffffff',
    zoneLine: 'rgba(0, 0, 0, 0.1)'
};

const PINCH_THRESHOLD = 0.08; // More forgiving pinch detection

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let gestureRecognizer = null;
let tetris = new Tetris();
let video, canvas, ctx;
let isRunning = false;

let hands = { left: null, right: null };
let pinchDistances = { left: null, right: null };
let lastPinchState = { left: false, right: false };

// HUD State
let fps = 0;
let lastTime = 0;
let frameCount = 0;

// System Log State
let systemLogs = [];
function addLog(msg) {
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    systemLogs.push(`[${timestamp}] ${msg}`);
    if (systemLogs.length > 8) systemLogs.shift();
    console.log(`[SYS] ${msg}`);
}
window.addLog = addLog;

// Smoothing (Low-pass filter)
let smoothedData = {
    left: { dist: 0, pos: { x: 0, y: 0 } },
    right: { dist: 0, pos: { x: 0, y: 0 } }
};
const LERP_FACTOR = 0.2;


// UI Elements
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start-btn');
const distanceDisplay = document.getElementById('distance-display');
const handDistanceEls = distanceDisplay.querySelectorAll('.hand-distance span');

// Hide legacy UI elements that aren't needed for the pure HUD
statusEl.style.display = 'none';
distanceDisplay.style.display = 'none';

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

async function init() {
    console.log('Initializing System...');
    try {
        statusEl.textContent = 'System.Loading';

        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        console.log('FilesetResolver loaded');

        try {
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2
        });
        } catch (gpuError) {
            console.warn('GPU acceleration failed, falling back to CPU', gpuError);
            gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
                    delegate: "CPU"
                },
                runningMode: "VIDEO",
                numHands: 2
            });
        }
        console.log('GestureRecognizer created');

        setupCanvas();
        statusEl.textContent = 'System.Ready';
        console.log('System Ready');
        
        startBtn.addEventListener('click', start);

    } catch (error) {
        console.error('Init error:', error);
        statusEl.textContent = 'System.Error';
    }
}

function setupCanvas() {
    video = document.getElementById('video');
    canvas = document.getElementById('video-canvas');
    ctx = canvas.getContext('2d');
    
    resize();
    window.addEventListener('resize', resize);
    
    // Start preview loop immediately (shows Tetris without camera)
    previewLoop();
}

function previewLoop() {
    if (isRunning) return; // Stop preview when tracking starts
    
    const now = performance.now();
    const w = canvas.width;
    const h = canvas.height;
    
    // Update tetris without hand input in preview mode
    tetris.update(now, null, null, w, h);
    
    // Clear canvas to transparent (let background grid show through)
    ctx.clearRect(0, 0, w, h);
    
    tetris.draw(ctx, w, h);
    drawSystemData(w, h);
    
    requestAnimationFrame(previewLoop);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// ═══════════════════════════════════════════════════════════════════════════
// CAMERA & TRACKING
// ═══════════════════════════════════════════════════════════════════════════

async function start() {
    console.log('Start sequence initiated');
    try {
        statusEl.textContent = 'Accessing_Core';
        
        // Safari fix: Start video play before/during stream acquisition
        video.setAttribute('playsinline', '');
        video.setAttribute('muted', '');
        video.muted = true;

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 }, 
                height: { ideal: 720 }, 
                facingMode: 'user' 
            }
        });

        video.srcObject = stream;

        // Wait for video to be ready to play
        video.onloadedmetadata = () => {
            video.play()
                .then(() => {
                    console.log('Video playback started');
        isRunning = true;
        startBtn.classList.add('active');
                    statusEl.textContent = 'Tracking.Active';
        detect();
                })
                .catch(err => {
                    console.error('Video play rejected:', err);
                    statusEl.textContent = 'Playback_Err';
                });
        };

    } catch (error) {
        console.error('Start error:', error);
        statusEl.textContent = error.name === 'NotAllowedError' ? 'Cam_Denied' : 'Auth_Failed';
    }
}

function detect() {
    if (!isRunning) return;

    const now = performance.now();
    
    // FPS Calc
    frameCount++;
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
    }

    const results = gestureRecognizer.recognizeForVideo(video, now);

    // Reset hands state
    hands = { left: null, right: null };
    pinchDistances = { left: null, right: null };

    if (results.landmarks && results.landmarks.length > 0) {
        for (let i = 0; i < results.landmarks.length; i++) {
            const landmarks = results.landmarks[i];
            const handedness = results.handednesses[i][0].categoryName;
            
            const handKey = handedness === 'Right' ? 'left' : 'right';
            hands[handKey] = { landmarks };
            
            const thumbTip = landmarks[4];
            const indexTip = landmarks[8];
            const dx = thumbTip.x - indexTip.x;
            const dy = thumbTip.y - indexTip.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            pinchDistances[handKey] = dist;
            
            // Smoothing
            smoothedData[handKey].dist += (dist - smoothedData[handKey].dist) * LERP_FACTOR;
            
            const midX = (thumbTip.x + indexTip.x) / 2;
            const midY = (thumbTip.y + indexTip.y) / 2;
            smoothedData[handKey].pos.x += (midX - smoothedData[handKey].pos.x) * LERP_FACTOR;
            smoothedData[handKey].pos.y += (midY - smoothedData[handKey].pos.y) * LERP_FACTOR;
            
            // Check for state transitions
            const isPinching = dist < PINCH_THRESHOLD;
            if (isPinching !== lastPinchState[handKey]) {
                lastPinchState[handKey] = isPinching;
            }
        }
    }
    
    tetris.update(performance.now(), hands, pinchDistances, canvas.width, canvas.height);
    draw();
    
    requestAnimationFrame(detect);
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════════

function updateHUD() {
    const lDist = pinchDistances.left;
    const rDist = pinchDistances.right;
    
    handDistanceEls[0].textContent = lDist !== null ? (lDist * 100).toFixed(2) : '--';
    handDistanceEls[1].textContent = rDist !== null ? (rDist * 100).toFixed(2) : '--';
}

function draw() {
    const w = canvas.width;
    const h = canvas.height;
    
    // Clear canvas to transparent (let background grid show through)
    ctx.clearRect(0, 0, w, h);
    
    // Tetris board (centered, on top of background)
    tetris.draw(ctx, w, h);
    
    drawSystemData(w, h);

    ['left', 'right'].forEach(handKey => {
        if (hands[handKey]) {
            drawHandVisuals(handKey, w, h);
        }
    });
}

function drawSystemData(w, h) {
    ctx.font = '8px "JetBrains Mono"';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.textAlign = 'left';
    ctx.fillText(`FPS:${fps} RES:${w}x${h}`, 30, h - 30);
}

function drawHandVisuals(handKey, w, h) {
    const landmarks = hands[handKey].landmarks;
    const rawDist = pinchDistances[handKey];
    const isPinching = rawDist < PINCH_THRESHOLD;
    
    // Get interaction state from tetris
    const interaction = tetris.interactionState[handKey];
    const grabbedColor = tetris.getGrabbedPieceColor(handKey);
    const handColor = grabbedColor || (isPinching ? COLORS.accent : COLORS.white);
    
    const thumb = getScreenPos(landmarks[4], w, h);
    const index = getScreenPos(landmarks[8], w, h);
    const wrist = getScreenPos(landmarks[0], w, h);
    const midX = (thumb.x + index.x) / 2;
    const midY = (thumb.y + index.y) / 2;

    // Draw Connection to Wrist
    ctx.beginPath();
    ctx.moveTo(wrist.x, wrist.y);
    ctx.lineTo(thumb.x, thumb.y);
    ctx.moveTo(wrist.x, wrist.y);
    ctx.lineTo(index.x, index.y);
    ctx.strokeStyle = COLORS.whiteDim;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Targeting/Grabbing Line to target piece
    if (interaction.target) {
        const targetX = interaction.target.screenX;
        const targetY = interaction.target.screenY;
        
        ctx.beginPath();
        ctx.moveTo(midX, midY);
        ctx.lineTo(targetX, targetY);
        ctx.strokeStyle = grabbedColor || (isPinching ? COLORS.accent : 'rgba(0, 0, 0, 0.5)');
        ctx.lineWidth = isPinching ? 1.5 : 0.8;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Visual proximity indicator (circle around target when targeting)
        if (interaction.state === 'TARGETING') {
            ctx.strokeStyle = interaction.target.color || 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(targetX, targetY, 20, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Draw Connector Line (Pinch)
    ctx.beginPath();
    ctx.moveTo(thumb.x, thumb.y);
    ctx.lineTo(index.x, index.y);
    ctx.strokeStyle = handColor;
    ctx.lineWidth = isPinching ? 2 : 0.8;
    ctx.setLineDash(isPinching ? [] : [3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Landmarks
    [thumb, index].forEach((pos) => {
        const size = isPinching ? 6 : 4;
        ctx.fillStyle = handColor;
        ctx.fillRect(pos.x - size/2, pos.y - size/2, size, size);
        
        // Technical crosshair
        ctx.strokeStyle = handColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(pos.x - 12, pos.y);
        ctx.lineTo(pos.x + 12, pos.y);
        ctx.moveTo(pos.x, pos.y - 12);
        ctx.lineTo(pos.x, pos.y + 12);
        ctx.stroke();
    });

    // State Label
    ctx.font = '9px "JetBrains Mono"';
    ctx.fillStyle = handColor;
    ctx.textAlign = 'left';
    ctx.fillText(`${handKey.toUpperCase()}_STATE: ${interaction.state}`, midX + 25, midY - 5);
    
    if (interaction.state === 'DRAGGING' || interaction.state === 'GRABBING') {
        ctx.font = 'bold 8px "Orbitron"';
        ctx.fillStyle = handColor;
        
        if (interaction.isPlayZoneGrab) {
            // Check if two-handed mode
            const otherSide = handKey === 'left' ? 'right' : 'left';
            const otherInteraction = tetris.interactionState[otherSide];
            const isTwoHanded = otherInteraction.isPlayZoneGrab && 
                               otherInteraction.state === 'DRAGGING';
            
            if (isTwoHanded) {
                // Two-handed mode - show role
                ctx.fillText(handKey === 'left' ? 'MOVE ← →' : 'ROTATE ↻', midX + 25, midY + 10);
            } else {
                // Single-handed mode
                ctx.fillText('CONTROL_ACTIVE', midX + 25, midY + 10);
                ctx.font = '7px "JetBrains Mono"';
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillText('CIRCLE=ROTATE  DRAG=MOVE', midX + 25, midY + 22);
            }
        } else {
            // Spawn zone or hold - can drag freely
            ctx.fillText(interaction.state === 'DRAGGING' ? 'MOVING_TO_HOLD' : 'LOCK_ACQUIRED', midX + 25, midY + 10);
        }
    }
}

function getScreenPos(landmark, w, h) {
    return {
        x: (1 - landmark.x) * w, // Mirrored
        y: landmark.y * h
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

init();
