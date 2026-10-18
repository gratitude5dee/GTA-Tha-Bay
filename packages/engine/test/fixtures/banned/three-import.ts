// Banned in sim code (C02 rule 1): importing three, or any of its subpaths.
import * as THREE from 'three';
import { Vector3 } from 'three/webgpu';

export const make = (): unknown => [new THREE.Object3D(), new Vector3()];
