"use client";

import React from "react";
import { ShootingStars } from "@/components/ui/shooting-stars";
import { StarsBackground } from "@/components/ui/stars-background";

export function CosmicBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none -z-10">
      <StarsBackground
        starDensity={0.00012}
        allStarsTwinkle
        twinkleProbability={0.8}
        minTwinkleSpeed={0.4}
        maxTwinkleSpeed={1.2}
      />
      <ShootingStars
        starColor="#8B5CF6"
        trailColor="#06B6D4"
        minSpeed={8}
        maxSpeed={25}
        minDelay={2000}
        maxDelay={5000}
        starWidth={12}
        starHeight={1}
      />
      <ShootingStars
        starColor="#06B6D4"
        trailColor="#8B5CF6"
        minSpeed={6}
        maxSpeed={18}
        minDelay={3000}
        maxDelay={7000}
        starWidth={8}
        starHeight={1}
      />
    </div>
  );
}
