import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ===== Global State =====
export const STATE = {
    mode: 'TREE', // TREE, SCATTER, FOCUS
    handRotation: { x: 0, y: 0 },
    focusTarget: null as Particle | null,
    uploadedPhotos: [] as any[]
};

// ===== Utility: Create Candy Cane Texture =====
export function createCandyCaneTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);

    // Red diagonal stripes
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 20;
    for (let i = -64; i < 128; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 64, 64);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}



// ===== Particle Class =====
export class Particle {
    type: string;
    mesh: THREE.Mesh | THREE.Group;
    treePos: THREE.Vector3;
    scatterPos: THREE.Vector3;
    randomRotSpeed: THREE.Vector3;
    isPhoto: boolean = false;
    photoIndex: number = -1;

    constructor(type: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], index: number, totalCount: number, tOverride?: number) {
        this.type = type;
        this.mesh = new THREE.Mesh(geometry, material);

        // Calculate tree position (spiral cone)
        // t goes from 0 to 1. 0 is bottom (radius max), 1 is top (radius 0).
        let t = (tOverride !== undefined) ? tOverride : Math.pow(Math.random(), 1.5);

        // Manual override for "Skirt" filling (Drastically increased for user request)
        // Force 25% of particles to be in the heavy bottom skirt
        if (tOverride === undefined && Math.random() < 0.25) {
            t = Math.random() * 0.2; // Bottom 20%
        }

        const height = t * 24 - 12; // Height 24 (-12 to 12)
        const maxRadius = 10.5;       // Base radius 10.5 (Restored Tree Shape)

        // Add some noise to radius to make it less perfect cone, more fluffy
        const radiusNoise = (Math.random() - 0.5) * 1.5; // Less noise
        let radius = maxRadius * (1 - t) + radiusNoise;
        // Removed Wide Skirt logic (radius *= 1.2)

        if (radius < 0) radius = 0;

        const angle = t * 60 * Math.PI + Math.random() * Math.PI * 2;

        this.treePos = new THREE.Vector3(
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius
        );

        // Calculate scatter position (sphere)
        const r = 8 + Math.random() * 12;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        this.scatterPos = new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );

        // Random rotation speed for SCATTER mode
        this.randomRotSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02,
            (Math.random() - 0.5) * 0.02
        );

        // Set initial position
        this.mesh.position.copy(this.treePos);

        // Photo specific
        if (type === 'PHOTO') {
            this.isPhoto = true;
            this.photoIndex = index;
        }
    }

    update(deltaTime: number, mode: string, focusTarget: Particle | null) {
        let targetPos: THREE.Vector3;

        if (mode === 'TREE') {
            if (this.mesh.parent !== this.mesh.userData.originalParent) {
                this.mesh.userData.originalParent.attach(this.mesh);
            }
            targetPos = this.treePos;
        } else if (mode === 'SCATTER') {
            if (this.mesh.parent !== this.mesh.userData.originalParent) {
                this.mesh.userData.originalParent.attach(this.mesh);
            }
            // Make it EXPLODE bigger!
            targetPos = this.scatterPos.clone().multiplyScalar(2.5);

            // Photos should be visible in Scatter
            if (this.isPhoto) {
                this.mesh.scale.lerp(new THREE.Vector3(2, 2, 2), 0.05);
            }

            this.mesh.rotation.x += this.randomRotSpeed.x;
            this.mesh.rotation.y += this.randomRotSpeed.y;
            this.mesh.rotation.z += this.randomRotSpeed.z;
        } else if (mode === 'FOCUS') {
            if (this.isPhoto && this === focusTarget) {
                // Determine scene parent (root scene)
                const scene = this.mesh.userData.originalParent.parent;
                if (this.mesh.parent !== scene) {
                    scene.attach(this.mesh);
                }

                // Move to WORLD camera front (independent of hand rotation)
                targetPos = new THREE.Vector3(0, 2, 35);
                this.mesh.scale.lerp(new THREE.Vector3(7.5, 7.5, 7.5), 0.1);

                // Force look at camera
                // Since parent is Scene (world), we can just look at world camera pos
                // But we need to do it every frame
                // We'll set rotation in the next block, here just set position
            } else {
                if (this.mesh.parent !== this.mesh.userData.originalParent) {
                    this.mesh.userData.originalParent.attach(this.mesh);
                }
                const spread = this.scatterPos.clone().multiplyScalar(1.5);
                targetPos = spread;
                this.mesh.scale.lerp(new THREE.Vector3(0.5, 0.5, 0.5), 0.1);
            }
        } else {
            if (this.mesh.parent !== this.mesh.userData.originalParent) {
                this.mesh.userData.originalParent.attach(this.mesh);
            }
            targetPos = this.treePos;
        }

        // Lerp to target position
        // "Return" to tree faster (0.25) than exploding (0.1)
        const speed = mode === 'TREE' ? 0.25 : 0.1;
        this.mesh.position.lerp(targetPos, speed);

        // Handle rotation for Focus Target
        if (mode === 'FOCUS' && this.isPhoto && this === focusTarget) {
            // Look directly at camera (0,2,50)
            this.mesh.lookAt(0, 2, 50);
        } else if (mode !== 'SCATTER') {
            // Reset rotation for others? Or let them stay
        }

        // Reset scale in non-FOCUS modes
        if (mode !== 'FOCUS') {
            this.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), speed);
        }
    }
}

// ===== Main Application Class =====
export class ChristmasTreeLogic {
    canvas: HTMLCanvasElement;
    renderer!: THREE.WebGLRenderer;
    scene!: THREE.Scene;
    camera!: THREE.PerspectiveCamera;
    mainGroup!: THREE.Group;
    composer!: EffectComposer;
    particles: Particle[] = [];
    dustSystem!: THREE.Points;
    video!: HTMLVideoElement;
    cvCanvas!: HTMLCanvasElement;
    handLandmarker: HandLandmarker | null = null;
    lastVideoTime: number = -1;
    running: boolean = false;
    topStar: THREE.Mesh | null = null;

    constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement, cvCanvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.video = video;
        this.cvCanvas = cvCanvas;
    }

    cursorMesh!: THREE.Mesh;
    raycaster!: THREE.Raycaster;
    hoverTarget: Particle | null = null;
    lastHandX: number | null = null;
    switchCooldown: number = 0;

    async init() {
        this.setupScene();
        this.setupLighting();
        this.setupPostProcessing();
        this.createParticles();
        this.setupTopStar(); // Create Top Star
        this.createCursor(); // Initialize cursor

        this.raycaster = new THREE.Raycaster();

        this.running = true;
        this.animate(); // Start rendering immediately

        // Start loading photos
        this.loadPredefinedPhotos();

        // Initialize MediaPipe in background
        this.setupMediaPipe().then(() => {
            console.log('MediaPipe initialized successfully');
        }).catch(error => {
            console.warn('MediaPipe initialization failed:', error);
        });

        // Duplicate load call removed
    }

    createCursor() {
        // Create a small glowing sphere for the cursor
        const geometry = new THREE.SphereGeometry(0.2, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8,
            depthTest: false // Always visible
        });
        this.cursorMesh = new THREE.Mesh(geometry, material);
        // Initially hide until hand is detected
        this.cursorMesh.visible = false;
        this.scene.add(this.cursorMesh);
    }

    async loadPredefinedPhotos() {
        // Distinct photos list in user-specified order
        // 1..10 then Card
        const orderedPhotos = [
            '1.JPG',
            '2.JPG',
            '3.JPG',
            '4.JPG',
            '5.JPG',
            '6.JPG',
            '7.JPG',
            '8.JPG',
            '9 2.jpeg',
            '10.JPG',
            '卡片.png'
        ];

        const loader = new THREE.TextureLoader();



        // Optimize: Load ALL in parallel, but Add sequentially
        // 1. Create all load promises
        const loadPromises = orderedPhotos.map(filename => {
            return new Promise<THREE.Texture | null>((resolve) => {
                loader.load(
                    `/photos/${filename}`,
                    (texture) => {
                        texture.colorSpace = THREE.SRGBColorSpace;
                        resolve(texture);
                    },
                    undefined,
                    () => resolve(null) // Resolve null on error
                );
            });
        });

        // 2. Wait for all
        const textures = await Promise.all(loadPromises);

        // 3. Add valid ones in order
        textures.forEach(texture => {
            if (texture) {
                this.addPhoto(texture);
            }
        });
    }
    //...


    tryLoadPhoto(loader: THREE.TextureLoader, url: string) {
        loader.load(
            url,
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                this.addPhoto(texture);
            },
            undefined,
            (err) => {
                // Suppress
            }
        );
    }

    dispose() {
        this.running = false;
        if (this.renderer) this.renderer.dispose();
        // Stop video stream
        if (this.video && this.video.srcObject) {
            const stream = this.video.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
    }

    setupEventListeners() {
        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });

        // H key to hide UI
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'h') {
                const title = document.getElementById('title');
                const uploadWrapper = document.getElementById('upload-wrapper');
                if (title) title.classList.toggle('ui-hidden');
                if (uploadWrapper) uploadWrapper.classList.toggle('ui-hidden');
            }
        });

        // Mouse click removed as per user request
    }
    setupScene() {
        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 2.2;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 2, 50);
        this.camera.lookAt(0, 0, 0);

        // Main group for rotation control
        this.mainGroup = new THREE.Group();
        this.scene.add(this.mainGroup);

        // Environment
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmremGenerator.fromScene(
            new RoomEnvironment(),
            0.04
        ).texture;
    }

    setupLighting() {
        // Ambient light (Dimmed for "Cozy/Dark" mood)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(ambientLight);

        // Point light (orange, internal)
        const pointLight = new THREE.PointLight(0xFFA500, 1.5);
        pointLight.position.set(0, 0, 0);
        this.scene.add(pointLight);

        // Spot light (Warm Gold - Softened)
        const spotLight1 = new THREE.SpotLight(0xFFE475, 800);
        spotLight1.position.set(30, 40, 40);
        spotLight1.angle = Math.PI / 4;
        spotLight1.penumbra = 0.5;
        // Shadows disabled for performance
        spotLight1.castShadow = false;
        this.scene.add(spotLight1);

        // Spot light (Icy Blue - Softened)
        const spotLight2 = new THREE.SpotLight(0xB0E0E6, 400);
        spotLight2.position.set(-30, 20, -30);
        spotLight2.angle = Math.PI / 4;
        spotLight2.penumbra = 0.5;
        this.scene.add(spotLight2);
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.15,   // strength (Drastically reduced from 0.3)
            0.5,    // radius
            0.92    // threshold (High - only lights glow)
        );
        this.composer.addPass(bloomPass);
    }

    async setupMediaPipe() {
        try {
            // Get webcam
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 160, height: 120 }
            });

            this.video.srcObject = stream;

            // Wait for video to be ready
            await new Promise<void>((resolve) => {
                if (this.video.readyState >= 2) {
                    this.video.play().then(() => resolve()).catch(e => console.warn("Play failed", e));
                } else {
                    this.video.onloadeddata = () => {
                        this.video.play().then(() => resolve()).catch(e => console.warn("Play failed", e));
                    };
                }
            });

            // Initialize HandLandmarker
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
            );

            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });

            this.lastVideoTime = -1;
            this.processGestures();
        } catch (error) {
            console.warn('MediaPipe setup failed:', error);
            throw error;
        }
    }

    processGestures() {
        if (!this.running || !this.handLandmarker || !this.video) return;

        const detect = () => {
            if (!this.running) return;

            if (this.video.currentTime !== this.lastVideoTime) {
                this.lastVideoTime = this.video.currentTime;

                try {
                    const results = this.handLandmarker!.detectForVideo(
                        this.video,
                        Date.now()
                    );

                    if (results.landmarks && results.landmarks.length > 0) {
                        const landmarks = results.landmarks[0];

                        // Map palm center (landmark 9) to scene rotation
                        const palmCenter = landmarks[9];
                        STATE.handRotation.y = (palmCenter.x - 0.5) * 4;  // -2 to 2 radians
                        STATE.handRotation.x = (palmCenter.y - 0.5) * 2;  // -1 to 1 radians

                        // --- Hand Cursor Logic ---
                        const indexTip = landmarks[8];

                        // 1. Update Cursor Mesh Position (Visual feedback)
                        // Map 0..1 to -1..1 (inverted X for mirror effect)
                        const ndcX = (1 - indexTip.x) * 2 - 1;
                        const ndcY = (1 - indexTip.y) * 2 - 1;

                        // Project to 3D space at a fixed distance for visibility
                        const vector = new THREE.Vector3(ndcX, ndcY, 0.5); // z is depth in NDC
                        vector.unproject(this.camera);
                        const dir = vector.sub(this.camera.position).normalize();
                        const distance = 40; // Place cursor at typical tree distance
                        const pos = this.camera.position.clone().add(dir.multiplyScalar(distance));

                        this.cursorMesh.position.copy(pos);
                        this.cursorMesh.visible = false; // Hidden as per user request (Step 360)

                        // 2. Raycasting for Photo Selection
                        const mouse = new THREE.Vector2(ndcX, ndcY);
                        this.raycaster.setFromCamera(mouse, this.camera);

                        const photoParticles = this.particles.filter(p => p.isPhoto);
                        const meshes = photoParticles.map(p => p.mesh);
                        const intersects = this.raycaster.intersectObjects(meshes, true);

                        // Reset previous hover target
                        if (this.hoverTarget && (!intersects.length || intersects[0].object !== this.hoverTarget.mesh && !this.isChildOf(intersects[0].object, this.hoverTarget.mesh as THREE.Group))) {
                            // Scale down if not focused
                            if (STATE.mode !== 'FOCUS' || STATE.focusTarget !== this.hoverTarget) {
                                this.hoverTarget.mesh.scale.set(1, 1, 1);
                            }
                            this.hoverTarget = null;
                        }

                        if (intersects.length > 0) {
                            const hitObject = intersects[0].object;
                            const targetParticle = photoParticles.find(p => this.isChildOf(hitObject, p.mesh as THREE.Group) || p.mesh === hitObject);

                            if (targetParticle) {
                                this.hoverTarget = targetParticle;
                                // Hover effect REMOVED as per user request
                                // (No scaling)
                            }
                        }

                        // --- Gesture Recognition ---
                        const thumb = landmarks[4];
                        const index = landmarks[8];
                        const wrist = landmarks[0];
                        const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);

                        // Calculate Pinch Distance
                        const pinchDist = dist(thumb, index);

                        // Calculate Hand Openness (Avg fingertip dist)
                        const fingertips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
                        const avgDist = fingertips.reduce((sum, tip) => sum + dist(tip, wrist), 0) / 4;

                        // === INTERACTION LOGIC ===

                        // === INTERACTION LOGIC ===

                        // 1. PINCH (Hold to Focus)
                        if (pinchDist < 0.05) {
                            if (STATE.mode === 'FOCUS' && STATE.focusTarget) {
                                // --- SWIPE TO SWITCH LOGIC ---
                                // If already focused, check for horizontal movement (Swipe)
                                const currentX = index.x; // 0..1
                                const dx = currentX - (this.lastVideoTime === -1 ? currentX : (this.lastHandX || currentX));
                                this.lastHandX = currentX;

                                // Cooldown check (using lastVideoTime as quick timestamp proxy or Date.now)
                                const now = Date.now();
                                if (!this.switchCooldown || now - this.switchCooldown > 500) {
                                    const photoParticles = this.particles.filter(p => p.isPhoto);
                                    const currentIndex = photoParticles.length > 0 ? photoParticles.indexOf(STATE.focusTarget) : -1;

                                    if (currentIndex !== -1) {
                                        let nextIndex = -1;
                                        // Swipe threshold
                                        if (dx > 0.08) { // Moved Right -> Next
                                            nextIndex = (currentIndex + 1) % photoParticles.length;
                                        } else if (dx < -0.08) { // Moved Left -> Prev
                                            nextIndex = (currentIndex - 1 + photoParticles.length) % photoParticles.length;
                                        }

                                        if (nextIndex !== -1) {
                                            STATE.focusTarget = photoParticles[nextIndex];
                                            this.switchCooldown = now;
                                        }
                                    }
                                }
                            } else if (this.hoverTarget) {
                                // Aim to switch (if not already focused or standard)
                                STATE.mode = 'FOCUS';
                                STATE.focusTarget = this.hoverTarget;
                                this.lastHandX = index.x; // Init X tracking
                            } else {
                                // Fallback: If pinching empty space, find the NEAREST photo to the ray
                                // "As long as I pinch, a photo should appear"
                                let closestDist = Infinity;
                                let closestPhoto: Particle | null = null;
                                const photoParticles = this.particles.filter(p => p.isPhoto);

                                for (const p of photoParticles) {
                                    // Calculate distance from ray to particle position
                                    // Raycaster is already set from camera
                                    const dist = this.raycaster.ray.distanceSqToPoint(p.mesh.position);
                                    if (dist < closestDist) {
                                        closestDist = dist;
                                        closestPhoto = p;
                                    }
                                }

                                // If the closest one is somewhat reasonable (or just pick absolute closest)
                                if (closestPhoto) {
                                    STATE.mode = 'FOCUS';
                                    STATE.focusTarget = closestPhoto;
                                    // Also set as hoverTarget to simulate selection
                                    this.hoverTarget = closestPhoto;
                                }
                            }
                        } else {
                            this.lastHandX = null; // Reset swipe tracking

                            // 2. RELEASE (Pinch Open -> Close Photo)
                            if (STATE.mode === 'FOCUS') {
                                STATE.focusTarget = null;
                                // Decide next mode based on hand openness
                                if (avgDist > 0.32) {
                                    STATE.mode = 'SCATTER';
                                } else {
                                    STATE.mode = 'TREE';
                                }
                            }

                            // Standard Modes
                            if (avgDist < 0.25) {
                                STATE.mode = 'TREE';
                            } else if (avgDist > 0.35) {
                                STATE.mode = 'SCATTER';
                            }
                        }

                    } else {
                        // Hide cursor if no hand detected
                        this.cursorMesh.visible = false;
                    }
                } catch (e) {
                    console.warn(e);
                }
            }

            requestAnimationFrame(detect);
        };

        detect();
    }

    // Helper to check if object is child of group
    isChildOf(child: THREE.Object3D, parent: THREE.Group): boolean {
        let curr = child;
        while (curr.parent) {
            if (curr.parent === parent) return true;
            curr = curr.parent;
        }
        return false;
    }

    createParticles() {
        this.particles = [];

        // Materials - "Ethereal & Sparkling"

        // 1. Ethereal Snow (Pearl White, Icy) - Optimized for Performance
        // 1. Lux Flocked Snow (Ivory/Cream - Warm & Soft)
        const snowDirect = new THREE.MeshStandardMaterial({
            color: 0xfffff0, // Ivory (Warm White)
            roughness: 0.9,
            metalness: 0.1,
            emissive: 0x000000, // NO EMISSIVE (Fix Brightness)
        });

        // 2. Rose Petal (Premium Velvet)
        // 2. Cream Poinsettia / Flower (Soft Fabric)
        const roseMaterial = new THREE.MeshStandardMaterial({
            color: 0xfffdd0, // Cream / Off-White
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        // 3. Champagne Gold (Soft Metallic)
        const champagneMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xeeddcc,
            metalness: 0.5,
            roughness: 0.2,
            clearcoat: 1.0,
            reflectivity: 0.8
        });

        // 4. Soft Silver (Matte Metallic)
        const silverMatte = new THREE.MeshPhysicalMaterial({
            color: 0xdcdcdc,
            metalness: 0.8,
            roughness: 0.4,
            clearcoat: 0.5
        });

        // 5. Ribbon/Bow (Fabric Cream)
        // 5. Large Ribbon/Bow (Champagne Velvet)
        const ribbonMaterial = new THREE.MeshStandardMaterial({
            color: 0xeecfa1, // Palomino / Champagne Gold
            roughness: 0.6,
            metalness: 0.3,
            side: THREE.DoubleSide
        });

        // 6. Fairy Light (Glowing)
        const fairyMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffee, // Warm White
            toneMapped: false // Super bright for bloom
        });

        // 7. Rich Gold (For Top Highlights)
        const richGoldMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xffd700, // Standard Gold
            metalness: 1.0,
            roughness: 0.1,
            clearcoat: 1.0,
            emissive: 0xaa8800,
            emissiveIntensity: 0.2
        });

        // Geometries
        // Large Fluffed Branches (Tetrahedron with offset)
        const foliageGeo = new THREE.TetrahedronGeometry(0.7, 0);
        const sphereGeo = new THREE.SphereGeometry(0.4, 32, 32);
        const boxGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
        const pyramidGeo = new THREE.ConeGeometry(0.3, 0.6, 4);
        const fairyGeo = new THREE.OctahedronGeometry(0.15, 0); // Tiny star/diamond

        // Abstract Rose: "Rose Knot" (Intricate Flower Ball)
        // Uses TorusKnot with specific P/Q to mimic petals
        const roseGeo = new THREE.TorusKnotGeometry(0.35, 0.1, 128, 16, 5, 4);

        // Classic Bow: Simple Knot
        const bowGeo = new THREE.TorusKnotGeometry(0.35, 0.12, 64, 8, 2, 3);

        // Create 3500 particles (High Density for "Full" look)
        const count = 3500;
        for (let i = 0; i < count; i++) {
            const rand = Math.random();
            let particle;

            if (rand < 0.40) {
                // 40% Foliage (Base Layer - Tighter)
                particle = new Particle('FOLIAGE', foliageGeo, snowDirect, i, count);
                particle.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                // @ts-ignore
                particle.mesh.userData.baseScale = 1.8 + Math.random() * 1.2; // Scale 1.8 to 3.0 (sharper silhouette)

            } else if (rand < 0.85) {
                // 45% Ornaments (The main visual - Balls everywhere)
                let mat;
                const rMat = Math.random();
                if (rMat < 0.5) mat = champagneMaterial;
                else if (rMat < 0.8) mat = richGoldMaterial; // More Gold!
                else mat = silverMatte; // Accent

                // Mostly Spheres (Reference images are full of balls)
                let geo: THREE.BufferGeometry = sphereGeo;
                if (Math.random() < 0.1) geo = boxGeo; // Rare box

                particle = new Particle('ORNAMENT', geo, mat, i, count);

                // Varied sizes: Full Mix (Small to Massive)
                const s = Math.random();
                let scale = 1.0;
                if (s < 0.3) scale = 0.8;       // Small fillers
                else if (s < 0.6) scale = 1.6;  // Medium
                else if (s < 0.9) scale = 2.4;  // Large
                else scale = 3.0;               // Giant Statement

                // @ts-ignore
                particle.mesh.scale.set(scale, scale, scale);
                // @ts-ignore
                particle.mesh.userData.baseScale = scale;
                particle.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

            } else if (rand < 0.95) {
                // 10% Flowers (Cream Poinsettias)
                particle = new Particle('ROSE', roseGeo, roseMaterial, i, count);
                // @ts-ignore
                particle.mesh.scale.set(2.5, 2.5, 2.5);
                // @ts-ignore
                particle.mesh.userData.baseScale = 2.5;
            } else {
                // 5% Bows (Champagne)
                particle = new Particle('BOW', bowGeo, ribbonMaterial, i, count);
                // @ts-ignore
                particle.mesh.scale.set(2.4, 2.4, 2.4);
                // @ts-ignore
                particle.mesh.userData.baseScale = 2.4;
            }

            // Set initial scale
            // @ts-ignore
            if (!particle.mesh.userData.baseScale) particle.mesh.userData.baseScale = 1.0;
            // @ts-ignore
            particle.mesh.userData.currentScale = particle.mesh.userData.baseScale;
            // @ts-ignore
            particle.mesh.scale.setScalar(0);

            this.mainGroup.add(particle.mesh);
            particle.mesh.userData.originalParent = this.mainGroup; // Fix: Restore originalParent
            this.particles.push(particle);
        }

        // --- Top Gold Highlights (Optimized to 80) ---
        for (let i = 0; i < 80; i++) {
            const t = 0.65 + Math.random() * 0.3;
            const r = Math.random();
            let geo: THREE.BufferGeometry = sphereGeo;
            if (r < 0.3) geo = boxGeo;
            else if (r < 0.6) geo = pyramidGeo;

            const p = new Particle('ORNAMENT', geo, richGoldMaterial, count + i, count + 100, t);
            // @ts-ignore
            p.mesh.scale.set(1.5, 1.5, 1.5);
            // @ts-ignore
            p.mesh.userData.baseScale = 1.5;
            // @ts-ignore
            p.mesh.userData.currentScale = 1.5;
            p.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

            this.mainGroup.add(p.mesh);
            p.mesh.userData.originalParent = this.mainGroup; // Fix: Restore originalParent
            this.particles.push(p);
        }



        // Dust particles (Twinkling Stars)
        const dustGeo = new THREE.BufferGeometry();
        const dustPositions = [];
        const dustOffsets = []; // For random twinkle timing

        for (let i = 0; i < 2500; i++) {
            const r = 25 * Math.cbrt(Math.random());
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            dustPositions.push(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi)
            );
            dustOffsets.push(Math.random() * 100);
        }
        dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
        dustGeo.setAttribute('aOffset', new THREE.Float32BufferAttribute(dustOffsets, 1));

        const dustMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }
            },
            vertexShader: `
                uniform float uTime;
                attribute float aOffset;
                varying float vAlpha;
                void main() {
                    vec3 pos = position;
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    // Size attenuation
                    gl_PointSize = 3.0 * (20.0 / -mvPosition.z);
                    
                    // Twinkle logic
                    float blink = sin(uTime * 2.0 + aOffset);
                    vAlpha = 0.3 + 0.7 * (0.5 + 0.5 * blink); // Range 0.3 to 1.0
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    // Make circular
                    vec2 coord = gl_PointCoord - vec2(0.5);
                    if(length(coord) > 0.5) discard;
                    
                    gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.dustSystem = new THREE.Points(dustGeo, dustMat);
        this.mainGroup.add(this.dustSystem);
    }

    setupTopStar() {
        // Create a 3D 5-Pointed Star (Pyramidal Gem Layout)
        // Vertices:
        // 0: Center Front (0, 0, Z)
        // 1: Center Back (0, 0, -Z)
        // 2-6: Inner Ring (Valleys)
        // 7-11: Outer Ring (Points)

        const outerRadius = 2.0;
        const innerRadius = 0.8;
        const depth = 0.6;

        const vertices = [];
        const indices = [];

        // 0: Front Center, 1: Back Center
        vertices.push(0, 0, depth);
        vertices.push(0, 0, -depth);

        // Generate Ring Vertices
        for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2 - Math.PI / 2; // Start at top
            const r = (i % 2 === 0) ? outerRadius : innerRadius;
            vertices.push(Math.cos(angle) * r, Math.sin(angle) * r, 0);
        }

        // Faces (Front)
        // Connect Center(0) to i and i+1 in ring (indices 2 to 11)
        for (let i = 0; i < 10; i++) {
            const next = (i + 1) % 10;
            // Front Face: 0, Ring[i], Ring[next]
            indices.push(0, 2 + i, 2 + next);
            // Back Face: 1, Ring[next], Ring[i] (Reverse winding)
            indices.push(1, 2 + next, 2 + i);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshPhysicalMaterial({
            color: 0xffd700,
            metalness: 0.2, // Low metal for crystal look
            roughness: 0.0, // Perfectly smooth
            transmission: 0.6, // Glass-like transparency
            thickness: 2.0, // Refraction volume
            clearcoat: 1.0, // Shiny coating
            clearcoatRoughness: 0.0,
            ior: 2.33, // Diamond refractive index
            emissive: 0xffaa00,
            emissiveIntensity: 0.5,
            side: THREE.DoubleSide
        });

        this.topStar = new THREE.Mesh(geometry, material);
        this.topStar.position.set(0, 13.5, 0); // Corrected height (Tree Peak is ~12)

        // Add a local point light for the star
        const starLight = new THREE.PointLight(0xffd700, 2, 15);
        starLight.position.set(0, 0, 0);
        this.topStar.add(starLight);

        this.mainGroup.add(this.topStar);
    }

    addPhoto(texture: THREE.Texture, shouldFocus: boolean = false) {
        // Calculate Aspect Ratio
        let width = 1.0;
        let height = 0.7;

        if (texture.image) {
            const aspect = texture.image.width / texture.image.height;
            if (aspect > 1) {
                // Landscape
                width = 1.0;
                height = 1.0 / aspect;
            } else {
                // Portrait
                height = 1.0;
                width = 1.0 * aspect;
            }
        }

        // Frame adds padding
        const framePadding = 0.2;
        const frameGeo = new THREE.BoxGeometry(width + framePadding, height + framePadding, 0.05);
        const frameMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0, // Slightly darker white (Light Grey) to prevent bloom burnout
            metalness: 0.0,
            roughness: 1.0,
            emissive: 0x000000
        });

        const photoGeo = new THREE.PlaneGeometry(width, height);
        const photoMat = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xbbbbbb, // Slightly dimmed to match darker scene
            toneMapped: false
        });

        const photoGroup = new THREE.Group();

        const frame = new THREE.Mesh(frameGeo, frameMat);
        const photo = new THREE.Mesh(photoGeo, photoMat);
        photo.position.z = 0.03;

        photoGroup.add(frame);
        photoGroup.add(photo);

        // Create as particle
        const particle = new Particle('PHOTO', frameGeo, frameMat, this.particles.length, this.particles.length + 1);
        particle.mesh = photoGroup; // Replace mesh with group
        particle.isPhoto = true;

        this.particles.push(particle);
        this.mainGroup.add(photoGroup);
        photoGroup.userData.originalParent = this.mainGroup; // Store original parent

        // Auto-focus if requested
        if (shouldFocus) {
            STATE.mode = 'FOCUS';
            STATE.focusTarget = particle;
        }
    }

    // New: Keyboard Navigation
    navigatePhotos(direction: number) {
        const photoParticles = this.particles.filter(p => p.isPhoto);
        if (photoParticles.length === 0) return;

        let currentIndex = -1;
        if (STATE.focusTarget && STATE.focusTarget.isPhoto) {
            currentIndex = photoParticles.indexOf(STATE.focusTarget);
        }

        let nextIndex;
        if (currentIndex === -1) {
            // If not focused, start at 0 (or last if direction -1)
            nextIndex = direction > 0 ? 0 : photoParticles.length - 1;
        } else {
            nextIndex = (currentIndex + direction + photoParticles.length) % photoParticles.length;
        }

        STATE.focusTarget = photoParticles[nextIndex];
        STATE.mode = 'FOCUS';
    }

    animate() {
        if (!this.running) return;

        requestAnimationFrame(() => this.animate());

        const deltaTime = 0.016; // ~60fps

        // Apply hand rotation to main group (X-axis only, Y is auto)
        this.mainGroup.rotation.x += (STATE.handRotation.x - this.mainGroup.rotation.x) * 0.1;
        // this.mainGroup.rotation.y += (STATE.handRotation.y - this.mainGroup.rotation.y) * 0.1; // Disable Hand Y-control to allow auto-spin

        // Auto-rotate the tree slowly (Always)
        this.mainGroup.rotation.y += 0.003; // Slightly faster spin

        // Update all particles
        this.particles.forEach(particle => {
            particle.update(deltaTime, STATE.mode, STATE.focusTarget);
        });

        // Update Dust Twinkle
        if (this.dustSystem && this.dustSystem.material instanceof THREE.ShaderMaterial) {
            this.dustSystem.material.uniforms.uTime.value += deltaTime;
        }

        // Rotate Top Star
        if (this.topStar) {
            this.topStar.rotation.y -= deltaTime * 0.5;
            this.topStar.rotation.z += deltaTime * 0.2;
        }

        // Render
        this.composer.render();
    }
}
