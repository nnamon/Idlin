import * as THREE from "three";

/**
 * Phase 0 placeholder scene proving the rendering stack: a slowly rotating
 * cube over a ground plane, lit the way Idlin intends to look — dark ambient,
 * one strong warm point light, fog for depth.
 */
export class TestScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private cube: THREE.Mesh;
  private clock = new THREE.Clock();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0a0f);
    this.scene.fog = new THREE.Fog(0x0a0a0f, 8, 30);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(4, 5, 7);
    this.camera.lookAt(0, 0.5, 0);

    // Idlin mood: near-black ambient, one strong warm light.
    this.scene.add(new THREE.AmbientLight(0x404060, 0.4));
    const brazier = new THREE.PointLight(0xff9a3c, 60, 25);
    brazier.position.set(3, 4, 2);
    brazier.castShadow = true;
    this.scene.add(brazier);
    const rim = new THREE.DirectionalLight(0x3c5aff, 0.3);
    rim.position.set(-5, 3, -5);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x8a2be2, roughness: 0.4, metalness: 0.2 }),
    );
    this.cube.position.y = 1;
    this.cube.castShadow = true;
    this.scene.add(this.cube);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private frame(): void {
    const dt = this.clock.getDelta();
    this.cube.rotation.y += dt * 0.8;
    this.cube.position.y = 1 + Math.sin(this.clock.elapsedTime * 1.5) * 0.15;
    this.renderer.render(this.scene, this.camera);
  }
}
