import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export default function ProductInspection3D({ imageUrl, name, icon = "⚙" }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [exploded, setExploded] = useState(false);
  const autoRotateRef = useRef(autoRotate);
  const explodedRef = useRef(exploded);
  const zoomRef = useRef(4.2);
  autoRotateRef.current = autoRotate;
  explodedRef.current = exploded;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111a1d");
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, zoomRef.current);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor("#111a1d", 1);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe8f1eb, 0x243035, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffb477, 3.3);
    keyLight.position.set(-3, 4, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x83cbc2, 2.4);
    rimLight.position.set(4, -2, -3);
    scene.add(rimLight);

    const productGroup = new THREE.Group();
    scene.add(productGroup);
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 2.1, 0.13),
      new THREE.MeshStandardMaterial({ color: "#354247", metalness: 0.74, roughness: 0.31 }),
    );
    backing.position.z = -0.08;
    productGroup.add(backing);

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.98, 1.98),
      new THREE.MeshStandardMaterial({ color: "#d8dedb", roughness: 0.82, metalness: 0.04 }),
    );
    face.position.z = 0.01;
    productGroup.add(face);

    const accentGeometry = new THREE.TorusGeometry(0.88, 0.012, 8, 72);
    const accent = new THREE.Mesh(accentGeometry, new THREE.MeshStandardMaterial({ color: "#ed8e4c", metalness: 0.45, roughness: 0.4 }));
    accent.position.z = 0.035;
    productGroup.add(accent);

    const fallbackCanvas = document.createElement("canvas");
    fallbackCanvas.width = 512;
    fallbackCanvas.height = 512;
    const context = fallbackCanvas.getContext("2d");
    context.fillStyle = "#d8dedb";
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = "#59676a";
    context.font = "180px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(icon || "⚙", 256, 250);
    const fallbackTexture = new THREE.CanvasTexture(fallbackCanvas);
    fallbackTexture.colorSpace = THREE.SRGBColorSpace;
    face.material.map = fallbackTexture;
    face.material.needsUpdate = true;

    let disposed = false;
    if (imageUrl) {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(imageUrl, (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        face.material.map = texture;
        face.material.color.set("#ffffff");
        face.material.needsUpdate = true;
      });
    }

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 64),
      new THREE.MeshBasicMaterial({ color: "#1d292a", transparent: true, opacity: 0.72 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.55;
    floor.position.z = -0.4;
    scene.add(floor);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let dragging = false;
    let previousX = 0;
    let previousY = 0;
    let pointerMoved = false;
    const onPointerDown = (event) => {
      dragging = true;
      pointerMoved = false;
      previousX = event.clientX;
      previousY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      const deltaX = event.clientX - previousX;
      const deltaY = event.clientY - previousY;
      pointerMoved ||= Math.abs(deltaX) + Math.abs(deltaY) > 1;
      productGroup.rotation.y += deltaX * 0.009;
      productGroup.rotation.x = THREE.MathUtils.clamp(productGroup.rotation.x + deltaY * 0.009, -0.7, 0.7);
      previousX = event.clientX;
      previousY = event.clientY;
    };
    const onPointerUp = () => { dragging = false; };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", (event) => {
      event.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.003, 2.8, 6.4);
    }, { passive: false });

    let animationFrame;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      if (autoRotateRef.current && !dragging) productGroup.rotation.y += 0.003;
      const separation = explodedRef.current ? 0.48 : 0;
      face.position.z = THREE.MathUtils.damp(face.position.z, 0.01 + separation, 5, 1 / 60);
      accent.position.z = THREE.MathUtils.damp(accent.position.z, 0.035 + separation, 5, 1 / 60);
      backing.position.z = THREE.MathUtils.damp(backing.position.z, -0.08 - separation * 0.65, 5, 1 / 60);
      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = { camera, productGroup, renderer, pointerMoved: () => pointerMoved };
    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            material.map?.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [imageUrl, icon]);

  function changeZoom(amount) {
    zoomRef.current = THREE.MathUtils.clamp(zoomRef.current + amount, 2.8, 6.4);
    if (sceneRef.current) {
      sceneRef.current.camera.position.z = zoomRef.current;
    }
  }

  function resetView() {
    zoomRef.current = 4.2;
    if (sceneRef.current) {
      sceneRef.current.camera.position.z = 4.2;
      sceneRef.current.productGroup.rotation.set(0, 0, 0);
    }
  }

  return (
    <section className="inspection-panel" aria-label={`${name} 3D product inspection`}>
      <div className="inspection-heading">
        <div><span className="inspection-kicker">PARTS LAB / 01</span><h2>Inspect the part</h2></div>
        <span className="inspection-live"><i /> LIVE VIEW</span>
      </div>
      <div className="inspection-stage" ref={mountRef} aria-label="Drag to rotate. Use the mouse wheel to zoom." role="img" />
      <div className="inspection-controls">
        <div className="inspection-control-group">
          <button type="button" onClick={() => setAutoRotate((value) => !value)} aria-pressed={autoRotate} title={autoRotate ? "Pause rotation" : "Resume rotation"}>
            <span>{autoRotate ? "Ⅱ" : "▶"}</span>{autoRotate ? "Pause" : "Rotate"}
          </button>
          <button type="button" onClick={() => setExploded((value) => !value)} aria-pressed={exploded} title="Separate the image plate from the metal backing">
            <span>⇧</span>{exploded ? "Reassemble" : "Explode view"}
          </button>
        </div>
        <div className="inspection-control-group inspection-zoom-controls">
          <button type="button" onClick={() => changeZoom(-0.45)} aria-label="Zoom out">−</button>
          <span>ZOOM</span>
          <button type="button" onClick={() => changeZoom(0.45)} aria-label="Zoom in">+</button>
          <button type="button" onClick={resetView} aria-label="Reset camera view" title="Reset view">↺</button>
        </div>
      </div>
      <p className="inspection-note">Image-based preview · Drag to orbit · Scroll to zoom</p>
    </section>
  );
}