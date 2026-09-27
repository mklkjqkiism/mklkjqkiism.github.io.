// main.js - 简易 3D 开车小游戏（three.js）
// 控制: W/↑ 前进, S/↓ 刹车/倒车, A/← 左转, D/→ 右转, 空格 手刹, R 重置

(() => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // 天空蓝

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 6, -12);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  hemi.position.set(0, 200, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(-10, 20, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024,1024);
  scene.add(dir);

  // ground
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // simple track: ring of walls
  const walls = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const wallH = 1.0;
  const wallThickness = 1.0;
  const radius = 30;
  const segments = 48;
  for (let i=0;i<segments;i++){
    const angle = (i/segments) * Math.PI*2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const box = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallH, 2.5), wallMat);
    box.position.set(x, wallH/2, z);
    box.lookAt(0, wallH/2, 0);
    box.receiveShadow = true;
    box.castShadow = true;
    walls.add(box);
  }
  scene.add(walls);

  // some obstacles inside the track
  const obstacles = new THREE.Group();
  const obsMat = new THREE.MeshStandardMaterial({ color: 0xb22222 });
  for (let i=0;i<6;i++){
    const b = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 3), obsMat);
    const a = (i/6) * Math.PI * 2;
    const r = 12 + (i%2)*4;
    b.position.set(Math.cos(a)*r, 0.75, Math.sin(a)*r);
    b.castShadow = true;
    obstacles.add(b);
  }
  scene.add(obstacles);

  // car (group)
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x156289 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 4), bodyMat);
  body.position.y = 0.7;
  body.castShadow = true;
  car.add(body);

  // windshield
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 1.0), new THREE.MeshStandardMaterial({ color: 0x77c3ff, transparent:true, opacity:0.6 }));
  glass.position.set(0, 1.0, -0.2);
  car.add(glass);

  // wheels (simple cylinders)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.5, 12);
  function makeWheel(x,z){
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI/2;
    w.position.set(x, 0.35, z);
    w.castShadow = true;
    return w;
  }
  const w1 = makeWheel(-0.95, 1.4);
  const w2 = makeWheel(0.95, 1.4);
  const w3 = makeWheel(-0.95, -1.4);
  const w4 = makeWheel(0.95, -1.4);
  car.add(w1, w2, w3, w4);

  car.position.set(0, 0, 0);
  scene.add(car);

  // helpers
  const grid = new THREE.GridHelper(200, 40, 0x444444, 0x444444);
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);

  // input
  const keys = { forward:false, back:false, left:false, right:false, handbrake:false };
  window.addEventListener('keydown', (e)=>{
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.forward = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.back = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
    if (e.code === 'Space') keys.handbrake = true;
    if (e.code === 'KeyR') resetCar();
  });
  window.addEventListener('keyup', (e)=>{
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.forward = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.back = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
    if (e.code === 'Space') keys.handbrake = false;
  });

  // car physics (very simple)
  let velocity = 0; // scalar speed forward (local z negative direction)
  let steering = 0; // -1..1
  const maxSpeed = 35; // units/sec
  const accel = 30; // units/sec^2
  const brakeForce = 50;
  const drag = 8; // natural drag
  const steerSpeedAtZero = 1.4; // radians/sec at low speed
  const maxSteerAngle = 0.04; // radians per frame-ish (we scale by speed)
  const clock = new THREE.Clock();

  // UI
  const speedEl = document.getElementById('speed');

  function resetCar(){
    car.position.set(0, 0, 0);
    car.rotation.set(0, 0, 0);
    velocity = 0;
  }

  // simple AABB collision check with walls and obstacles
  function checkCollisions(nextPos){
    const margin = 0.9;
    // walls group boxes are oriented toward center - but they approximate a circular wall already placed.
    // We'll detect leaving the inner radius or exceeding outer radius as collision.
    const dist = Math.sqrt(nextPos.x*nextPos.x + nextPos.z*nextPos.z);
    const innerLimit = 0; // center allowed
    const outerLimit = radius - 1.5;
    if (dist > outerLimit) return true;

    // obstacle boxes
    for (const c of obstacles.children){
      const dx = Math.abs(nextPos.x - c.position.x);
      const dz = Math.abs(nextPos.z - c.position.z);
      if (dx < 2.0 && dz < 2.0) return true;
    }
    return false;
  }

  // camera follow
  const camOffset = new THREE.Vector3(0, 5, -10);
  const camTarget = new THREE.Vector3(0, 1.5, 0);

  function animate(){
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());

    // control acceleration/brake
    if (keys.forward){
      velocity += accel * dt;
    } else if (keys.back){
      velocity -= accel * dt;
    } else {
      // natural slowdown
      if (!keys.handbrake) {
        if (velocity > 0) velocity -= drag * dt;
        if (velocity < 0) velocity += drag * dt;
      }
    }

    // handbrake => strong drag
    if (keys.handbrake){
      if (velocity > 0) velocity -= brakeForce * dt;
      if (velocity < 0) velocity += brakeForce * dt;
    }

    // clamp speed
    velocity = Math.max(Math.min(velocity, maxSpeed), -12);

    // steering scaled by speed (more responsive when moving)
    let steerInput = 0;
    if (keys.left) steerInput -= 1;
    if (keys.right) steerInput += 1;
    const steerEffect = Math.max(0.2, Math.abs(velocity) / maxSpeed);
    const turn = steerInput * maxSteerAngle * steerEffect * (velocity !== 0 ? Math.sign(velocity) : 1) * (60 * dt);
    car.rotation.y += turn;

    // compute forward movement in world coordinates
    const forward = new THREE.Vector3(0,0,-1);
    forward.applyEuler(car.rotation);
    const nextPos = car.position.clone().addScaledVector(forward, velocity * dt);

    // collision handling: if collides, reduce speed and don't move through
    if (checkCollisions(nextPos)){
      // simple collision response: stop and slightly bounce back
      velocity *= -0.2;
    } else {
      car.position.copy(nextPos);
    }

    // rotate wheels roughly by speed
    const wheelSpin = velocity * dt * 3;
    w1.rotation.x += wheelSpin; w2.rotation.x += wheelSpin; w3.rotation.x += wheelSpin; w4.rotation.x += wheelSpin;

    // update camera smoothly
    const desiredCamPos = car.position.clone().add(camOffset.clone().applyEuler(car.rotation));
    camera.position.lerp(desiredCamPos, 1 - Math.pow(0.001, dt));
    const desiredLook = car.position.clone().add(camTarget.clone().applyEuler(car.rotation));
    camera.position.y = Math.max(camera.position.y, 1.0);
    camera.lookAt(desiredLook);

    // update UI
    speedEl.textContent = `速度: ${Math.abs(velocity).toFixed(2)}`;

    renderer.render(scene, camera);
  }

  // handle resize
  window.addEventListener('resize', ()=>{
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // start
  resetCar();
  animate();

})();