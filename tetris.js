/**
 * Tetris - Hand Controlled
 * Zone-based interaction: spawn zone for grabbing, play zone for rotating only
 */

const COLS = 10;
const ROWS = 20;
const CELL_SIZE = 24;
const SPAWN_ZONE_HEIGHT = 220; // More distance between spawn and play area
const SPAWN_TICKS = 6; // Number of ticks piece stays in spawn zone (grabbable)
const HOLD_SLOT_HEIGHT = 70;
const HOLD_SLOT_WIDTH = 90;
const HOLD_SLOT_GAP = 25; // Gap between hold slots
const MAX_HOLDS = 6; // 3 on left, 3 on right
const MAX_PER_HOLD = 3;
const HOLD_SPAWN_DELAY = 2000; // Spawn new piece after 2 seconds of holding

// Tetromino shapes
const SHAPES = {
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]]
};

const SHAPE_COLORS = {
    I: '#00CED1',
    O: '#FFD700',
    T: '#9370DB',
    S: '#32CD32',
    Z: '#FF6347',
    J: '#4169E1',
    L: '#FF8C00'
};

export const INTERACTION_STATES = {
    IDLE: 'IDLE',
    TARGETING: 'TARGETING',
    GRABBING: 'GRABBING',
    DRAGGING: 'DRAGGING'
};

export class Tetris {
    constructor() {
        this.board = this.createEmptyBoard();
        this.boardWidth = COLS * CELL_SIZE;
        this.boardHeight = ROWS * CELL_SIZE;
        this.currentPiece = null;
        this.lastDropTime = 0;
        this.dropInterval = 600; // Faster falling
        
        // Hold slots - 6 holds: 1-3 on left, 4-6 on right
        this.holds = [
            { pieces: [], type: null, x: 0, y: 0, isTargeted: false, side: 'left' },
            { pieces: [], type: null, x: 0, y: 0, isTargeted: false, side: 'left' },
            { pieces: [], type: null, x: 0, y: 0, isTargeted: false, side: 'left' },
            { pieces: [], type: null, x: 0, y: 0, isTargeted: false, side: 'right' },
            { pieces: [], type: null, x: 0, y: 0, isTargeted: false, side: 'right' },
            { pieces: [], type: null, x: 0, y: 0, isTargeted: false, side: 'right' }
        ];
        
        // Track when piece was last held (for delayed spawn)
        this.lastHoldTime = 0;
        this.pendingSpawn = false;
        
        // Interaction state
        this.interactionState = {
            left: { 
                state: INTERACTION_STATES.IDLE, 
                target: null, 
                grabOffset: null, 
                smoothedPos: null,
                grabAngle: null,
                lastRotateTime: 0,
                isPlayZoneGrab: false,
                grabX: 0,
                lastMoveTime: 0
            },
            right: { 
                state: INTERACTION_STATES.IDLE, 
                target: null, 
                grabOffset: null, 
                smoothedPos: null,
                grabAngle: null,
                lastRotateTime: 0,
                isPlayZoneGrab: false,
                grabX: 0,
                lastMoveTime: 0
            }
        };
        
        // Layout info
        this.layout = { 
            offsetX: 0, 
            offsetY: 0, 
            spawnZoneTop: 0,
            spawnZoneBottom: 0,
            holdX: 0,
            holdY: 0
        };
        
        // Dragging state
        this.isDraggingPiece = false;
        this.draggedPiece = null;
        
        this.spawnPiece();
    }

    createEmptyBoard() {
        return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    }

    spawnPiece() {
        const types = Object.keys(SHAPES);
        const type = types[Math.floor(Math.random() * types.length)];
        const shape = SHAPES[type];
        
        this.currentPiece = {
            type,
            shape: JSON.parse(JSON.stringify(shape)),
            x: Math.floor((COLS - shape[0].length) / 2),
            y: -SPAWN_TICKS - shape.length, // Start high in spawn zone for grab time
            color: SHAPE_COLORS[type],
            isGrabbed: false,
            inPlayZone: false, // Track if piece has entered play zone
            screenX: 0,
            screenY: 0,
            targetScreenX: 0,
            targetScreenY: 0
        };
    }

    rotatePiece(piece) {
        if (!piece || piece.type === 'O') return;
        
        const rows = piece.shape.length;
        const cols = piece.shape[0].length;
        const rotated = [];
        
        for (let col = 0; col < cols; col++) {
            rotated.push([]);
            for (let row = rows - 1; row >= 0; row--) {
                rotated[col].push(piece.shape[row][col]);
            }
        }
        
        // Check if rotation is valid (wall kick)
        const oldShape = piece.shape;
        piece.shape = rotated;
        
        if (!this.canPlace(piece)) {
            // Try wall kicks
            const kicks = [-1, 1, -2, 2];
            let valid = false;
            for (let kick of kicks) {
                piece.x += kick;
                if (this.canPlace(piece)) {
                    valid = true;
                    break;
                }
                piece.x -= kick;
            }
            if (!valid) {
                piece.shape = oldShape; // Revert
            }
        }
    }

    calculateWristAngle(landmarks) {
        if (!landmarks) return null;
        const wrist = landmarks[0];
        const middleMCP = landmarks[9];
        const dx = middleMCP.x - wrist.x;
        const dy = middleMCP.y - wrist.y;
        return Math.atan2(dy, dx) * (180 / Math.PI);
    }

    update(currentTime, hands, pinchDistances, canvasWidth, canvasHeight) {
        // Calculate layout - board center-bottom, holds top-left and top-right
        
        // Board in center-bottom
        this.layout.offsetX = (canvasWidth - this.boardWidth) / 2;
        this.layout.offsetY = canvasHeight - this.boardHeight - 60;
        this.layout.spawnZoneTop = this.layout.offsetY - SPAWN_ZONE_HEIGHT;
        this.layout.spawnZoneBottom = this.layout.offsetY;
        
        // Hold positions - top corners
        const holdGap = 20;
        const holdMargin = 40; // Distance from screen edge
        const holdTopY = 60; // Distance from top
        
        // Left holds (1, 2, 3) - top left
        this.layout.holdLeftX = holdMargin;
        // Right holds (4, 5, 6) - top right  
        this.layout.holdRightX = canvasWidth - HOLD_SLOT_WIDTH - holdMargin;
        
        // Update hold slot positions
        this.holds.forEach((hold, i) => {
            if (i < 3) {
                // Left side (holds 1, 2, 3)
                hold.x = this.layout.holdLeftX;
                hold.y = holdTopY + (i * (HOLD_SLOT_HEIGHT + holdGap));
            } else {
                // Right side (holds 4, 5, 6)
                hold.x = this.layout.holdRightX;
                hold.y = holdTopY + ((i - 3) * (HOLD_SLOT_HEIGHT + holdGap));
            }
            hold.isTargeted = false;
        });
        
        // Check if current piece has entered play zone
        if (this.currentPiece && !this.currentPiece.inPlayZone && !this.currentPiece.isGrabbed) {
            if (this.currentPiece.y >= 0) {
                this.currentPiece.inPlayZone = true;
            }
        }
        
        // Spawn new piece after hold delay
        if (this.pendingSpawn && !this.currentPiece) {
            if (currentTime - this.lastHoldTime >= HOLD_SPAWN_DELAY) {
                this.spawnPiece();
                this.pendingSpawn = false;
            }
        }
        
        // Handle hand interaction
        if (hands) {
            this.handleHandInteraction(hands, pinchDistances, canvasWidth, canvasHeight, currentTime);
        }
        
        // Auto-drop only if piece is not grabbed and exists
        if (this.currentPiece && !this.currentPiece.isGrabbed) {
            if (currentTime - this.lastDropTime > this.dropInterval) {
                this.lastDropTime = currentTime;
                this.dropPiece();
            }
        }
        
        // Update piece screen positions
        this.updatePiecePositions();
    }

    handleHandInteraction(hands, pinchDistances, w, h, currentTime) {
        this.isDraggingPiece = false;
        this.draggedPiece = null;
        
        ['left', 'right'].forEach(side => {
            const hand = hands[side];
            const dist = pinchDistances[side];
            const interaction = this.interactionState[side];

            if (!hand) {
                if (interaction.target) {
                    interaction.target.isGrabbed = false;
                }
                interaction.state = INTERACTION_STATES.IDLE;
                interaction.target = null;
                interaction.grabAngle = null;
                return;
            }

            const thumb = hand.landmarks[4];
            const index = hand.landmarks[8];
            const rawMidX = (1 - (thumb.x + index.x) / 2) * w;
            const rawMidY = ((thumb.y + index.y) / 2) * h;

            if (!interaction.smoothedPos) {
                interaction.smoothedPos = { x: rawMidX, y: rawMidY };
            }
            // Faster smoothing when dragging for more responsive feel
            const isDragging = interaction.state === INTERACTION_STATES.DRAGGING;
            const smoothFactor = isDragging ? 0.5 : 0.3;
            interaction.smoothedPos.x += (rawMidX - interaction.smoothedPos.x) * smoothFactor;
            interaction.smoothedPos.y += (rawMidY - interaction.smoothedPos.y) * smoothFactor;
            
            const midX = interaction.smoothedPos.x;
            const midY = interaction.smoothedPos.y;

            const GRAB_THRESHOLD = 0.09;
            const RELEASE_THRESHOLD = 0.15; // More forgiving - won't accidentally release
            const canGrab = dist < GRAB_THRESHOLD;
            const shouldRelease = dist > RELEASE_THRESHOLD;

            if (interaction.state === INTERACTION_STATES.IDLE || interaction.state === INTERACTION_STATES.TARGETING) {
                // Find nearest piece (works for both spawn zone and play zone)
                const nearest = this.findNearestGrabbablePiece(midX, midY);
                
                if (nearest && nearest.dist < 120) {
                    interaction.state = INTERACTION_STATES.TARGETING;
                    interaction.target = nearest.piece;
                    interaction.isPlayZoneGrab = nearest.isPlayZone;
                } else {
                    interaction.state = INTERACTION_STATES.IDLE;
                    interaction.target = null;
                    interaction.isPlayZoneGrab = false;
                }

                if (canGrab && interaction.target) {
                    interaction.state = INTERACTION_STATES.GRABBING;
                    
                    // Only mark as grabbed if NOT in play zone (play zone pieces stay in grid)
                    if (!interaction.isPlayZoneGrab) {
                    interaction.target.isGrabbed = true;
                    }
                    
                    interaction.grabOffset = { 
                        x: interaction.target.screenX - midX, 
                        y: interaction.target.screenY - midY 
                    };
                    interaction.grabAngle = this.calculateWristAngle(hand.landmarks);
                    interaction.grabX = midX; // Store initial grab X for movement
                    interaction.lastMoveTime = currentTime;
                }
            } else if (interaction.state === INTERACTION_STATES.GRABBING || interaction.state === INTERACTION_STATES.DRAGGING) {
                if (shouldRelease) {
                    const piece = interaction.target;
                    if (piece && !interaction.isPlayZoneGrab) {
                        piece.isGrabbed = false;
                        this.handleDrop(piece, midX, midY);
                    } else if (interaction.isPlayZoneGrab && piece === this.currentPiece) {
                        // Hard drop on release in play zone
                        this.hardDrop();
                    }
                    
                    interaction.state = INTERACTION_STATES.IDLE;
                    interaction.target = null;
                    interaction.grabOffset = null;
                    interaction.grabAngle = null;
                    interaction.isPlayZoneGrab = false;
                    interaction.currentRotation = undefined;
                } else {
                    interaction.state = INTERACTION_STATES.DRAGGING;
                    
                    if (interaction.isPlayZoneGrab && interaction.target === this.currentPiece) {
                        // Check if this is two-handed mode
                        const otherSide = side === 'left' ? 'right' : 'left';
                        const otherInteraction = this.interactionState[otherSide];
                        const isTwoHanded = otherInteraction.isPlayZoneGrab && 
                                           otherInteraction.state === INTERACTION_STATES.DRAGGING;
                        
                        const pieceX = this.currentPiece.screenX;
                        const pieceY = this.currentPiece.screenY;
                        const dx = midX - pieceX;
                        const dy = midY - pieceY;
                        const distFromPiece = Math.sqrt(dx * dx + dy * dy);
                        
                        if (isTwoHanded) {
                            // TWO-HANDED MODE: Left hand = movement, Right hand = rotation
                            if (side === 'left') {
                                // LEFT HAND: Horizontal movement only
                                const MOVE_THRESHOLD = 30;
                                const MOVE_COOLDOWN = 100;
                                const moveX = midX - interaction.grabX;
                                
                                if (Math.abs(moveX) > MOVE_THRESHOLD && currentTime - interaction.lastMoveTime > MOVE_COOLDOWN) {
                                    const direction = moveX > 0 ? 1 : -1;
                                    if (this.canMove(direction, 0)) {
                                        this.currentPiece.x += direction;
                                        interaction.grabX = midX;
                                        interaction.lastMoveTime = currentTime;
                                    }
                                }
                                // Clear rotation visual for movement hand
                                interaction.pieceCenter = null;
                            } else {
                                // RIGHT HAND: Rotation only (circle system)
                                interaction.circleAngle = Math.atan2(dy, dx);
                                interaction.circleRadius = 70;
                                interaction.pieceCenter = { x: pieceX, y: pieceY };
                                
                                if (distFromPiece > 30) {
                                    const angleDeg = (interaction.circleAngle * 180 / Math.PI + 360) % 360;
                                    const targetRotation = Math.round(angleDeg / 90) % 4;
                                    
                                    if (interaction.currentRotation === undefined) {
                                        interaction.currentRotation = 0;
                                    }
                                    
                                    const ROTATION_COOLDOWN = 200;
                                    if (targetRotation !== interaction.currentRotation && 
                                        currentTime - interaction.lastRotateTime > ROTATION_COOLDOWN) {
                                        
                                        let diff = targetRotation - interaction.currentRotation;
                                        if (diff > 2) diff -= 4;
                                        if (diff < -2) diff += 4;
                                        
                                        if (diff > 0) {
                                            this.rotatePiece(this.currentPiece);
                                        } else if (diff < 0) {
                                            this.rotatePiece(this.currentPiece);
                                            this.rotatePiece(this.currentPiece);
                                            this.rotatePiece(this.currentPiece);
                                        }
                                        
                                        interaction.currentRotation = targetRotation;
                                        interaction.lastRotateTime = currentTime;
                                    }
                                }
                            }
                        } else {
                            // SINGLE-HANDED MODE: Same hand does both
                            interaction.circleAngle = Math.atan2(dy, dx);
                            interaction.circleRadius = 70;
                            interaction.pieceCenter = { x: pieceX, y: pieceY };
                            
                            // Rotation based on angle
                            if (distFromPiece > 40) {
                                const angleDeg = (interaction.circleAngle * 180 / Math.PI + 360) % 360;
                                const targetRotation = Math.round(angleDeg / 90) % 4;
                                
                                if (interaction.currentRotation === undefined) {
                                    interaction.currentRotation = 0;
                                }
                                
                                const ROTATION_COOLDOWN = 250;
                                if (targetRotation !== interaction.currentRotation && 
                                    currentTime - interaction.lastRotateTime > ROTATION_COOLDOWN) {
                                    
                                    let diff = targetRotation - interaction.currentRotation;
                                    if (diff > 2) diff -= 4;
                                    if (diff < -2) diff += 4;
                                    
                                    if (diff > 0) {
                                        this.rotatePiece(this.currentPiece);
                                    } else if (diff < 0) {
                                        this.rotatePiece(this.currentPiece);
                                        this.rotatePiece(this.currentPiece);
                                        this.rotatePiece(this.currentPiece);
                                    }
                                    
                                    interaction.currentRotation = targetRotation;
                                    interaction.lastRotateTime = currentTime;
                                }
                            }
                            
                            // Horizontal movement
                            const MOVE_THRESHOLD = 35;
                            const MOVE_COOLDOWN = 120;
                            const moveX = midX - interaction.grabX;
                            
                            if (Math.abs(moveX) > MOVE_THRESHOLD && currentTime - interaction.lastMoveTime > MOVE_COOLDOWN) {
                                const direction = moveX > 0 ? 1 : -1;
                                if (this.canMove(direction, 0)) {
                                    this.currentPiece.x += direction;
                                    interaction.grabX = midX;
                                    interaction.lastMoveTime = currentTime;
                                }
                            }
                        }
                    } else {
                        // SPAWN ZONE / HOLD: Free drag movement - direct follow
                        this.isDraggingPiece = true;
                        this.draggedPiece = interaction.target;
                        
                        if (interaction.target && interaction.grabOffset) {
                            // Set target position
                            interaction.target.targetScreenX = midX + interaction.grabOffset.x;
                            interaction.target.targetScreenY = midY + interaction.grabOffset.y;
                            
                            // Also directly update position for immediate response
                            const dx = interaction.target.targetScreenX - interaction.target.screenX;
                            const dy = interaction.target.targetScreenY - interaction.target.screenY;
                            interaction.target.screenX += dx * 0.6;
                            interaction.target.screenY += dy * 0.6;
                        }
                    }
                }
            }
        });

        // Smooth animation for grabbed pieces - faster and more responsive
        const allPieces = [this.currentPiece, ...this.holds.flatMap(h => h.pieces)].filter(p => p);
        allPieces.forEach(piece => {
            if (piece && piece.isGrabbed) {
                const dx = piece.targetScreenX - piece.screenX;
                const dy = piece.targetScreenY - piece.screenY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // Much faster follow - nearly 1:1 with hand
                const lerpFactor = 0.4 + Math.min(dist / 50, 0.4);
                
                piece.screenX += dx * lerpFactor;
                piece.screenY += dy * lerpFactor;
            }
        });
        
        // Update hold targeting feedback
        if (this.isDraggingPiece && this.draggedPiece) {
            const handPos = this.getHandPosition();
            if (handPos) {
                this.holds.forEach(hold => {
                    const inBounds = handPos.x >= hold.x - 10 && handPos.x <= hold.x + HOLD_SLOT_WIDTH + 10 &&
                                   handPos.y >= hold.y - 10 && handPos.y <= hold.y + HOLD_SLOT_HEIGHT + 10;
                    const canAdd = hold.pieces.length < MAX_PER_HOLD && 
                                  (hold.type === null || hold.type === this.draggedPiece.type);
                    hold.isTargeted = inBounds && canAdd;
                });
            }
        }
    }
    
    getHandPosition() {
        for (let side of ['left', 'right']) {
            const interaction = this.interactionState[side];
            if (interaction.smoothedPos && interaction.state === INTERACTION_STATES.DRAGGING) {
                return interaction.smoothedPos;
            }
        }
        return null;
    }

    findNearestGrabbablePiece(x, y) {
        let nearest = null;
        let minDist = Infinity;
        let isPlayZonePiece = false;
        
        // Current piece - always targetable (different behavior based on zone)
        if (this.currentPiece) {
            const dx = x - this.currentPiece.screenX;
            const dy = y - this.currentPiece.screenY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
                minDist = d;
                nearest = this.currentPiece;
                isPlayZonePiece = this.currentPiece.inPlayZone;
            }
        }
        
        // Pieces in holds (only the top piece of each hold is grabbable)
        this.holds.forEach(hold => {
            if (hold.pieces.length > 0) {
                const topPiece = hold.pieces[hold.pieces.length - 1];
                const dx = x - topPiece.screenX;
                const dy = y - topPiece.screenY;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) {
                    minDist = d;
                    nearest = topPiece;
                    isPlayZonePiece = false;
                }
            }
        });
        
        return nearest ? { piece: nearest, dist: minDist, isPlayZone: isPlayZonePiece } : null;
    }

    handleDrop(piece, x, y) {
        const { spawnZoneTop, spawnZoneBottom, offsetX } = this.layout;
        
        // Check if dropped on a specific hold slot
        for (let hold of this.holds) {
            const inHoldBounds = x >= hold.x - 10 && x <= hold.x + HOLD_SLOT_WIDTH + 10 &&
                                 y >= hold.y - 10 && y <= hold.y + HOLD_SLOT_HEIGHT + 10;
            
            if (inHoldBounds) {
                // Check if can add to this hold
                const canAdd = hold.pieces.length < MAX_PER_HOLD && 
                              (hold.type === null || hold.type === piece.type);
                
                if (canAdd) {
                    // Remove piece from its current location
                if (piece === this.currentPiece) {
                    this.currentPiece = null;
                        // Mark that we need to spawn after delay
                        this.lastHoldTime = performance.now();
                        this.pendingSpawn = true;
                    } else {
                        // Remove from any hold it might be in
                        this.removeFromHolds(piece);
                    }
                    
                    // Add to this hold
                    piece.inPlayZone = false;
                    hold.pieces.push(piece);
                    hold.type = piece.type;
                    return;
                }
                // If can't add (wrong type or full), piece goes back to origin
                return;
            }
        }
        
        // Check if dropped in spawn zone (release from hold)
        if (x >= offsetX && x <= offsetX + this.boardWidth &&
            y >= spawnZoneTop && y <= spawnZoneBottom) {
            
            // Find which hold this piece is in
            const sourceHold = this.findHoldContaining(piece);
            if (sourceHold) {
                // Remove from hold
                const idx = sourceHold.pieces.indexOf(piece);
                if (idx !== -1) {
                    sourceHold.pieces.splice(idx, 1);
                    if (sourceHold.pieces.length === 0) {
                        sourceHold.type = null; // Reset type when empty
                    }
                }
                
                // Swap with current piece if it's in spawn zone
                if (this.currentPiece && !this.currentPiece.inPlayZone) {
                    // Try to put current piece in the same hold
                    if (sourceHold.pieces.length < MAX_PER_HOLD &&
                        (sourceHold.type === null || sourceHold.type === this.currentPiece.type)) {
                        this.currentPiece.inPlayZone = false;
                        sourceHold.pieces.push(this.currentPiece);
                        sourceHold.type = this.currentPiece.type;
                    }
                }
                
                // Make released piece the current piece
                    this.currentPiece = piece;
                piece.x = Math.floor((COLS - piece.shape[0].length) / 2);
                piece.y = -SPAWN_TICKS - piece.shape.length;
                piece.inPlayZone = false;
            }
            return;
        }
    }

    removeFromHolds(piece) {
        for (let hold of this.holds) {
            const idx = hold.pieces.indexOf(piece);
            if (idx !== -1) {
                hold.pieces.splice(idx, 1);
                if (hold.pieces.length === 0) {
                    hold.type = null;
                }
                return;
            }
        }
    }

    findHoldContaining(piece) {
        for (let hold of this.holds) {
            if (hold.pieces.includes(piece)) {
                return hold;
            }
        }
        return null;
    }

    updatePiecePositions() {
        const { offsetX, offsetY, spawnZoneTop, holdX, holdY } = this.layout;
        
        // Update current piece screen position
        if (this.currentPiece && !this.currentPiece.isGrabbed) {
            let centerX, centerY;
            
            if (this.currentPiece.inPlayZone) {
                // In play zone - use grid position
                centerX = offsetX + (this.currentPiece.x + this.currentPiece.shape[0].length / 2) * CELL_SIZE;
                centerY = offsetY + (this.currentPiece.y + this.currentPiece.shape.length / 2) * CELL_SIZE;
            } else {
                // In spawn zone - center horizontally, fall through spawn zone
                centerX = offsetX + this.boardWidth / 2;
                // Map y from spawn start to spawn zone bottom
                // y goes from -(SPAWN_TICKS + shape.length) to -1
                const totalSpawnTicks = SPAWN_TICKS + this.currentPiece.shape.length;
                const currentTick = this.currentPiece.y + totalSpawnTicks; // 0 to totalSpawnTicks-1
                const progress = currentTick / totalSpawnTicks;
                centerY = spawnZoneTop + 30 + (progress * (SPAWN_ZONE_HEIGHT - 50));
            }
            
            this.currentPiece.screenX = centerX;
            this.currentPiece.screenY = centerY;
            this.currentPiece.targetScreenX = centerX;
            this.currentPiece.targetScreenY = centerY;
        }
        
        // Update hold pieces positions
        this.holds.forEach((hold, holdIdx) => {
            hold.pieces.forEach((piece, pieceIdx) => {
                if (!piece.isGrabbed) {
                    // Stack pieces horizontally within the hold slot
                    const stackOffset = pieceIdx * 18; // Slight offset for stacked pieces
                    const centerX = hold.x + HOLD_SLOT_WIDTH / 2 + stackOffset - ((hold.pieces.length - 1) * 9);
                    const centerY = hold.y + HOLD_SLOT_HEIGHT / 2 + 5;
                    piece.screenX = centerX;
                    piece.screenY = centerY;
                    piece.targetScreenX = centerX;
                    piece.targetScreenY = centerY;
                }
            });
        });
    }

    dropPiece() {
        if (!this.currentPiece || this.currentPiece.isGrabbed) return;

        if (this.currentPiece.y < 0) {
            // Still in spawn zone, just move down
            this.currentPiece.y++;
            if (this.currentPiece.y >= 0) {
                this.currentPiece.inPlayZone = true;
            }
        } else if (this.canMove(0, 1)) {
            this.currentPiece.y++;
        } else {
            this.lockPiece();
            this.clearLines();
            this.spawnPiece();
        }
    }

    hardDrop() {
        if (!this.currentPiece) return;
        
        // Drop piece all the way down
        while (this.canMove(0, 1)) {
            this.currentPiece.y++;
        }
        
        // Lock immediately
        this.lockPiece();
        this.clearLines();
        this.spawnPiece();
    }

    canMove(dx, dy) {
        const piece = this.currentPiece;
        if (!piece) return false;

        for (let row = 0; row < piece.shape.length; row++) {
            for (let col = 0; col < piece.shape[row].length; col++) {
                if (piece.shape[row][col]) {
                    const newX = piece.x + col + dx;
                    const newY = piece.y + row + dy;

                    if (newX < 0 || newX >= COLS || newY >= ROWS) {
                        return false;
                    }

                    if (newY >= 0 && this.board[newY][newX]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    canPlace(piece) {
        for (let row = 0; row < piece.shape.length; row++) {
            for (let col = 0; col < piece.shape[row].length; col++) {
                if (piece.shape[row][col]) {
                    const boardX = piece.x + col;
                    const boardY = piece.y + row;
                    
                    if (boardX < 0 || boardX >= COLS || boardY >= ROWS) {
                        return false;
                    }
                    
                    if (boardY >= 0 && this.board[boardY][boardX]) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    lockPiece() {
        const piece = this.currentPiece;
        if (!piece) return;

        for (let row = 0; row < piece.shape.length; row++) {
            for (let col = 0; col < piece.shape[row].length; col++) {
                if (piece.shape[row][col]) {
                    const boardY = piece.y + row;
                    const boardX = piece.x + col;
                    if (boardY >= 0 && boardY < ROWS) {
                        this.board[boardY][boardX] = piece.type;
                    }
                }
            }
        }
    }

    clearLines() {
        for (let row = ROWS - 1; row >= 0; row--) {
            if (this.board[row].every(cell => cell !== 0)) {
                this.board.splice(row, 1);
                this.board.unshift(Array(COLS).fill(0));
                row++;
            }
        }
    }

    getGrabbedPieceColor(side) {
        const interaction = this.interactionState[side];
        if (interaction.target && interaction.state === INTERACTION_STATES.DRAGGING) {
            return interaction.target.color;
        }
        return null;
    }

    draw(ctx, canvasWidth, canvasHeight) {
        const { offsetX, offsetY, spawnZoneTop, spawnZoneBottom, holdX, holdY } = this.layout;

        // Spawn zone label (no rectangle border)
        ctx.font = '9px "JetBrains Mono"';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.textAlign = 'center';
        ctx.fillText('SPAWN ZONE', offsetX + this.boardWidth / 2, spawnZoneTop + 20);
        ctx.fillText('GRAB TO HOLD →', offsetX + this.boardWidth / 2, spawnZoneTop + 35);

        // Play zone (main board)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(offsetX, offsetY, this.boardWidth, this.boardHeight);

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(offsetX, offsetY, this.boardWidth, this.boardHeight);

        // Shadow FROM spawn zone - at bottom of spawn zone fading upward
        const shadowGradient = ctx.createLinearGradient(0, spawnZoneTop + SPAWN_ZONE_HEIGHT - 30, 0, spawnZoneTop + SPAWN_ZONE_HEIGHT);
        shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
        ctx.fillStyle = shadowGradient;
        ctx.fillRect(offsetX, spawnZoneTop + SPAWN_ZONE_HEIGHT - 30, this.boardWidth, 30);
        
        // Dashed spawn line (divider between spawn zone and play area)
        const dividerColor = this.currentPiece ? this.currentPiece.color : 'rgba(0, 0, 0, 0.5)';
        ctx.strokeStyle = dividerColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(offsetX - 20, offsetY);
        ctx.lineTo(offsetX + this.boardWidth + 20, offsetY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Play zone label
        ctx.font = '8px "JetBrains Mono"';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.textAlign = 'left';
        ctx.fillText('PLAY ZONE - TWIST TO ROTATE', offsetX + 5, offsetY + 12);

        // Grid lines
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.lineWidth = 0.5;
        for (let i = 1; i < COLS; i++) {
            ctx.beginPath();
            ctx.moveTo(offsetX + i * CELL_SIZE, offsetY);
            ctx.lineTo(offsetX + i * CELL_SIZE, offsetY + this.boardHeight);
            ctx.stroke();
        }
        for (let i = 1; i < ROWS; i++) {
            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + i * CELL_SIZE);
            ctx.lineTo(offsetX + this.boardWidth, offsetY + i * CELL_SIZE);
            ctx.stroke();
        }

        // Draw locked pieces
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                if (this.board[row][col]) {
                    const x = offsetX + col * CELL_SIZE;
                    const y = offsetY + row * CELL_SIZE;
                    this.drawCell(ctx, x, y, SHAPE_COLORS[this.board[row][col]]);
                }
            }
        }

        // Draw current piece
        if (this.currentPiece) {
            this.drawPiece(ctx, this.currentPiece, offsetX, offsetY);
            
            // Draw rotation circle if piece is being controlled in play zone
            this.drawRotationCircle(ctx);
        }

        // Corner accents
        this.drawCornerAccents(ctx, offsetX, offsetY);

        // Draw holds
        this.drawHolds(ctx);
    }

    drawPiece(ctx, piece, offsetX, offsetY) {
        const centerOffsetX = (piece.shape[0].length * CELL_SIZE) / 2;
        const centerOffsetY = (piece.shape.length * CELL_SIZE) / 2;
        
        if (piece.isGrabbed) {
            // Draw at screen position when grabbed
            for (let row = 0; row < piece.shape.length; row++) {
                for (let col = 0; col < piece.shape[row].length; col++) {
                    if (piece.shape[row][col]) {
                        const x = piece.screenX - centerOffsetX + col * CELL_SIZE;
                        const y = piece.screenY - centerOffsetY + row * CELL_SIZE;
                        this.drawCell(ctx, x, y, piece.color, true);
                    }
                }
            }
        } else if (piece.inPlayZone) {
            // Draw at grid position in play zone
            for (let row = 0; row < piece.shape.length; row++) {
                for (let col = 0; col < piece.shape[row].length; col++) {
                    if (piece.shape[row][col]) {
                        const x = offsetX + (piece.x + col) * CELL_SIZE;
                        const y = offsetY + (piece.y + row) * CELL_SIZE;
                        if (y >= offsetY) {
                            this.drawCell(ctx, x, y, piece.color);
                        }
                    }
                }
            }
        } else {
            // Draw at screen position in spawn zone
            for (let row = 0; row < piece.shape.length; row++) {
                for (let col = 0; col < piece.shape[row].length; col++) {
                    if (piece.shape[row][col]) {
                        const x = piece.screenX - centerOffsetX + col * CELL_SIZE;
                        const y = piece.screenY - centerOffsetY + row * CELL_SIZE;
                        this.drawCell(ctx, x, y, piece.color);
                    }
                }
            }
        }
    }

    drawHolds(ctx) {
        this.holds.forEach((hold, idx) => {
            const isTargeted = hold.isTargeted;
            const isFull = hold.pieces.length >= MAX_PER_HOLD;
            const hasType = hold.type !== null;
            
            // Slot background
            ctx.fillStyle = isTargeted ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.02)';
            ctx.fillRect(hold.x, hold.y, HOLD_SLOT_WIDTH, HOLD_SLOT_HEIGHT);
            
            // Slot border - colored by type if has pieces
            if (isTargeted) {
                ctx.strokeStyle = this.draggedPiece?.color || 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 2;
            } else if (hasType) {
                ctx.strokeStyle = SHAPE_COLORS[hold.type] + '66';
                ctx.lineWidth = 1.5;
            } else {
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                ctx.lineWidth = 1;
            }
            ctx.strokeRect(hold.x, hold.y, HOLD_SLOT_WIDTH, HOLD_SLOT_HEIGHT);
            
            // Slot label
            ctx.font = '8px "JetBrains Mono"';
            ctx.fillStyle = hasType ? SHAPE_COLORS[hold.type] + '88' : 'rgba(0, 0, 0, 0.25)';
            ctx.textAlign = 'center';
            const holdNum = idx + 1;
            ctx.fillText(`HOLD ${holdNum}`, hold.x + HOLD_SLOT_WIDTH / 2, hold.y + 10);
            
            // Piece count
            ctx.font = '7px "JetBrains Mono"';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillText(`${hold.pieces.length}/${MAX_PER_HOLD}`, hold.x + HOLD_SLOT_WIDTH / 2, hold.y + HOLD_SLOT_HEIGHT - 5);
            
            // Draw pieces in this hold
            hold.pieces.forEach((piece, pieceIdx) => {
                if (!piece.isGrabbed) {
                    const centerOffsetX = (piece.shape[0].length * CELL_SIZE) / 2;
                    const centerOffsetY = (piece.shape.length * CELL_SIZE) / 2;
                    
                    // Slight transparency for stacked pieces (except top)
                    const isTop = pieceIdx === hold.pieces.length - 1;
                    
                    for (let row = 0; row < piece.shape.length; row++) {
                        for (let col = 0; col < piece.shape[row].length; col++) {
                            if (piece.shape[row][col]) {
                                const x = piece.screenX - centerOffsetX + col * CELL_SIZE;
                                const y = piece.screenY - centerOffsetY + row * CELL_SIZE;
                                this.drawCell(ctx, x, y, piece.color, false, !isTop);
                            }
                        }
                    }
                }
            });
            
            // Type indicator for empty slots being targeted
            if (isTargeted && !hasType && this.draggedPiece) {
                ctx.font = '7px "JetBrains Mono"';
                ctx.fillStyle = this.draggedPiece.color + '88';
                ctx.fillText(`+ ${this.draggedPiece.type}`, hold.x + HOLD_SLOT_WIDTH / 2, hold.y + HOLD_SLOT_HEIGHT / 2);
            }
            
            // "FULL" or type mismatch indicator
            if (isTargeted === false && this.isDraggingPiece && this.draggedPiece) {
                const inBounds = this.isInHoldBounds(hold);
                if (inBounds) {
                    if (isFull) {
                        ctx.font = '7px "JetBrains Mono"';
                        ctx.fillStyle = 'rgba(200, 0, 0, 0.5)';
                        ctx.fillText('FULL', hold.x + HOLD_SLOT_WIDTH / 2, hold.y + HOLD_SLOT_HEIGHT / 2 + 20);
                    } else if (hasType && hold.type !== this.draggedPiece.type) {
                        ctx.font = '6px "JetBrains Mono"';
                        ctx.fillStyle = 'rgba(200, 0, 0, 0.5)';
                        ctx.fillText(`${hold.type} ONLY`, hold.x + HOLD_SLOT_WIDTH / 2, hold.y + HOLD_SLOT_HEIGHT / 2 + 20);
                    }
                }
            }
        });
    }
    
    isInHoldBounds(hold) {
        const handPos = this.getHandPosition();
        if (!handPos) return false;
        return handPos.x >= hold.x - 10 && handPos.x <= hold.x + HOLD_SLOT_WIDTH + 10 &&
               handPos.y >= hold.y - 10 && handPos.y <= hold.y + HOLD_SLOT_HEIGHT + 10;
    }

    drawRotationCircle(ctx) {
        // Check if any hand is controlling the piece in play zone
        for (let side of ['left', 'right']) {
            const interaction = this.interactionState[side];
            
            if (interaction.isPlayZoneGrab && 
                interaction.state === INTERACTION_STATES.DRAGGING &&
                interaction.pieceCenter) {
                
                const cx = interaction.pieceCenter.x;
                const cy = interaction.pieceCenter.y;
                const radius = interaction.circleRadius || 70;
                const angle = interaction.circleAngle || 0;
                
                // Subtle grey color scheme
                const circleColor = 'rgba(0, 0, 0, 0.12)';
                const markerColor = 'rgba(0, 0, 0, 0.15)';
                const lineColor = 'rgba(0, 0, 0, 0.25)';
                const dotColor = 'rgba(0, 0, 0, 0.3)';
                
                // Draw outer circle (subtle rotation track)
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.strokeStyle = circleColor;
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Draw 4 quadrant markers (small dots)
                for (let i = 0; i < 4; i++) {
                    const markerAngle = (i * Math.PI / 2);
                    const mx = cx + Math.cos(markerAngle) * radius;
                    const my = cy + Math.sin(markerAngle) * radius;
                    
                    ctx.beginPath();
                    ctx.arc(mx, my, 2, 0, Math.PI * 2);
                    ctx.fillStyle = markerColor;
                    ctx.fill();
                }
                
                // Direction line from center to hand position
                const handX = cx + Math.cos(angle) * radius;
                const handY = cy + Math.sin(angle) * radius;
                
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(handX, handY);
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 1;
                ctx.stroke();
                
                // Small dot at hand position
                ctx.beginPath();
                ctx.arc(handX, handY, 3, 0, Math.PI * 2);
                ctx.fillStyle = dotColor;
                ctx.fill();
                
                break; // Only draw for one hand
            }
        }
    }

    drawCornerAccents(ctx, offsetX, offsetY) {
        const s = 8;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY + s);
        ctx.lineTo(offsetX, offsetY);
        ctx.lineTo(offsetX + s, offsetY);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(offsetX + this.boardWidth - s, offsetY);
        ctx.lineTo(offsetX + this.boardWidth, offsetY);
        ctx.lineTo(offsetX + this.boardWidth, offsetY + s);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(offsetX + this.boardWidth, offsetY + this.boardHeight - s);
        ctx.lineTo(offsetX + this.boardWidth, offsetY + this.boardHeight);
        ctx.lineTo(offsetX + this.boardWidth - s, offsetY + this.boardHeight);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(offsetX + s, offsetY + this.boardHeight);
        ctx.lineTo(offsetX, offsetY + this.boardHeight);
        ctx.lineTo(offsetX, offsetY + this.boardHeight - s);
        ctx.stroke();
    }

    drawCell(ctx, x, y, color, isGrabbed = false, isDimmed = false) {
        const inset = 2;
        const size = CELL_SIZE - inset * 2;
        
        const fillOpacity = isDimmed ? '11' : (isGrabbed ? '44' : '22');
        const strokeOpacity = isDimmed ? '55' : '';
        
        ctx.fillStyle = color + fillOpacity;
        ctx.fillRect(x + inset, y + inset, size, size);
        
        ctx.strokeStyle = color + strokeOpacity;
        ctx.lineWidth = isGrabbed ? 2.5 : (isDimmed ? 1 : 2);
        ctx.strokeRect(x + inset, y + inset, size, size);
        
        if (!isDimmed) {
            ctx.strokeStyle = color + '44';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + inset + 2, y + inset + size - 2);
            ctx.lineTo(x + inset + 2, y + inset + 2);
            ctx.lineTo(x + inset + size - 2, y + inset + 2);
            ctx.stroke();
        }
    }
}
