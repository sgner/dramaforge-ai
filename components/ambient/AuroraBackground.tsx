/**
 * AuroraBackground.tsx — 电影感 WebGL 动态背景（Three.js + 自定义 GLSL）
 *
 * 特性：域扭曲 fbm 网格渐变 + 极光光带 + 双浮动光源 + 胶片颗粒 + 暗角
 * 交互：鼠标视差（uv 微偏移，lerp 平滑）+ 8~20s 多周期呼吸
 * 性能：像素比封顶 1.5、页面隐藏时暂停、prefers-reduced-motion 时渲染静帧
 * 约束：绝不喧宾夺主——所有光效强度压得很低，底色调到 #040406 附近
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;

  /* 呼吸：16s 与 9s 两个慢周期叠加 */
  float breathe = 0.5 + 0.5 * sin(6.28318 * t / 16.0);
  float breathe2 = 0.5 + 0.5 * sin(6.28318 * t / 9.0 + 1.7);

  /* 鼠标视差：极小幅 uv 偏移 */
  vec2 par = uMouse * 0.055;

  /* 域扭曲 fbm —— 大型网格渐变 */
  vec2 q = p * 1.35 + par;
  float w1 = fbm(q + vec2(0.0, t * 0.016));
  float w2 = fbm(q + 1.7 * w1 + vec2(t * 0.011, -t * 0.009));
  float f = fbm(q + 2.1 * vec2(w1, w2));

  /* 色板：Suno 式暖色电影感——近黑暖底 + 琥珀/橙红/品红/紫罗兰 */
  vec3 base   = vec3(0.020, 0.012, 0.010);
  vec3 amber  = vec3(0.52, 0.24, 0.05);
  vec3 ember  = vec3(0.55, 0.13, 0.08);
  vec3 magenta= vec3(0.44, 0.08, 0.25);
  vec3 violet = vec3(0.20, 0.09, 0.34);

  vec3 col = base;
  col = mix(col, amber,   smoothstep(0.30, 0.85, f) * 0.60);
  col = mix(col, ember,   smoothstep(0.50, 0.95, w2) * 0.50);
  col = mix(col, magenta, smoothstep(0.58, 1.00, w1) * 0.45);
  col = mix(col, violet,  smoothstep(0.70, 1.05, f * w2 * 1.7) * 0.40);

  /* 极光光带：暖橙→品红的柔带，缓慢漂移 + 呼吸 */
  float band = exp(-pow((uv.y - 0.66 - 0.08 * sin(t * 0.05) - w1 * 0.14) * 4.2, 2.0));
  col += vec3(0.38, 0.14, 0.10) * band * (0.35 + 0.25 * breathe2);

  /* 浮动光源 ×2：琥珀 + 品红，缓慢游走的柔光斑（反射感） */
  vec2 asp = vec2(aspect, 1.0);
  vec2 l1 = asp * vec2(0.50 + 0.34 * sin(t * 0.070 + 1.0), 0.56 + 0.24 * cos(t * 0.055));
  vec2 l2 = asp * vec2(0.50 + 0.40 * cos(t * 0.045 + 3.0), 0.40 + 0.28 * sin(t * 0.062 + 2.0));
  col += vec3(0.55, 0.26, 0.08) * 0.11 * exp(-13.0 * dot(p - l1, p - l1));
  col += vec3(0.45, 0.10, 0.28) * 0.09 * exp(-15.0 * dot(p - l2, p - l2));

  /* 全局呼吸亮度 */
  col *= 0.92 + 0.08 * breathe;

  /* 暗角 */
  float vig = smoothstep(1.30, 0.35, length(uv - 0.5) * 1.6);
  col *= mix(0.72, 1.0, vig);

  /* 胶片颗粒 */
  float g = hash(gl_FragCoord.xy + fract(t) * 61.7);
  col += (g - 0.5) * 0.026;

  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = /* glsl */ `
void main() { gl_Position = vec4(position, 1.0); }
`;

export function AuroraBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      });
    } catch {
      return; // 无 WebGL 环境（测试/happy-dom）——静默退出，保留 CSS 底色
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight).multiplyScalar(Math.min(window.devicePixelRatio || 1, 1.5)) },
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
    };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onResize = () => {
      const pr = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer!.setPixelRatio(pr);
      renderer!.setSize(window.innerWidth, window.innerHeight, false);
      uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', onResize);

    let raf = 0;
    const t0 = performance.now();
    const renderFrame = () => {
      mouse.x += (mouse.tx - mouse.x) * 0.045;
      mouse.y += (mouse.ty - mouse.y) * 0.045;
      uniforms.uMouse.value.set(mouse.x, mouse.y);
      uniforms.uTime.value = (performance.now() - t0) / 1000;
      renderer!.render(scene, camera);
    };
    const loop = () => {
      if (document.hidden) { raf = requestAnimationFrame(loop); return; }
      renderFrame();
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      uniforms.uTime.value = 3.2; // 静帧：取一个层次丰富的时刻
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      mesh.geometry.dispose();
      material.dispose();
      renderer!.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      style={{ background: '#050303' }}
    />
  );
}
