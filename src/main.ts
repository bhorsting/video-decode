import {VideoFrameExtractor} from "./VideoFrameExtractor.ts";

const testVideo = document.getElementById('video');
const extractor: VideoFrameExtractor = new VideoFrameExtractor(testVideo as HTMLVideoElement);

async function start() {
    await extractor.start();
}

start();
