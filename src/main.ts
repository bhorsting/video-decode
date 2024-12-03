import { VideoFrameExtractor } from "./VideoFrameExtractor.ts";

const testVideo = document.getElementById("video");
const posterElement = document.getElementById("videoPoster");

const extractor: VideoFrameExtractor = new VideoFrameExtractor(
  testVideo as HTMLVideoElement,
  posterElement as HTMLVideoElement
);

async function start() {
  await extractor.start();
}

start();
