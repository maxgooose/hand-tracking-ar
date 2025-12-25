/**
 * Spatial Shell - Core Logic & Data Structures
 */

export const INTERACTION_STATES = {
    IDLE: 'IDLE',
    TARGETING: 'TARGETING',
    GRABBING: 'GRABBING',
    DRAGGING: 'DRAGGING'
};

export const ZONES = {
    SOURCE: 'SOURCE',
    BUFFER: 'BUFFER'
};

export class SpatialShell {
    constructor() {
        this.fileSystem = this._initializeMockFS();
        this.interactionState = {
            left: { state: INTERACTION_STATES.IDLE, target: null, grabPos: null, grabOffset: null },
            right: { state: INTERACTION_STATES.IDLE, target: null, grabPos: null, grabOffset: null }
        };
        this.nodes = this._flattenFS(this.fileSystem);
        this.activeNodes = { left: [], right: [] }; // Nodes currently visible in each zone
        this._populateInitialZones();
    }

    _initializeMockFS() {
        return {
            name: '/',
            type: 'dir',
            permissions: 'drwxr-xr-x',
            children: [
                {
                    name: 'sys',
                    type: 'dir',
                    permissions: 'dr-xr-xr-x',
                    children: [
                        { name: 'kernel.bin', type: 'file', size: 1048576, permissions: '-r--------' },
                        { name: 'config.sys', type: 'file', size: 4096, permissions: '-rw-r--r--' }
                    ]
                },
                {
                    name: 'usr',
                    type: 'dir',
                    permissions: 'drwxr-xr-x',
                    children: [
                        { name: 'bin', type: 'dir', permissions: 'drwxr-xr-x', children: [] },
                        { name: 'local', type: 'dir', permissions: 'drwxr-xr-x', children: [] }
                    ]
                },
                {
                    name: 'data',
                    type: 'dir',
                    permissions: 'drwxrwxrwx',
                    children: [
                        { name: 'logs_alpha.log', type: 'file', size: 524288, permissions: '-rw-------' },
                        { name: 'sensor_stream.io', type: 'file', size: 128, permissions: '-rw-rw-rw-' },
                        { name: 'network_dump.pcap', type: 'file', size: 20971520, permissions: '-r--------' }
                    ]
                },
                { name: 'readme.txt', type: 'file', size: 256, permissions: '-rw-r--r--' }
            ]
        };
    }

    _flattenFS(node, path = '') {
        let results = [];
        // Fix: Ensure root is '/' and children follow a standard /path/name pattern
        const isRoot = node.name === '/';
        const fullPath = isRoot ? '/' : (path === '/' ? '' : path) + '/' + node.name;
        
        results.push({
            id: Math.random().toString(36).substring(2, 11),
            name: node.name,
            type: node.type,
            path: fullPath,
            permissions: node.permissions,
            size: node.size || 0,
            x: 0, y: 0,
            targetX: 0, targetY: 0,
            isGrabbed: false,
            nestedCount: 0
        });

        if (node.children) {
            node.children.forEach(child => {
                results = results.concat(this._flattenFS(child, fullPath));
            });
        }
        return results;
    }

    _populateInitialZones() {
        // Correctly find children of the root directory
        const rootChildren = this.nodes.filter(n => {
            const parts = n.path.split('/').filter(p => p.length > 0);
            return parts.length === 1; // Direct children of root
        });

        rootChildren.forEach((node, i) => {
            node.x = 120;
            node.y = 180 + (i * 70);
            node.targetX = node.x;
            node.targetY = node.y;
            this.activeNodes.left.push(node);
        });
    }

    update(hands, pinchDistances, w, h) {
        ['left', 'right'].forEach(side => {
            const hand = hands[side];
            const dist = pinchDistances[side];
            const interaction = this.interactionState[side];

            if (!hand) {
                interaction.state = INTERACTION_STATES.IDLE;
                interaction.target = null;
                return;
            }

            const thumb = hand.landmarks[4];
            const index = hand.landmarks[8];
            const rawMidX = (1 - (thumb.x + index.x) / 2) * w;
            const rawMidY = ((thumb.y + index.y) / 2) * h;

            // Smooth hand position to reduce jitter
            if (!interaction.smoothedPos) {
                interaction.smoothedPos = { x: rawMidX, y: rawMidY };
            }
            const smoothFactor = 0.25; // Lower = smoother movement
            interaction.smoothedPos.x += (rawMidX - interaction.smoothedPos.x) * smoothFactor;
            interaction.smoothedPos.y += (rawMidY - interaction.smoothedPos.y) * smoothFactor;
            
            const midX = interaction.smoothedPos.x;
            const midY = interaction.smoothedPos.y;

            // Hysteresis: easier to grab (0.08), harder to release (0.12)
            const GRAB_THRESHOLD = 0.08;  // Pinch closer than this to grab
            const RELEASE_THRESHOLD = 0.12; // Must spread wider than this to release
            
            const canGrab = dist < GRAB_THRESHOLD;
            const shouldRelease = dist > RELEASE_THRESHOLD;

            if (interaction.state === INTERACTION_STATES.IDLE || interaction.state === INTERACTION_STATES.TARGETING) {
                // Find nearest node - large radius for easy targeting from far away
                const nearest = this._findNearestNode(midX, midY, side);
                if (nearest && nearest.dist < 400) { // Large range for far targeting
                    interaction.state = INTERACTION_STATES.TARGETING;
                    interaction.target = nearest.node;
                    // No magnetic attraction - nodes stay put
                } else {
                    interaction.state = INTERACTION_STATES.IDLE;
                    interaction.target = null;
                }

                if (canGrab && interaction.target) {
                    interaction.state = INTERACTION_STATES.GRABBING;
                    interaction.target.isGrabbed = true;
                    // Store offset between hand and node center so node doesn't snap to hand
                    interaction.grabOffset = { 
                        x: interaction.target.x - midX, 
                        y: interaction.target.y - midY 
                    };
                    interaction.grabPos = { x: midX, y: midY };
                }
            } else if (interaction.state === INTERACTION_STATES.GRABBING || interaction.state === INTERACTION_STATES.DRAGGING) {
                if (shouldRelease) {
                    const node = interaction.target;
                    if (node) {
                        node.isGrabbed = false;
                        // Snap node position to final target for clean release
                        node.x = node.targetX;
                        node.y = node.targetY;
                    }
                    
                    // Check for zone transfer
                    this._handleDrop(side, midX, midY);
                    
                    interaction.state = INTERACTION_STATES.IDLE;
                    interaction.target = null;
                    interaction.grabOffset = null;
                } else {
                    interaction.state = INTERACTION_STATES.DRAGGING;
                    // Move node with hand, maintaining grab offset
                    if (interaction.target && interaction.grabOffset) {
                        interaction.target.targetX = midX + interaction.grabOffset.x;
                        interaction.target.targetY = midY + interaction.grabOffset.y;
                    }
                }
            }
        });

        // Hand-to-Hand Bridge Detection
        this.handBridgeActive = false;
        if (hands.left && hands.right) {
            const lIdx = hands.left.landmarks[8];
            const rIdx = hands.right.landmarks[8];
            const dx = lIdx.x - rIdx.x;
            const dy = lIdx.y - rIdx.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < 0.08) {
                this.handBridgeActive = true;
                this._executePipeOperation();
            }
        }

        // Smoothly animate grabbed nodes only
        this.nodes.forEach(node => {
            if (node.isGrabbed) {
                // Distance-based easing - faster when far, slower when close
                const dx = node.targetX - node.x;
                const dy = node.targetY - node.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // Adaptive lerp: faster for big distances, smoother for small
                const baseLerp = 0.15;
                const distanceFactor = Math.min(dist / 100, 1); // Cap at 1
                const lerpFactor = baseLerp + distanceFactor * 0.2; // 0.15 to 0.35
                
                node.x += dx * lerpFactor;
                node.y += dy * lerpFactor;
            }
            // Non-grabbed nodes stay exactly where they are
        });
    }

    _findNearestNode(x, y, side) {
        let nearest = null;
        let minDist = Infinity;
        
        const zoneNodes = side === 'left' ? this.activeNodes.left : this.activeNodes.right;

        zoneNodes.forEach(node => {
            const dx = x - node.x;
            const dy = y - node.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
                minDist = d;
                nearest = node;
            }
        });

        return nearest ? { node: nearest, dist: minDist } : null;
    }

    _handleDrop(side, x, y) {
        const interaction = this.interactionState[side];
        const node = interaction.target;
        if (!node) return;

        // Check if dropped ONTO another node (folder)
        const zoneNodes = side === 'left' ? this.activeNodes.left : this.activeNodes.right;
        const targetFolder = zoneNodes.find(n => 
            n !== node && 
            n.type === 'dir' && 
            Math.abs(x - n.x) < 80 && 
            Math.abs(y - n.y) < 30
        );

        if (targetFolder) {
            // Move node inside the folder (logical move)
            const sourceArray = side === 'left' ? this.activeNodes.left : this.activeNodes.right;
            const idx = sourceArray.indexOf(node);
            if (idx !== -1) {
                sourceArray.splice(idx, 1);
                targetFolder.nestedCount++;
                if (window.addLog) window.addLog(`NESTED: ${node.name} -> ${targetFolder.name}`);
            }
            return;
        }

        const midPoint = window.innerWidth / 2;
        const newSide = x < midPoint ? 'left' : 'right';

        if (newSide !== side) {
            // Transfer between zones
            const sourceArray = side === 'left' ? this.activeNodes.left : this.activeNodes.right;
            const destArray = newSide === 'left' ? this.activeNodes.left : this.activeNodes.right;
            
            const idx = sourceArray.indexOf(node);
            if (idx !== -1) {
                sourceArray.splice(idx, 1);
                destArray.push(node);
                
                // Snap to a decent position in the new zone if not being dragged
                node.targetX = newSide === 'left' ? 100 : window.innerWidth - 260;
                node.targetY = 150 + (destArray.length * 60);
            }
        }
    }

    _executePipeOperation() {
        // Pipe: Align all active nodes into clean stacks
        ['left', 'right'].forEach(side => {
            const nodes = this.activeNodes[side];
            nodes.forEach((node, i) => {
                if (!node.isGrabbed) {
                    node.targetX = side === 'left' ? 100 : window.innerWidth - 260;
                    node.targetY = 150 + (i * 60);
                }
            });
        });
    }
}

