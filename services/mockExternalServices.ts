// In a real application, these would make fetch calls to the respective APIs.
// We are mocking them to provide a working UI experience.

import { Character, BigShot } from "../types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const generateCharacterDesign = async (character: Character, style: string): Promise<string> => {
  console.log(`[NanoBanana] Generating character ${character.name} in style ${style}...`);
  await delay(1500); 
  // Return a stable placeholder based on name length to simulate variety
  const seed = character.name.length;
  return `https://picsum.photos/seed/${seed}/400/600`;
};

export const generateStoryboardImage = async (description: string, style: string): Promise<string> => {
  console.log(`[NanoBanana] Generating storyboard: ${description.substring(0, 30)}...`);
  await delay(1000);
  const randomId = Math.floor(Math.random() * 1000);
  return `https://picsum.photos/seed/${randomId}/640/360`;
};

export const generateSoraVideo = async (optimizedPrompt: string): Promise<string> => {
  console.log(`[Sora 2] Generating video for prompt length ${optimizedPrompt.length}...`);
  await delay(3000); // Simulate processing time
  // Returning a sample video URL (Big Buck Bunny is standard for tests, using a short clip or placeholder)
  // Since we can't generate real video, we use a placeholder link.
  return "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";
};
