import * as THREE from 'three';

/**
 * Reusable Prototype 2 foundation ("体积激光与拖尾条带"):
 * Builds view-angle-feathered volumetric light shafts and animated 3D ribbon arcs
 * for TH09, TH12, TH13, and TH18.
 */

export function createVolumetricBeamGeometry(
  radiusNear: number,
  radiusFar: number,
  length: number,
  radialSegments = 20,
): THREE.BufferGeometry {
  // Cylinder along Y by default -> rotate to extend along +Z from z=0 to z=+length
  const geom = new THREE.CylinderGeometry(radiusFar, radiusNear, length, radialSegments, 1, true);
  geom.translate(0, length * 0.5, 0);
  geom.rotateX(Math.PI * 0.5);
  return geom;
}

/**
 * Volumetric god-ray beam material:
 * Bright hot core along the center axis, silky Fresnel edge fade (zero hard tube silhouette!),
 * plus subtle drifting cathedral mist waves. Strictly NaN-safe GLSL.
 */
export function createVolumetricBeamMaterial(
  coreHex: number,
  haloHex: number,
  softPower: 'core' | 'halo' = 'halo',
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uCoreColor: { value: new THREE.Color(coreHex) },
      uHaloColor: { value: new THREE.Color(haloHex) },
      uIsCore: { value: softPower === 'core' ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uCoreColor;
      uniform vec3 uHaloColor;
      uniform float uIsCore;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
        // Smooth Fresnel falloff: sharp hot center for core, silky atmospheric cone for volumetric halo
        float profile = mix(ndv * ndv * ndv, ndv * ndv * ndv * ndv, uIsCore);

        // Longitudinal fade: bright near emitter root, softly dissolving into cathedral dome distance
        float rootFade = smoothstep(0.0, 0.06, vUv.y);
        float tipFade = 1.0 - smoothstep(0.32, 1.0, vUv.y);

        // Subtle drifting incense-mist shimmer along the light beam
        float mist = 0.84 + 0.16 * sin(vUv.y * 16.0 - uTime * 2.8 + vUv.x * 6.2831);

        vec3 col = mix(uHaloColor, uCoreColor, smoothstep(0.25, 0.9, ndv));
        float boost = mix(0.56, 1.4, uIsCore);
        float alpha = profile * rootFade * tipFade * mist * uOpacity * mix(0.26, 0.78, uIsCore);

        gl_FragColor = vec4(col * boost, alpha);
      }
    `,
  });
}

/**
 * Animated stained-glass / laser ribbon shader for curved 3D TubeGeometry ribbons.
 */
export function createPrismaticRibbonMaterial(colorHex: number, phaseOffset = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uColor: { value: new THREE.Color(colorHex) },
      uPhase: { value: phaseOffset },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform float uPhase;

      varying vec2 vUv;

      void main() {
        float endFade = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
        float pulse = 0.45 + 0.55 * sin(vUv.x * 14.0 - uTime * 3.6 + uPhase);
        float shimmer = 0.72 + 0.28 * cos(vUv.y * 6.2831 + uTime * 2.0);
        vec3 col = mix(uColor, vec3(1.0, 0.97, 0.86), pulse * 0.42);
        float alpha = endFade * (0.28 + pulse * 0.52) * shimmer * uOpacity;
        gl_FragColor = vec4(col * 1.15, alpha);
      }
    `,
  });
}
