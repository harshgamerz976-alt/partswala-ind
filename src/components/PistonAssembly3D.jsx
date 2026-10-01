import { useEffect, useRef, useState } from "react";
import "./PistonAssembly3D.css";

const LIGHTWEIGHT_QUERY = "(max-width: 640px), (pointer: coarse), (prefers-reduced-motion: reduce)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export default function PistonAssembly3D() {
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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.setClearColor(0x000000, 0);
        mount.appendChild(renderer.domElement);

        scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 20);
        camera.position.set(0, 0, 5);
        scene.add(new THREE.HemisphereLight(0xe9eef1, 0x171b1e, 2.1));

        const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
        keyLight.position.set(-2.4, 3.3, 4);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x91a0a7, 2.4);
        rimLight.position.set(2.2, -1.5, -2.5);
        scene.add(rimLight);
        const accentLight = new THREE.PointLight(0xf97316, 0.8, 3.5);
        accentLight.position.set(0.8, 0.4, 2.2);
        scene.add(accentLight);

        const materials = {
          piston: new THREE.MeshStandardMaterial({ color: 0x8c969b, metalness: 0.88, roughness: 0.24 }),
          edge: new THREE.MeshStandardMaterial({ color: 0xc2c9cc, metalness: 0.93, roughness: 0.2 }),
          dark: new THREE.MeshStandardMaterial({ color: 0x343c40, metalness: 0.86, roughness: 0.32 }),
          groove: new THREE.MeshStandardMaterial({ color: 0x171c1f, metalness: 0.6, roughness: 0.46 }),
          rod: new THREE.MeshStandardMaterial({ color: 0x687278, metalness: 0.9, roughness: 0.26 }),
          orange: new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.72, roughness: 0.24 }),
        };

        const assembly = new THREE.Group();
        const tiltGroup = new THREE.Group();
        assembly.add(tiltGroup);
        scene.add(assembly);

        const piston = new THREE.Group();
        tiltGroup.add(piston);
        const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.33, 0.39, 32, 1), materials.piston);
        skirt.position.y = -0.12;
        piston.add(skirt);

        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.32, 0.09, 36, 1), materials.edge);
        crown.position.y = 0.105;
        piston.add(crown);
        const crownInset = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.3, 0.012, 32), materials.dark);
        crownInset.position.y = 0.156;
        piston.add(crownInset);

        [-0.005, -0.067, -0.128].forEach((y, index) => {
          const groove = new THREE.Mesh(new THREE.TorusGeometry(index === 0 ? 0.321 : 0.309, 0.018, 7, 36), materials.groove);
          groove.rotation.x = Math.PI / 2;
          groove.position.y = y;
          piston.add(groove);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(index === 0 ? 0.323 : 0.312, 0.009, 6, 36), index === 1 ? materials.orange : materials.edge);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = y + 0.019;
          piston.add(ring);
        });

        const pistonPin = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.62, 20), materials.dark);
        pistonPin.rotation.z = Math.PI / 2;
        pistonPin.position.set(0, -0.12, 0.01);
        piston.add(pistonPin);
        [-0.17, 0.17].forEach((x) => {
          const pinEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.012, 16), materials.edge);
          pinEnd.rotation.z = Math.PI / 2;
          pinEnd.position.set(x, -0.12, 0.01);
          piston.add(pinEnd);
        });

        const rodLength = 0.9;
        const crankRadius = 0.19;
        const crankCenterY = -0.55;
        const rod = new THREE.Group();
        tiltGroup.add(rod);

        const rodShape = new THREE.Shape();
        rodShape.moveTo(-0.08, -0.07);
        rodShape.lineTo(-0.12, -0.18);
        rodShape.lineTo(-0.052, -0.34);
        rodShape.lineTo(-0.058, -0.62);
        rodShape.lineTo(-0.13, -0.78);
        rodShape.lineTo(-0.125, -0.87);
        rodShape.lineTo(-0.075, -rodLength);
        rodShape.lineTo(0.075, -rodLength);
        rodShape.lineTo(0.125, -0.87);
        rodShape.lineTo(0.13, -0.78);
        rodShape.lineTo(0.058, -0.62);
        rodShape.lineTo(0.052, -0.34);
        rodShape.lineTo(0.12, -0.18);
        rodShape.lineTo(0.08, -0.07);
        rodShape.closePath();
        const rodGeometry = new THREE.ExtrudeGeometry(rodShape, {
          depth: 0.075,
          bevelEnabled: true,
          bevelSegments: 2,
          steps: 1,
          bevelSize: 0.012,
          bevelThickness: 0.012,
        });
        const rodBody = new THREE.Mesh(rodGeometry, materials.rod);
        rodBody.position.z = 0.035;
        rod.add(rodBody);

        const addRodEye = (y, radius, innerRadius) => {
          const eye = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 8, 28), materials.edge);
          eye.position.set(0, y, 0.08);
          rod.add(eye);
          const bearing = new THREE.Mesh(new THREE.CircleGeometry(innerRadius, 24), materials.groove);
          bearing.position.set(0, y, 0.076);
          rod.add(bearing);
          const insert = new THREE.Mesh(new THREE.TorusGeometry(innerRadius * 0.72, 0.012, 6, 20), materials.dark);
          insert.position.set(0, y, 0.09);
          rod.add(insert);
        };
        addRodEye(-0.01, 0.13, 0.078);
        addRodEye(-rodLength, 0.175, 0.112);

        const crank = new THREE.Group();
        crank.position.y = crankCenterY;
        tiltGroup.add(crank);
        const crankWebShape = new THREE.Shape();
        crankWebShape.moveTo(-0.12, -0.07);
        crankWebShape.lineTo(0.12, -0.07);
        crankWebShape.lineTo(0.13, crankRadius - 0.06);
        crankWebShape.lineTo(0.07, crankRadius + 0.06);
        crankWebShape.lineTo(-0.12, crankRadius + 0.045);
        crankWebShape.closePath();
        const crankWeb = new THREE.Mesh(new THREE.ExtrudeGeometry(crankWebShape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }), materials.dark);
        crankWeb.position.z = -0.09;
        crank.add(crankWeb);

        const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.42, 24), materials.edge);
        axle.rotation.z = Math.PI / 2;
        axle.position.z = -0.16;
        crank.add(axle);
        const crankPin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.34, 20), materials.piston);
        crankPin.rotation.z = Math.PI / 2;
        crankPin.position.set(0, crankRadius, -0.02);
        crank.add(crankPin);

        const blastGroup = new THREE.Group();
        blastGroup.visible = false;
        tiltGroup.add(blastGroup);
        const blastMaterial = new THREE.MeshBasicMaterial({ color: 0xffa13b, transparent: true, opacity: 0.9, depthWrite: false });
        const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.95, depthWrite: false });
        const blastFlash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), blastMaterial);
        blastGroup.add(blastFlash);
        const sparks = [];
        for (let index = 0; index < 6; index += 1) {
          const angle = (index / 6) * Math.PI * 2;
          const direction = new THREE.Vector3(Math.cos(angle) * 0.2, 0.09 + (index % 2) * 0.045, Math.sin(angle) * 0.045);
          const spark = new THREE.Mesh(new THREE.TetrahedronGeometry(0.037, 0), sparkMaterial);
          spark.userData.direction = direction;
          blastGroup.add(spark);
          sparks.push(spark);
        }

        const pointerTarget = new THREE.Vector2();
        let phase = 0;
        let lastBlastCycle = 0;
        let blastStartedAt = -Infinity;
        let speed = 2.4;
        let previousTime = performance.now();

        const resize = () => {
          const { width, height } = mount.getBoundingClientRect();
          if (!width || !height) return;
          const viewHeight = 2.2;
          const aspect = width / height;
          camera.top = viewHeight / 2;
          camera.bottom = -viewHeight / 2;
          camera.left = -(viewHeight * aspect) / 2;
          camera.right = (viewHeight * aspect) / 2;
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
          const targetSpeed = revvingNow ? 17 : pointer.hovering ? 5.2 : 2.4;
          const response = revvingNow ? 5.5 : 3.2;
          speed += (targetSpeed - speed) * (1 - Math.exp(-dt * response));
          phase += speed * dt;
          const blastCycle = Math.floor(phase / (Math.PI * 2));
          if (blastCycle > lastBlastCycle) {
            lastBlastCycle = blastCycle;
            blastStartedAt = now;
            blastGroup.visible = true;
          }

          const crankX = -crankRadius * Math.sin(phase);
          const crankY = crankCenterY + crankRadius * Math.cos(phase);
          const rodRise = Math.sqrt((rodLength * rodLength) - (crankX * crankX));
          const pistonPinY = crankY + rodRise;
          piston.position.set(0, pistonPinY + 0.12, 0);
          rod.position.set(0, pistonPinY, 0);
          rod.rotation.z = Math.atan2(crankX, rodRise);
          crank.rotation.z = phase;

          const blastProgress = (now - blastStartedAt) / 190;
          if (blastProgress >= 0 && blastProgress < 1) {
            const expansion = 1 - ((1 - blastProgress) ** 2);
            blastGroup.visible = true;
            blastGroup.position.set(0, piston.position.y + 0.2, 0.12);
            blastFlash.scale.setScalar(0.4 + expansion * 2.1);
            blastMaterial.opacity = (1 - blastProgress) * 0.8;
            sparkMaterial.opacity = (1 - blastProgress) * 0.95;
            sparks.forEach((spark) => spark.position.copy(spark.userData.direction).multiplyScalar(expansion));
          } else {
            blastGroup.visible = false;
          }

          pointerTarget.set(pointer.x * 0.075, pointer.y * 0.055);
          tiltGroup.rotation.y += (pointerTarget.x - tiltGroup.rotation.y) * (1 - Math.exp(-dt * 4.5));
          tiltGroup.rotation.x += (-pointerTarget.y - tiltGroup.rotation.x) * (1 - Math.exp(-dt * 4.5));
          renderer.render(scene, camera);
        };
        animationFrame = requestAnimationFrame(animate);
      } catch {
        setLightweight(true);
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
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach((material) => material.dispose());
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [lightweight]);

  function handlePointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    pointerRef.current.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
  }

  function handleRev() {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    pointerRef.current.hovering = false;
    setHovered(false);
    pointerRef.current.revUntil = performance.now() + 1000;
    setRevving(true);
    window.clearTimeout(revTimeoutRef.current);
    revTimeoutRef.current = window.setTimeout(() => setRevving(false), 1120);
  }

  return (
    <div
      className={`piston-assembly3d ${lightweight ? "is-lightweight" : ""} ${hovered ? "is-hovered" : ""} ${revving ? "is-revving" : ""}`}
      ref={mountRef}
      role="button"
      tabIndex={0}
      aria-label="Interactive piston and connecting rod. Hover to accelerate, click to rev the engine."
      aria-pressed={revving}
      title="Hover to accelerate · Click to rev"
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
      <span className="piston-fallback" aria-hidden="true">
        <span className="fallback-piston">
          <i className="fallback-crown" />
          <i className="fallback-skirt" />
          <i className="fallback-ring fallback-ring-one" />
          <i className="fallback-ring fallback-ring-two" />
          <i className="fallback-pin" />
        </span>
        <span className="fallback-blast" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        <span className="fallback-rod"><i /></span>
        <span className="fallback-crank"><i /></span>
      </span>
    </div>
  );
}