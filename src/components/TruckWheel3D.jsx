import { useEffect, useRef, useState } from "react";
import "./TruckWheel3D.css";

const LIGHTWEIGHT_QUERY = "(max-width: 640px), (pointer: coarse), (prefers-reduced-motion: reduce)";

export default function TruckWheel3D() {
  const mountRef = useRef(null);
  const pointerRef = useRef({ x: 0, y: 0, hovering: false, revUntil: 0 });
  const revTimeoutRef = useRef(null);
  const [lightweight, setLightweight] = useState(() => window.matchMedia(LIGHTWEIGHT_QUERY).matches);
  const [hovered, setHovered] = useState(false);
  const [revving, setRevving] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(LIGHTWEIGHT_QUERY);
    const updateMode = () => setLightweight(media.matches);
    media.addEventListener("change", updateMode);
    return () => media.removeEventListener("change", updateMode);
  }, []);

  useEffect(() => () => window.clearTimeout(revTimeoutRef.current), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || lightweight) return undefined;

    let disposed = false;
    let renderer;
    let scene;
    let resizeObserver;
    let animationFrame;

    import("three").then((THREE) => {
      if (disposed) return;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
        scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 20);
        camera.position.set(0, 0, 5);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.setClearColor(0x000000, 0);
        mount.appendChild(renderer.domElement);

        scene.add(new THREE.HemisphereLight(0xe6edf0, 0x171b1d, 2));
        const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
        keyLight.position.set(-2.5, 3.5, 4);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0xaabac1, 2.3);
        rimLight.position.set(3, -2, -2);
        scene.add(rimLight);
        const orangeLight = new THREE.PointLight(0xf97316, 0.8, 4);
        orangeLight.position.set(1, 0.5, 2);
        scene.add(orangeLight);

        const assembly = new THREE.Group();
        const rotatingWheel = new THREE.Group();
        scene.add(assembly);
        assembly.add(rotatingWheel);

        const rubber = new THREE.MeshStandardMaterial({ color: 0x171a1c, metalness: 0.03, roughness: 0.88 });
        const sidewall = new THREE.MeshStandardMaterial({ color: 0x24282a, metalness: 0.08, roughness: 0.72 });
        const steel = new THREE.MeshStandardMaterial({ color: 0xaab2b5, metalness: 0.9, roughness: 0.24 });
        const darkSteel = new THREE.MeshStandardMaterial({ color: 0x41494d, metalness: 0.82, roughness: 0.32 });
        const rotorSteel = new THREE.MeshStandardMaterial({ color: 0x777f82, metalness: 0.86, roughness: 0.36 });
        const orange = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.63, roughness: 0.28 });

        const tire = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.22, 10, 40), rubber);
        rotatingWheel.add(tire);
        [-0.14, 0.14].forEach((z) => {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.035, 6, 36), sidewall);
          band.position.z = z;
          rotatingWheel.add(band);
        });

        const treadGeometry = new THREE.BoxGeometry(0.115, 0.095, 0.105);
        for (let row = -1; row <= 1; row += 1) {
          for (let index = 0; index < 28; index += 1) {
            const angle = (index / 28) * Math.PI * 2;
            const block = new THREE.Mesh(treadGeometry, rubber);
            block.position.set(Math.cos(angle) * 0.98, Math.sin(angle) * 0.98, row * 0.13);
            block.rotation.z = angle + Math.PI / 2 + (index % 2 ? 0.12 : -0.12);
            rotatingWheel.add(block);
          }
        }

        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.59, 0.59, 0.24, 40), darkSteel);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.z = 0.015;
        rotatingWheel.add(barrel);

        const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.035, 36), rotorSteel);
        rotor.rotation.x = Math.PI / 2;
        rotor.position.z = 0.15;
        rotatingWheel.add(rotor);
        const rotorRing = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.018, 6, 36), orange);
        rotorRing.position.z = 0.18;
        rotatingWheel.add(rotorRing);

        const rimLip = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.028, 8, 40), steel);
        rimLip.position.z = 0.2;
        rotatingWheel.add(rimLip);
        const rimInner = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.014, 6, 36), darkSteel);
        rimInner.position.z = 0.205;
        rotatingWheel.add(rimInner);

        const spokeShape = new THREE.Shape();
        spokeShape.moveTo(-0.045, 0.13);
        spokeShape.lineTo(-0.105, 0.49);
        spokeShape.lineTo(0.105, 0.49);
        spokeShape.lineTo(0.045, 0.13);
        spokeShape.closePath();
        const spokeGeometry = new THREE.ExtrudeGeometry(spokeShape, {
          depth: 0.075,
          bevelEnabled: true,
          bevelSegments: 1,
          steps: 1,
          bevelSize: 0.012,
          bevelThickness: 0.012,
        });
        for (let index = 0; index < 5; index += 1) {
          const spoke = new THREE.Mesh(spokeGeometry, steel);
          spoke.rotation.z = (index / 5) * Math.PI * 2;
          spoke.position.z = 0.13;
          rotatingWheel.add(spoke);
        }

        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.16, 32), steel);
        hub.rotation.x = Math.PI / 2;
        hub.position.z = 0.22;
        rotatingWheel.add(hub);
        const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.035, 28), darkSteel);
        hubCap.rotation.x = Math.PI / 2;
        hubCap.position.z = 0.32;
        rotatingWheel.add(hubCap);

        const lugGeometry = new THREE.CylinderGeometry(0.027, 0.027, 0.045, 8);
        for (let index = 0; index < 10; index += 1) {
          const angle = (index / 10) * Math.PI * 2;
          const lug = new THREE.Mesh(lugGeometry, index % 2 ? steel : orange);
          lug.rotation.x = Math.PI / 2;
          lug.position.set(Math.cos(angle) * 0.255, Math.sin(angle) * 0.255, 0.29);
          rotatingWheel.add(lug);
        }

        const caliper = new THREE.Group();
        const caliperBody = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.12), orange);
        caliperBody.position.set(0.42, 0.02, 0.22);
        caliper.add(caliperBody);
        const caliperInset = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.18, 0.015), darkSteel);
        caliperInset.position.set(0.42, 0.02, 0.29);
        caliper.add(caliperInset);
        assembly.add(caliper);

        const pointerTarget = new THREE.Vector2();
        const scaleTarget = new THREE.Vector3(1, 1, 1);
        let angle = 0;
        let speed = 0.42;
        let previousTime = performance.now();

        const resize = () => {
          const { width, height } = mount.getBoundingClientRect();
          if (!width || !height) return;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);
        resize();

        const animate = (now) => {
          animationFrame = requestAnimationFrame(animate);
          const dt = Math.min((now - previousTime) / 1000, 0.05);
          previousTime = now;
          const pointer = pointerRef.current;
          const revvingNow = now < pointer.revUntil;
          const targetSpeed = revvingNow ? 16 : pointer.hovering ? 0.95 : 0.42;
          const response = revvingNow ? 6 : 2.8;
          speed += (targetSpeed - speed) * (1 - Math.exp(-dt * response));
          angle += speed * dt;
          rotatingWheel.rotation.z = angle;

          pointerTarget.set(pointer.x * 0.06, pointer.y * 0.045);
          assembly.rotation.y += (pointerTarget.x - assembly.rotation.y) * (1 - Math.exp(-dt * 5));
          assembly.rotation.x += (-pointerTarget.y - assembly.rotation.x) * (1 - Math.exp(-dt * 5));
          const scale = pointer.hovering ? 1.025 : 1;
          scaleTarget.set(scale, scale, scale);
          assembly.scale.lerp(scaleTarget, 1 - Math.exp(-dt * 4));
          renderer.render(scene, camera);
        };
        animationFrame = requestAnimationFrame(animate);
      } catch {
        if (!disposed) setLightweight(true);
      }
    }).catch(() => {
      if (!disposed) setLightweight(true);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      scene?.traverse((object) => {
        object.geometry?.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [lightweight]);

  function handlePointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    pointerRef.current.x = x;
    pointerRef.current.y = y;
  }

  function handleRev() {
    pointerRef.current.revUntil = performance.now() + 700;
    setRevving(true);
    window.clearTimeout(revTimeoutRef.current);
    revTimeoutRef.current = window.setTimeout(() => setRevving(false), 1200);
  }

  return (
    <div
      className={`truck-wheel3d ${lightweight ? "is-lightweight" : ""} ${hovered ? "is-hovered" : ""} ${revving ? "is-revving" : ""}`}
      ref={mountRef}
      role="button"
      tabIndex={0}
      aria-label="Interactive truck wheel. Hover to accelerate, click to spin."
      title="Hover to accelerate · Click to spin"
      onPointerEnter={() => {
        pointerRef.current.hovering = true;
        setHovered(true);
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pointerRef.current.hovering = false;
        pointerRef.current.x = 0;
        pointerRef.current.y = 0;
        setHovered(false);
      }}
      onClick={handleRev}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleRev();
        }
      }}
    >
      <span className="truck-wheel-fallback" aria-hidden="true">
        <span className="wheel-rotation">
          <span className="wheel-rim">
            <span className="wheel-spokes"><i /><i /><i /><i /><i /></span>
            <span className="wheel-hub" />
          </span>
        </span>
        <span className="wheel-caliper" />
      </span>
    </div>
  );
}