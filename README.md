# Hand-tracking Tetris

Tetris you play in the air. The webcam tracks your hands, and a pinch of thumb and index finger grabs, steers, rotates and drops the pieces. It runs entirely in the browser with no build step and no server-side code.

## How to play

1. Press **Initialize** and allow camera access.
2. Pinch (thumb and index finger together) over a piece in the spawn zone to grab it. Release to let it fall.
3. Move your hand while pinching to steer the piece.
4. Trace a circle to rotate it. The angle of the circle snaps to quarter turns.
5. With two hands in view, the left hand moves the piece and the right hand rotates it.
6. Pinch a piece before it reaches the board to park it in a holder for later. Use the holders when the board gets crowded.

The game pauses on its own when no hand has been visible for 1.5 seconds. You score for drop distance and for cleared lines, and the game ends when the stack reaches the top.

## Run it

The camera only works on `localhost` or over HTTPS, so serve the folder instead of opening the file directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge.

## How it works

| File | What it does |
|---|---|
| `index.html` | Page shell, HUD styling, the video and canvas elements |
| `app.js` | Camera setup, MediaPipe gesture recognizer (up to two hands), pinch detection, auto-pause, render loop |
| `spatial_shell.js` | Interaction state machine (idle, targeting, grabbing, dragging) and the source and buffer zones |
| `tetris.js` | Board, pieces, rotation with wall kicks, holders, scoring, game over |

Hand landmarks come from [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer) 0.10.14, loaded from a CDN along with its gesture model, so the first load needs a network connection.
