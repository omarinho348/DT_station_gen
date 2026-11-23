// Liquid supply unit: vertical stainless tank on legs (dished head, manway, vent, level sight glass,
// outlet cone, name plate, ultrasonic level transmitter) with a centrifugal transfer pump on a skid
// beside it, the suction line with its ball valve, and the discharge stub with valve and pressure
// gauge. Port of the reference station-1 OilTank.js (createOilTank, createTransferPump), the supply
// piping of OilFillingStation.js and the tank level transmitter of OilSensors.js.
// Origin: tank axis on the floor; the pump stands `pumpOffset` towards +X. The pipe on to the
// consumer starts at the `discharge` anchor (top of the discharge stub).
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, cylinderBetween, roundedBox, pipeRun, flange } from '../../core/primitives.js';
import { canvasTexture } from '../../core/textures.js';

const DOME = 0.24; // dished head height / radius
const PUMP = { suction: [-0.12, 0.24, 0], discharge: [0, 0.41, 0] }; // pump-local points (reference)
const STUB_TOP = 1.5; // discharge stub (valve at 0.95 m, gauge at 1.45 m as the reference riser)

function plateTexture({ tag, contents }) {
  return canvasTexture(512, 256, (ctx, width, height) => {
    ctx.fillStyle = '#f3f4f2';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e0a521';
    ctx.fillRect(0, 0, width, 46);
    ctx.fillStyle = '#1b1f22';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillText('LIQUID SUPPLY', width / 2, 34);
    ctx.font = 'bold 70px Arial, sans-serif';
    ctx.fillText(tag, width / 2, 135);
    ctx.font = '32px Arial, sans-serif';
    ctx.fillText(contents, width / 2, 200);
  }, { fallback: [243, 244, 242, 255] });
}

defineComponent({
  type: 'supplyTank',
  category: 'machine',
  summary: 'Liquid supply tank on legs with level sight glass and transmitter, transfer pump on a skid, suction and discharge valves.',
  params: z.object({
    radius: z.number().min(0.25).max(0.8).default(0.45).describe('Tank shell radius (m)'),
    height: z.number().min(0.6).max(2.2).default(1.3).describe('Shell height (m)'),
    legHeight: z.number().min(0.35).max(0.9).default(0.55).describe('Shell bottom above the floor (m)'),
    pumpOffset: z.number().min(0.7).max(2.5).default(0.975).describe('Pump volute centre from the tank axis, towards +X (m)'),
    tag: z.string().max(10).default('T-101').describe('Tank tag on the name plate'),
    contents: z.string().max(24).default('SAE 15W-40 · 800 L').describe('Contents line on the name plate'),
  }).refine((p) => p.pumpOffset >= p.radius + 0.25, { message: 'pumpOffset must leave room between tank and pump (radius + 0.25 m)', path: ['pumpOffset'] }),
  footprint: (p) => {
    const shellTop = p.legHeight + p.height;
    return {
      x: [-(p.radius + 0.015), p.pumpOffset + 0.53], // stiffening rings; pump skid
      z: [-(p.radius + 0.015), p.radius + 0.075],
      height: Math.max(shellTop + 0.36, 1.6), // vent cap, or the pressure gauge on the discharge stub
    };
  },
  mount: 'floor',
  motions: { level: { range: [0, 1], default: 0.85 } }, // liquid level as a share of the sight glass
  ops: [],
  anchors: ['discharge'],
  build({ params, materials }) {
    const { radius, height, legHeight, pumpOffset } = params;
    const shellBottom = legHeight;
    const shellTop = legHeight + height;
    const top = shellTop + radius * DOME;
    const root = group(null, 'supplyTank');
    const liquid = new THREE.MeshPhysicalMaterial({ color: 0xc2860f, emissive: 0x2a1800, metalness: 0, roughness: 0.12, clearcoat: 0.6 });
    liquid.name = 'tank liquid';

    // Shell, dished head, outlet cone, stiffening rings.
    const shell = group(root, 'Shell');
    cylinder(shell, radius, height, [0, shellBottom + height / 2, 0], materials.stainless, 'Tank shell', { segments: 48 });
    const dome = addMesh(shell, new THREE.SphereGeometry(radius, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), materials.stainless, 'Dished head', [0, shellTop, 0]);
    dome.scale.y = DOME;
    cylinder(shell, radius, 0.16, [0, shellBottom - 0.08, 0], materials.stainless, 'Outlet cone', { radiusBottom: 0.06, segments: 48 });
    [0.12, height - 0.12].forEach((y, i) => {
      addMesh(shell, new THREE.TorusGeometry(radius + 0.004, 0.008, 8, 48).rotateX(Math.PI / 2), materials.brushed, `Stiffening ring ${i + 1}`, [0, shellBottom + y, 0]);
    });

    // Legs with foot plates.
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.PI / 4 + i * (Math.PI / 2);
      const x = Math.cos(angle) * (radius - 0.02);
      const zz = Math.sin(angle) * (radius - 0.02);
      roundedBox(root, [0.07, legHeight + 0.12, 0.07], [x, (legHeight + 0.12) / 2, zz], materials.stainless, `Leg ${i + 1}`, 0.01);
      roundedBox(root, [0.16, 0.015, 0.16], [x, 0.0075, zz], materials.brushed, `Foot plate ${i + 1}`, 0.004);
    }

    // Manway, vent.
    cylinder(root, 0.17, 0.08, [0, top - 0.02, 0], materials.brushed, 'Manway collar', { segments: 32 });
    cylinder(root, 0.19, 0.025, [0, top + 0.03, 0], materials.stainless, 'Manway lid', { segments: 32 });
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      cylinder(root, 0.009, 0.03, [Math.cos(angle) * 0.17, top + 0.05, Math.sin(angle) * 0.17], materials.chrome, 'Lid bolt', { segments: 6 });
    }
    const ventX = Math.min(0.28, radius - 0.08);
    cylinderBetween(root, [ventX, shellTop + 0.02, 0.1], [ventX, shellTop + 0.32, 0.1], 0.025, materials.stainless, 'Vent pipe');
    addMesh(root, new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.stainless, 'Vent cap', [ventX, shellTop + 0.32, 0.1]);

    // Ultrasonic level transmitter, standing on the dished head. (The reference set it at the apex
    // height, 1.8 cm above the head where it stood.)
    const tx = [Math.min(0.22, radius * 0.5), 0, -0.12];
    const headY = shellTop + DOME * Math.sqrt(Math.max(0, radius ** 2 - tx[0] ** 2 - tx[2] ** 2));
    const transmitter = group(root, 'Level transmitter', [tx[0], headY - 0.005, tx[2]]);
    cylinder(transmitter, 0.03, 0.04, [0, 0.02, 0], materials.brushed, 'Process connection', { segments: 6 });
    cylinder(transmitter, 0.045, 0.09, [0, 0.085, 0], materials.stainless, 'Transmitter body', { segments: 24 });
    roundedBox(transmitter, [0.07, 0.05, 0.05], [0, 0.155, 0], materials.motor, 'Display head', 0.01);

    // Level sight glass on the front of the shell.
    const sight = group(root, 'Level sight glass', [0, 0, radius + 0.05]);
    const sightBottom = shellBottom + 0.1;
    const sightTop = shellTop - 0.1;
    const sightLength = sightTop - sightBottom;
    cylinder(sight, 0.016, sightLength, [0, sightBottom + sightLength / 2, 0], materials.sightGlass, 'Sight tube', { segments: 16 });
    const sightLiquid = addMesh(sight, new THREE.CylinderGeometry(0.011, 0.011, 1, 12).translate(0, 0.5, 0), liquid, 'Sight liquid', [0, sightBottom, 0]);
    // Valves overlap the tube ends (the reference's stood 5 mm off them, so the tube floated).
    [sightBottom - 0.02, sightTop + 0.02].forEach((y, i) => {
      cylinder(sight, 0.022, 0.05, [0, y, 0], materials.brushed, `Sight valve ${i + 1}`, { segments: 16 });
      cylinderBetween(sight, [0, y, 0], [0, y, -0.06], 0.012, materials.brushed, `Sight stub ${i + 1}`);
    });

    const plateMaterial = new THREE.MeshStandardMaterial({ map: plateTexture(params), metalness: 0.2, roughness: 0.5 });
    plateMaterial.name = 'tank name plate';
    const plate = addMesh(root, new THREE.CylinderGeometry(radius + 0.003, radius + 0.003, Math.min(0.24, height * 0.3), 32, 1, true, -0.5, 1), plateMaterial, 'Tank name plate', [0, shellBottom + height * 0.62, 0], { castShadow: false });
    plate.rotation.y = 0.7;

    // Transfer pump on its skid.
    const pump = group(root, 'Transfer pump', [pumpOffset, 0, 0]);
    roundedBox(pump, [0.7, 0.06, 0.3], [0.18, 0.03, 0], materials.frame, 'Pump skid', 0.008);
    roundedBox(pump, [0.16, 0.1, 0.18], [0, 0.11, 0], materials.frame, 'Pump pedestal', 0.01);
    cylinder(pump, 0.1, 0.09, [0, 0.24, 0], materials.stainless, 'Pump volute', { axis: 'x', segments: 32 });
    cylinder(pump, 0.05, 0.08, [-0.08, 0.24, 0], materials.stainless, 'Suction nozzle', { axis: 'x', segments: 20 });
    cylinder(pump, 0.045, 0.1, [0, 0.36, 0], materials.stainless, 'Discharge nozzle', { segments: 20 });
    // The bearing frame reaches the motor and the motor stands on feet on the skid. (The reference
    // motor hung 1 cm off the bearing frame with nothing under it.)
    cylinder(pump, 0.03, 0.14, [0.1, 0.24, 0], materials.brushed, 'Bearing frame', { axis: 'x', segments: 20 });
    cylinder(pump, 0.09, 0.3, [0.32, 0.24, 0], materials.motor, 'Pump motor', { axis: 'x', segments: 32 });
    roundedBox(pump, [0.2, 0.1, 0.14], [0.32, 0.11, 0], materials.motor, 'Motor feet', 0.008);
    cylinder(pump, 0.092, 0.05, [0.495, 0.24, 0], materials.frameDark, 'Motor fan cover', { axis: 'x', segments: 32 });
    roundedBox(pump, [0.1, 0.06, 0.1], [0.3, 0.355, 0], materials.motor, 'Motor terminal box', 0.01);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      roundedBox(pump, [0.26, 0.012, 0.012], [0.32, 0.24 + Math.sin(angle) * 0.092, Math.cos(angle) * 0.092], materials.motor, 'Cooling fin', 0.004);
    }

    // Suction line: tank outlet down to the pump suction, with a ball valve.
    const outlet = [0, shellBottom - 0.16, 0];
    const suction = [pumpOffset + PUMP.suction[0], PUMP.suction[1], 0];
    const suctionLine = pipeRun(root, [outlet, [outlet[0], suction[1], 0], suction], 0.03, materials.stainless, 'Suction line');
    flange(suctionLine, 0.057, [suction[0] - 0.02, suction[1], 0], materials.brushed, 'Suction line flange 1', 'x');
    ballValve(root, materials, 'Suction valve', [(outlet[0] + suction[0]) / 2, suction[1], 0], 'z', 0.035);

    // Discharge stub with valve and pressure gauge; the line on to the consumer starts at its top.
    const dischargeX = pumpOffset + PUMP.discharge[0];
    const stub = pipeRun(root, [[dischargeX, PUMP.discharge[1], 0], [dischargeX, STUB_TOP, 0]], 0.026, materials.stainless, 'Discharge stub');
    flange(stub, 0.049, [dischargeX, PUMP.discharge[1] + 0.02, 0], materials.brushed, 'Discharge stub flange 1');
    ballValve(root, materials, 'Discharge valve', [dischargeX, 0.95, 0], 'y', 0.03);
    pressureGauge(root, materials, 'Discharge pressure gauge', [dischargeX, 1.45, 0.03]);
    const discharge = group(root, 'Discharge', [dischargeX, STUB_TOP, 0]);

    return {
      root,
      anchors: { discharge },
      motions: { level(v) { sightLiquid.scale.y = Math.max(0.001, v * sightLength); } },
    };
  },
});

/** Ball valve with a red lever (reference OilHoses.addValve). */
function ballValve(parent, materials, name, position, axis, radius) {
  const valve = group(parent, name, position);
  addMesh(valve, new THREE.SphereGeometry(radius * 1.3, 20, 14), materials.stainless, 'Ball valve body');
  const lever = group(valve, 'Valve lever', [0, radius * 1.3, 0]);
  cylinder(lever, 0.008, 0.04, [0, 0.02, 0], materials.stainless, 'Stem', { segments: 10 });
  // The handle points along x or z from the stem. (The reference kept it long in x when it pointed
  // along z, so it missed the stem.)
  const alongX = axis === 'y';
  box(lever, alongX ? [0.16, 0.012, 0.025] : [0.025, 0.012, 0.16], [alongX ? 0.07 : 0, 0.04, alongX ? 0 : 0.07], materials.emergency, 'Lever handle');
  return valve;
}

/** Dial pressure gauge on a stem (reference OilHoses.addGauge). */
function pressureGauge(parent, materials, name, position) {
  const gauge = group(parent, name, position);
  cylinder(gauge, 0.01, 0.06, [0, 0.03, 0], materials.brushed, 'Gauge stem', { segments: 10 });
  cylinder(gauge, 0.045, 0.03, [0, 0.1, 0], materials.stainless, 'Gauge case', { axis: 'z', segments: 28 });
  const face = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.4 });
  face.name = 'gauge dial';
  cylinder(gauge, 0.038, 0.002, [0, 0.1, 0.016], face, 'Gauge dial', { axis: 'z', segments: 28 }).castShadow = false;
  box(gauge, [0.003, 0.03, 0.002], [0.006, 0.108, 0.018], materials.emergency, 'Gauge needle').rotation.z = -0.6;
  return gauge;
}
