// three.js + cannon-es 游戏主逻辑：玩家车 + AI 车（避障/换道）+ 更复杂信号灯（绿黄红/行人提示）+ 路人（行人会在车灯红灯时过马路）
// 通过 ES module CDN 引入 three 和 cannon-es
import * as THREE from 'https://unpkg.com/three@0.153.0/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

const canvas = document.getElementById('threeCanvas');
const menu = document.getElementById('menu');
const startBtn = document.getElementById('startBtn');
const orientationOverlay = document.getElementById('orientationOverlay');
const portraitTip = document.getElementById('portraitTip');
const speedEl = document.getElementById('speed');

// 控件元素
const leftBtn = document.getElementById('leftBtn');
const rightBtn = document.getElementById('rightBtn');
const accelBtn = document.getElementById('accelBtn');
const brakeBtn = document.getElementById('brakeBtn');
const handbrakeBtn = document.getElementById('handbrakeBtn');

// audio toggle
const soundToggle = document.getElementById('soundToggle');
const AudioEnabled = () => soundToggle.checked;

// WebAudio（用于提示音与简易发动机合成）
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.7;
masterGain.connect(audioCtx.destination);

// simple tone
function playTone(freq=440, duration=0.12, volume=0.6) {
  if (!AudioEnabled()) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.frequency.value = freq;
  o.type = 'sine';
  g.gain.value = volume;
  o.connect(g); g.connect(masterGain);
  o.start();
  g.gain.setValueAtTime(volume, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  o.stop(audioCtx.currentTime + duration + 0.02);
}

// engine synth for player
const engineOsc = audioCtx.createOscillator();
const engineGain = audioCtx.createGain();
engineOsc.type = 'sawtooth';
engineOsc.frequency.value = 60;
engineGain.gain.value = 0.0;
engineOsc.connect(engineGain); engineGain.connect(masterGain);
engineOsc.start();

// horn
function playHorn() { playTone(220, 0.25, 0.9); }

// Three + Cannon setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 6, -12);
camera.lookAt(0, 0, 0);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(5, 10, -5);
scene.add(dirLight);
const hemi = new THREE.HemisphereLight(0xaaaaaa, 0x444444, 0.6);
scene.add(hemi);

const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.6;

// ground & road
const groundGeo = new THREE.PlaneGeometry(400, 400);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a });
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI/2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI/2,0,0);
world.addBody(groundBody);

const roadGeo = new THREE.PlaneGeometry(30, 400);
const roadMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
const roadMesh = new THREE.Mesh(roadGeo, roadMat);
roadMesh.rotation.x = -Math.PI/2;
roadMesh.position.y = 0.01;
scene.add(roadMesh);

// environment: lamps + buildings
function addStreetLamp(x,z) {
  const lampGroup = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,4), new THREE.MeshStandardMaterial({color:0x222222}));
  pole.position.y = 2; lampGroup.add(pole);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25,12,8), new THREE.MeshStandardMaterial({emissive:0xffffaa, emissiveIntensity:1, color:0x333333}));
  head.position.set(0,3.1,0); lampGroup.add(head);
  const light = new THREE.PointLight(0xfff0c0,1,12,2); light.position.set(0,3.1,0); lampGroup.add(light);
  lampGroup.position.set(x,0,z); scene.add(lampGroup);
}
function addBuilding(x,z,w=8,h=30,d=8) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshStandardMaterial({ color:0x77aaff, metalness:0.9, roughness:0.05, opacity:0.95, transparent:true }));
  mesh.position.set(x,h/2,z); scene.add(mesh);
}
for (let i=-8;i<=8;i++){
  addStreetLamp(-8, i*20);
  addStreetLamp(8, i*20);
  if (i%2===0) {
    addBuilding(-16, i*20+8, 10, 40 + (i%3)*8, 10);
    addBuilding(16, i*20-8, 10, 30 + (i%4)*6, 10);
  }
}

// ========== 玩家车辆（RaycastVehicle） ==========
const chassisShape = new CANNON.Box(new CANNON.Vec3(1.0, 0.5, 2.0));
const chassisBody = new CANNON.Body({ mass: 150 });
chassisBody.addShape(chassisShape);
chassisBody.position.set(0,2,0);
chassisBody.angularDamping = 0.5;
world.addBody(chassisBody);

const vehicle = new CANNON.RaycastVehicle({ chassisBody, indexRightAxis:0, indexUpAxis:1, indexForwardAxis:2 });
const axleWidth = 1.0;
const wheelFrontZ = 1.3, wheelBackZ = -1.3;
const wheelOptions = {
  radius: 0.4,
  directionLocal: new CANNON.Vec3(0,-1,0),
  suspensionStiffness: 30,
  suspensionRestLength: 0.3,
  frictionSlip: 5,
  dampingRelaxation: 2.3,
  dampingCompression: 4.4,
  maxSuspensionForce: 100000,
  rollInfluence: 0.01,
  maxSuspensionTravel: 0.3,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true
};
vehicle.addWheel({...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-axleWidth,0,wheelFrontZ)});
vehicle.addWheel({...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(axleWidth,0,wheelFrontZ)});
vehicle.addWheel({...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-axleWidth,0,wheelBackZ)});
vehicle.addWheel({...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(axleWidth,0,wheelBackZ)});
vehicle.addToWorld(world);

const wheelMeshes = [];
for (let i=0;i<vehicle.wheelInfos.length;i++){
  const wgeo = new THREE.CylinderGeometry(vehicle.wheelInfos[i].radius, vehicle.wheelInfos[i].radius, 0.4, 16);
  const wmat = new THREE.MeshStandardMaterial({ color:0x111111, metalness:0.2, roughness:0.6 });
  const wheel = new THREE.Mesh(wgeo, wmat); wheel.rotation.z = Math.PI/2; scene.add(wheel); wheelMeshes.push(wheel);
}
const chassisMesh = new THREE.Mesh(new THREE.BoxGeometry(2,1,4), new THREE.MeshStandardMaterial({ color:0xcc0000, metalness:0.2, roughness:0.4 }));
scene.add(chassisMesh);
function setHandbrake(enabled) {
  for (let i=0;i<vehicle.wheelInfos.length;i++){
    if (i>=2) vehicle.wheelInfos[i].frictionSlip = enabled ? 0.8 : 5;
    else vehicle.wheelInfos[i].frictionSlip = enabled ? 3 : 5;
  }
}

// player engine sound control
function updateEngineSound(speedMps) {
  if (!AudioEnabled()) { engineGain.gain.value = 0; return; }
  const freq = 60 + Math.min(1, speedMps/30) * 540;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  const amp = 0.04 + Math.min(1, speedMps/30) * 0.18;
  engineGain.gain.linearRampToValueAtTime(amp, audioCtx.currentTime + 0.05);
}

// camera follow
function updateCamera() {
  const p = chassisBody.position;
  const q = chassisBody.quaternion;
  const forward = new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w));
  const camPos = new THREE.Vector3(p.x, p.y + 4, p.z).add(forward.multiplyScalar(-8));
  camera.position.lerp(camPos, 0.12);
  const lookAt = new THREE.Vector3(p.x, p.y + 1.5, p.z);
  camera.lookAt(lookAt);
}

// controls
const keyState = {};
window.addEventListener('keydown', (e)=>{ keyState[e.code]=true; if (e.code==='KeyH') playHorn(); });
window.addEventListener('keyup', (e)=>{ keyState[e.code]=false; });

function bindButton(btn) {
  btn.pressed = false;
  btn.addEventListener('touchstart', (e)=>{ e.preventDefault(); btn.pressed = true; }, {passive:false});
  btn.addEventListener('touchend', (e)=>{ e.preventDefault(); btn.pressed = false; }, {passive:false});
  btn.addEventListener('mousedown', ()=>{ btn.pressed = true; });
  window.addEventListener('mouseup', ()=>{ btn.pressed = false; });
}
[ leftBtn, rightBtn, accelBtn, brakeBtn, handbrakeBtn ].forEach(bindButton);

function applyInputs() {
  let accel = 0, steer = 0, brake = 0, hand = false;
  if (keyState['KeyW'] || keyState['ArrowUp'] || accelBtn.pressed) accel = 1;
  if (keyState['KeyS'] || keyState['ArrowDown'] || brakeBtn.pressed) brake = 1;
  if (keyState['KeyA'] || keyState['ArrowLeft'] || leftBtn.pressed) steer = 1;
  if (keyState['KeyD'] || keyState['ArrowRight'] || rightBtn.pressed) steer = -1;
  if (keyState['Space'] || handbrakeBtn.pressed) hand = true;
  const steering = steer * 0.5;
  const force = accel * 3000;
  vehicle.applyEngineForce(-force, 2); vehicle.applyEngineForce(-force, 3);
  const brakeForce = brake * 50;
  for (let i=0;i<4;i++) vehicle.setBrake(brakeForce, i);
  vehicle.setSteeringValue(steering, 0); vehicle.setSteeringValue(steering, 1);
  setHandbrake(hand);
}

// ========== Traffic light (绿-黄-红 + 行人提示音) ==========
class TrafficLight {
  constructor(x,z, green=6, yellow=2, red=6, offset=0) {
    this.x = x; this.z = z;
    this.greenDuration = green; this.yellowDuration = yellow; this.redDuration = red;
    this.timer = offset;
    this.state = 'green'; // green, yellow, red
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,2.5), new THREE.MeshStandardMaterial({color:0x222222}));
    pole.position.y = 1.25; g.add(pole);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.9,0.25), new THREE.MeshStandardMaterial({color:0x111111}));
    box.position.y = 1.95; g.add(box);
    this.redLight = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6), new THREE.MeshStandardMaterial({emissive:0x550000, color:0x220000, emissiveIntensity:0}));
    this.yellowLight = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6), new THREE.MeshStandardMaterial({emissive:0x554400, color:0x221100, emissiveIntensity:0}));
    this.greenLight = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6), new THREE.MeshStandardMaterial({emissive:0x005500, color:0x001a00, emissiveIntensity:0}));
    this.redLight.position.set(0,2.25,0.15); this.yellowLight.position.set(0,2.0,0.15); this.greenLight.position.set(0,1.75,0.15);
    g.add(this.redLight); g.add(this.yellowLight); g.add(this.greenLight);
    g.position.set(x,0,z);
    scene.add(g);
    this.mesh = g;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    // play sound on change; when vehicles red -> pedestrians can walk -> give beep
    if (AudioEnabled()) {
      if (s==='green') playTone(880, 0.08, 0.4);
      else if (s==='yellow') playTone(660, 0.08, 0.35);
      else if (s==='red') { playTone(440, 0.08, 0.4); /* pedestrian beep for walk */ setTimeout(()=>playTone(1200, 0.12, 0.25), 60); }
    }
  }

  update(dt) {
    this.timer += dt;
    if (this.state === 'green') {
      if (this.timer >= this.greenDuration) { this.timer = 0; this.setState('yellow'); }
    } else if (this.state === 'yellow') {
      if (this.timer >= this.yellowDuration) { this.timer = 0; this.setState('red'); }
    } else if (this.state === 'red') {
      if (this.timer >= this.redDuration) { this.timer = 0; this.setState('green'); }
    }
    this.redLight.material.emissiveIntensity = (this.state==='red') ? 1.2 : 0;
    this.yellowLight.material.emissiveIntensity = (this.state==='yellow') ? 1.2 : 0;
    this.greenLight.material.emissiveIntensity = (this.state==='green') ? 1.2 : 0;
  }

  isRed() { return this.state==='red'; }
  isYellow() { return this.state==='yellow'; }
}

// ========== Pedestrian (路人) ==========
class Pedestrian {
  constructor(startX, targetX, z, speed = 1.2, linkedLight = null) {
    this.x = startX; this.targetX = targetX; this.z = z;
    this.speed = speed;
    this.linkedLight = linkedLight; // traffic light to observe
    this.crossing = false; // currently in the road crossing
    this.done = false;

    // visual: simple capsule-like (cylinder + sphere)
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.5,8), new THREE.MeshStandardMaterial({color:0xffcc66}));
    body.position.y = 0.25;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16,8,8), new THREE.MeshStandardMaterial({color:0xffe0c0}));
    head.position.y = 0.6;
    g.add(body); g.add(head);
    g.position.set(this.x, 0, this.z);
    scene.add(g);
    this.mesh = g;
    // small random delay before starting to cross even when allowed
    this.startDelay = Math.random() * 1.2;
    this._delayTimer = 0;
  }

  update(dt, vehiclesNearby) {
    if (this.done) return;
    // Determine if allowed to cross: we consider pedestrian allowed when linked light is red (vehicles stopped)
    let allowed = true;
    if (this.linkedLight) {
      allowed = this.linkedLight.isRed();
    }
    // also ensure no approaching vehicle too close (vehiclesNearby array gives closeness)
    let vehicleTooClose = false;
    for (const v of vehiclesNearby) {
      const dz = v.z - this.z; // positive if vehicle ahead in +z
      const dx = Math.abs(v.x - this.x);
      if (Math.abs(dz) < 8 && dx < 3) { vehicleTooClose = true; break; }
    }

    if (!this.crossing) {
      if (allowed && !vehicleTooClose) {
        this._delayTimer += dt;
        if (this._delayTimer >= this.startDelay) {
          this.crossing = true;
        }
      } else {
        this._delayTimer = 0;
      }
    }

    if (this.crossing) {
      // move toward targetX
      const dir = Math.sign(this.targetX - this.x);
      const move = dir * this.speed * dt;
      this.x += move;
      // update mesh
      this.mesh.position.x = this.x;
      // if reached target
      if ((dir > 0 && this.x >= this.targetX) || (dir < 0 && this.x <= this.targetX)) {
        this.done = true;
        scene.remove(this.mesh);
      }
    }
  }
}

// ========== AI 车辆（带避障/换道/避让行人） ==========
class AICar {
  constructor(laneX, startZ, speed = 8) {
    this.laneX = laneX; this.targetLaneX = laneX;
    this.speed = speed;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8,0.8,3.2), new THREE.MeshStandardMaterial({ color: 0x0066cc }));
    this.mesh.position.set(laneX, 0.5, startZ); scene.add(this.mesh);
    const shape = new CANNON.Box(new CANNON.Vec3(0.9,0.4,1.6));
    this.body = new CANNON.Body({ mass: 120 });
    this.body.addShape(shape);
    this.body.position.set(laneX, 0.5, startZ);
    this.body.linearDamping = 0.2;
    world.addBody(this.body);
    this.state = 'cruise';
  }

  isLaneFree(checkLaneX, aiCars, lookZ) {
    for (const other of aiCars) {
      if (other === this) continue;
      if (Math.abs(other.body.position.x - checkLaneX) < 1.2) {
        const dz = other.body.position.z - this.body.position.z;
        if (Math.abs(dz) < lookZ) return false;
      }
    }
    const playerDz = chassisBody.position.z - this.body.position.z;
    if (Math.abs(chassisBody.position.x - checkLaneX) < 1.2 && Math.abs(playerDz) < lookZ) return false;
    return true;
  }

  update(dt, trafficLights, aiCars, pedestrians) {
    let shouldStop = false;
    let shouldCautious = false;
    const stoppingDist = 8 + Math.abs(this.body.velocity.z) * 0.4;
    for (const t of trafficLights) {
      if (Math.abs(t.x - this.body.position.x) < 5) {
        const dist = t.z - this.body.position.z;
        if (dist > 0 && dist < 30) {
          if (t.isRed() && dist < stoppingDist) shouldStop = true;
          if (t.isYellow() && dist < stoppingDist * 0.8) shouldCautious = true;
        }
      }
    }

    // check vehicle ahead
    let carAhead = null; let distAhead = 999;
    for (const other of aiCars) {
      if (other === this) continue;
      if (Math.abs(other.body.position.x - this.body.position.x) < 1.2) {
        const dz = other.body.position.z - this.body.position.z;
        if (dz > 0 && dz < distAhead) { distAhead = dz; carAhead = other; }
      }
    }

    // check pedestrians ahead in crossing
    for (const p of pedestrians) {
      if (p.done) continue;
      // if pedestrian is crossing and roughly in our lane path (z close and x between sidewalks)
      if (p.crossing && Math.abs(p.z - this.body.position.z) < 8) {
        const dx = Math.abs(p.x - this.body.position.x);
        if (dx < 2.5) {
          shouldStop = true;
        }
      }
    }

    // lane change logic
    const safeDist = 6 + Math.abs(this.body.velocity.z) * 0.5;
    if (carAhead && distAhead < safeDist) {
      const otherLaneX = (this.body.position.x < 0) ? 1.5 : -1.5;
      if (this.isLaneFree(otherLaneX, aiCars, 8)) {
        this.targetLaneX = otherLaneX;
        this.state = 'laneChange';
      } else {
        this.state = 'slow';
      }
    } else if (shouldStop) {
      this.state = 'slow';
    } else if (shouldCautious) {
      this.state = 'slow';
    } else {
      if (this.state !== 'laneChange') { this.state = 'cruise'; this.targetLaneX = this.laneX; }
    }

    let targetSpeed = this.speed;
    if (this.state === 'slow') targetSpeed = Math.max(0, this.speed * 0.35);
    if (this.state === 'laneChange') targetSpeed = Math.max(0.6*this.speed, this.speed*0.8);

    const currentVz = this.body.velocity.z;
    const newVz = THREE.MathUtils.damp(currentVz, targetSpeed, 3, dt);
    this.body.velocity.set(0, this.body.velocity.y, newVz);

    const curX = this.body.position.x;
    const targX = this.targetLaneX;
    const newX = THREE.MathUtils.damp(curX, targX, 6, dt);
    this.body.position.x = newX;

    const forwardQuat = new CANNON.Quaternion(); forwardQuat.setFromEuler(0,0,0,'XYZ');
    this.body.quaternion.slerp(forwardQuat, 0.1);

    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }
}

// create traffic lights
const trafficLights = [];
const lightPositions = [-120, -40, 40, 120, 200];
for (let i=0;i<lightPositions.length;i++){
  const z = lightPositions[i];
  const offset = (i%2===0)?0:1.5;
  trafficLights.push(new TrafficLight(-3.6,z,6,2,6,offset));
  trafficLights.push(new TrafficLight(3.6,z,6,2,6,offset));
}

// pedestrians management
const pedestrians = [];
let pedSpawnTimer = 0;
function spawnPedestrianAt(light) {
  // spawn on either left (-side) crossing to right, or vice versa
  const side = Math.random() < 0.5 ? 'left' : 'right';
  const startX = side === 'left' ? -6 : 6;
  const targetX = side === 'left' ? 6 : -6;
  const z = light.z + (Math.random() * 4 - 2); // small z jitter
  const ped = new Pedestrian(startX, targetX, z, 1.0 + Math.random()*0.6, light);
  pedestrians.push(ped);
}

// AI spawn & management
const aiCars = [];
let aiSpawnTimer = 0;
function spawnAICar() {
  const laneX = Math.random() < 0.5 ? -1.5 : 1.5;
  const startZ = -220 + Math.random()*80;
  const speed = 6 + Math.random()*6;
  const car = new AICar(laneX, startZ, speed);
  aiCars.push(car);
}

// animation / physics loop
let lastTime;
function animate(time) {
  requestAnimationFrame(animate);
  if (!lastTime) lastTime = time;
  const dt = (time - lastTime)/1000;
  lastTime = time;

  if (window.innerHeight > window.innerWidth) { portraitTip.classList.remove('hidden'); return; }
  else portraitTip.classList.add('hidden');

  // update lights
  for (const t of trafficLights) t.update(dt);

  // spawn AI
  aiSpawnTimer += dt;
  if (aiSpawnTimer > 1.5) { aiSpawnTimer = 0; if (aiCars.length < 14) spawnAICar(); }

  // spawn pedestrians occasionally near random lights (but not too many)
  pedSpawnTimer += dt;
  if (pedSpawnTimer > 2.5) { pedSpawnTimer = 0;
    if (pedestrians.length < 18) {
      const idx = Math.floor(Math.random() * trafficLights.length);
      spawnPedestrianAt(trafficLights[idx]);
    }
  }

  // update AI
  for (const ai of aiCars) ai.update(dt, trafficLights, aiCars, pedestrians);

  // update pedestrians: compile nearby vehicles positions for each
  const vehiclesNearbyInfo = aiCars.concat([{ x: chassisBody.position.x, z: chassisBody.position.z }]).map(v => ({ x: v.body ? v.body.position.x : v.x, z: v.body ? v.body.position.z : v.z }));
  for (let i = pedestrians.length - 1; i >= 0; i--) {
    const p = pedestrians[i];
    p.update(dt, vehiclesNearbyInfo);
    if (p.done) pedestrians.splice(i, 1);
  }

  // apply player inputs & step physics
  applyInputs();
  world.fixedStep = 1/60;
  world.step(1/60, dt, 3);

  // update player visuals
  chassisMesh.position.copy(chassisBody.position);
  chassisMesh.quaternion.copy(chassisBody.quaternion);
  for (let i=0;i<vehicle.wheelInfos.length;i++){
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    wheelMeshes[i].position.copy(t.position); wheelMeshes[i].quaternion.copy(t.quaternion);
  }

  // sync AI visuals & cleanup
  for (let i=aiCars.length-1;i>=0;i--) {
    const ai = aiCars[i];
    ai.mesh.position.copy(ai.body.position); ai.mesh.quaternion.copy(ai.body.quaternion);
    if (ai.body.position.z > 320) { world.removeBody(ai.body); scene.remove(ai.mesh); aiCars.splice(i,1); }
  }

  // update camera & speed & engine sound
  updateCamera();
  const vel = chassisBody.velocity;
  const speedKmh = (Math.sqrt(vel.x*vel.x + vel.z*vel.z) * 3.6);
  speedEl.textContent = `速度: ${Math.round(speedKmh)} km/h`;
  updateEngineSound(Math.sqrt(vel.x*vel.x + vel.z*vel.z));

  renderer.render(scene, camera);
}

// startGame
function startGame() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  menu.classList.add('hidden');
  chassisBody.position.set(0,2,0);
  chassisBody.velocity.set(0,0,0);
  chassisBody.angularVelocity.set(0,0,0);
  chassisBody.quaternion.set(0,0,0,1);
  for (let i=0;i<4;i++) spawnAICar();
  requestAnimationFrame(animate);
}

// orientation resize handlers
function checkOrientation() {
  if (window.innerHeight > window.innerWidth) { orientationOverlay.classList.remove('hidden'); portraitTip.classList.remove('hidden'); }
  else { orientationOverlay.classList.add('hidden'); portraitTip.classList.add('hidden'); }
}
window.addEventListener('resize', ()=>{ renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); checkOrientation(); });
startBtn.addEventListener('click', ()=>{ if (window.innerHeight > window.innerWidth) { orientationOverlay.classList.remove('hidden'); return; } startGame(); });
canvas.addEventListener('dblclick', ()=>{ if (!menu.classList.contains('hidden')) startBtn.click(); });

// touch steer
let touchStartX = null;
window.addEventListener('touchstart', (e)=>{ if (e.touches && e.touches.length===1) touchStartX = e.touches[0].clientX; });
window.addEventListener('touchmove', (e)=>{ if (touchStartX!=null && e.touches && e.touches.length===1) {
  const dx = e.touches[0].clientX - touchStartX; const percent = Math.max(-1,Math.min(1,dx / (window.innerWidth*0.5)));
  leftBtn.pressed = percent < -0.2; rightBtn.pressed = percent > 0.2;
}});
window.addEventListener('touchend', ()=>{ touchStartX = null; leftBtn.pressed = false; rightBtn.pressed = false; });

// button mouse states
leftBtn.addEventListener('mousedown', ()=> leftBtn.pressed = true); leftBtn.addEventListener('mouseup', ()=> leftBtn.pressed = false);
rightBtn.addEventListener('mousedown', ()=> rightBtn.pressed = true); rightBtn.addEventListener('mouseup', ()=> rightBtn.pressed = false);
accelBtn.addEventListener('mousedown', ()=> accelBtn.pressed = true); accelBtn.addEventListener('mouseup', ()=> accelBtn.pressed = false);
brakeBtn.addEventListener('mousedown', ()=> brakeBtn.pressed = true); brakeBtn.addEventListener('mouseup', ()=> brakeBtn.pressed = false);
handbrakeBtn.addEventListener('mousedown', ()=> handbrakeBtn.pressed = true); handbrakeBtn.addEventListener('mouseup', ()=> handbrakeBtn.pressed = false);
window.addEventListener('blur', ()=> { [leftBtn,rightBtn,accelBtn,brakeBtn,handbrakeBtn].forEach(b=>b.pressed=false); });

// initial renderer resize
renderer.setSize(window.innerWidth, window.innerHeight);
camera.updateProjectionMatrix();
checkOrientation();