import { parseAllVideos } from "./parseAllVideos.ts";

parseAllVideos(document.querySelectorAll("video"));

(<any>window).handleFrameChange = (f) => {
  const currentTime = parseFloat(f.data);
  if (!isNaN(currentTime)) {
    document.querySelectorAll("video").forEach((video) => {
      video.currentTime = currentTime;
    });
  }
};
