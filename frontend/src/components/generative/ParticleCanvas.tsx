/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMediaStore } from "@/store/useMediaStore";

// Dynamically import Sketch to prevent SSR issues with p5
const Sketch = dynamic(() => import("react-p5").then((mod) => mod.default), {
  ssr: false,
});

export default function ParticleCanvas() {
  const [isDesktop, setIsDesktop] = useState(false);
  const hoverColor = useMediaStore((state) => state.hoverColor);

  useEffect(() => {
    const checkIsDesktop = () => setIsDesktop(window.innerWidth > 768);
    checkIsDesktop();
    window.addEventListener("resize", checkIsDesktop);
    return () => window.removeEventListener("resize", checkIsDesktop);
  }, []);

  const particlesRef = useRef<any[]>([]);
  const noiseScaleRef = useRef(0.01);
  const currentHueRef = useRef(200); // Default blue

  if (!isDesktop) return null;

  const numParticles = 800;

  // Parse color string to HSB rough estimate or just use fixed hues for simplicity
  const updateHue = (p5: any) => {
    // If we have a hex color in state, we could convert to HSB.
    // For now, we will smoothly shift towards a target hue based on hover.
    let targetHue = 200;
    if (hoverColor) {
      // Simple hash of color string to get a target hue between 0-360
      let hash = 0;
      for (let i = 0; i < hoverColor.length; i++) {
        hash = hoverColor.charCodeAt(i) + ((hash << 5) - hash);
      }
      targetHue = Math.abs(hash % 360);
    }

    // Lerp current hue to target hue
    currentHueRef.current = p5.lerp(currentHueRef.current, targetHue, 0.05);
  };

  const setup = (p5: any, canvasParentRef: Element) => {
    p5.createCanvas(window.innerWidth, window.innerHeight).parent(canvasParentRef);
    p5.colorMode(p5.HSB, 360, 100, 100, 100);

    // Clear particles before pushing new ones, in case of strict mode double setup
    particlesRef.current = [];
    for (let i = 0; i < numParticles; i++) {
      particlesRef.current.push({
        x: p5.random(p5.width),
        y: p5.random(p5.height),
        vx: 0,
        vy: 0,
        age: p5.random(100),
        maxAge: p5.random(200, 400)
      });
    }
  };

  const draw = (p5: any) => {
    updateHue(p5);

    // Slight fade for trails
    p5.background(0, 0, 0, 10);

    p5.noStroke();

    const particles = particlesRef.current;
    const noiseScale = noiseScaleRef.current;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      const angle = p5.noise(p.x * noiseScale, p.y * noiseScale, p5.frameCount * 0.005) * p5.TWO_PI * 4;

      p.vx = p5.cos(angle) * 0.5;
      p.vy = p5.sin(angle) * 0.5;

      p.x += p.vx;
      p.y += p.vy;
      p.age++;

      // Calculate opacity based on age (fade in and fade out)
      let opacity = 0;
      if (p.age < 50) {
        opacity = p5.map(p.age, 0, 50, 0, 30);
      } else if (p.age > p.maxAge - 50) {
        opacity = p5.map(p.age, p.maxAge - 50, p.maxAge, 30, 0);
      } else {
        opacity = 30;
      }

      p5.fill(currentHueRef.current, 70, 100, opacity);
      p5.circle(p.x, p.y, 1.5);

      // Reset particle if it leaves screen or gets too old
      if (p.x < 0 || p.x > p5.width || p.y < 0 || p.y > p5.height || p.age > p.maxAge) {
        p.x = p5.random(p5.width);
        p.y = p5.random(p5.height);
        p.age = 0;
        p.maxAge = p5.random(200, 400);
      }
    }
  };

  const windowResized = (p5: any) => {
    p5.resizeCanvas(window.innerWidth, window.innerHeight);
  };

  return (
    <div className="fixed inset-0 pointer-events-none -z-10">
      <Sketch setup={setup} draw={draw} windowResized={windowResized} />
    </div>
  );
}
