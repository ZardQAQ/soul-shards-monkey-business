// ============================================================
// world.js - 酒店走廊迷宫视觉（性能优化版）
// 顶灯：视觉灯具全量 + 仅玩家附近少量真实点光
// ============================================================

import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT } from './maze.js';
import {
    getTextures, createVoxel, createMaterial, mulberry32
} from './utils.js';
import { MODE, getCuteConfig } from './mode.js';

/** 灯具间距（格）；越大越稀 */
const CEILING_LIGHT_SPACING = 2.4;
/** 同时启用的真实点光数量（Three.js 点光极贵） */
const MAX_ACTIVE_LIGHTS = 10;
const LIGHT_RANGE = CELL_SIZE * 3.8;

export class World {
    constructor(scene, maze, options = {}) {
        this.scene = scene;
        this.maze = maze;
        this.textures = getTextures();
        this.mode = options.mode || MODE.CLASSIC;

        this.exitMesh = null;
        this.exitOpen = false;
        this.ceilingLights = [];
        this.fixturePositions = []; // {x,y,z}
        this._owned = [];
        this._lightUpdateAcc = 0;
        this._tmpDist = [];

        this._decoRoomNum = 100;

        const cute = this.mode === MODE.CUTE;
        const sceneCfg = cute ? getCuteConfig().scene : null;

        // 共享装饰材质（Lambert 吃顶光，贴近酒店走廊参考）
        // 窝囊版：奶油木门、浅棕框，更像萌宠乐园小屋
        this._matFrame = new THREE.MeshLambertMaterial({
            color: cute ? sceneCfg.frameColor : 0x2c1810,
        });
        this._matDoor = new THREE.MeshLambertMaterial({
            color: cute ? sceneCfg.doorColor : 0x4a2a1c,
        });
        this._matDoorPanel = new THREE.MeshLambertMaterial({
            color: cute ? 0xb07850 : 0x3a2014,
        });
        this._matKnob = new THREE.MeshPhongMaterial({
            color: cute ? 0xffd060 : 0xd4a84a,
            specular: cute ? 0xfff0c0 : 0xffe0a0,
            shininess: 50,
        });
        this._matPlaque = new THREE.MeshLambertMaterial({
            color: cute ? 0x8a6a4a : 0x1a120c,
        });
        this._matPlaqueNum = new THREE.MeshBasicMaterial({
            color: cute ? 0xfff0d0 : 0xc8b090,
        });
        this._matPaintFrame = new THREE.MeshPhongMaterial({
            color: cute ? 0xd4a070 : 0xb8944a,
            specular: cute ? 0xffe8c0 : 0xffe0a0,
            shininess: 45,
        });
        this._matPaintFrameDark = new THREE.MeshPhongMaterial({
            color: cute ? 0xa87850 : 0x7a5a28,
            specular: cute ? 0xdcc090 : 0xd0b060,
            shininess: 35,
        });
        this._matPaintCanvas = cute
            ? [
                new THREE.MeshLambertMaterial({ color: 0xf0c8d8 }), // 粉
                new THREE.MeshLambertMaterial({ color: 0xc8e0f0 }), // 蓝
                new THREE.MeshLambertMaterial({ color: 0xe0d8b8 }), // 米黄
                new THREE.MeshLambertMaterial({ color: 0xd0e8c8 }), // 薄荷绿
                new THREE.MeshLambertMaterial({ color: 0xe8c8a8 }), // 杏色
              ]
            : [
                new THREE.MeshLambertMaterial({ color: 0x3a2820 }),
                new THREE.MeshLambertMaterial({ color: 0x2a2838 }),
                new THREE.MeshLambertMaterial({ color: 0x402028 }),
                new THREE.MeshLambertMaterial({ color: 0x243028 }),
                new THREE.MeshLambertMaterial({ color: 0x1a1820 }),
              ];
        this._matBlood = new THREE.MeshBasicMaterial({
            color: 0x600010,
            transparent: true,
            opacity: 0.65,
        });
        this._matFixture = new THREE.MeshBasicMaterial({
            color: cute ? 0xe0c8a0 : 0x3a3228,
        });
        this._matGlow = new THREE.MeshBasicMaterial({
            color: cute ? 0xfff8e8 : 0xfff0c8,
            transparent: true,
            opacity: cute ? 0.85 : 1,
            side: THREE.DoubleSide,
        });

        this._buildFloor();
        this._buildCeiling();
        this._prepareElevatorShaft(); // 先挖电梯井，避免墙体把电梯挡住
        this._buildWalls();
        this._buildCeilingLights();
        this._buildElevator();
        this._buildDecorations();
    }

    _track(obj) {
        this._owned.push(obj);
        this.scene.add(obj);
        return obj;
    }

    _buildFloor() {
        const w = this.maze.width * CELL_SIZE;
        const h = this.maze.height * CELL_SIZE;
        const tex = this.textures.cobblestone.clone();
        tex.needsUpdate = true;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(this.maze.width, this.maze.height);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;

        const floorColor = this.mode === MODE.CUTE
            ? getCuteConfig().scene.floorColor
            : 0xb88890;
        const geo = new THREE.PlaneGeometry(w, h);
        const mat = createMaterial(tex, { color: floorColor });
        const floor = new THREE.Mesh(geo, mat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(w / 2 - CELL_SIZE / 2, 0, h / 2 - CELL_SIZE / 2);
        this._track(floor);
    }

    _buildCeiling() {
        const w = this.maze.width * CELL_SIZE;
        const h = this.maze.height * CELL_SIZE;
        const tex = this.textures.ceiling.clone();
        tex.needsUpdate = true;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(this.maze.width, this.maze.height);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;

        const ceilingColor = this.mode === MODE.CUTE
            ? getCuteConfig().scene.ceilingColor
            : 0x6a6058;
        const geo = new THREE.PlaneGeometry(w, h);
        const mat = createMaterial(tex, { color: ceilingColor });
        const ceil = new THREE.Mesh(geo, mat);
        ceil.rotation.x = Math.PI / 2;
        ceil.position.set(w / 2 - CELL_SIZE / 2, WALL_HEIGHT, h / 2 - CELL_SIZE / 2);
        this._track(ceil);
    }

    /**
     * 算出电梯朝向，并把身后墙格挖成电梯井（不渲染墙、可走入）
     * 走廊变窄后若不挖井，墙体实例会把整座电梯盖住
     */
    _prepareElevatorShaft() {
        const sx = this.maze.start.x;
        const sy = this.maze.start.y;
        let faceX = 0;
        let faceZ = 1;
        const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        for (const [dx, dy] of dirs) {
            if (!this.maze.isWallCell(sx + dx, sy + dy)) {
                faceX = dx;
                faceZ = dy;
                break;
            }
        }
        this._elevFace = { faceX, faceZ, sx, sy };

        // 身后 1～2 格挖空做轿厢空间
        for (let i = 1; i <= 2; i++) {
            const cx = sx - faceX * i;
            const cy = sy - faceZ * i;
            if (cx < 0 || cy < 0 || cx >= this.maze.width || cy >= this.maze.height) break;
            if (this.maze.grid[cy][cx] === 1) {
                this.maze.grid[cy][cx] = 0;
            }
        }
    }

    _buildWalls() {
        const wallCells = [];
        for (let y = 0; y < this.maze.height; y++) {
            for (let x = 0; x < this.maze.width; x++) {
                if (this.maze.isWallCell(x, y)) wallCells.push([x, y]);
            }
        }
        if (wallCells.length === 0) return;

        const geo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
        const tex = this.textures.stoneBrick.clone();
        tex.needsUpdate = true;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;

        const wallColor = this.mode === MODE.CUTE
            ? getCuteConfig().scene.wallColor
            : 0xe0c8b8;
        const wallTopColor = this.mode === MODE.CUTE
            ? getCuteConfig().scene.wallTopColor
            : 0x3a3228;
        const sideMat = createMaterial(tex, { color: wallColor });
        const topMat = createMaterial(this.textures.ceiling, { color: wallTopColor });
        const materials = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];

        const mesh = new THREE.InstancedMesh(geo, materials, wallCells.length);
        const dummy = new THREE.Object3D();
        wallCells.forEach(([x, y], i) => {
            dummy.position.set(x * CELL_SIZE, WALL_HEIGHT / 2, y * CELL_SIZE);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = true;
        this._track(mesh);
    }

    /**
     * 走廊顶灯：灯具全量用实例化网格；真实点光仅 MAX_ACTIVE_LIGHTS 盏，跟随玩家
     */
    _buildCeilingLights() {
        const placed = [];
        for (const cell of this.maze.pathCells) {
            const tooClose = placed.some(
                (p) => Math.hypot(p.x - cell.x, p.y - cell.y) < CEILING_LIGHT_SPACING
            );
            if (tooClose) continue;
            placed.push(cell);
            this.fixturePositions.push({
                x: cell.x * CELL_SIZE,
                y: WALL_HEIGHT - 0.15,
                z: cell.y * CELL_SIZE,
            });
        }

        const n = this.fixturePositions.length;
        if (n === 0) return;

        const fixtureGeo = new THREE.BoxGeometry(0.85, 0.06, 0.85);
        const glowGeo = new THREE.CircleGeometry(0.42, 14);
        const fixtures = new THREE.InstancedMesh(fixtureGeo, this._matFixture, n);
        const glows = new THREE.InstancedMesh(glowGeo, this._matGlow, n);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < n; i++) {
            const p = this.fixturePositions[i];
            dummy.position.set(p.x, WALL_HEIGHT - 0.08, p.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            fixtures.setMatrixAt(i, dummy.matrix);

            dummy.position.set(p.x, WALL_HEIGHT - 0.12, p.z);
            dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.updateMatrix();
            glows.setMatrixAt(i, dummy.matrix);
        }
        fixtures.instanceMatrix.needsUpdate = true;
        glows.instanceMatrix.needsUpdate = true;
        this._track(fixtures);
        this._track(glows);

        // 可复用的少量点光池 —— 暖黄顶灯光池，对齐参考走廊
        // 窝囊版：更暖更柔的日光感
        const lightColor = this.mode === MODE.CUTE ? 0xfff0d0 : 0xffe0b0;
        for (let i = 0; i < MAX_ACTIVE_LIGHTS; i++) {
            const light = new THREE.PointLight(lightColor, 0, LIGHT_RANGE, 1.45);
            light.position.set(0, -999, 0);
            this.scene.add(light);
            this.ceilingLights.push(light);
        }
    }

    /**
     * 起点电梯：维多利亚装饰风（黄铜多层门框、刷纹金属门、红光面板）
     * 窝囊版：奶油木屋风（浅木门、柔和暖光）
     */
    _buildElevator() {
        const start = this.maze.getStartWorldPos();
        const faceX = this._elevFace?.faceX ?? 0;
        const faceZ = this._elevFace?.faceZ ?? 1;
        const yaw = Math.atan2(faceX, faceZ);

        const cute = this.mode === MODE.CUTE;

        // —— 材质 ——
        const woodColor = cute ? 0xd4a070 : 0x3a281c;
        const woodDeepColor = cute ? 0xb88050 : 0x241810;
        const brassColor = cute ? 0xe8c090 : 0xb8944a;
        const brassSpec = cute ? 0xfff0d0 : 0xffe0a0;
        const brassDarkColor = cute ? 0xc89060 : 0x7a5a28;
        const brassDarkSpec = cute ? 0xe8d0a0 : 0xd0b060;
        const doorMetalColor = cute ? 0xd4b896 : 0x2a2e34;
        const doorMetalSpec = cute ? 0xf0e0c0 : 0x8890a0;
        const doorStripeColor = cute ? 0xe0c8a8 : 0x3a4048;
        const doorStripeSpec = cute ? 0xfff0d8 : 0xaab0c0;
        const panelBaseColor = cute ? 0xa07858 : 0x2a2420;
        const glowColor = cute ? 0xffd060 : 0xff2020;

        const wood = new THREE.MeshLambertMaterial({ color: woodColor });
        const woodDeep = new THREE.MeshLambertMaterial({ color: woodDeepColor });
        const brass = new THREE.MeshPhongMaterial({
            color: brassColor,
            specular: brassSpec,
            shininess: 55,
        });
        const brassDark = new THREE.MeshPhongMaterial({
            color: brassDarkColor,
            specular: brassDarkSpec,
            shininess: 40,
        });
        const doorMetal = new THREE.MeshPhongMaterial({
            color: doorMetalColor,
            specular: doorMetalSpec,
            shininess: 70,
        });
        const doorStripe = new THREE.MeshPhongMaterial({
            color: doorStripeColor,
            specular: doorStripeSpec,
            shininess: 80,
        });
        const panelBase = new THREE.MeshLambertMaterial({ color: panelBaseColor });
        const redGlow = new THREE.MeshBasicMaterial({ color: glowColor });
        this.elevatorIndicatorMat = new THREE.MeshBasicMaterial({ color: glowColor });
        this.elevatorDoorMat = doorMetal;
        this.exitFrameMat = brass;
        this._elevMats = [
            wood, woodDeep, brass, brassDark, doorMetal, doorStripe,
            panelBase, redGlow, this.elevatorIndicatorMat,
        ];

        const group = new THREE.Group();

        // 加深轿厢：后门更靠后，站位离门更远
        const cabinBack = -1.55;
        const doorZ = 0.55;
        const cabinMid = (cabinBack + doorZ) * 0.5;

        group.add(createVoxel(0, 1.45, cabinBack, 2.45, 2.9, 0.1, woodDeep));
        group.add(createVoxel(-1.22, 1.45, cabinMid, 0.1, 2.9, 2.15, wood));
        group.add(createVoxel(1.22, 1.45, cabinMid, 0.1, 2.9, 2.15, wood));
        group.add(createVoxel(0, 2.95, cabinMid, 2.45, 0.1, 2.15, woodDeep));
        group.add(createVoxel(0, 0.04, cabinMid, 2.45, 0.08, 2.15, woodDeep));

        for (const side of [-1, 1]) {
            for (const z of [-1.1, -0.35, 0.35]) {
                group.add(createVoxel(side * 1.16, 0.55, z, 0.04, 0.7, 0.55, woodDeep));
                group.add(createVoxel(side * 1.16, 1.45, z, 0.04, 0.7, 0.55, woodDeep));
                group.add(createVoxel(side * 1.16, 2.35, z, 0.04, 0.55, 0.55, woodDeep));
            }
        }

        // 门框外墙木饰面
        group.add(createVoxel(-1.4, 1.5, doorZ - 0.05, 0.5, 3.1, 0.28, wood));
        group.add(createVoxel(1.4, 1.5, doorZ - 0.05, 0.5, 3.1, 0.28, wood));

        // 多层黄铜门框（只做边框，中间开口，避免开门后金膜挡路）
        const openW = 1.95;
        const openH = 2.55;
        const frameY = 1.4;
        const addFrameLayer = (z, thick, inset, mat) => {
            const halfW = openW * 0.5 + inset;
            const halfH = openH * 0.5 + inset;
            const bar = 0.12 + inset * 0.35;
            group.add(createVoxel(-halfW, frameY, z, bar, openH + inset * 2, thick, mat));
            group.add(createVoxel(halfW, frameY, z, bar, openH + inset * 2, thick, mat));
            group.add(createVoxel(0, frameY + halfH, z, openW + inset * 2, bar, thick, mat));
            group.add(createVoxel(0, frameY - halfH, z, openW + inset * 2, bar, thick, mat));
        };
        addFrameLayer(doorZ + 0.08, 0.08, 0.28, brassDark);
        addFrameLayer(doorZ + 0.13, 0.07, 0.16, brass);
        addFrameLayer(doorZ + 0.17, 0.06, 0.06, brassDark);
        group.add(createVoxel(-1.05, 1.4, doorZ + 0.2, 0.14, 2.75, 0.1, brass));
        group.add(createVoxel(1.05, 1.4, doorZ + 0.2, 0.14, 2.75, 0.1, brass));
        group.add(createVoxel(0, 2.82, doorZ + 0.2, 2.24, 0.14, 0.1, brass));
        group.add(createVoxel(0, 0.12, doorZ + 0.2, 2.24, 0.12, 0.1, brassDark));

        group.add(createVoxel(0, 3.05, doorZ + 0.02, 2.7, 0.28, 0.18, brassDark));
        group.add(createVoxel(0, 3.12, doorZ + 0.1, 2.4, 0.12, 0.1, brass));
        const scrollXs = [-0.85, -0.5, -0.15, 0.15, 0.5, 0.85];
        for (const sx2 of scrollXs) {
            group.add(createVoxel(sx2, 3.08, doorZ + 0.15, 0.22, 0.18, 0.08, brass));
            group.add(createVoxel(sx2, 3.18, doorZ + 0.12, 0.12, 0.1, 0.06, brassDark));
        }
        group.add(createVoxel(0, 3.1, doorZ + 0.18, 0.35, 0.22, 0.1, brass));
        group.add(createVoxel(0, 3.1, doorZ + 0.22, 0.18, 0.12, 0.05, brassDark));

        group.add(createVoxel(0, 2.62, doorZ + 0.24, 0.5, 0.12, 0.05, woodDeep));
        group.add(createVoxel(0, 2.62, doorZ + 0.26, 0.38, 0.07, 0.04, this.elevatorIndicatorMat));

        this.elevatorDoorL = createVoxel(-0.48, 1.35, doorZ, 0.94, 2.55, 0.07, doorMetal);
        this.elevatorDoorR = createVoxel(0.48, 1.35, doorZ, 0.94, 2.55, 0.07, doorMetal);
        group.add(this.elevatorDoorL, this.elevatorDoorR);
        this._doorStripes = [];
        for (let i = 0; i < 9; i++) {
            const y = 0.35 + i * 0.28;
            const sL = createVoxel(-0.48, y, doorZ + 0.045, 0.9, 0.035, 0.02, doorStripe);
            const sR = createVoxel(0.48, y, doorZ + 0.045, 0.9, 0.035, 0.02, doorStripe);
            this.elevatorDoorL.add(sL);
            this.elevatorDoorR.add(sR);
            sL.position.set(0, y - 1.35, 0.045);
            sR.position.set(0, y - 1.35, 0.045);
            this._doorStripes.push(sL, sR);
        }

        group.add(createVoxel(-1.18, 1.05, cabinMid, 0.05, 0.05, 1.9, brass));
        group.add(createVoxel(1.18, 1.05, cabinMid, 0.05, 0.05, 1.9, brass));

        // 控制面板贴右侧内壁（薄面朝轿厢中心，开门前就能看见）
        const panel = new THREE.Group();
        // 右墙内表面约 x=1.17；面板厚 0.06，背贴墙 → 中心 x≈1.14
        panel.position.set(1.14, 1.35, -0.2);
        panel.rotation.y = -Math.PI / 2; // 本地 +Z 朝向 -X（轿厢内侧）
        panel.add(createVoxel(0, 0, 0, 0.28, 0.95, 0.06, panelBase));
        panel.add(createVoxel(0, 0.42, 0.02, 0.22, 0.08, 0.04, brassDark));
        panel.add(createVoxel(0, 0.48, 0.03, 0.1, 0.06, 0.03, brass));
        const btnMat = redGlow;
        const btnYs = [0.22, 0.08, -0.06, -0.2];
        for (const by of btnYs) {
            panel.add(createVoxel(-0.06, by, 0.04, 0.07, 0.07, 0.03, btnMat));
            panel.add(createVoxel(0.06, by, 0.04, 0.07, 0.07, 0.03, btnMat));
        }
        const label = this._makeElevatorLabel();
        if (label) {
            label.position.set(0, -0.38, 0.035);
            panel.add(label);
        }
        group.add(panel);

        this._elevPanelLight = new THREE.PointLight(0xff3030, 0.75, 2.8, 2);
        this._elevPanelLight.position.set(0.95, 1.35, -0.2);
        group.add(this._elevPanelLight);

        // 轿厢顶灯：开场能看清内饰
        this._elevCabinLight = new THREE.PointLight(0xffe2b8, 3.0, 5.0, 1.25);
        this._elevCabinLight.position.set(0, 2.7, cabinMid);
        group.add(this._elevCabinLight);

        // 门贴在起点格后缘，轿厢伸进挖空的电梯井（出门后仍可见）
        const doorOnPath = CELL_SIZE * 0.5 - 0.06;
        const backX = start.x - faceX * (doorOnPath + doorZ);
        const backZ = start.z - faceZ * (doorOnPath + doorZ);
        group.position.set(backX, 0, backZ);
        group.rotation.y = yaw;
        // 宽度略收，适配窄走廊
        const elevScale = Math.min(1, (CELL_SIZE * 0.95) / 2.4);
        group.scale.setScalar(elevScale);
        this._track(group);

        // 门外暖光，预亮走廊入口
        this.exitLight = new THREE.PointLight(0xffe8c0, 3.4, 14, 1.2);
        this.exitLight.position.set(
            start.x - faceX * 0.15,
            2.55,
            start.z - faceZ * 0.15
        );
        this.scene.add(this.exitLight);

        // 站位随缩放
        const standBack = 0.85 * elevScale;
        const doorWorldDist = doorOnPath; // 相对 start 往 -face
        // 关门碰撞：门板在世界坐标中的薄板（网格已挖空电梯井，需单独挡）
        const doorCx = start.x - faceX * doorWorldDist;
        const doorCz = start.z - faceZ * doorWorldDist;
        this.elevator = {
            group,
            faceX,
            faceZ,
            yaw,
            doorOpen: 0,
            targetOpen: 0,
            doorCollider: {
                cx: doorCx,
                cz: doorCz,
                nx: faceX,
                nz: faceZ,
                tx: -faceZ,
                tz: faceX,
                halfW: 0.98 * elevScale,
                halfD: 0.08 * elevScale,
            },
            interior: {
                x: backX - faceX * standBack,
                z: backZ - faceZ * standBack,
            },
            outside: {
                x: start.x + faceX * (CELL_SIZE * 0.35),
                z: start.z + faceZ * (CELL_SIZE * 0.35),
            },
            entry: {
                x: start.x - faceX * (doorWorldDist - 0.15),
                z: start.z - faceZ * (doorWorldDist - 0.15),
            },
            hallPreview: {
                x: start.x + faceX * (CELL_SIZE * 1.2),
                z: start.z + faceZ * (CELL_SIZE * 1.2),
            },
        };

        this.exitOpen = false;
        this.exitMesh = { group };
        this._setDoorOpenAmount(0);
        this.primeLightsAround(start.x, start.z);
    }

    /**
     * 立刻点亮某点附近顶灯（开场用，避免出门瞬间走廊全黑）
     */
    primeLightsAround(wx, wz) {
        if (!this.fixturePositions.length || !this.ceilingLights.length) return;
        const scored = [];
        for (let i = 0; i < this.fixturePositions.length; i++) {
            const p = this.fixturePositions[i];
            const d2 = (p.x - wx) * (p.x - wx) + (p.z - wz) * (p.z - wz);
            scored.push({ i, d2, p });
        }
        scored.sort((a, b) => a.d2 - b.d2);
        const active = Math.min(MAX_ACTIVE_LIGHTS, scored.length);
        for (let i = 0; i < this.ceilingLights.length; i++) {
            const light = this.ceilingLights[i];
            if (i < active) {
                const { p, d2 } = scored[i];
                light.position.set(p.x, p.y, p.z);
                const dist = Math.sqrt(d2);
                const fade = Math.max(0.7, 1 - dist / (CELL_SIZE * 18));
                light.intensity = 4.0 * fade;
            } else {
                light.intensity = 0;
                light.position.set(0, -999, 0);
            }
        }
        this._lightsBooted = true;
        this._lightUpdateAcc = 0;
    }

    /** 控制面板底部 ELEVATOR 铭牌 */
    _makeElevatorLabel() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#1a1410';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#c8a050';
        ctx.font = 'bold 28px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ELEVATOR', 128, 34);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        this._elevMats.push(mat);
        this._elevLabelTex = tex;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), mat);
        return mesh;
    }

    _setDoorOpenAmount(t) {
        const a = Math.max(0, Math.min(1, t));
        if (this.elevator) this.elevator.doorOpen = a;
        if (this.elevatorDoorL) this.elevatorDoorL.position.x = -0.48 - a * 0.95;
        if (this.elevatorDoorR) this.elevatorDoorR.position.x = 0.48 + a * 0.95;
    }

    openElevatorDoors() {
        if (!this.elevator) return;
        this.elevator.targetOpen = 1;
    }

    closeElevatorDoors() {
        if (!this.elevator || this.exitOpen) return;
        this.elevator.targetOpen = 0;
    }

    /**
     * 电梯门关闭/半开时阻挡穿越（视觉门有模型，但迷宫格已被挖空）
     * 开度 > 0.72 视为可通过（过场出门 / 逃脱进门）
     */
    isElevatorDoorBlocking(worldX, worldZ, radius = 0.28) {
        const elev = this.elevator;
        if (!elev || !elev.doorCollider) return false;
        if (elev.doorOpen > 0.72) return false;

        const { cx, cz, nx, nz, tx, tz, halfW, halfD } = elev.doorCollider;
        const dx = worldX - cx;
        const dz = worldZ - cz;
        const along = dx * tx + dz * tz;
        const through = dx * nx + dz * nz;

        // 推拉门从中间拉开：中间空隙可通过，两侧门板仍挡
        const gapHalf = elev.doorOpen * halfW * 0.98;
        if (Math.abs(along) < gapHalf) return false;

        const closestA = Math.max(-halfW, Math.min(along, halfW));
        const closestT = Math.max(-halfD, Math.min(through, halfD));
        const ex = along - closestA;
        const ez = through - closestT;
        return ex * ex + ez * ez < radius * radius;
    }

    openExit() {
        if (this.exitOpen) return;
        this.exitOpen = true;
        if (this.elevator) this.elevator.targetOpen = 1;
        if (this.elevatorIndicatorMat) this.elevatorIndicatorMat.color.setHex(0x40ff40);
        if (this.exitLight) {
            this.exitLight.color.setHex(0xa0ffb0);
            this.exitLight.intensity = 4.0;
        }
    }

    isExitOpen() {
        return this.exitOpen;
    }

    isPlayerInElevator(worldX, worldZ) {
        if (!this.elevator) return false;
        const e = this.elevator.entry;
        return Math.hypot(worldX - e.x, worldZ - e.z) < 1.15;
    }

    getElevator() {
        return this.elevator;
    }

    _buildDecorations() {
        const rng = mulberry32(this.maze.seed ^ 0xBEEF);
        // 记录已占用的墙面，避免门和壁画叠在一起
        const used = new Set();
        const faceKey = (x, y, dx, dz) => `${x},${y},${dx},${dz}`;

        const candidates = [];
        for (const cell of this.maze.pathCells) {
            const ds = Math.hypot(cell.x - this.maze.start.x, cell.y - this.maze.start.y);
            if (ds < 2.5) continue;
            const dirs = this._wallFacingDirs(cell.x, cell.y);
            for (const dir of dirs) {
                candidates.push({ cell, dir });
            }
        }

        // 打乱后按走廊密度铺设：约一半做门，约三分之一做壁画
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = candidates[i];
            candidates[i] = candidates[j];
            candidates[j] = tmp;
        }

        let doors = 0;
        let paintings = 0;
        const doorTarget = Math.max(28, Math.floor(candidates.length * 0.32));
        const paintTarget = Math.max(22, Math.floor(candidates.length * 0.26));

        // 第一遍铺门
        for (const { cell, dir } of candidates) {
            if (doors >= doorTarget) break;
            const [dx, dz] = dir;
            const key = faceKey(cell.x, cell.y, dx, dz);
            if (used.has(key)) continue;
            const neighborBusy =
                used.has(faceKey(cell.x + dz, cell.y + dx, dx, dz)) ||
                used.has(faceKey(cell.x - dz, cell.y - dx, dx, dz));
            if (neighborBusy) continue;
            this._addDoor(cell, dir);
            used.add(key);
            doors++;
        }

        // 第二遍铺壁画（占未用墙面）
        for (const { cell, dir } of candidates) {
            if (paintings >= paintTarget) break;
            const [dx, dz] = dir;
            const key = faceKey(cell.x, cell.y, dx, dz);
            if (used.has(key)) continue;
            this._addPainting(cell, dir, rng);
            used.add(key);
            paintings++;
        }

        // 少量血迹（窝囊版不生成）
        if (this.mode !== MODE.CUTE) {
            const path = this.maze.pathCells.filter((c) => {
                const ds = Math.hypot(c.x - this.maze.start.x, c.y - this.maze.start.y);
                return ds > 3;
            });
            const stainCount = Math.min(10, Math.floor(path.length * 0.02));
            for (let i = 0; i < stainCount; i++) {
                const cell = path[Math.floor(rng() * path.length)];
                const wx = cell.x * CELL_SIZE + (rng() - 0.5) * 1.2;
                const wz = cell.y * CELL_SIZE + (rng() - 0.5) * 1.2;
                this._addBloodStain(wx, wz, rng);
            }
        }
    }

    _wallFacingDirs(x, y) {
        const dirs = [];
        if (this.maze.isWallCell(x + 1, y)) dirs.push([1, 0]);
        if (this.maze.isWallCell(x - 1, y)) dirs.push([-1, 0]);
        if (this.maze.isWallCell(x, y + 1)) dirs.push([0, 1]);
        if (this.maze.isWallCell(x, y - 1)) dirs.push([0, -1]);
        return dirs;
    }

    /** 酒店客房门：深木门框 + 门板 + 门牌号 */
    _addDoor(cell, dir) {
        const [dx, dz] = dir;
        // 门贴墙内嵌，少凸进走廊，避免视觉上像挡住路
        const wx = cell.x * CELL_SIZE + dx * (CELL_SIZE * 0.5 - 0.02);
        const wz = cell.y * CELL_SIZE + dz * (CELL_SIZE * 0.5 - 0.02);
        const yaw = Math.atan2(dx, dz);
        const roomNo = this._decoRoomNum++;

        const group = new THREE.Group();
        // 外框（略薄，少占视觉通道）
        group.add(createVoxel(-0.58, 1.15, 0, 0.12, 2.3, 0.06, this._matFrame));
        group.add(createVoxel(0.58, 1.15, 0, 0.12, 2.3, 0.06, this._matFrame));
        group.add(createVoxel(0, 2.35, 0, 1.28, 0.12, 0.06, this._matFrame));
        group.add(createVoxel(0, 0.06, 0, 1.28, 0.08, 0.06, this._matFrame));
        group.add(createVoxel(0, 1.15, 0.03, 1.02, 2.15, 0.05, this._matDoor));
        group.add(createVoxel(0, 1.65, 0.07, 0.68, 0.65, 0.025, this._matDoorPanel));
        group.add(createVoxel(0, 0.72, 0.07, 0.68, 0.65, 0.025, this._matDoorPanel));
        group.add(createVoxel(0.36, 1.1, 0.1, 0.06, 0.06, 0.05, this._matKnob));
        group.add(createVoxel(0, 2.52, 0.05, 0.38, 0.12, 0.04, this._matPlaque));
        group.add(createVoxel(0, 2.52, 0.08, 0.26, 0.05, 0.02, this._matPlaqueNum));

        group.position.set(wx, 0, wz);
        group.rotation.y = yaw;
        group.userData.roomNo = roomNo;
        this._track(group);
    }

    /** 墙上鎏金大画框壁画 */
    _addPainting(cell, dir, rng) {
        const [dx, dz] = dir;
        const wx = cell.x * CELL_SIZE + dx * (CELL_SIZE * 0.5 - 0.05);
        const wz = cell.y * CELL_SIZE + dz * (CELL_SIZE * 0.5 - 0.05);
        const yaw = Math.atan2(dx, dz);
        const h = 1.55 + rng() * 0.25;
        const canvasMat = this._matPaintCanvas[Math.floor(rng() * this._matPaintCanvas.length)];

        // 大画框为主，偶尔小幅
        const large = rng() < 0.55;
        const fw = large ? 1.15 + rng() * 0.45 : 0.7 + rng() * 0.25;
        const fh = large ? 0.85 + rng() * 0.35 : 0.55 + rng() * 0.2;

        const group = new THREE.Group();
        // 外层厚金框
        group.add(createVoxel(0, 0, 0, fw + 0.22, fh + 0.22, 0.06, this._matPaintFrameDark));
        group.add(createVoxel(0, 0, 0.04, fw + 0.12, fh + 0.12, 0.05, this._matPaintFrame));
        // 内缘
        group.add(createVoxel(0, 0, 0.07, fw + 0.04, fh + 0.04, 0.03, this._matPaintFrameDark));
        // 画布
        group.add(createVoxel(0, 0, 0.1, fw, fh, 0.025, canvasMat));
        // 四角装饰块
        const cx = fw * 0.5 + 0.02;
        const cy = fh * 0.5 + 0.02;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            group.add(createVoxel(sx * cx, sy * cy, 0.08, 0.12, 0.12, 0.04, this._matPaintFrame));
        }

        group.position.set(wx, h, wz);
        group.rotation.y = yaw;
        this._track(group);
    }

    _addBloodStain(wx, wz, rng) {
        const size = 0.55 + rng() * 0.4;
        const geo = new THREE.PlaneGeometry(size, size);
        const blood = new THREE.Mesh(geo, this._matBlood);
        blood.rotation.x = -Math.PI / 2;
        blood.rotation.z = rng() * Math.PI * 2;
        blood.position.set(wx, 0.02, wz);
        this._track(blood);
    }

    /**
     * @param {number} dt
     * @param {{x:number,y:number,z:number}|null} playerPos
     */
    update(dt, playerPos = null) {
        const t = performance.now() * 0.001;

        if (this.elevator) {
            const cur = this.elevator.doorOpen;
            const tgt = this.elevator.targetOpen;
            if (Math.abs(cur - tgt) > 0.001) {
                const next = cur + Math.sign(tgt - cur) * Math.min(Math.abs(tgt - cur), dt * 0.9);
                this._setDoorOpenAmount(next);
            }
            if (this.exitLight) {
                const pulse = 0.92 + Math.sin(t * 2.2) * 0.08;
                this.exitLight.intensity = (this.exitOpen ? 4.0 : 3.4) * pulse;
            }
        }

        // 每 0.12s 重算一次最近灯具，避免每帧排序
        this._lightUpdateAcc += dt;
        if (!playerPos || this.fixturePositions.length === 0) return;
        if (this._lightUpdateAcc < 0.12 && this._lightsBooted) return;
        this._lightUpdateAcc = 0;
        this._lightsBooted = true;

        const px = playerPos.x;
        const pz = playerPos.z;
        const scored = this._tmpDist;
        scored.length = 0;
        for (let i = 0; i < this.fixturePositions.length; i++) {
            const p = this.fixturePositions[i];
            const d2 = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
            scored.push(i);
            p._d2 = d2;
        }
        scored.sort((a, b) => this.fixturePositions[a]._d2 - this.fixturePositions[b]._d2);

        const active = Math.min(MAX_ACTIVE_LIGHTS, scored.length);
        for (let i = 0; i < this.ceilingLights.length; i++) {
            const light = this.ceilingLights[i];
            if (i < active) {
                const p = this.fixturePositions[scored[i]];
                light.position.set(p.x, p.y, p.z);
                const dist = Math.sqrt(p._d2);
                const fade = Math.max(0.55, 1 - dist / (CELL_SIZE * 16));
                light.intensity = 3.6 * fade;
            } else {
                light.intensity = 0;
                light.position.set(0, -999, 0);
            }
        }
    }

    dispose() {
        for (const obj of this._owned) {
            this.scene.remove(obj);
            obj.traverse?.((child) => {
                if (child.geometry) child.geometry.dispose();
            });
            if (obj.geometry) obj.geometry.dispose();
        }
        this._owned = [];
        for (const light of this.ceilingLights) this.scene.remove(light);
        this.ceilingLights = [];
        this.fixturePositions = [];
        if (this.exitLight) {
            this.scene.remove(this.exitLight);
            this.exitLight = null;
        }
        this._elevPanelLight = null;
        this._elevCabinLight = null;
        if (this._elevLabelTex) {
            this._elevLabelTex.dispose();
            this._elevLabelTex = null;
        }
        const extra = [
            this._matFrame, this._matDoor, this._matDoorPanel, this._matKnob,
            this._matPlaque, this._matPlaqueNum,
            this._matPaintFrame, this._matPaintFrameDark,
            this._matBlood, this._matFixture, this._matGlow,
            this.elevatorDoorMat, this.elevatorIndicatorMat, this.exitFrameMat,
            ...(this._elevMats || []),
            ...this._matPaintCanvas,
        ];
        extra.forEach((m) => m?.dispose?.());
        this.elevator = null;
        this.exitMesh = null;
        this._doorStripes = null;
    }
}
